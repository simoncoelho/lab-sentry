"""Web app: show a protocol's expected deck, check it with the vision service, then run it.

    .venv/bin/python webapp.py          # then open http://localhost:8000

Protocols and their expected layouts live in protocols.json. The deck state
comes from the vision service's HTTP stream, which is kept open in the
background; checks use its latest message if it is recent enough. The robot is
only asked to create and start a run after a fresh deck check passes.
"""
import json
import threading
from pathlib import Path

import requests
from flask import Flask, jsonify, request, send_from_directory

import vision_model
from opentrons_client import OpentronsClient, OpentronsError

ROOT = Path(__file__).parent
CONFIG = ROOT / "protocols.json"

app = Flask(__name__, static_folder=str(ROOT / "static"))
stream = None
stream_lock = threading.Lock()


class StaleDeckState(Exception):
    pass


def config():
    return json.loads(CONFIG.read_text())


def protocol_config(name):
    for p in config()["protocols"]:
        if p["name"] == name:
            return p
    raise LookupError(f"{name} is not in protocols.json")


def robot():
    return OpentronsClient(config()["robot_host"], timeout=10)


def deck_stream(vision_host):
    """The open stream to vision_host, (re)connecting if the host or settings changed."""
    global stream
    cfg = config()
    url = f"http://{vision_host}:{cfg.get('vision_port', vision_model.PORT)}" \
          f"{cfg.get('vision_stream_path', vision_model.STREAM_PATH)}"
    with stream_lock:
        if stream is None or stream.url != url:
            if stream is not None:
                stream.close()
            stream = vision_model.DeckStream(vision_host, cfg.get("vision_port", vision_model.PORT),
                                             cfg.get("vision_stream_path", vision_model.STREAM_PATH))
        return stream


def latest_layout(vision_host):
    s = deck_stream(vision_host)
    max_age = config().get("stream_max_age_seconds", 10)
    layout, age = s.latest()
    if layout is None:
        raise StaleDeckState(f"No deck state from {s.url} yet" + (f" ({s.last_error})" if s.last_error else ""))
    if age > max_age:
        raise StaleDeckState(f"Latest deck state is {age:.0f} s old (limit {max_age} s)"
                             + (f"; stream: {s.last_error}" if s.last_error else ""))
    return layout


def check_deck(protocol_name, vision_host):
    """Compare the vision service's latest streamed deck state with the protocol's layout.

    Expected slots must be occupied by the named labware with at least
    min_confidence. Every other reported slot must be empty, apart from
    fixtures listed in "allowed_extras". Slots in "ignored_slots" (the A3 tip
    waste) are left out of both sides entirely. Unknown or
    obscured slots never pass, and any problem the service reports with the
    whole reading (error, not fresh, not live) fails the check; the alignment
    section is ignored. Names are
    compared ignoring case and surrounding spaces, but returned as written.
    """
    tidy = lambda d: {str(k).strip().upper(): str(v).strip() for k, v in d.items()}
    same = lambda a, b: a is not None and b is not None and a.lower() == b.lower()
    cfg = config()
    expected = tidy(protocol_config(protocol_name)["layout"])
    allowed = tidy(cfg.get("allowed_extras", {}))
    empty = {e.lower() for e in cfg.get("empty_names", ["Empty"])}
    min_conf = cfg.get("min_confidence", 0.5)
    state = vision_model.parse_deck_state(latest_layout(vision_host))
    ignored = set(tidy(cfg.get("ignored_slots", {})))  # e.g. A3 tip waste: neither expected nor checked
    expected = {s: v for s, v in expected.items() if s not in ignored}
    state["slots"] = {s: v for s, v in state["slots"].items() if s not in ignored}
    slots = []
    for slot in sorted(set(expected) | set(state["slots"])):
        want = expected.get(slot)
        info = state["slots"].get(slot) or {"label": None, "state": "unknown", "confidence": None, "reason": "not reported"}
        got = info["label"]
        confident = info["confidence"] is None or info["confidence"] >= min_conf
        if want is not None:
            match = info["state"] == "occupied" and same(want, got) and confident
        else:  # not used by the protocol: must be empty or an allowed fixture
            match = confident and (info["state"] == "empty" or (got or "").lower() in empty or same(allowed.get(slot), got))
        note = info["reason"] or (f"confidence {info['confidence']:.2f}" if not confident else None)
        slots.append({"slot": slot, "expected": want, "seen": got, "match": match,
                      "extra": want is None and not match and info["state"] == "occupied",
                      "state": info["state"], "confidence": info["confidence"], "note": note})
    ok = not state["problems"] and all(s["match"] for s in slots)
    return {"ok": ok, "problems": state["problems"], "observed_at": state["observed_at"], "slots": slots}


def error(message, status=502, **extra):
    return jsonify({"error": message, **extra}), status


@app.get("/")
def index():
    return send_from_directory(app.static_folder, "index.html")


@app.get("/api/config")
def get_config():
    c = config()
    return jsonify({"protocols": c["protocols"], "vision_host": c.get("vision_host", ""),
                    "vision_port": c.get("vision_port", vision_model.PORT), "robot_host": c["robot_host"],
                    "ignored_slots": c.get("ignored_slots", {})})


@app.get("/api/robot")
def robot_status():
    try:
        bot = robot()
        h = bot.health()
        cur = bot.current_run()
        return jsonify({"name": h["name"], "model": h["robot_model"],
                        "current_run": cur and {"id": cur["id"], "status": cur["status"]}})
    except (OpentronsError, requests.RequestException) as e:
        return error(f"Robot not reachable: {e}")


@app.post("/api/stream")
def api_stream():
    """Connect (or keep) the stream for this host and report its state."""
    return jsonify(deck_stream(request.get_json(force=True)["vision_host"]).status())


@app.post("/api/check")
def api_check():
    body = request.get_json(force=True)
    try:
        return jsonify(check_deck(body["protocol"], body["vision_host"]))
    except LookupError as e:
        return error(str(e), 400)
    except StaleDeckState as e:
        return error(str(e), 409, waiting=True)


@app.post("/api/start")
def api_start():
    body = request.get_json(force=True)
    try:
        check = check_deck(body["protocol"], body["vision_host"])  # re-check right before starting
    except LookupError as e:
        return error(str(e), 400)
    except StaleDeckState as e:
        return error(f"Not started: {e}", 409)
    if not check["ok"]:
        return error("Deck Not In Correct State", 409, check=check)
    try:
        bot = robot()
        proto = bot.find_protocol(body["protocol"])
        run = bot.create_run(proto["id"])
        bot.play(run["id"])
        return jsonify({"run_id": run["id"], "check": check})
    except (OpentronsError, requests.RequestException) as e:
        return error(f"Robot refused to start: {e}", 409, check=check)


@app.get("/api/run/<run_id>")
def api_run(run_id):
    try:
        run = robot().run(run_id)
        return jsonify({"id": run["id"], "status": run["status"], "errors": run.get("errors", [])})
    except (OpentronsError, requests.RequestException) as e:
        return error(str(e))


@app.post("/api/run/<run_id>/<action>")
def api_run_action(run_id, action):
    """pause, resume or stop a run."""
    actions = {"pause": "pause", "resume": "play", "stop": "stop"}
    if action not in actions:
        return error(f"unknown action {action!r}", 404)
    try:
        robot().action(run_id, actions[action])
        return jsonify({"run_id": run_id, "action": action})
    except (OpentronsError, requests.RequestException) as e:
        return error(str(e), 409)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=8000)
