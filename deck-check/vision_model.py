"""Client for the deck vision service (your camera + trained model).

The service runs on another computer, port 5103, and reports deck state
(schemaVersion 1) like:

    {"schemaVersion": 1, "status": "live", "fresh": true, "error": null,
     "observedAt": "...", "ageMs": 17,
     "alignment": {"ok": true, "driftPixels": 2.1, "inliers": 80, "reason": null},
     "slots": [{"slot": "D1", "state": "occupied", "labware": "Microplate",
                "confidence": 0.97, "reason": null}, ...]}

slot state is occupied, empty, obscured or unknown. parse_deck_state() turns
that into per-slot labels plus a list of reasons the whole reading can't be
trusted (error, not fresh, not live). The alignment section is not checked.

Two ways to read it:
  - get_deck_state(host): one REST call, GET /api/v1/deck-state
  - DeckStream(host): keeps the Server-Sent Events stream open
    (GET /api/v1/deck-state/stream, "event: state" / "data: {...}") and holds
    the latest message

Slots are Flex names (A1-D4). Labware names must match protocols.json.

    python vision_model.py 192.168.0.50            # one REST call, print the answer
    python vision_model.py 192.168.0.50 --stream   # print each streamed update
"""
import json
import sys
import threading
import time
import warnings

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")  # macOS system Python; plain HTTP here
import requests  # noqa: E402

PORT = 5103
PATH = "/api/v1/deck-state"  # returns every deck position
STREAM_PATH = "/api/v1/deck-state/stream"
METHOD = "GET"
TIMEOUT = (5, 60)  # seconds: to connect, then for capture + inference
STREAM_IDLE_TIMEOUT = 30  # reconnect if the stream sends nothing for this long
STATE_LABELS = {"empty": "Empty", "obscured": "Obscured", "unknown": "Unknown"}


def to_layout(data, source):
    if not isinstance(data, dict) or not isinstance(data.get("slots"), list):
        raise ValueError(f"{source} did not return a deck state (object with a 'slots' list)")
    return data


def labware_name(labware):
    """Display name of a slot's labware; the service may send a string or an object."""
    if isinstance(labware, dict):
        for key in ("name", "displayName", "label", "class", "loadName"):
            if labware.get(key):
                return str(labware[key])
        return None
    return str(labware) if labware else None


def parse_deck_state(data):
    """{"slots": {slot: {label, state, confidence, reason}}, "problems": [...]} from one deck-state message."""
    problems = []
    if data.get("error"):
        problems.append(f"vision service error: {data['error']}")
    if data.get("status") not in (None, "live"):
        problems.append(f"vision service status is {data['status']!r}")
    if data.get("fresh") is False:
        problems.append("vision service says the reading is not fresh")
    # the "alignment" section is deliberately not checked
    slots = {}
    for s in data.get("slots", []):
        state = str(s.get("state") or "unknown").lower()
        name = labware_name(s.get("labware"))
        label = name if state == "occupied" and name else \
            "Occupied (unidentified)" if state == "occupied" else STATE_LABELS.get(state, state.title())
        slots[str(s.get("slot", "")).strip().upper()] = {
            "label": label, "state": state, "confidence": s.get("confidence"), "reason": s.get("reason")}
    return {"slots": slots, "problems": problems, "observed_at": data.get("observedAt")}


def get_deck_state(host, port=PORT):
    url = f"http://{host}:{port}{PATH}"
    r = requests.request(METHOD, url, timeout=TIMEOUT)
    r.raise_for_status()
    return to_layout(r.json(), url)


def get_deck_layout(host, port=PORT):
    """{slot: label} from one REST call (used by opentrons_client.py)."""
    return {slot: s["label"] for slot, s in parse_deck_state(get_deck_state(host, port))["slots"].items()}


def parse_stream_line(line):
    """JSON object from one stream line, or None for blank lines, SSE comments and other SSE fields."""
    line = line.strip()
    if line.startswith("data:"):
        line = line[5:].strip()
    elif not line or line.startswith(":") or line.split(":", 1)[0] in ("event", "id", "retry"):
        return None
    return json.loads(line)


class DeckStream:
    """Background reader of the deck-state stream; reconnects when it drops."""

    def __init__(self, host, port=PORT, path=STREAM_PATH):
        self.url = f"http://{host}:{port}{path}"
        self.host = host
        self.layout = None
        self.received_at = None
        self.connected = False
        self.last_error = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._response = None
        self._thread = threading.Thread(target=self._run, name=f"deck-stream-{host}", daemon=True)
        self._thread.start()

    def latest(self):
        """(layout, age in seconds), or (None, None) before the first message."""
        with self._lock:
            if self.layout is None:
                return None, None
            return self.layout, time.time() - self.received_at

    def status(self):
        layout, age = self.latest()
        return {"url": self.url, "connected": self.connected, "age_seconds": None if age is None else round(age, 1),
                "last_error": self.last_error, "layout": layout}

    def close(self):
        self._stop.set()
        if self._response is not None:
            self._response.close()

    def _run(self):
        backoff = 1
        while not self._stop.is_set():
            try:
                with requests.get(self.url, stream=True, timeout=(5, STREAM_IDLE_TIMEOUT),
                                  headers={"Accept": "text/event-stream, application/x-ndjson, application/json"}) as r:
                    self._response = r
                    r.raise_for_status()
                    self.connected, self.last_error, backoff = True, None, 1
                    for raw in r.iter_lines(chunk_size=1):  # small reads: hand over each message as soon as it arrives
                        if self._stop.is_set():
                            return
                        data = parse_stream_line(raw.decode("utf-8", "replace"))
                        if data is None:
                            continue
                        layout = to_layout(data, self.url)
                        with self._lock:
                            self.layout, self.received_at = layout, time.time()
                self.last_error = "stream ended"
            except Exception as e:  # keep the reader alive whatever the service sends
                self.last_error = f"{type(e).__name__}: {e}"
            finally:
                self.connected = False
                self._response = None
            self._stop.wait(backoff)
            backoff = min(backoff * 2, 10)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    host = args[0] if args else input("Vision service IP address: ").strip()
    if "--stream" not in sys.argv:
        print(json.dumps(get_deck_layout(host)))
        sys.exit()
    stream, last = DeckStream(host), None
    print(f"reading {stream.url} (Ctrl-C to stop)")
    try:
        while True:
            layout, _ = stream.latest()
            if layout is not None and layout is not last:
                print(json.dumps(layout))
                last = layout
            elif stream.last_error and layout is None:
                print("waiting:", stream.last_error)
            time.sleep(0.5)
    except KeyboardInterrupt:
        stream.close()
