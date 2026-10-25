# Lab Sentry

Local camera-based Opentrons Flex deck detection. Two included YOLO26n models identify labware and deck-slot states. The app shows a live camera view, a 3D deck, and a REST/SSE state API.

## Windows quick start

1. Download this repository from GitHub (**Code → Download ZIP**) and **extract it** to a writable folder. Windows 11 x64 is the tested target; allow a few GB of free space for dependencies.
2. Double-click **Setup.cmd**. First setup needs internet. It installs missing Node.js LTS, .NET 10 SDK, and uv using Windows Package Manager, then installs a private Python environment with **CPU PyTorch**, camera support, and the app. Follow any installer prompts. If Windows Package Manager is unavailable, install those three prerequisites manually and rerun setup.
3. Connect the OBSBOT by USB. Close OBSBOT Center, Windows Camera, and other apps using it.
4. Double-click **Start.cmd**. Keep its console window open. The browser opens at **http://127.0.0.1:5173/**.
5. Choose **Flex deck – included setup** in **Open workspace**, then **05 Train & run → Run detection**. The included **Flex deck – ready to run** model needs no dataset generation or training. **06 Serve** shows the live 3D deck and API.

**No NVIDIA GPU, API key, Codex login, Git installation, or sibling repository is needed for detection.** CPU speed depends on the PC; the UI only reports actual completed observations. `Ctrl+C` in the launcher stops its services. Run Setup again after downloading an update, with the app stopped.

## Camera placement matters

The included setup and models are for the existing fixed deck camera mount and its saved pan/tilt/zoom. Starting detection restores those settings. They recognize **Tip rack, Microplate, Reservoir** and all 12 deck positions; they do not identify arbitrary labware SKUs.

On a different mount, the saved geometry is not automatically correct. Unknown slots / “View changed” mean the reference does not match. Recalibrate and prepare a model for that view using the authoring workflow before relying on slot locations. Do not treat unknown as empty. This is a synthetic-trained baseline adapted to one real layout, not a validated laboratory interlock.

The tested physical camera identifies as **OBSBOT Tiny SE StreamCamera**. The scene's Tiny 2 model does not imply every OBSBOT model has been hardware-tested. Camera video/control are local Windows DirectShow services, downloaded from a pinned revision of [obsbot-control](https://github.com/simoncoelho/obsbot-control) during setup. FFmpeg is not required by the launcher.

## CPU inference vs. training

Start.cmd defaults to CPU inference, including on NVIDIA machines. To use an existing CUDA-enabled Python installation, the developer launcher remains `training/start.ps1`; `LAB_SENTRY_DEVICE=auto|cpu|cuda` selects inference hardware. The packaged CPU Python environment cannot train on CUDA. Fine-tuning is optional and still requires an NVIDIA GPU and a CUDA PyTorch environment; see [training/README.md](training/README.md). Classifier/dataset copilot authoring additionally requires the user's own Codex CLI login. Neither is required to run the included detector.

## Files and model handoff

- `bundled/deck/`: both weights, metrics, camera reference, calibration manifest, and importable `workspace.json`. Paths are relative so moving the checkout works.
- `training/runs/`: locally trained models; not committed. **Model & validation → Download model** exports a portable ZIP. Extract a trusted export into `training/runs/<model-id>/` and restart the app. Import its `workspace.json` through Open workspace. Only load trusted model files; PyTorch checkpoints are executable formats.
- `.runtime/`: private Python environment, camera binaries and logs. Recreated by Setup; not committed.
- `.dependencies/`: pinned camera source. Setup downloads this automatically; no manual clone.
- Browser storage: saved setups and generated datasets. Export a setup to move it between browsers/PCs. Generated training images are not included in this handoff.

## API (unchanged)

Local: `http://127.0.0.1:5102/api/v1/deck-state` and `/api/v1/deck-state/stream` (SSE). All 12 positions are returned, with unknown on stale/invalid observations. The existing schema remains unchanged.

Optional LAN access: run `training/start-lan.ps1` and follow [the LAN setup instructions](training/README.md#local-network-access). It exposes only the read-only state API; the app, camera and control services remain loopback-only. No firewall or router changes are made by Setup/Start.

## Troubleshooting

- **Setup fails while app is running:** stop the launcher first, then retry. Do not run multiple copies.
- **Missing tool after installation:** reopen Setup.cmd so Windows refreshes PATH.
- **No camera:** check USB and Windows camera privacy permissions; close other camera apps.
- **Port in use:** close the previous launcher. Start refuses to kill unrelated applications.
- **Service fails:** inspect `.runtime/logs/video.log`, `control.log`, `inference.log`, and `web.log`.
- **Check installation:** `.runtime\python\Scripts\python.exe tools\doctor.py` loads both models and executes CPU inference without opening the camera.

Dependency and model licensing notes are in [THIRD_PARTY.md](THIRD_PARTY.md).
