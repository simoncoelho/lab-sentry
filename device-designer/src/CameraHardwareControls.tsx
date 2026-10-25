import { useEffect, useRef, useState } from "react";
import { LiveTarget } from "./live-target";
import { settledAngles } from './settled-angles';

type Reading = { value: number | null; range: { min: number; max: number; step: number } | null; error?: string };
type CameraState = { isConnected: boolean; device?: { displayName: string }; controls: { Pan?: Reading; Tilt?: Reading; Zoom?: Reading }; lastError?: string };
async function cameraRequest(path: string, body?: object) {
  const response = await fetch(`/camera-api/${path}`, { signal: AbortSignal.timeout(4000), ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(data.error || "Camera service unavailable.");
  return data;
}

export function CameraHardwareControls({ onReading, preset, detection = false }: { detection?: boolean; onReading: (pan: number, tilt: number, zoom?: number, device?: string) => void; preset?: { pan: number; tilt: number; zoom: number; device: string } }) {
  const [state, setState] = useState<CameraState | null>(null);
  const [linked, setLinked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [target, setTarget] = useState<{ Pan: number; Tilt: number; Zoom: number | null }>({ Pan: 0, Tilt: 0, Zoom: null });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [following, setFollowing] = useState(false);
  const desired = useRef(target);
  const connected = useRef(false);
  const shutdown = useRef<Promise<unknown>>(Promise.resolve());
  const queue = useRef<LiveTarget<{ Pan: number; Tilt: number; Zoom: number | null }> | null>(null);
  if (!queue.current) queue.current = new LiveTarget(async value => {
    await cameraRequest("target", { pan: value.Pan, tilt: value.Tilt, zoom: value.Zoom });
  }, () => { setError("Camera control connection failed. Reconnect before moving again."); setLinked(false); });
  useEffect(() => {
    let active = true;
    // React effect replay / hot reload must wait for the previous stop before
    // reopening the queue. Otherwise it stays paused or stops a newer target.
    void shutdown.current.then(() => { if (active) queue.current?.resume(); });
    return () => {
      active = false;
      const shouldStop = connected.current;
      shutdown.current = queue.current!.pause().then(() => shouldStop ? cameraRequest("stop", {}) : undefined).catch(() => {});
    };
  }, []);
  const callback = useRef(onReading);
  callback.current = onReading;
  function accept(next: CameraState, moving = true) {
    setState(next);
    const pan = next.controls.Pan?.value, tilt = next.controls.Tilt?.value;
    if (next.isConnected && Number.isFinite(pan) && Number.isFinite(tilt)) {
      // Keep raw readings visible, but avoid a one-degree encoder fluctuation
      // moving the calibrated projection after the target has settled.
      const angles = settledAngles({ pan: pan!, tilt: tilt! }, { pan: desired.current.Pan, tilt: desired.current.Tilt }, moving);
      callback.current(angles.pan, angles.tilt, next.controls.Zoom?.value ?? undefined, next.device?.displayName);
    }
  }
  useEffect(() => {
    if (!linked) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await cameraRequest("state");
        const next: CameraState = result.state;
        if (!active) return;
        accept(next, result.motion.moving);
        setFollowing(result.motion.moving);
        setError(result.motion.error || "");
        if (!next.isConnected) { setError("Camera disconnected. Reconnect controls."); setLinked(false); return; }
      } catch { if (active) { void queue.current?.pause(); setError("Lost camera control connection. Reconnect controls."); setLinked(false); } return; }
      if (active) timer = setTimeout(poll, 100);
    }
    void poll();
    return () => { active = false; clearTimeout(timer); };
  }, [linked]);
  async function connect() {
    setBusy(true); setError("");
    try {
      await shutdown.current;
      const next: CameraState = await cameraRequest("connect", {});
      accept(next);
      if (!next.isConnected || next.controls.Pan?.value == null || next.controls.Tilt?.value == null) throw new Error("Camera pan/tilt readings are unavailable.");
      desired.current = { Pan: next.controls.Pan.value, Tilt: next.controls.Tilt.value, Zoom: next.controls.Zoom?.value ?? null };
      setTarget(desired.current); queue.current?.resume(); connected.current = true; setLinked(true);
      setMessage("");
    } catch (e) { setError(e instanceof Error ? e.message : "Cannot connect camera controls."); }
    finally { setBusy(false); }
  }
  function changeTarget(axis: "Pan" | "Tilt" | "Zoom", value: number) {
    desired.current = { ...desired.current, [axis]: value };
    setTarget(desired.current); setFollowing(true); setMessage(axis === "Zoom" ? "Zoom changes framing. Re-align the expected view afterward." : ""); setError("");
    queue.current?.push(desired.current);
  }
  function restorePreset() {
    if (!preset) return;
    if (preset.device !== state?.device?.displayName) { setError('Saved view belongs to a different camera.'); return; }
    desired.current = { Pan: preset.pan, Tilt: preset.tilt, Zoom: preset.zoom };
    setTarget(desired.current); setFollowing(true); setError('');
    setMessage('Restoring saved PTZ. Let motion and autofocus settle before detection.');
    queue.current?.push(desired.current);
  }
  async function stop() {
    setBusy(true);
    try {
      await queue.current?.pause();
      const next: CameraState = await cameraRequest("stop", {});
      accept(next);
      desired.current = { Pan: next.controls.Pan?.value ?? target.Pan, Tilt: next.controls.Tilt?.value ?? target.Tilt, Zoom: next.controls.Zoom?.value ?? target.Zoom };
      setTarget(desired.current); setFollowing(false); setError(""); setMessage("Stopped. Drag a slider to move again."); queue.current?.resume();
    }
    catch { setError("Could not stop camera through the control service."); }
    finally { setBusy(false); }
  }
  return <div className="hardware-controls">
    <p className="hardware-label">{detection ? "Camera" : linked ? state?.device?.displayName : "Link camera controls"}</p>
    {!linked && <button disabled={busy} onClick={() => void connect()}>{busy ? "Connecting…" : "Connect camera controls"}</button>}
    {linked && <>
      <div className={`live-motion-status ${following ? "following" : "settled"}`} role="status"><span/>{error ? "Motion stopped" : following ? "Following…" : "Live · ready"}</div>
      {(["Pan", "Tilt", "Zoom"] as const).map(axis => {
        const reading = state?.controls[axis], hardwareRange = reading?.range;
        const range = hardwareRange;
        const unit = axis === "Zoom" ? "" : "°";
        const nudge = (direction: number) => {
          if (!range) return;
          changeTarget(axis, Math.max(range.min, Math.min(range.max, (desired.current[axis] ?? range.min) + direction * Math.max(1, range.step))));
        };
        return <div className="joint-control" key={axis}><div className="control-label"><label htmlFor={`hardware-${axis}`}>{axis}</label><span>{reading?.value ?? "—"}{unit} actual</span></div><input id={`hardware-${axis}`} aria-label={`Camera ${axis} target`} type="range" min={range?.min ?? 0} max={range?.max ?? 0} step={Math.max(1, range?.step ?? 1)} value={target[axis] ?? range?.min ?? 0} disabled={busy || !range || reading?.value == null} onChange={e => changeTarget(axis, Number(e.target.value))}/><div className="range-labels"><span>{range?.min}{unit}</span><span>{range ? `Target ${target[axis] ?? "—"}${unit}` : "Unavailable"}</span><span>{range?.max}{unit}</span></div>{detection && <div className="camera-nudges"><button aria-label={`Decrease camera ${axis.toLowerCase()}`} disabled={busy || !range || reading?.value == null} onClick={() => nudge(-1)}>−</button><button aria-label={`Increase camera ${axis.toLowerCase()}`} disabled={busy || !range || reading?.value == null} onClick={() => nudge(1)}>+</button></div>}</div>;
      })}
      {!detection && <p>Drag to aim live. New input replaces the previous target; allow a moment for the camera and video to catch up.</p>}
      <div className="hardware-actions"><button disabled={busy} onClick={() => void stop()}>{busy ? "Stopping…" : "Stop"}</button>{preset && <button disabled={busy} onClick={restorePreset} title="Return camera to the calibrated pan, tilt and zoom">Restore view</button>}</div>
    </>}
    {message && <p role="status">{message}</p>}{error && <p className="camera-error" role="alert">{error}</p>}
    {!detection && <p>Reported angles drive the model. Mount alignment and optical calibration still determine whether the images match.</p>}
  </div>;
}
