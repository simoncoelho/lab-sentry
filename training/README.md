# Local deck detection

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

Runtime matches reference landmarks to reject shifted camera views, associates boxes with calibrated slot geometry, and preserves unknown for ambiguous, stale or unseen observations. A missing object detection is never interpreted as empty by itself. Partially cropped slots cannot be called empty. The reference photograph currently comes from `~/Downloads/lab-sentry-fixed-deck-2026-10-24/calibration-fixed.jpg`; set `LAB_SENTRY_DATASET` before service startup to change the initial dataset and sibling reference location. A different workspace needs its own reference and calibration.

The current library supports tip racks, microplates and reservoirs. Clear-labware product identities and some 3D shapes are approximate. Unsupported tube racks/other labware do not become trained classes merely by appearing in a classifier definition. Runtime confidence is a model score, not a calibrated probability of correctness.

```powershell
./training/.venv/Scripts/python.exe -m unittest discover -s training -p "test_*.py"
```

## Reviewed image effects and saved models

Camera effects in Generate dataset are saved per run. Noise uses a deterministic seed per image; JPEG artifacts and downsampling are baked into losslessly packaged PNGs. The preview and training upload use the same processing function. Originals remain in browser storage. Match stream resolution captures a fresh reference from running detection and uses its dimensions; it does not estimate sensor noise, JPEG quality, lighting, or geometry. Keep validation clean unless deliberately measuring a separate degraded validation set. Source-image hashes prevent effects from hiding cross-split duplicates.

Use generated dataset uploads the saved processed versions. Additional random camera effects during training are opt-in in the UI; the CLI retains its augmentation default. Each completed model remains on disk and appears in the model selector. Save name persists a friendly name, and Download model bundles both detectors, calibration manifest and metrics. Stop detection to select and run an older model.
