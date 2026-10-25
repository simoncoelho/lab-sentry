# Camera controls bridge

The comparison view can link physical OBSBOT pan/tilt to the Tiny 2 model. It reads actual camera angles every 100 ms. Dragging a slider sends the latest target at most once per 120 ms, without overlapping requests or queuing old positions. The panel is open by default, including mount position, rotation and lens field of view. Closing the control panel keeps synchronization running. **Stop camera** clears pending browser targets, waits for any in-flight acknowledgement, then cancels server motion. Leaving calibration also clears queued motion and stops the camera. Reported angles, not slider targets, drive the model; a catching-up indicator makes hardware lag visible. Position and rotation edit only the modeled mount. Use **Save workspace** to persist that pose and the current joint readings.

## Run locally (Windows)

Requires .NET 10 and the existing `obsbot-control` repository next to `lab-sentry`:

```powershell
dotnet run --project camera-bridge/CameraBridge.csproj
```

For another checkout location, pass `-p:ObsbotRoot=C:/path/to/obsbot-control` when building/running. The bridge references its `Obsbot.Control` and `Obsbot.Motion` projects without copying them. It binds only to `127.0.0.1:5101`; Vite proxies `/camera-api`. The existing video service on port 5100 remains separate. Production hosting must provide the same API proxy on a trusted local host; the static build alone does not control hardware.

The bridge accepts JSON POSTs from the local viewer, validates the connected hardware ranges, keeps one active move plus one replaceable pending target, and uses `TeachPointMotionController` in `AbsoluteSetpoint` mode, using repeated feedback-guided targets to recover from single-command stalls. New targets cancel the previous monitored move before starting another. The controller uses two-degree settling tolerance and an eight-second timeout; failures appear in the UI. This replaces the coarse eight-degree setpoint profile used for the initial discrete controls. Driver-reported angles are treated as degrees and converted to URDF radians. Pan and tilt respect the attached camera's reported limits; the visual model accepts measured angles beyond the reconstructed Tiny 2 range (for example Tiny SE tilt at 85 degrees). No commands are issued merely by loading the page or opening the panel.

The currently attached device identifies as Tiny SE, while the geometric model is Tiny 2. Shared pan/tilt readings do not establish calibrated optical alignment: verify angle conventions, mount orientation, lens field of view and any zero offsets against the real mounting. Zoom is not coupled because its mapping to optical field of view has not been calibrated.

## Alignment and zoom

**Align camera** freezes the expected and actual images after checking that the hardware has settled. Match at least six fixed landmarks across the images, then choose **Fit & preview**. Lens fitting is optional; the default preserves the current field of view. **Save alignment to workspace** saves the modeled mount pose and field of view in browser storage and workspace exports. **Discard alignment** restores the previous pose and lens. The fit assumes a pinhole camera and needs a roughly positioned initial mount.

The **Zoom** slider sends the device-reported raw zoom value through the same latest-target queue as pan and tilt. Unsupported zoom is disabled. Changing zoom does not automatically adjust the modeled field of view; re-align after changing zoom. The bridge excludes virtual OBSBOT devices when connecting to physical controls.
