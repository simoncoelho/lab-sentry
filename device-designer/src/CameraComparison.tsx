import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Camera, Plug, Unplug } from "lucide-react";
import type { InstrumentScene } from "./scene";

export function CameraComparison({ scene }: { scene: InstrumentScene | null }) {
  const expectedHost = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const request = useRef(0);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [source, setSource] = useState<"usb" | "service">("usb");
  const [serviceUrl, setServiceUrl] = useState("http://127.0.0.1:5100/obsbot/video.mjpeg?orientation=none");
  const [liveUrl, setLiveUrl] = useState("");
  const [status, setStatus] = useState<"idle" | "connecting" | "live">("idle");
  const [error, setError] = useState("");
  const [deviceLabel, setDeviceLabel] = useState("");
  const [resolution, setResolution] = useState("");
  const [aspect, setAspect] = useState(16 / 9);
  const [fov, setFov] = useState(70);
  const [discovering, setDiscovering] = useState(false);

  function stopTracks() {
    request.current++;
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream.current = null;
    if (video.current) video.current.srcObject = null;
  }
  function disconnect() {
    stopTracks(); setLiveUrl(""); setStatus("idle"); setResolution(""); setDeviceLabel("");
  }
  useEffect(() => {
    let active = true;
    async function discover() {
      if (!navigator.mediaDevices?.enumerateDevices) return;
      try {
        const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        if (!active) return;
        setDevices(cameras);
        setDeviceId(previous => cameras.some(d => d.deviceId === previous) ? previous : cameras.find(d => /obsbot/i.test(d.label))?.deviceId || "");
      } catch { if (active) setError("Camera discovery is unavailable. Use localhost in a browser with camera access, or choose the OBSBOT service."); }
    }
    void discover();
    navigator.mediaDevices?.addEventListener("devicechange", discover);
    return () => { active = false; stopTracks(); navigator.mediaDevices?.removeEventListener("devicechange", discover); };
  }, []);
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
  async function allowCameraAccess() {
    if (!navigator.mediaDevices?.getUserMedia) { setError("USB access is unavailable here. Use the OBSBOT service or open this app in Chrome or Edge."); return; }
    setDiscovering(true); setError("");
    const current = request.current;
    try {
      // Browsers withhold device names until permission is granted. Release
      // this discovery stream immediately; preview uses the selected exact ID.
      const permissionStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      permissionStream.getTracks().forEach(track => track.stop());
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      if (current !== request.current) return;
      setDevices(cameras); setDeviceId(cameras.find(d => /obsbot/i.test(d.label))?.deviceId || "");
    } catch { if (current === request.current) setError("Could not get camera access. Allow camera permission or use the OBSBOT service."); }
    finally { if (current === request.current) setDiscovering(false); }
  }
  async function connect() {
    disconnect(); setError("");
    if (source === "service") {
      try {
        const url = new URL(serviceUrl);
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
        setLiveUrl(url.href); setStatus("connecting"); setDeviceLabel("OBSBOT service");
      } catch { setError("Enter an HTTP or HTTPS camera stream URL without embedded credentials."); }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) { setError("USB camera access is unavailable in this browser. Open the app in Chrome or Edge, or use the OBSBOT service."); return; }
    if (!deviceId) { setError("Select the OBSBOT camera from the camera list first."); return; }
    const current = request.current;
    setStatus("connecting");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: false, video: { deviceId: { exact: deviceId }, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
      if (request.current !== current) { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      const track = media.getVideoTracks()[0];
      setDeviceLabel(track.label || "Selected camera");
      track.onended = () => { disconnect(); setError("The camera disconnected. Reconnect it and try again."); };
      if (video.current) { video.current.srcObject = media; await video.current.play(); }
      if (request.current !== current) return;
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      if (request.current === current) setDevices(cameras);
    } catch (failure) {
      if (request.current !== current) return;
      disconnect();
      const name = failure instanceof DOMException ? failure.name : "";
      setError(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access for this page and try again." : name === "NotFoundError" || name === "OverconstrainedError" ? "That camera is no longer available. Connect the OBSBOT and select it again." : "Could not open the camera. Close other apps using it and try again, or use the OBSBOT service.");
    }
  }

  return <section className="camera-comparison" style={{ "--camera-aspect": aspect } as CSSProperties} aria-label="Expected and actual camera views">
    <header><div><span className="small-label">CAMERA VIEW COMPARISON</span><h2>Expected & actual</h2></div><span className={`camera-status ${status}`} role="status">{status === "live" ? "Live camera" : status === "connecting" ? "Connecting..." : "Camera disconnected"}</span></header>
    <div className="comparison-views">
      <section className="comparison-pane"><div className="comparison-heading"><span>Expected</span><small>Saved Tiny 2 pose</small></div><div className="image-well"><div className="expected-image" ref={expectedHost} style={{ aspectRatio: aspect }}/></div><p>Saved pose, not an automatic alignment. Edit camera placement if the model is out of frame.</p></section>
      <section className="comparison-pane"><div className="comparison-heading"><span>Actual</span><small>{resolution || "Waiting for camera"}</small></div><div className="image-well">
        <video ref={video} muted playsInline autoPlay hidden={source !== "usb" || status === "idle"} onLoadedMetadata={e => dimensions(e.currentTarget.videoWidth, e.currentTarget.videoHeight)} onPlaying={() => setStatus("live")} />
        {liveUrl && <img src={liveUrl} alt="Live OBSBOT camera feed" onLoad={e => { dimensions(e.currentTarget.naturalWidth, e.currentTarget.naturalHeight); setStatus("live"); }} onError={() => { disconnect(); setError("The OBSBOT stream could not be loaded. Check its address and that the camera service is running."); }} />}
        {status === "idle" && <div className="camera-empty"><Camera size={28}/><strong>Connect your OBSBOT</strong><p>Choose a USB camera or the existing camera service.</p></div>}
      </div><p>{deviceLabel || "Video only. No audio is requested."}</p></section>
    </div>
    <div className="camera-connect">
      <label>Source<select aria-label="Camera source" value={source} disabled={status !== "idle"} onChange={e => { setSource(e.target.value as "usb" | "service"); setError(""); }}><option value="usb">USB camera</option><option value="service">OBSBOT service</option></select></label>
      {source === "usb" ? <label className="camera-device">Camera<select aria-label="Camera device" value={deviceId} disabled={status !== "idle"} onChange={e => setDeviceId(e.target.value)}><option value="">Select a camera</option>{devices.map((d, i) => <option key={d.deviceId || i} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label> : <label className="camera-device">Stream address<input aria-label="OBSBOT stream address" value={serviceUrl} disabled={status !== "idle"} onChange={e => setServiceUrl(e.target.value)}/></label>}
      {status === "idle" ? <button className="primary-action" disabled={discovering} onClick={() => void connect()}><Plug size={14}/>Connect camera</button> : <button onClick={disconnect}><Unplug size={14}/>{status === "connecting" ? "Cancel connection" : "Disconnect"}</button>}
    </div>
    {error && <p className="camera-error" role="alert">{error}</p>}
    {source === "usb" && !devices.some(d => /obsbot/i.test(d.label)) && status === "idle" && <div className="camera-guidance"><p>No camera is labeled OBSBOT yet. Connect it by USB, then choose it above.</p><button disabled={discovering} onClick={() => void allowCameraAccess()}>{discovering ? "Requesting access..." : "Allow camera access"}</button><p>Permission briefly opens the default camera to reveal device names, then releases it. Select OBSBOT before starting the preview.</p></div>}
    <div className="lens-control"><label htmlFor="expected-fov">Expected horizontal field of view <strong>{fov.toFixed(1)} degrees</strong></label><input id="expected-fov" aria-label="Expected horizontal field of view" type="range" min="30" max="120" step=".1" value={fov} onChange={e => setFov(Number(e.target.value))}/><p>70 degrees is an initial estimate. Both panes use the camera feed's aspect ratio without mirroring or cropping.</p></div>
  </section>;
}
