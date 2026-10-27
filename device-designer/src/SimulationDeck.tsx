import { useEffect, useRef, useState } from 'react';
import type { Group } from 'three';
import type { InstrumentScene } from './scene';
import { detailedLiveLabware, type LiveKind } from './live-labware';
import { disposeAsset } from './dataset-assets';
import './simulation-deck.css';
import { simulationLayout } from './simulation-layout';

const slots = 'ABCD'.split('').flatMap(row => [1, 2, 3].map(column => `${row}${column}`));
const names: Record<LiveKind, string> = { tiprack: 'Tip rack', plate: 'Microplate', reservoir: 'Reservoir' };

export function SimulationDeck({ scene, running }: { scene: InstrumentScene | null; running: boolean }) {
  const [layout, setLayout] = useState<Record<string, LiveKind>>({});
  const [selected, setSelected] = useState('D1');
  const [moving, setMoving] = useState(false);
  const [autoplay, setAutoplay] = useState(true);
  const [intervalSeconds, setIntervalSeconds] = useState(10);
  const [iteration, setIteration] = useState(0);
  const nextIteration = useRef(0);
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const playing = autoplay && running && ready;
  const controller = useRef<ReturnType<InstrumentScene['createSimulationDeck']> | null>(null);
  const templates = useRef(new Map<LiveKind, Group>());
  const previous = useRef<Record<string, LiveKind>>({});

  function nextLayout() {
    setLayout(simulationLayout(nextIteration.current));
    nextIteration.current += 1;
    setIteration(nextIteration.current);
    setMoving(false);
  }

  useEffect(() => {
    if (!playing || !scene) return;
    if (nextIteration.current === 0) nextLayout();
    scene.setGantryDemo(true);
    const timer = setInterval(nextLayout, intervalSeconds * 1000);
    return () => { clearInterval(timer); scene.setGantryDemo(false); };
  }, [playing, scene, intervalSeconds]);

  useEffect(() => {
    if (!scene) return;
    let cancelled = false;
    const loaded = new Map<LiveKind, Group>();
    setReady(false);
    try { controller.current = scene.createSimulationDeck(); }
    catch (e) { setError((e as Error).message); return; }
    void Promise.all((Object.keys(names) as LiveKind[]).map(async kind => {
      const model = await detailedLiveLabware(kind);
      if (cancelled) { disposeAsset(model); return; }
      loaded.set(kind, model);
    })).then(() => {
      if (!cancelled) { templates.current = loaded; setReady(true); }
    }).catch(e => { if (!cancelled) setError((e as Error).message); });
    return () => {
      cancelled = true; controller.current?.dispose(); controller.current = null;
      loaded.forEach(disposeAsset); templates.current = new Map(); previous.current = {};
    };
  }, [scene]);

  useEffect(() => {
    if (!ready || !controller.current) return;
    for (const slot of slots.filter(s => s !== 'A3')) {
      if (previous.current[slot] !== layout[slot])
        controller.current.place(slot, layout[slot] ? templates.current.get(layout[slot])! : null);
    }
    previous.current = layout;
  }, [layout, ready]);

  function pick(slot: string) {
    if (moving && layout[selected] && !layout[slot] && slot !== selected) {
      setLayout(current => { const next = { ...current, [slot]: current[selected] }; delete next[selected]; return next; });
    }
    setSelected(slot);
    setMoving(false);
  }

  return <section className="simulation-deck" aria-label="Simulated labware">
    <header><strong>Scene</strong><span>{selected}</span></header>
    <div className="simulation-autoplay">
      <button disabled={!ready || !running} aria-pressed={playing} onClick={() => { if (!autoplay) nextLayout(); setAutoplay(!autoplay); }}>{playing ? 'Pause' : 'Autoplay'}</button>
      <select aria-label="Scenario duration" value={intervalSeconds} onChange={e => setIntervalSeconds(Number(e.target.value))}>{[5, 10, 20].map(seconds => <option key={seconds} value={seconds}>{seconds}s / layout</option>)}</select>
      <button disabled={!ready} onClick={nextLayout}>Next layout</button>
    </div>
    {iteration > 0 && <p role="status">Layout {iteration}{playing ? ' · Gantry moving' : ''}</p>}
    <div className="simulation-deck-grid">{slots.map(slot => <button key={slot} disabled={!ready || playing || slot === 'A3' || (moving && !!layout[slot] && slot !== selected)} aria-pressed={selected === slot} aria-label={`${slot}: ${slot === 'A3' ? 'Fixed waste bin' : layout[slot] ? names[layout[slot]] : 'Empty'}`} onClick={() => pick(slot)}>
      <strong>{slot}</strong><span>{slot === 'A3' ? 'Waste bin' : layout[slot] ? names[layout[slot]] : '+'}</span>
    </button>)}</div>
    {!playing && <><div className="simulation-deck-tools">{(Object.keys(names) as LiveKind[]).map(kind => <button key={kind} disabled={!ready || moving || playing} onClick={() => setLayout(current => ({ ...current, [selected]: kind }))}>{names[kind]}</button>)}</div>
    <p>{moving ? 'Choose an empty destination.' : 'Select a slot to edit.'}</p>
    <footer><button disabled={playing || !layout[selected]} aria-pressed={moving} onClick={() => setMoving(!moving)}>{moving ? 'Cancel move' : 'Move'}</button><button disabled={playing || !layout[selected]} onClick={() => { setMoving(false); setLayout(current => { const next = { ...current }; delete next[selected]; return next; }); }}>Remove</button><button disabled={playing || !Object.keys(layout).length} onClick={() => { setMoving(false); setLayout({}); }}>Clear deck</button></footer></>}
    {!ready && !error && <p role="status">Loading labware…</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
