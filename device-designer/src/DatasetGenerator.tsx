import { ImageProcessingPanel } from './ImageProcessingPanel';
import { completeDeckState } from './deck-state';
import { useEffect, useRef, useState } from 'react';

import { ArrowUp, Download, Pause, Play, Upload, X } from 'lucide-react';

import type * as THREE from 'three';

import type { InstrumentScene } from './scene';

import type { SavedWorkspace } from './workspace-file';

import { availableSlots, cameraCoverage, validCameraRange, datasetTar, runSignature, validateRecipe, type CameraRange, type DatasetAsset, type DatasetFrame, type Recipe } from './dataset';

import { processedYoloFiles } from './dataset-export';

import { detectionClasses, yoloLabel } from './dataset-labels';

import { labwareLibrary } from './labware-library';

import { loadDatasetAsset, disposeAsset } from './dataset-assets';

import { loadFrames, loadRuns, saveFrame, saveRun, type DatasetRun } from './dataset-store';



function FrameImage({ frame, ...props }: { frame: DatasetFrame } & React.ImgHTMLAttributes<HTMLImageElement>) {

  const [url, setUrl] = useState('');

  useEffect(() => { const next = URL.createObjectURL(frame.image); setUrl(next); return () => URL.revokeObjectURL(next); }, [frame.image]);

  return <img {...props} src={url} alt={`Synthetic camera image ${frame.index}: ${frame.recipe.note}`}/>;

}

const contextKey = (context: SavedWorkspace) => JSON.stringify({ workspace: context.workspace, view: context.view, classifier: context.classifier });

export function DatasetGenerator({ scene, context, onProgress }: { scene: InstrumentScene | null; context: SavedWorkspace; onProgress?: (progress: { running: boolean; count: number; target: number }) => void }) {

  const design = context.classifier!;

  const [assets, setAssets] = useState<DatasetAsset[]>(() => labwareLibrary(design));

  const [emptyClass, setEmptyClass] = useState(design.classes.find(c => /^(empty|empty slot)$/i.test(c.name))?.id ?? '');

  const [target, setTarget] = useState(100);

  const fixedRange = (): CameraRange => { const pan = (context.workspace.tiny2.joints.obsbot_pan_joint ?? 0) * 180 / Math.PI, tilt = (context.workspace.tiny2.joints.obsbot_tilt_joint ?? 0) * 180 / Math.PI; return { pan: [pan, pan], tilt: [tilt, tilt], zoom: [1, 1] }; };
  const [cameraRange, setCameraRange] = useState<CameraRange>(fixedRange);
  const fixedView = cameraRange.pan[0] === cameraRange.pan[1] && cameraRange.tilt[0] === cameraRange.tilt[1] && cameraRange.zoom[0] === cameraRange.zoom[1];

  const [split, setSplit] = useState<DatasetRun['split']>('train');

  const [frames, setFrames] = useState<DatasetFrame[]>([]);

  const [selected, setSelected] = useState<string | null>(null);

  const [running, setRunning] = useState(false);

  const [status, setStatus] = useState('Ready to generate');

  const [error, setError] = useState('');

  const [feedback, setFeedback] = useState('');

  const [notes, setNotes] = useState<string[]>([]);

  const [run, setRun] = useState<DatasetRun | null>(null);

  const [runs, setRuns] = useState<DatasetRun[]>([]);

  const [loading, setLoading] = useState(true);

  const [uploading, setUploading] = useState(false);

  const [showLabels, setShowLabels] = useState(true);

  const host = useRef<HTMLDivElement>(null);

  const alive = useRef(true), active = useRef(false), revision = useRef(0);

  const abort = useRef<AbortController | null>(null);

  const latest = useRef({ assets, emptyClass, target, split, frames, run, notes });

  latest.current = { assets, emptyClass, target, split, frames, run, notes };

  const initialContext = useRef(context);
  useEffect(() => { onProgress?.({ running, count: frames.length, target }); }, [running, frames.length, target, onProgress]);

  useEffect(() => {

    alive.current = true;

    scene?.attachExpectedView(host.current!); scene?.setExpectedLens(context.view.horizontalFov ?? 70, 16 / 9);

    if (context.view.lighting) scene?.setLighting(context.view.lighting);

    loadRuns().then(async saved => {

      if (!alive.current) return;

      setRuns(saved);

      const match = saved.find(r => contextKey(r.context) === contextKey(initialContext.current));

      if (match) await restoreRun(match);

    }).catch(e => setError(`Local storage unavailable: ${e.message}`)).finally(() => { if (alive.current) setLoading(false); });

    return () => { alive.current = false; active.current = false; abort.current?.abort(); scene?.detachExpectedView(); onProgress?.({ running: false, count: latest.current.frames.length, target: latest.current.target }); };

  }, [scene]);

  async function restoreRun(next: DatasetRun) {

    const saved = await loadFrames(next.id);

    if (!alive.current) return;

    if (next.cameraRange) setCameraRange(next.cameraRange);

    setRun(next); setAssets(next.assets); setEmptyClass(next.emptyClass); setTarget(next.target); setSplit(next.split); setNotes(next.feedback); setFrames(saved); setSelected(null);

    setStatus(saved.length >= next.target ? 'Target reached' : 'Saved run · ready to resume');

  }

  function changeAssets(next: DatasetAsset[]) {

    latest.current.assets = next; setAssets(next); revision.current++; abort.current?.abort();

  }

  async function upload(files: FileList | File[]) {

    setUploading(true); setError('');

    try {

      const added: DatasetAsset[] = [];

      for (const file of Array.from(files)) {

        const kind = file.name.toLowerCase().endsWith('.glb') ? 'glb' : file.name.toLowerCase().endsWith('.stl') ? 'stl' : null;

        if (!kind || file.size > 50 * 1024 * 1024) throw new Error('Use STL or self-contained GLB files, up to 50 MB each.');

        if (latest.current.assets.length + added.length >= 40) throw new Error('Use at most 40 assets per run.');

        added.push({ id: crypto.randomUUID(), name: file.name, kind, file, widthMm: 127.76, up: kind === 'glb' ? 'Y' : 'Z', classId: '' });

      }

      changeAssets([...latest.current.assets, ...added]);

      setStatus('Assets added · assign a class and check size');

    } catch (e) { setError((e as Error).message); }

    finally { setUploading(false); }

  }

  async function guide() {

    if (!feedback.trim()) return;

    const next = [...latest.current.notes, feedback.trim()].slice(-20);

    latest.current.notes = next; setNotes(next); setFeedback(''); revision.current++; abort.current?.abort();

    setStatus(active.current ? 'Feedback received · replanning next scene' : 'Feedback ready for next scene');

    if (latest.current.run) {

      const updated = { ...latest.current.run, feedback: next }; latest.current.run = updated; setRun(updated);

      try { await saveRun(updated); } catch (e) { setError((e as Error).message); }

    }

  }

  function pause() { active.current = false; abort.current?.abort(); setStatus('Pausing…'); }

  async function start() {

    if (!scene || active.current) return;

    if (!validCameraRange(cameraRange)) { setError('Choose ordered pan (−140..140°), tilt (−30..90°), and relative zoom (1..4×) ranges.'); return; }

    if (!Number.isInteger(target) || target < 1 || target > 1000) { setError('Choose 1–1,000 images.'); return; }

    if (!availableSlots(design).length) { setError('Select a usable deck slot in classifier design. A3 is reserved for the waste bin.'); return; }

    if (run && contextKey(run.context) !== contextKey(context)) { setError('This run uses a different workspace. Start a new run for the current calibration.'); return; }

    if (!assets.some(a => a.classId)) { setError('Assign at least one asset to a classifier class.'); return; }

    setError(''); setRunning(true); active.current = true;

    let completed = [...frames];

    let session: DatasetRun = run ? { ...run, target, split, cameraRange } : { id: crypto.randomUUID(), signature: runSignature(contextKey(context), assets, emptyClass), context: structuredClone(context), assets, emptyClass, target, split, cameraRange, feedback: notes, createdAt: new Date().toISOString() };

    const templates = new Map<string, THREE.Group>();

    let templateKey = '';

    try {

      await saveRun(session); setRun(session); latest.current.run = session;

      while (active.current && completed.length < target) {

        const settings = latest.current, currentRevision = revision.current;

        const mapped = settings.assets.filter(a => a.classId !== settings.emptyClass && design.classes.some(c => c.id === a.classId));

        const key = JSON.stringify(mapped.map(({ file: _, ...a }) => a));

        if (!mapped.length) throw new Error('Assign an asset to a class before continuing.');

        if (key !== templateKey) {

          templates.forEach(disposeAsset); templates.clear();

          setStatus('Preparing scene assets…');

          for (const asset of mapped) templates.set(asset.id, await loadDatasetAsset(asset));

          templateKey = key;

        }

        if (!active.current) break;

        const sources = new Map([...(session.sourceAssets ?? session.assets), ...settings.assets].map(a => [a.id, a]));

        session = { ...session, assets: settings.assets, sourceAssets: [...sources.values()], emptyClass: settings.emptyClass, feedback: settings.notes };

        await saveRun(session); latest.current.run = session; setRun(session);

        setStatus(`Codex planning · ${completed.length} / ${target}`);

        const request = new AbortController(); abort.current = request;

        let batch: { note: string; recipes: Recipe[] };

        try {

          const counts: Record<string, number> = {};

          completed.forEach(f => f.detections?.filter(a => !a.review && a.pixels > 0).forEach(a => { counts[a.classId] = (counts[a.classId] ?? 0) + 1; }));

          const response = await fetch('/classifier-api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: request.signal, body: JSON.stringify({ design, fixedView, cameraRange, cameraCoverage: cameraCoverage(completed, cameraRange), assets: mapped.map(({ file: _, ...a }) => a), feedback: settings.notes, completed: completed.length, remaining: target - completed.length, counts, recent: completed.slice(-6).map(f => ({ ...f.recipe, visibleSlots: f.annotations.filter(a => !a.review).map(a => a.slot), reviewSlotCount: f.annotations.filter(a => a.review).length })), emptyClass: settings.emptyClass }) });

          batch = await response.json();

          if (!response.ok) throw new Error((batch as unknown as { error: string }).error || 'Codex generation failed.');

        } catch (e) { if (request.signal.aborted) continue; throw e; }

        if (!active.current || currentRevision !== revision.current) continue;

        setStatus(batch.note);

        for (const planned of batch.recipes) {
          const recipe = fixedView ? { ...planned, exposure: 1, warmth: 0 } : planned;

          if (!active.current || currentRevision !== revision.current || completed.length >= target) break;

          validateRecipe(recipe, mapped, availableSlots(design), cameraRange);

          const rendered = await scene.captureDataset(recipe, mapped, templates, availableSlots(design), settings.emptyClass);

          if (!active.current || currentRevision !== revision.current) break;

          const frame: DatasetFrame = { id: crypto.randomUUID(), runId: session.id, index: completed.length + 1, ...rendered, recipe, assetSettings: mapped.map(({ file: _, ...a }) => a), feedback: [...settings.notes], createdAt: new Date().toISOString() };

          await saveFrame(frame); completed = [...completed, frame];

          if (!alive.current) break;

          setFrames(completed); latest.current.frames = completed; setSelected(null);

          setStatus(recipe.note);

          // Yield for paint so each completed image is observable, including fast batches.

          await new Promise(resolve => setTimeout(resolve, 400));

        }

      }

      if (alive.current) setStatus(completed.length >= target ? 'Target reached · dataset saved locally' : 'Paused · completed images saved');

    } catch (e) { if (alive.current) { setError((e as Error).message); setStatus('Paused · retry to continue'); } }

    finally { templates.forEach(disposeAsset); active.current = false; abort.current = null; if (alive.current) { setRunning(false); setRuns(await loadRuns().catch(() => [])); } }

  }

  async function download() {

    if (!run || !frames.length) return;

    try {

      const saved = await loadRuns();

      const compatible = saved.filter(r => contextKey(r.context) === contextKey(context));

      const groups = await Promise.all(compatible.map(async r => ({ run: r, frames: await loadFrames(r.id) })));

      const { files, counts } = await processedYoloFiles(groups, run);
      const urls = new Set(groups.flatMap(({ run: r }) => r.sourceAssets ?? r.assets).flatMap(a => [a.modelUrl, a.definitionUrl]).filter((u): u is string => !!u));
      for (const source of urls) {
        const response = await fetch(source);
        if (!response.ok) throw new Error('A source asset is unavailable; export cancelled.');
        files.push({ name: `assets/${source.split('/').at(-1)}`, data: await response.blob() });
      }
      const provenance = await fetch('./models/labware/sources.json');
      if (provenance.ok) files.push({ name: 'assets/sources.json', data: await provenance.blob() });

      const url = URL.createObjectURL(datasetTar(files)), link = document.createElement('a');

      link.href = url; link.download = `lab-sentry-yolo-${run.id.slice(0, 8)}.tar`; link.click();

      setTimeout(() => URL.revokeObjectURL(url), 10000);

      setStatus(`Exported ${counts.train} train · ${counts.val} validation · ${counts.test} test · ${counts.review} review`);

    } catch (e) { setError((e as Error).message); }

  }



  const current = frames.find(f => f.id === selected) ?? frames.at(-1);

  const coverage = cameraCoverage(frames, cameraRange);

  const missing = design.classes.filter(c => c.id !== emptyClass && !assets.some(a => a.classId === c.id));

  return <main className="dataset-generator" aria-label="Dataset generation" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files); }}>

    <header className="dataset-heading"><div><span className="small-label">PHASE 04 · SYNTHETIC DATA</span><h1>Generate training images</h1></div><div><label>Images<input aria-label="Target images" type="number" min={1} max={1000} disabled={running} value={target} onChange={e => setTarget(Number(e.target.value))}/></label><select aria-label="Dataset split" value={split} disabled={running || !!frames.length} onChange={e => setSplit(e.target.value as DatasetRun['split'])}><option value="train">Training</option><option value="validation">Validation</option><option value="test">Test</option></select><button className="primary-action" disabled={loading || uploading || !scene || (!running && frames.length >= target)} onClick={running ? pause : () => void start()}>{running ? <Pause size={14}/> : <Play size={14}/>} {running ? 'Pause' : frames.length ? 'Resume' : 'Generate'}</button><button disabled={running || !frames.length} onClick={() => void download()}><Download size={14}/>YOLO export</button></div></header>

    <div className="dataset-progress"><progress value={frames.length} max={target}/><strong>{frames.length} / {target}</strong><span role="status">{status}</span></div>

    {error && <div className="copilot-error" role="alert">{error}</div>}

    <div className="dataset-layout"><section className="dataset-observer">

      <div className="dataset-image">{current ? <div className="dataset-labeled-frame"><FrameImage frame={current}/>{showLabels && <svg viewBox="0 0 1280 720" aria-label="Object detection boxes">{current.detections?.filter(d => d.box).map(d => { const [x, y, w, h] = d.box!; const c = design.classes.find(c => c.id === d.classId); return <g key={d.slot} stroke={d.review ? '#ffad52' : c?.color ?? '#60deb6'}><rect x={x * 1280} y={y * 720} width={w * 1280} height={h * 720} fill="none" strokeWidth="2"/><text x={x * 1280 + 4} y={Math.max(16, y * 720 - 5)} stroke="none" fill={d.review ? '#ffad52' : '#fff'} fontSize="17">{c?.name} · {d.slot}{d.review ? ' · review' : ''}</text></g>; })}</svg>}</div> : <div className="dataset-empty"><h2>Your calibrated camera</h2><p>Images appear here as each scene renders.</p></div>}<div ref={host} className="dataset-render-host" style={{ visibility: current ? 'hidden' : 'visible' }} aria-hidden="true"/></div>

      <div className="dataset-caption"><span>{current ? `Image ${current.index} · 1280 × 720` : '1280 × 720 · static mount / variable PTZ'}</span>{current?.recipe.camera && <span>Pan {current.recipe.camera.pan.toFixed(1)}° · Tilt {current.recipe.camera.tilt.toFixed(1)}° · {current.recipe.camera.zoom.toFixed(1)}×</span>}<span>{current ? yoloLabel(current, detectionClasses(design, emptyClass).map(c => c.id)) === null ? 'Held for review' : `${current.detections?.filter(d => d.pixels).length ?? 0} object labels` : 'A3 reserved for waste bin'}</span><button aria-pressed={showLabels} onClick={() => setShowLabels(v => !v)}>Labels</button></div>

      <ImageProcessingPanel run={run} frame={current} disabled={running} onSave={updated => { setRun(updated); latest.current.run = updated; setRuns(previous => previous.map(r => r.id === updated.id ? updated : r)); }}/>
      <div className="dataset-filmstrip" aria-label="Generated images">{frames.slice(-24).map(f => <button key={f.id} aria-label={`View image ${f.index}`} aria-pressed={current?.id === f.id} onClick={() => setSelected(f.id)}><FrameImage frame={f}/><span>{f.index}</span></button>)}</div>

      {current && <div className="dataset-slot-states" aria-label="Deck slot states">{completeDeckState(current).map(s => <div key={s.slot} data-state={s.state} title={`${s.reason} · ${Math.round(s.visibility * 100)}% visible`}><strong>{s.slot}</strong><span>{s.state}</span>{s.state === 'occupied' && <small>{s.assetId === 'fixed-waste-bin' ? 'Waste bin' : design.classes.find(c => c.id === s.classId)?.name}</small>}</div>)}</div>}
      {current && <details><summary>Scene labels & recipe</summary><p>{current.recipe.note}</p>{current.recipe.camera && <p>Pan {current.recipe.camera.pan.toFixed(1)}° · Tilt {current.recipe.camera.tilt.toFixed(1)}° · Zoom {current.recipe.camera.zoom.toFixed(2)}×</p>}<div className="dataset-labels">{current.annotations.map(a => <span key={a.slot}>{a.slot} · {a.review ? 'Review' : design.classes.find(c => c.id === a.classId)?.name ?? 'Unmapped'}</span>)}</div></details>}

      <div className="dataset-feedback"><div className="classifier-section-heading"><h2>Direct Codex</h2><small>{running ? 'Applies to the next scene' : 'Guidance for the next run'}</small></div><div className="dataset-notes">{notes.slice(-3).map((n, i) => <p key={i}>{n}</p>)}</div><form onSubmit={e => { e.preventDefault(); void guide(); }}><textarea aria-label="Generation feedback" maxLength={2000} placeholder="More empty slots. Dimmer lighting. Focus on transparent plates…" value={feedback} onChange={e => setFeedback(e.target.value)}/><button aria-label="Send generation feedback" disabled={!feedback.trim()}><ArrowUp size={18}/></button></form></div>

    </section><aside className="dataset-assets classifier-card"><div className="classifier-section-heading"><h2>Scene assets</h2><label className="file-button"><Upload size={14}/>Add files<input aria-label="Upload scene assets" type="file" multiple accept=".stl,.glb" disabled={uploading} onChange={e => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }}/></label></div><p className="classifier-note">Drop STL / GLB. Library entries show their source and fidelity.</p>

      <button onClick={() => changeAssets([...assets.filter(a => !a.id.startsWith('builtin-')), ...labwareLibrary(design).filter(a => !assets.some(b => b.id === a.id))])}>Load labware library</button>

      <section className="dataset-camera"><h2>Camera view</h2><label><input type="checkbox" aria-label="Lock calibrated camera and lighting" checked={fixedView} disabled={running || !!frames.length} onChange={e => setCameraRange(e.target.checked ? fixedRange() : { pan: [-140, 140], tilt: [-30, 70], zoom: [1, 4] })}/> Lock calibrated view & lighting</label><p className="classifier-note">Fixed mode keeps the saved PTZ and matched lighting. 1× uses the calibrated lens.</p>

        {(['pan', 'tilt', 'zoom'] as const).map(axis => <div key={axis} className="dataset-camera-axis"><label>{axis}</label><div>{([0, 1] as const).map(end => <input key={end} aria-label={`${axis} ${end ? 'maximum' : 'minimum'}`} type="number" step={axis === 'zoom' ? .1 : 1} disabled={running || fixedView} value={cameraRange[axis][end]} onChange={e => setCameraRange(previous => ({ ...previous, [axis]: previous[axis].map((v, i) => i === end ? Number(e.target.value) : v) }))}/>)}</div><div className="dataset-coverage" aria-label={`${axis} coverage`}>{coverage[axis].map((count, i) => <span key={i} className={count ? 'covered' : ''} title={`${axis} range bin ${i + 1}: ${count} images`}>{count}</span>)}</div></div>)}

      </section>

      <label className="dataset-empty-class">Empty slot label<select aria-label="Empty slot class" value={emptyClass} disabled={running || !!frames.length} onChange={e => setEmptyClass(e.target.value)}><option value="">Manual review</option>{design.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>

      {assets.map(a => <div className="dataset-asset" key={a.id}><div><strong>{a.name}</strong><button aria-label={`Remove ${a.name}`} onClick={() => changeAssets(assets.filter(x => x.id !== a.id))}><X size={12}/></button></div><small>{a.fidelity ?? (a.file ? 'Uploaded model' : 'Procedural approximation')}{a.source && <> · <a href={a.source} target="_blank" rel="noreferrer">Source</a></>}</small><select aria-label={`Class for ${a.name}`} value={a.classId} onChange={e => changeAssets(assets.map(x => x.id === a.id ? { ...x, classId: e.target.value } : x))}><option value="">Not used · choose class</option>{design.classes.filter(c => c.id !== emptyClass).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{a.file && <div className="dataset-asset-size"><label>Width mm<input aria-label={`Width of ${a.name}`} type="number" min={10} max={140} value={a.widthMm} onChange={e => changeAssets(assets.map(x => x.id === a.id ? { ...x, widthMm: Number(e.target.value) } : x))}/></label><label>Up<select aria-label={`Up axis of ${a.name}`} value={a.up} onChange={e => changeAssets(assets.map(x => x.id === a.id ? { ...x, up: e.target.value as 'Y' | 'Z' } : x))}><option>Y</option><option>Z</option></select></label></div>}</div>)}

      {!!missing.length && <p className="classifier-note">No asset yet: {missing.map(c => c.name).join(', ')}.</p>}

      <div className="dataset-runs"><h2>Saved runs</h2><select aria-label="Saved dataset run" disabled={running || loading} value={run?.id ?? ''} onChange={e => { const found = runs.find(r => r.id === e.target.value); if (found) void restoreRun(found).catch(e => setError(e.message)); }}><option value="">New run</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {r.split} · {r.target} images</option>)}</select><button disabled={running} onClick={() => { setRun(null); setCameraRange(fixedRange()); setFrames([]); setSelected(null); setNotes([]); setFeedback(''); setStatus('New run · previous images remain saved'); setError(''); }}>New run</button></div>

    </aside></div>

  </main>;

}
