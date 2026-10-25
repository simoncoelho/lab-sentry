import { useEffect, useRef, useState } from "react";
import type { InstrumentScene } from "./scene";
import type { ExpectedDeck } from "./protocol-deck";
import { DECK_SLOTS, checkDeck, expectedBySlot, slotPolygon, type Point, type SlotResult } from "./deck-check";

type Frame = { data: Uint8ClampedArray; width: number; height: number };
type Source = () => HTMLVideoElement | HTMLImageElement | null;

const FRAME_WIDTH = 640;

function grabFrame(source: HTMLVideoElement | HTMLImageElement, aspect: number): Frame {
  const canvas = document.createElement("canvas");
  canvas.width = FRAME_WIDTH; canvas.height = Math.round(FRAME_WIDTH / aspect);
  const context = canvas.getContext("2d", { willReadFrequently: true })!;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  return { data: context.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

const label: Record<SlotResult["status"], string> = {
  "ok-occupied": "OK", "ok-empty": "Empty", missing: "Missing", unexpected: "Unexpected", hidden: "Not visible",
};

/** Slot outlines, the empty-deck reference and the per-slot check, shared by the overlay and the panel. */
export function useDeckCheck(scene: InstrumentScene | null, deck: ExpectedDeck | null, source: Source, live: boolean, aspect: number) {
  const [polygons, setPolygons] = useState<Map<string, Point[] | null>>(new Map());
  const [reference, setReference] = useState<Frame | null>(null);
  const [results, setResults] = useState<SlotResult[]>([]);
  const [threshold, setThreshold] = useState(.18);
  const [auto, setAuto] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef({ reference, threshold, deck, polygons });
  latest.current = { reference, threshold, deck, polygons };

  // Re-project every half second: pan/tilt, mount and lens edits move the outlines.
  useEffect(() => {
    if (!scene) { setPolygons(new Map()); return; }
    const update = () => {
      const slots = DECK_SLOTS.map(slot => slotPolygon(slot)!);
      const projected = scene.projectFlexPolygons(slots);
      setPolygons(new Map(DECK_SLOTS.map((slot, i) => [slot, projected[i]])));
    };
    update();
    const timer = setInterval(update, 500);
    return () => clearInterval(timer);
  }, [scene]);

  const frame = () => {
    const element = source();
    if (!element || !live) throw new Error("Connect the camera first.");
    try { return grabFrame(element, aspect); }
    catch (failure) {
      throw failure instanceof DOMException && failure.name === "SecurityError"
        ? new Error("This stream blocks image sampling. Use USB or the local OBSBOT service.") : failure;
    }
  };
  const captureReference = () => {
    setError("");
    try { setReference(frame()); setResults([]); } catch (failure) { setError((failure as Error).message); }
  };
  const check = () => {
    const { reference, threshold, deck, polygons } = latest.current;
    if (!reference) { setError("Capture the empty deck first."); return; }
    try { setResults(checkDeck(frame(), reference, polygons, deck, threshold)); setError(""); }
    catch (failure) { setError((failure as Error).message); setAuto(false); }
  };
  useEffect(() => {
    if (!auto || !live) return;
    const timer = setInterval(check, 1000);
    return () => clearInterval(timer);
  }, [auto, live]);

  // Re-run with the new threshold so the slider gives instant feedback.
  useEffect(() => { if (results.length) check(); }, [threshold]);
  useEffect(() => { if (!live) setAuto(false); }, [live]);

  return { polygons, reference, results, threshold, setThreshold, auto, setAuto, error, captureReference, check, deck };
}
export type DeckCheckState = ReturnType<typeof useDeckCheck>;

/** SVG slot outlines drawn over the live image, colored by check result. */
export function DeckOverlay({ state, aspect }: { state: DeckCheckState; aspect: number }) {
  const expected = expectedBySlot(state.deck);
  const results = new Map(state.results.map(r => [r.slot, r]));
  // Same letterboxing as the video's object-fit: contain, so outlines stay on the image.
  return <svg className="deck-overlay" viewBox={`0 0 ${aspect} 1`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
    {[...state.polygons].map(([slot, normalized]) => {
      if (!normalized) return null;
      const polygon = normalized.map(([x, y]): Point => [x * aspect, y]);
      const result = results.get(slot);
      const status = result?.status ?? (expected.has(slot) ? "expected" : "idle");
      const [cx, cy] = polygon.reduce(([x, y], p) => [x + p[0] / polygon.length, y + p[1] / polygon.length], [0, 0]);
      return <g key={slot} className={`deck-slot ${status}`}>
        <polygon points={polygon.map(p => p.join(",")).join(" ")} vectorEffect="non-scaling-stroke" />
        <text x={cx} y={cy}>{slot}</text>
      </g>;
    })}
  </svg>;
}

export function DeckCheckPanel({ state, live }: { state: DeckCheckState; live: boolean }) {
  const problems = state.results.filter(r => r.status === "missing" || r.status === "unexpected");
  const verdict = !state.results.length ? null : problems.length ? `${problems.length} slot${problems.length > 1 ? "s" : ""} need attention` : "Deck matches the protocol";
  return <section className="deck-check" aria-label="Deck check">
    <header>
      <div><span className="small-label">DECK CHECK</span><h3>{state.deck ? state.deck.protocolName : "No protocol loaded"}</h3></div>
      {verdict && <span className={`deck-verdict ${problems.length ? "bad" : "good"}`} role="status">{verdict}</span>}
    </header>
    <ol className="deck-steps">
      <li>Clear the deck, then <button disabled={!live} onClick={state.captureReference}>{state.reference ? "Recapture empty deck" : "Capture empty deck"}</button></li>
      <li>Set up the labware, then <button className="primary-action" disabled={!live || !state.reference} onClick={state.check}>Check deck</button>
        <label className="deck-auto"><input type="checkbox" disabled={!live || !state.reference} checked={state.auto} onChange={e => state.setAuto(e.target.checked)} />Check every second</label></li>
    </ol>
    <label className="deck-threshold">Sensitivity <strong>{Math.round(state.threshold * 100)}</strong>
      <input type="range" min=".04" max=".5" step=".01" value={state.threshold} aria-label="Occupied threshold" onChange={e => state.setThreshold(Number(e.target.value))} />
      <small>Lower finds smaller changes; raise it if empty slots show as occupied.</small></label>
    {!state.deck && <p className="deck-note">Load a protocol in the Protocol deck panel to know what each slot should hold.</p>}
    {state.error && <p className="camera-error" role="alert">{state.error}</p>}
    {state.results.length > 0 && <ul className="deck-results">
      {state.results.map(r => <li key={r.slot} className={r.status}>
        <span className="slot-badge">{r.slot}</span>
        <span className="deck-result-text">{r.expected.length ? r.expected.join(" + ") : "Nothing expected"}</span>
        <span className="deck-result-score" title="Difference from the empty deck">{r.score === null ? "–" : Math.round(r.score * 100)}</span>
        <strong>{label[r.status]}</strong>
      </li>)}
    </ul>}
  </section>;
}
