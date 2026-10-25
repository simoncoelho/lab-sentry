# deck-check

A small web app that checks the Opentrons Flex deck with the lab-sentry vision
service before running a protocol, and only starts the run if the deck matches.

1. Pick a protocol: the page shows its expected deck layout.
2. **Start protocol**: reads the latest deck state from the vision service's
   stream and shows the found deck. Wrong, missing, extra or unreadable labware
   is marked red with **Deck Not In Correct State**.
3. **Start and run method** (only when the deck matches): checks again, creates
   the run on the robot and presses play. **Pause/Resume** and **Stop** control
   the run while it's going.

## Run it

```bash
cd deck-check
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python webapp.py
```

Open http://localhost:8000 and enter the vision service's IP address. The app
only answers on this computer (it can start runs on the robot).

## Configuration: `protocols.json`

| Key | Meaning |
|---|---|
| `robot_host` | Opentrons robot IP (HTTP API on port 31950) |
| `vision_port`, `vision_stream_path` | Vision service stream: `GET http://<IP>:5103/api/v1/deck-state/stream` (Server-Sent Events) |
| `stream_max_age_seconds` | Deck states older than this are not used (default 10) |
| `min_confidence` | Lowest slot confidence that can pass (default 0.5) |
| `empty_names` | Labels that mean an empty slot |
| `allowed_extras` | `{slot: labware}` that may sit in slots the protocol doesn't use |
| `ignored_slots` | `{slot: label}` left out of the check entirely (A3 is the tip waste) |
| `partial_view_slots` | `{slot: reason}` only partly in the camera's view, so never confirmed empty: they pass when empty or unknown, and fail if labware or an obscured view is detected (D1 with the included camera view) |
| `protocols` | Each protocol's file name on the robot and its expected `layout` `{slot: labware}` |

Labware names must match the vision service's (`Microplate`, `Reservoir`,
`Tip rack`), ignoring case. The run uses the newest protocol on the robot with
that file name.

## What passes

The vision service sends deck-state schema v1 messages: overall `status`,
`fresh` and `error`, plus `slots: [{slot, state, labware, confidence, reason}]`.

- The reading must be `live`, `fresh` and error-free. The `alignment` section is
  not checked.
- Each expected slot must be `occupied` by the named labware with at least
  `min_confidence`.
- Every other reported slot must be `empty` (or an allowed extra).
- `unknown` and `obscured` slots never pass.

## Files

| File | |
|---|---|
| `webapp.py` | Flask server: page, deck check, start/pause/resume/stop |
| `static/index.html` | The page |
| `vision_model.py` | Vision service client: stream reader, REST call, schema parsing |
| `opentrons_client.py` | Opentrons HTTP API wrapper; also a command-line tool (`status`, `protocols`, `run`, `stop`) |
| `protocols/test_opentron_file.py` | Serial-dilution protocol for the current layout (D1 Microplate, D2 Reservoir, B3 and C3 Tip rack) |
