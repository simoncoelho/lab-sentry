import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Camera, Plug, Unplug } from "lucide-react";
import type { InstrumentScene } from "./scene";
import { defaultLighting, matchLighting, sampleFrame, type Lighting } from "./lighting-match";
import type { Pose } from "./state";
import { CameraAlignment, type Capture } from "./CameraAlignment";

export function CameraComparison({ scene, cameraControls, fov, setFov, pose, onPose, onAngles, onSave, lighting, setLighting, onContinue }: {
  onContinue: () => void;
  lighting: Lighting; setLighting: (value: Lighting) => void;
  scene: InstrumentScene | null; cameraControls: ReactNode; fov: number; setFov: (value: number) => void;
  pose: Pose; onPose: (pose: Pose) => void; onAngles: (pan: number, tilt: number) => void; onSave: () => boolean;
}) {
  const actualImage = useRef<HTMLImageElement>(null);
  const [capture, setCapture] = useState<{ model: Capture; actual: HTMLCanvasElement } | null>(null);
  const [starting, setStarting] = useState(false);
  const [preview, setPreview] = useState<{ pose: Pose; fov: number; rms: number } | null>(null);
  const [alignmentMessage, setAlignmentMessage] = useState("");
  async function startAlignment() {
    if (!scene) return;
    setStarting(true); setError(""); setAlignmentMessage("");
    try {
      const read = async () => {
        const response = await fetch("/camera-api/state", { signal: AbortSignal.timeout(4000) });
        if (!response.ok) throw new Error("Connect camera controls before aligning.");
        const data = await response.json();
        const pan = data.state?.controls?.Pan?.value, tilt = data.state?.controls?.Tilt?.value;
        if (!data.state?.isConnected || !Number.isFinite(pan) || !Number.isFinite(tilt)) throw new Error("Connect camera controls before aligning.");
        if (data.motion?.moving) throw new Error("Wait for the camera to stop, then align.");
        return { pan, tilt };
      };
      const before = await read();
      onAngles(before.pan, before.tilt);
      await new Promise(resolve => setTimeout(resolve, 800));
      const after = await read();
      if (before.pan !== after.pan || before.tilt !== after.tilt) throw new Error("Camera is still settling. Try again in a moment.");
      const sourceImage = actualImage.current;
      if (!sourceImage) throw new Error("Connect the video first.");
      const actual = document.createElement("canvas");
      actual.width = sourceImage instanceof HTMLVideoElement ? sourceImage.videoWidth : sourceImage.naturalWidth;
      actual.height = sourceImage instanceof HTMLVideoElement ? sourceImage.videoHeight : sourceImage.naturalHeight;
      if (!actual.width || !actual.height) throw new Error("Wait for a camera image.");
      actual.getContext("2d")!.drawImage(sourceImage, 0, 0);
      setCapture({ model: scene.captureAlignment(), actual });
    } catch (failure) { setError((failure as Error).message); }
    finally { setStarting(false); }
  }
  function matchCurrentLighting() {
    setError(""); setAlignmentMessage("");
    try {
      const frame = actualImage.current;
      if (!scene || !frame || status !== "live") throw new Error("Connect the camera first.");
      const expected = scene.captureAlignment().canvas;
      setLighting(matchLighting(sampleFrame(frame), sampleFrame(expected), lighting));
      setAlignmentMessage("Lighting matched. Save workspace to keep it.");
      setShowControls(true);
    } catch (failure) {
      setError(failure instanceof DOMException && failure.name === "SecurityError"
        ? "This stream blocks image sampling. Use USB or the local OBSBOT service, then reconnect."
        : (failure as Error).message);
    }
  }
  useEffect(() => { scene?.setLighting(lighting); }, [scene, lighting]);
  const expectedHost = useRef<HTMLDivElement>(null);
  const [liveUrl, setLiveUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [error, setError] = useState("");
  const [resolution, setResolution] = useState("");
  const [aspect, setAspect] = useState(16 / 9);
  const [expanded, setExpanded] = useState(true);

  const [showControls, setShowControls] = useState(false);
  const fullView = status === "live" && expanded;

  function disconnect() {
    setLiveUrl(""); setStatus("idle"); setResolution("");
  }
  useEffect(() => {
    if (status !== "connecting") return;
    const timeout = setTimeout(() => { disconnect(); setError("OBSBOT is unavailable. Check its USB connection and camera service."); }, 10000);
    return () => clearTimeout(timeout);
  }, [status]);
  useEffect(() => {
    if (!scene || !expectedHost.current) return;
    scene.attachExpectedView(expectedHost.current);
    return () => scene.detachExpectedView();
  }, [scene]);
  useEffect(() => { scene?.setExpectedLens(fov, aspect); }, [scene, fov, aspect]);

  function dimensions(width: number, height: number) {
    if (!width || !height) return;
    setAspect(width / height); setResolution(`${width} x ${height}`);
  }
  function connect() {
    setError(""); setExpanded(true); setShowControls(true);
    setLiveUrl(`/video-api/obsbot/video.mjpeg?orientation=none&session=${Date.now()}`);
    setStatus("connecting");
  }

  return <section className={`camera-comparison${fullView ? " comparison-full-view" : ""}`} style={{ "--camera-aspect": aspect } as CSSProperties} aria-label="Expected and actual camera views">
    <header><div><h2>Camera calibration</h2></div><div className="comparison-actions"><button disabled={status !== "live" || starting || !!capture} title="Estimate brightness and color from the current frame. Align the camera first." onClick={matchCurrentLighting}>Match lighting</button><button className="primary-action" disabled={status !== "live" || starting || !!preview} onClick={() => void startAlignment()}>{starting ? "Settling..." : "Align camera"}</button><button aria-expanded={showControls} aria-controls="comparison-camera-controls" onClick={() => setShowControls(value => !value)}>Controls</button><span className={`camera-status ${status}`} role="status">{status === "live" ? "Live" : status === "connecting" ? "Connecting…" : "Offline"}</span>{status === "live" && <>
      <button onClick={() => setExpanded(value => !value)}>{fullView ? "Exit full screen" : "Full screen"}</button>
      {fullView && <button className="primary-action" onClick={onContinue}>Save & continue</button>}
      <button onClick={disconnect}><Unplug size={14}/>Disconnect</button>
    </>}{status === "connecting" && <button onClick={disconnect}>Cancel</button>}</div></header>
    {preview && <div className="alignment-review"><span>Preview  /  fit error {(preview.rms * 100).toFixed(2)}% of image dimensions</span><button onClick={() => { onPose(preview.pose); setFov(preview.fov); setPreview(null); }}>Discard alignment</button><button className="primary-action" onClick={() => { if (onSave()) { setPreview(null); setAlignmentMessage("Alignment saved to workspace"); } }}>Save alignment to workspace</button></div>}
    {alignmentMessage && <div className="alignment-review" role="status">{alignmentMessage}</div>}
    {capture && <CameraAlignment capture={capture.model} actual={capture.actual} fov={fov} aspect={aspect} onCancel={() => setCapture(null)} onApply={(nextPose, nextFov, rms) => { setPreview({ pose: { ...pose }, fov, rms }); onPose(nextPose); setFov(nextFov); setCapture(null); }}/>}
    <div inert={starting || !!capture} className={`comparison-body${showControls ? " with-controls" : ""}`}>
    <div className="comparison-views">
      <section className="comparison-pane"><div className="comparison-heading"><span>Expected</span><small>Model</small></div><div className="image-well"><div className="expected-image" ref={expectedHost} style={{ aspectRatio: aspect }}/></div></section>
      <section className="comparison-pane"><div className="comparison-heading"><span>OBSBOT</span><small>{resolution || "Not connected"}</small></div><div className="image-well">

        {liveUrl && <img ref={actualImage} src={liveUrl} alt="Live OBSBOT camera feed" onLoad={e => { dimensions(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); setStatus("live"); }} onError={() => { disconnect(); setError("OBSBOT is unavailable. Check its USB connection and camera service."); }} />}
        {status === "connecting" && <div className="camera-empty" role="status"><Camera size={28}/><span>Connecting to OBSBOT…</span></div>}
        {status === "idle" && <div className="camera-empty"><Camera size={28}/><button className="primary-action" onClick={connect}><Plug size={14}/>Connect OBSBOT</button></div>}
      </div></section>
    </div>
    <aside hidden={!showControls} className="comparison-camera-controls" id="comparison-camera-controls" aria-label="Camera controls"><header><div><h3>Adjust</h3></div><button aria-label="Close camera controls" onClick={() => setShowControls(false)}>×</button></header>{cameraControls}<div className="lens-control" id="comparison-lens">{JSON.stringify(lighting) !== JSON.stringify(defaultLighting) && <button title="Restore the reference lab lighting" onClick={() => { setLighting(defaultLighting); setAlignmentMessage("Lighting reset. Save workspace to keep it."); }}>Reset light</button>}<label htmlFor="expected-fov">Field of view <strong>{fov.toFixed(1)}°</strong></label><input id="expected-fov" aria-label="Expected horizontal field of view" type="range" min="30" max="120" step=".1" value={fov} onChange={e => setFov(Number(e.target.value))}/></div></aside>
    </div>
    {error && <p className="camera-error" role="alert">{error}</p>}


  </section>;
}
