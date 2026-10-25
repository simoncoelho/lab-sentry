import { useEffect, useRef, useState } from "react";
import { fitAlignment, type Match } from "./alignment";
import type { InstrumentScene } from "./scene";
import type { Pose } from "./state";

export type Capture = ReturnType<InstrumentScene["captureAlignment"]>;
export function CameraAlignment({ capture, actual, fov, aspect, onCancel, onApply }: {
  capture: Capture; actual: HTMLCanvasElement; fov: number; aspect: number;
  onCancel: () => void; onApply: (pose: Pose, fov: number, rms: number) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [matches, setMatches] = useState<Match[]>([]);
  const [pending, setPending] = useState<{ world: Match["world"]; model: Match["model"] } | null>(null);
  const [error, setError] = useState("");
  const [fitLens, setFitLens] = useState(false);
  useEffect(() => { dialog.current?.showModal(); }, []);
  function fit() {
    try {
      const result = fitAlignment(matches, capture.initial, fov, aspect, fitLens);
      onApply(capture.pose(result.camera), result.fov, result.rms);
    } catch (failure) { setError((failure as Error).message); }
  }
  return <dialog ref={dialog} className="alignment-dialog" onCancel={e => { e.preventDefault(); onCancel(); }} aria-labelledby="alignment-title">
    <header><div><h2 id="alignment-title">Match camera position</h2><span>{pending ? "Click the same point in Actual" : "Click a landmark in Expected"} · {matches.length}/6 pairs</span></div><button onClick={onCancel}>Cancel</button></header>
    <p>Use fixed corners or recesses across the deck. Images are frozen; keep the camera still.</p>
    <label className="alignment-lens"><input type="checkbox" checked={fitLens} onChange={e => setFitLens(e.target.checked)}/> Refine field of view</label>
    <div className="alignment-images">{(["Expected", "Actual"] as const).map((label, index) => <section key={label}>
      <h3>{label}<small>{(index === 0 ? !pending : !!pending) ? "Select point" : ""}</small></h3>
      <div className="alignment-image" style={{ aspectRatio: aspect }} onClick={e => {
        const box = e.currentTarget.getBoundingClientRect();
        const point: [number, number] = [(e.clientX - box.left) / box.width, (e.clientY - box.top) / box.height];
        if (index === 0 && !pending) {
          const world = capture.pick(...point);
          if (!world) { setError("Choose a solid Flex surface, such as a deck recess."); return; }
          setPending({ world, model: point }); setError("");
        } else if (index === 1 && pending) {
          setMatches([...matches, { ...pending, image: point }]); setPending(null); setError("");
        }
      }}>
        <canvas ref={node => { if (node) { const source = index === 0 ? capture.canvas : actual; node.width = source.width; node.height = source.height; node.getContext("2d")!.drawImage(source, 0, 0); } }}/>
        {matches.map((m, i) => <span className="alignment-point" key={i} style={{ left: `${(index === 0 ? m.model : m.image)[0] * 100}%`, top: `${(index === 0 ? m.model : m.image)[1] * 100}%` }}>{i + 1}</span>)}
        {index === 0 && pending && <span className="alignment-point pending" style={{ left: `${pending.model[0] * 100}%`, top: `${pending.model[1] * 100}%` }}>{matches.length + 1}</span>}
      </div>
    </section>)}</div>
    <footer><span role="alert">{error || "6–10 pairs, spread widely. Start with the mount roughly positioned."}</span><button disabled={!pending && !matches.length} onClick={() => { if (pending) setPending(null); else setMatches(matches.slice(0, -1)); setError(""); }}>Undo point</button><button className="primary-action" disabled={matches.length < 6 || !!pending} onClick={fit}>Fit & preview</button></footer>
  </dialog>;
}
