# Local deck detection

For the Windows CPU handoff, use **Setup.cmd → Start.cmd** at the repository root. The included deck model runs without CUDA, a generated dataset, or a Codex login. See the [root quick start](../README.md). The setup below is the optional GPU training/developer path.

The fifth workflow phase prepares the saved synthetic runs, fine-tunes two pretrained YOLO26n detectors on the local NVIDIA GPU, and runs inference on the OBSBOT stream. One detector identifies supported labware classes; the other predicts observed slot states. All twelve positions are returned, including unknown and obscured positions. Nothing is uploaded to a training service.

## Setup

From the repository root, with Python 3.13 and `uv` installed:

```powershell
uv venv --python 3.13 training/.venv
uv pip install --python training/.venv/Scripts/python.exe torch torchvision --index-url https://download.pytorch.org/whl/cu128
uv pip install --python training/.venv/Scripts/python.exe -r training/requirements.txt
./training/start.ps1
```

The service listens only on `127.0.0.1:5102`. Vite proxies `/training-api`. Camera video and control services must be running on ports 5100 and 5101. Training requires CUDA, holds a Windows sleep inhibitor while active, and stores datasets, checkpoints, training logs and metrics under `training/runs/<id>/`. Large artifacts are ignored by Git.

## Workflow

1. Generate training, validation and optional test runs using the same saved calibration and classifier. Keep related layouts within one split.
2. In **Train & run**, select **Use generated dataset**. Exported labels, image integrity, cross-split image duplication and twelve-slot state coverage are checked before training. Classes without training examples are excluded and shown explicitly.
3. Select **Train YOLO**. Both models use pretrained weights, fixed-view augmentation, GPU training, early stopping and separate validation. Progress survives navigation because training runs in a separate process.
4. Select a completed model and **Run detection**. This opens the camera and restores the dataset's saved hardware PTZ. The live image displays detected labware; the deck grid displays observed states.

## Validation and limits

Training samples receive mild Gaussian sensor noise (1–5 intensity levels, 35% probability), slight 3×3 blur (15%), and JPEG compression (quality 75–98, 30%), alongside small HSV exposure/color changes. These effects are resampled during training, leave bounding boxes and slot states unchanged, and never modify saved renders or validation/test images. Some samples remain clean. Parameters are recorded in each run's status and checkpoint configuration. These are conservative initial ranges, not measured camera noise statistics; existing checkpoints require retraining to use them.

Image count alone is not a quality gate. Review per-class counts, distinct layouts, occlusions, negatives and independent validation. Synthetic mAP describes synthetic performance only. Evaluate a separately labeled real-camera set with different physical arrangements before deployment; repeated video frames of one arrangement are not independent evidence.

**Include reviewed camera reference** adds the local `training/data/real-check/image.jpg` and its manually checked `labels.json` to training only. The single image is sampled twenty times to provide domain adaptation, explicitly recorded as one unique image in run metadata. Both labware boxes and optional complete slot states can be supplied. The current reference was labeled from the calibrated camera photograph; checking the same physical arrangement afterward measures fit to a known layout, not generalization. Do not enable this option for a different calibration without replacing and reviewing the reference labels.

Runtime matches reference landmarks to reject shifted camera views, associates boxes with calibrated slot geometry, and preserves unknown for ambiguous, stale or unseen observations. A missing object detection is never interpreted as empty by itself. Partially cropped slots cannot be called empty. The default reference and inference manifest are packaged in `bundled/deck/`. A model-local `calibration-fixed.jpg` travels with exported models; legacy training runs use the matching default reference. Set `LAB_SENTRY_DATASET` to override the default dataset and sibling reference location. A different workspace needs its own reference and calibration. `LAB_SENTRY_DEVICE=auto|cpu|cuda` selects inference hardware; the Windows launcher uses CPU by default.

The current library supports tip racks, microplates and reservoirs. Clear-labware product identities and some 3D shapes are approximate. Unsupported tube racks/other labware do not become trained classes merely by appearing in a classifier definition. Runtime confidence is a model score, not a calibrated probability of correctness.

```powershell
./training/.venv/Scripts/python.exe -m unittest discover -s training -p "test_*.py"
```

## Reviewed image effects and saved models

Camera effects in Generate dataset are saved per run. Noise uses a deterministic seed per image; JPEG artifacts and downsampling are baked into losslessly packaged PNGs. The preview and training upload use the same processing function. Originals remain in browser storage. Match stream resolution captures a fresh reference from running detection and uses its dimensions; it does not estimate sensor noise, JPEG quality, lighting, or geometry. Keep validation clean unless deliberately measuring a separate degraded validation set. Source-image hashes prevent effects from hiding cross-split duplicates.

Use generated dataset uploads the saved processed versions. Additional random camera effects during training are opt-in in the UI; the CLI retains its augmentation default. Each completed model remains on disk and appears in the model selector. Save name persists a friendly name, and Download model bundles both detectors, calibration manifest and metrics. Stop detection to select and run an older model.

## Live state REST API

The final **Serve** workflow step displays the Flex model with live 3D labware and the live JSON response. Start a saved detector in **Train & run**, then open **Serve**. Detection continues without the browser while the Python service is running.

`GET http://127.0.0.1:5102/api/v1/deck-state`

This read-only, loopback-only endpoint returns `schemaVersion: 1`, `instrument`, `modelId`, `status`, `fresh`, UTC `observedAt`, `ageMs`, `error`, and all 12 `slots`. Each slot has `slot`, `state`, `labware`, `confidence` (0–1), and `reason`. States include `empty`, `occupied`, `obscured`, and `unknown`. No observation is inferred from a missing detection.

`status` is `live`, `stale`, `stopped`, or `error`. Responses remain HTTP 200 when the detector is stopped or stale so clients can inspect its state. Observations older than five seconds, stopped detection, or runtime errors return every slot as unknown, with null labware and zero confidence. A fresh frame can still have unknown slots due to uncertain geometry or recognition. Responses have `Cache-Control: no-store`. Poll at approximately 1 Hz; reads do not start training or move the camera.

Example: `curl http://127.0.0.1:5102/api/v1/deck-state`

The live view uses lightweight gray silhouettes for detected Tip rack, Microplate, and Reservoir classes; detailed assets remain in dataset generation. The UI consumes SSE observations and renders independently at display cadence. Detection itself currently runs at approximately 4 Hz, so rendering does not imply new inference on every display frame. It does not claim to identify an exact SKU. Empty slots stay clear; unknown/obscured slots show subtle labels and no inferred labware. The upper enclosure is faded by default and can be restored with Show enclosure.

## Local-network access

Run `training/start-lan.ps1` alongside the local training service. It starts a separate read-only gateway on the LAN interface, port 5103. You can specify `-Address <IPv4>` when multiple interfaces exist. Training, camera controls, videos, and model files remain on the loopback-only service at port 5102.

For this PC, the current address is `http://192.168.0.80:5103/api/v1/deck-state`. Addresses assigned by DHCP may change. In an Administrator PowerShell, run `training/allow-lan.ps1` once to allow TCP 5103 from LocalSubnet on Wi-Fi; pass `-Address`, `-Interface`, or `-Port` to match another configuration. This does not expose the service through the router or change the network profile. No authentication is provided: devices on the allowed subnet can read deck state. The gateway returns HTTP 503 with `fresh:false` if local inference is unavailable.

## Streaming state (SSE)

`GET /api/v1/deck-state/stream` is available on both the local service (5102) and LAN gateway (5103). It uses `text/event-stream`, with named `state` events containing the same full JSON snapshot as REST. A connection gets the current snapshot immediately, then new inference/status snapshots; while idle, a snapshot is sent at least every two seconds. Slow clients receive the latest state rather than a queued history. Reconnect starts with a fresh snapshot; there is no replay log.

```sh
curl -N http://192.168.0.80:5103/api/v1/deck-state/stream
```

```js
const stream = new EventSource('/training-api/api/v1/deck-state/stream');
stream.addEventListener('state', event => {
  const state = JSON.parse(event.data);
  // Check state.fresh and each slot.state before acting.
  console.log(state.slots);
});
// EventSource reconnects automatically. Call stream.close() when done.
```

The Serve UI now uses this stream instead of polling. Disconnect or a five-second stream silence clears the displayed state. The LAN firewall requirement is the same as REST; no additional port is needed. Browser applications on other origins need their own same-origin proxy (cross-origin access is not enabled).
