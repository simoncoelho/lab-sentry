"""Small wrapper around the Opentrons Flex/OT-2 robot HTTP API (port 31950).

    python opentrons_client.py status
    python opentrons_client.py protocols
    python opentrons_client.py run test_opentron_file.py            # creates the run, shows it, does not start
    python opentrons_client.py run test_opentron_file.py --start    # also presses play and waits
    python opentrons_client.py stop <run_id>

Deck check before running: the run is only created (and started) if your vision
model sees the expected labware. The model is the vision service on port 5103
(see vision_model.py); you're prompted for its IP address unless --vision-host
or VISION_HOST gives it. --vision-cmd can instead name any command that prints
the slot -> class map as JSON, e.g. {"D1": "plate", "C2": "tip_rack"}:

    python opentrons_client.py run test_opentron_file.py --start \
        --expect D1=plate C2=tip_rack D2=tip_rack D3=reservoir

From Python, pass any function that returns that map:

    from opentrons_client import OpentronsClient, run_if_deck_ok
    bot = OpentronsClient("192.168.0.226")
    run_if_deck_ok(bot, "test_opentron_file.py",
                   {"D1": "plate", "C2": "tip_rack", "D2": "tip_rack", "D3": "reservoir"},
                   get_layout=my_model.predict_deck, start=True)
"""
import argparse
import json
import os
import shlex
import subprocess
import sys
import time
import warnings
from pathlib import Path

warnings.filterwarnings("ignore", message="urllib3 v2 only supports OpenSSL")  # macOS system Python; plain HTTP here
import requests  # noqa: E402

DEFAULT_HOST = os.environ.get("OPENTRONS_HOST", "192.168.0.226")
ACTIVE = {"idle", "running", "paused", "awaiting-recovery", "awaiting-recovery-paused",
          "awaiting-recovery-blocked-by-open-door", "blocked-by-open-door", "finishing", "stop-requested"}
FINISHED = {"succeeded", "failed", "stopped"}


class OpentronsError(RuntimeError):
    pass


class OpentronsClient:
    def __init__(self, host=DEFAULT_HOST, port=31950, timeout=30):
        self.base = f"http://{host}:{port}"
        self.timeout = timeout
        self.http = requests.Session()
        self.http.headers["Opentrons-Version"] = "3"

    def _call(self, method, path, **kw):
        r = self.http.request(method, self.base + path, timeout=kw.pop("timeout", self.timeout), **kw)
        if not r.ok:
            raise OpentronsError(f"{method} {path} -> HTTP {r.status_code}: {r.text[:500]}")
        return r.json() if r.content else None

    # robot
    def health(self):
        return self._call("GET", "/health")

    def lights(self, on):
        return self._call("POST", "/robot/lights", json={"on": on})

    # protocols
    def protocols(self):
        return self._call("GET", "/protocols")["data"]

    def find_protocol(self, name_or_id):
        """Newest protocol whose id or main file name matches."""
        matches = [p for p in self.protocols()
                   if p["id"] == name_or_id or any(f["name"] == name_or_id for f in p["files"])]
        if not matches:
            raise OpentronsError(f"no protocol named {name_or_id!r} on the robot")
        return max(matches, key=lambda p: p["createdAt"])

    def upload_protocol(self, path):
        path = Path(path)
        with path.open("rb") as f:
            return self._call("POST", "/protocols", files={"files": (path.name, f)}, timeout=120)["data"]

    def analysis(self, protocol_id):
        """Latest analysis; waits while the robot is still analysing."""
        for _ in range(60):
            a = self._call("GET", f"/protocols/{protocol_id}/analyses")["data"][-1]
            if a["status"] == "completed":
                return a
            time.sleep(2)
        raise OpentronsError("protocol analysis did not finish")

    # runs
    def current_run(self):
        link = self._call("GET", "/runs?pageLength=1").get("links", {}).get("current")
        return self._call("GET", link["href"])["data"] if link else None

    def run(self, run_id):
        return self._call("GET", f"/runs/{run_id}")["data"]

    def create_run(self, protocol_id):
        cur = self.current_run()
        if cur and cur["status"] in ACTIVE:
            raise OpentronsError(
                f"robot already has an active run {cur['id']} ({cur['status']}); "
                "stop or dismiss it first, on the touchscreen or with `stop`")
        return self._call("POST", "/runs", json={"data": {"protocolId": protocol_id}})["data"]

    def action(self, run_id, action_type):
        return self._call("POST", f"/runs/{run_id}/actions", json={"data": {"actionType": action_type}})["data"]

    def play(self, run_id):
        return self.action(run_id, "play")

    def pause(self, run_id):
        return self.action(run_id, "pause")

    def stop(self, run_id):
        return self.action(run_id, "stop")

    def dismiss(self, run_id):
        """Stop treating a finished run as the robot's current run."""
        return self._call("PATCH", f"/runs/{run_id}", json={"data": {"current": False}})["data"]

    def wait_for_run(self, run_id, poll=2.0, on_status=print):
        last = None
        while True:
            run = self.run(run_id)
            if run["status"] != last:
                last = run["status"]
                on_status(f"run {run_id}: {last}")
            if last in FINISHED:
                return run
            time.sleep(poll)


def check_deck(expected, seen, require_empty=False):
    """Compare expected {slot: class} with what the model saw; print a table, return True if all match.

    Slots and classes are compared case-insensitively. With require_empty, every
    other slot the model reports must be "empty".
    """
    norm = lambda d: {str(k).strip().upper(): str(v).strip().lower() for k, v in d.items()}
    expected, seen = norm(expected), norm(seen)
    slots = sorted(set(expected) | (set(seen) if require_empty else set()))
    ok = True
    print(f"{'slot':>4}  {'expected':16} seen")
    for slot in slots:
        want, got = expected.get(slot, "empty"), seen.get(slot, "(not reported)")
        flag = "" if want == got else "  <-- MISMATCH"
        ok &= not flag
        print(f"{slot:>4}  {want:16} {got}{flag}")
    print(f"deck check: {'pass' if ok else 'FAIL'}")
    return ok


def run_if_deck_ok(bot, protocol, expected, get_layout, start=False, require_empty=False):
    """Check the deck with get_layout() and only create/start a run if it matches.

    Returns the finished run (start=True), the created run (start=False), or None
    when the deck check fails.
    """
    proto = bot.find_protocol(protocol)
    if not check_deck(expected, get_layout(), require_empty):
        return None
    run = bot.create_run(proto["id"])
    print(f"created run {run['id']} for {proto['files'][0]['name']}")
    if not start:
        return run
    bot.play(run["id"])
    return bot.wait_for_run(run["id"])


def layout_from_command(cmd):
    """Run a vision command and parse the slot -> class JSON it prints."""
    out = subprocess.run(shlex.split(cmd), capture_output=True, text=True, timeout=300)
    if out.returncode:
        raise OpentronsError(f"vision command failed ({out.returncode}): {out.stderr.strip()[-500:]}")
    try:
        layout = json.loads(out.stdout.strip().splitlines()[-1])
    except (IndexError, json.JSONDecodeError):
        raise OpentronsError(f"vision command must print a JSON slot map as its last line; got: {out.stdout[-300:]!r}")
    if not isinstance(layout, dict):
        raise OpentronsError(f"vision command printed {type(layout).__name__}, expected a JSON object")
    return layout


def describe(analysis):
    lines = [f"  pipettes: {', '.join(p['pipetteName'] + ' (' + p['mount'] + ')' for p in analysis['pipettes'])}"]
    for lw in analysis["labware"]:
        slot = lw["location"].get("slotName") if isinstance(lw["location"], dict) else lw["location"]
        lines.append(f"  {slot or '?':>4}: {lw['loadName']}")
    lines.append(f"  {len(analysis.get('commands', []))} commands, analysis result: {analysis.get('result')}")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--host", default=DEFAULT_HOST)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("status")
    sub.add_parser("protocols")
    r = sub.add_parser("run", help="create a run for a protocol already on the robot (or --upload one)")
    r.add_argument("protocol", help="file name or protocol id; with --upload, a local .py path")
    r.add_argument("--upload", action="store_true", help="upload the local file first")
    r.add_argument("--start", action="store_true", help="press play and wait for the run to finish")
    r.add_argument("--expect", nargs="+", metavar="SLOT=CLASS", help="labware that must be on the deck first")
    r.add_argument("--vision-host", default=os.environ.get("VISION_HOST"),
                   help="IP address of the vision service (port 5103); prompted for if not given")
    r.add_argument("--vision-cmd", help="instead of the service, a command that prints the slot -> class map as JSON")
    r.add_argument("--require-empty", action="store_true", help="other reported slots must be empty")
    for name in ("play", "pause", "stop", "dismiss"):
        sub.add_parser(name).add_argument("run_id")
    args = ap.parse_args()

    bot = OpentronsClient(args.host)
    try:
        if args.cmd == "status":
            h = bot.health()
            print(f"{h['name']} ({h['robot_model']}), software {h['api_version']}")
            cur = bot.current_run()
            print(f"current run: {cur['id']} {cur['status']}" if cur else "current run: none")
        elif args.cmd == "protocols":
            for p in sorted(bot.protocols(), key=lambda p: p["createdAt"]):
                print(p["createdAt"][:16], p["id"], p["files"][0]["name"])
        elif args.cmd == "run":
            proto = bot.upload_protocol(args.protocol) if args.upload else bot.find_protocol(args.protocol)
            print(f"protocol {proto['files'][0]['name']} ({proto['id']})")
            print(describe(bot.analysis(proto["id"])))
            if args.expect:
                expected = dict(item.split("=", 1) for item in args.expect)
                if args.vision_cmd:
                    seen = layout_from_command(args.vision_cmd)
                else:
                    import vision_model
                    host = args.vision_host or input("Vision service IP address: ").strip()
                    seen = vision_model.get_deck_layout(host)
                if not check_deck(expected, seen, args.require_empty):
                    sys.exit("deck does not match; run not created")
            run = bot.create_run(proto["id"])
            print(f"created run {run['id']} ({run['status']})")
            if not args.start:
                print("not started; rerun with --start, or press play on the touchscreen")
                return
            bot.play(run["id"])
            final = bot.wait_for_run(run["id"])
            sys.exit(0 if final["status"] == "succeeded" else 1)
        else:
            print(getattr(bot, args.cmd)(args.run_id))
    except (OpentronsError, requests.RequestException, ValueError) as e:
        sys.exit(f"error: {e}")


if __name__ == "__main__":
    main()
