import { processImage, type ImageProcessing } from './image-processing';
import { recipeFromPlan, recipeKey, validatePlan, type GenerationPlan } from './generation-plan';
import { GenerationQueue } from './generation-queue';
import { ImageProcessingPanel } from './ImageProcessingPanel';
import { completeDeckState } from './deck-state';
import { useEffect, useMemo, useRef, useState } from 'react';

import { ArrowUp, Download, Pause, Play, Paperclip, X } from 'lucide-react';

import type * as THREE from 'three';

import type { InstrumentScene } from './scene';

import type { SavedWorkspace } from './workspace-file';

import { availableSlots, cameraCoverage, validCameraRange, datasetTar, runSignature, validateRecipe, type CameraRange, type DatasetAsset, type DatasetFrame, type Recipe } from './dataset';

import { processedYoloFiles } from './dataset-export';

import { detectionClasses, yoloLabel } from './dataset-labels';

import { labwareLibrary } from './labware-library';

import { loadDatasetAsset, disposeAsset } from './dataset-assets';

import { loadFrames, loadRuns, saveFrame, saveRun, type DatasetRun } from './dataset-store';



function FrameImage({ frame, processing, ...props }: { frame: DatasetFrame; processing?: ImageProcessing } & React.ImgHTMLAttributes<HTMLImageElement>) {

  const [url, setUrl] = useState('');

  const [failure, setFailure] = useState('');
  useEffect(() => {
    let cancelled = false, next = ''; setUrl(''); setFailure('');
    void processImage(frame.image, processing, frame.id).then(blob => {
      if (!cancelled) { next = URL.createObjectURL(blob); setUrl(next); }
    }).catch(() => { if (!cancelled) setFailure('Image processing failed'); });
    return () => { cancelled = true; if (next) URL.revokeObjectURL(next); };
  }, [frame.image, frame.id, processing]);
  if (failure) return <span role="alert">{failure}</span>;
  if (!url) return <span className="dataset-image-loading">Loading…</span>;

  return <img {...props} src={url} alt={`Synthetic camera image ${frame.index}: ${frame.recipe.note}`}/>;

}

const contextKey = (context: SavedWorkspace) => JSON.stringify({ workspace: context.workspace, view: context.view, classifier: context.classifier });

export function DatasetGenerator({ scene, context, onProgress, initialRunId, onOpenRun, onSideView }: { initialRunId?: string; onOpenRun?: (run: DatasetRun) => void; onSideView?: (context: SavedWorkspace) => void; scene: InstrumentScene | null; context: SavedWorkspace; onProgress?: (progress: { running: boolean; count: number; target: number }) => void }) {

  const design = context.classifier!;

  const [assets, setAssets] = useState<DatasetAsset[]>(() => labwareLibrary(design));

  const [emptyClass, setEmptyClass] = useState(design.classes.find(c => /^(empty|empty slot)$/i.test(c.name))?.id ?? '');

  const [target, setTarget] = useState(400);
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<DatasetFrame | null>(null);
  const [renderer, setRenderer] = useState<'browser' | 'isaac'>('browser');
  const [generationMode, setGenerationMode] = useState<'bulk' | 'directed'>('bulk');

  const fixedRange = (): CameraRange => { const pan = (context.workspace.tiny2.joints.obsbot_pan_joint ?? 0) * 180 / Math.PI, tilt = (context.workspace.tiny2.joints.obsbot_tilt_joint ?? 0) * 180 / Math.PI; return { pan: [pan, pan], tilt: [tilt, tilt], zoom: [1, 1] }; };
  const [cameraRange, setCameraRange] = useState<CameraRange>(fixedRange);
  const fixedView = cameraRange.pan[0] === cameraRange.pan[1] && cameraRange.tilt[0] === cameraRange.tilt[1] && cameraRange.zoom[0] === cameraRange.zoom[1];

  const [split, setSplit] = useState<DatasetRun['split']>('train');

  const [frames, setFrames] = useState<DatasetFrame[]>([]);

  const [selected, setSelected] = useState<string | null>(null);
  const [galleryOpen, setGalleryOpen] = useState(false);
  const [galleryPage, setGalleryPage] = useState(0);
  const gallery = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (galleryOpen) gallery.current?.showModal(); else gallery.current?.close(); }, [galleryOpen]);

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
  const [showOriginals, setShowOriginals] = useState(false);

  const host = useRef<HTMLDivElement>(null);
  const attachmentInput = useRef<HTMLInputElement>(null);

  const alive = useRef(true), active = useRef(false), revision = useRef(0);

  const planning = useRef(new GenerationQueue<{ note: string; recipes: Recipe[]; policy?: GenerationPlan }>());
  const [stage, setStage] = useState('Ready');
  const [elapsed, setElapsed] = useState(0);
  const sessionStart = useRef({ time: 0, count: 0 });
  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => setElapsed((performance.now() - sessionStart.current.time) / 1000), 500);
    return () => clearInterval(timer);
  }, [running]);

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

      const match = initialRunId ? saved.find(r => r.id === initialRunId && contextKey(r.context) === contextKey(initialContext.current)) : saved.find(r => contextKey(r.context) === contextKey(initialContext.current));

      if (match) await restoreRun(match);

    }).catch(e => setError(`Local storage unavailable: ${e.message}`)).finally(() => { if (alive.current) setLoading(false); });

    return () => { alive.current = false; active.current = false; planning.current.cancel(); scene?.detachExpectedView(); onProgress?.({ running: false, count: latest.current.frames.length, target: latest.current.target }); };

  }, [scene]);

  async function restoreRun(next: DatasetRun) {

    const saved = await loadFrames(next.id);

    if (!alive.current) return;

    setRenderer(next.renderer ?? 'browser');
    if (next.cameraRange) setCameraRange(next.cameraRange);

    setGenerationMode(next.generationMode ?? 'bulk');
    setRun(next); setAssets(next.assets); setEmptyClass(next.emptyClass); setTarget(next.target); setSplit(next.split); setNotes(next.feedback); setFrames(saved); setSelected(null);

    setStatus(saved.length >= next.target ? 'Target reached' : 'Saved run · ready to resume');

  }

  function changeAssets(next: DatasetAsset[]) {

    latest.current.assets = next; setAssets(next); revision.current++; planning.current.cancel();

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

    latest.current.notes = next; setNotes(next); setFeedback(''); revision.current++; planning.current.cancel();

    setStatus(active.current ? 'Feedback received · replanning next scene' : 'Feedback ready for next scene');

    if (latest.current.run) {

      const updated = { ...latest.current.run, feedback: next }; latest.current.run = updated; setRun(updated);

      try { await saveRun(updated); } catch (e) { setError((e as Error).message); }

    }

  }

  function pause() { active.current = false; planning.current.cancel(); setStage('Pausing'); setStatus('Pausing…'); }

  async function start() {

    if (!scene || active.current) return;

    if (!validCameraRange(cameraRange)) { setError('Choose ordered pan (−140..140°), tilt (−30..90°), and relative zoom (1..4×) ranges.'); return; }

    if (!Number.isInteger(target) || target < 1 || target > 1000) { setError('Choose 1–1,000 images.'); return; }

    if (!availableSlots(design).length) { setError('Select a usable deck slot in classifier design. A3 is reserved for the waste bin.'); return; }

    if (run && contextKey(run.context) !== contextKey(context)) { setError('This run uses a different workspace. Start a new run for the current calibration.'); return; }

    if (!assets.some(a => a.classId)) { setError('Assign at least one asset to a classifier class.'); return; }

    const initialNotes = feedback.trim() ? [...latest.current.notes, feedback.trim()].slice(-20) : latest.current.notes;
    latest.current.notes = initialNotes; setNotes(initialNotes); setFeedback('');
    setPreview(null); setError(''); setRunning(true); active.current = true;
    sessionStart.current = { time: performance.now(), count: frames.length }; setElapsed(0); setStage('Preparing');

    let completed = [...frames];

    let session: DatasetRun = run ? { ...run, target, split, cameraRange } : { id: crypto.randomUUID(), signature: runSignature(contextKey(context), assets, emptyClass), context: structuredClone(context), assets, emptyClass, target, split, cameraRange, feedback: notes, createdAt: new Date().toISOString() };

    session = { ...session, renderer, generationMode, feedback: initialNotes };
    const finishCapture = scene.beginDatasetCapture();
    const templates = new Map<string, THREE.Group>();

    let templateKey = '';

    try {

      if (renderer === 'isaac') {
        const health = await fetch('/isaac-api/health', { signal: AbortSignal.timeout(5000) }).catch(() => null);
        if (!health?.ok) throw new Error('Start Isaac Sim with Start-Isaac.cmd, then retry.');
      }
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

        setStage('Planning');

        const plan = async (signal: AbortSignal, queued: Recipe[] = []) => {
          const counts: Record<string, number> = {};
          completed.forEach(f => f.detections?.filter(a => !a.review && a.pixels > 0).forEach(a => { counts[a.classId] = (counts[a.classId] ?? 0) + 1; }));
          const response = await fetch('/classifier-api/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal, body: JSON.stringify({ strategy: generationMode, design, fixedView, cameraRange, cameraCoverage: cameraCoverage([...completed, ...queued.map(recipe => ({ recipe }))], cameraRange), assets: mapped.map(({ file: _, ...a }) => a), feedback: settings.notes, completed: completed.length + queued.length, remaining: target - completed.length - queued.length, counts, recent: [...completed.slice(-6).map(f => ({ ...f.recipe, visibleSlots: f.annotations.filter(a => !a.review).map(a => a.slot), reviewSlotCount: f.annotations.filter(a => a.review).length })), ...queued].slice(-8), emptyClass: settings.emptyClass }) });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error || 'Codex generation failed.');
          if (generationMode === 'bulk') {
            const policy = validatePlan(result, mapped, availableSlots(design), cameraRange, fixedView);
            const seen = new Set(completed.map(f => recipeKey(f.recipe))), recipes: Recipe[] = [];
            const remaining = target - completed.length;
            for (let attempt = 0; recipes.length < remaining && attempt < Math.max(1000, remaining * 30); attempt++) {
              const recipe = recipeFromPlan(policy, mapped, `${session.id}:${currentRevision}:${completed.length}:${attempt}`);
              const key = recipeKey(recipe); if (seen.has(key)) continue;
              seen.add(key); recipes.push(recipe);
            }
            if (recipes.length < remaining) throw new Error('This plan cannot produce enough distinct scenes. Broaden occupancy, assets, or placement variation.');
            return { note: policy.note, recipes, policy };
          }
          if (!Array.isArray(result.recipes) || !result.recipes.length) throw new Error('Codex returned no scenes. Retry to continue.');
          result.recipes.forEach((recipe: Recipe) => validateRecipe(recipe, mapped, availableSlots(design), cameraRange));
          return result as { note: string; recipes: Recipe[]; policy?: GenerationPlan };
        };
        let batch: { note: string; recipes: Recipe[]; policy?: GenerationPlan };
        try { batch = await planning.current.take(signal => plan(signal)); }
        catch (e) { if (!active.current || currentRevision !== revision.current) continue; throw e; }

        if (!active.current || currentRevision !== revision.current) continue;

        if (batch.policy) {
          session = { ...session, generationPlans: [...(session.generationPlans ?? []), { revision: currentRevision, plan: batch.policy, feedback: [...settings.notes], atIndex: completed.length + 1 }] };
          await saveRun(session); latest.current.run = session; setRun(session);
        }
        const recipes = batch.recipes.slice(0, target - completed.length);
        // Start the next Codex request before rendering this batch. Feedback cancels it.
        if (completed.length + recipes.length < target) planning.current.prepare(signal => plan(signal, recipes));
        setStage('Rendering'); setStatus(batch.note);

        for (const planned of recipes) {
          const recipe = fixedView ? { ...planned, exposure: 1, warmth: 0 } : planned;

          if (!active.current || currentRevision !== revision.current || completed.length >= target) break;

          validateRecipe(recipe, mapped, availableSlots(design), cameraRange);

          const rendered = await scene.captureDataset(recipe, mapped, templates, availableSlots(design), settings.emptyClass, undefined, renderer);

          if (!active.current || currentRevision !== revision.current) break;

          const frame: DatasetFrame = { id: crypto.randomUUID(), runId: session.id, index: completed.length + 1, ...rendered, recipe, assetSettings: mapped.map(({ file: _, ...a }) => a), feedback: [...settings.notes], createdAt: new Date().toISOString() };

          await saveFrame(frame); completed = [...completed, frame];

          if (!alive.current) break;

          setFrames(completed); latest.current.frames = completed;

          setStatus(recipe.note);

          // Yield for paint so each completed image is observable, including fast batches.

          await new Promise(resolve => setTimeout(resolve, 0));

        }

      }

      const seconds = (performance.now() - sessionStart.current.time) / 1000;
      session = { ...session, generationStats: { images: completed.length - sessionStart.current.count, seconds, completedAt: new Date().toISOString() } };
      await saveRun(session); latest.current.run = session; setRun(session); setElapsed(seconds);
      if (alive.current) setStatus(completed.length >= target ? 'Target reached · dataset saved locally' : 'Paused · completed images saved');

    } catch (e) { if (alive.current) { setError((e as Error).message); setStatus('Paused · retry to continue'); } }

    finally { finishCapture(); templates.forEach(disposeAsset); active.current = false; planning.current.cancel(); setStage('Ready'); if (alive.current) { setRunning(false); setRuns(await loadRuns().catch(() => [])); } }

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



  const produced = Math.max(0, frames.length - sessionStart.current.count);
  const rate = elapsed > 0 ? produced / elapsed : 0;
  const remainingSeconds = rate > 0 ? Math.ceil((target - frames.length) / rate) : 0;
  const eta = remainingSeconds >= 60 ? `${Math.ceil(remainingSeconds / 60)} min left` : `${remainingSeconds}s left`;
  const reviewCount = useMemo(() => { const ids = detectionClasses(design, emptyClass).map(c => c.id); return frames.filter(f => yoloLabel(f, ids) === null).length; }, [frames, design, emptyClass]);
  const current = preview ?? frames.find(f => f.id === selected) ?? frames.at(-1);

  async function previewRenderer(backend: 'browser' | 'isaac' = renderer) {
    if (!scene) return;
    setPreviewing(true); setError(''); setStatus('Rendering preview...');
    const templates = new Map<string, THREE.Group>(), finish = scene.beginDatasetCapture();
    try {
      const mapped = assets.filter(a => a.classId && a.classId !== emptyClass);
      for (const asset of mapped) templates.set(asset.id, await loadDatasetAsset(asset));
      const recipe: Recipe = current?.recipe ?? { note: 'Renderer preview', exposure: 1, warmth: 0, placements: [], camera: { pan: fixedRange().pan[0], tilt: fixedRange().tilt[0], zoom: 1 } };
      const rendered = await scene.captureDataset(recipe, mapped, templates, availableSlots(design), emptyClass, undefined, backend);
      setPreview({ id: crypto.randomUUID(), runId: 'preview', index: current?.index ?? 1, ...rendered, recipe, feedback: [], createdAt: new Date().toISOString() });
      setStatus(`${backend === 'isaac' ? 'Isaac Sim' : 'Browser'} preview - not added to dataset`);
    } catch (e) { setError((e as Error).message); setStatus('Preview failed'); }
    finally { templates.forEach(disposeAsset); finish(); setPreviewing(false); }
  }

  const coverage = cameraCoverage(frames, cameraRange);

  const missing = design.classes.filter(c => c.id !== emptyClass && !assets.some(a => a.classId === c.id));

  return <main className="dataset-generator" aria-label="Dataset generation" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(e.dataTransfer.files); }}>

    <header className="dataset-heading"><div><h1>Generate dataset</h1></div><div><label>Images<input aria-label="Target images" type="number" min={1} max={1000} disabled={running} value={target} onChange={e => setTarget(Number(e.target.value))}/></label><button className="primary-action" disabled={previewing || loading || uploading || !scene || (!running && frames.length >= target)} onClick={running ? pause : () => void start()}>{running ? <Pause size={14}/> : <Play size={14}/>} {running ? 'Pause' : frames.length >= target ? 'Complete' : frames.length ? 'Resume' : 'Generate'}</button><button disabled={!frames.length} onClick={() => { setGalleryPage(0); setGalleryOpen(true); }}>Gallery ({frames.length})</button><button disabled={running || !frames.length} onClick={() => void download()}><Download size={14}/>Export YOLO</button><button disabled={running} onClick={() => { setPreview(null); setRun(null); setCameraRange(fixedRange()); setFrames([]); setSelected(null); setNotes([]); setFeedback(''); setStatus('New run · previous images remain saved'); setError(''); }}>New run</button></div></header>

    <div className="dataset-progress"><progress value={frames.length} max={target}/><strong>{frames.length} / {target}</strong><span role="status" title={status}>{running ? stage : status}</span>{running && <span className="dataset-throughput">{produced > 0 ? `${(rate * 60).toFixed(1)} images/min  /  ${eta}` : 'Estimating time / '}</span>}</div>
    {!running && run?.generationStats && <div className="dataset-run-timing">{run.generationStats.images} images in {run.generationStats.seconds.toFixed(1)}s</div>}
    <div className="dataset-batch-summary"><span>{frames.length - reviewCount} ready <span className="dataset-summary-dot"> / </span> {reviewCount} need review</span><span>{running ? 'Autosaving' : 'YOLO labels included'}</span></div>

    <dialog ref={gallery} className="dataset-gallery-dialog" aria-labelledby="dataset-gallery-title" onCancel={() => setGalleryOpen(false)} onClose={() => setGalleryOpen(false)}>
      <header><div><h2 id="dataset-gallery-title">Image gallery</h2><span>{frames.length} images / {frames.length - reviewCount} ready / {showOriginals ? 'Originals' : 'Training output'}</span></div><button autoFocus aria-label="Close image gallery" onClick={() => setGalleryOpen(false)}><X size={20}/></button></header>
      {galleryOpen && <div className="dataset-gallery-grid">{frames.slice(galleryPage * 48, (galleryPage + 1) * 48).map(f => <button key={f.id} aria-label={`Inspect image ${f.index}`} onClick={() => { setPreview(null); setSelected(f.id); setGalleryOpen(false); }}><FrameImage processing={showOriginals ? undefined : run?.processing} frame={f} loading="lazy"/><span>Image {f.index}<small>{f.recipe.placements.length} occupied</small></span></button>)}</div>}
      <footer><button disabled={!galleryPage} onClick={() => setGalleryPage(p => p - 1)}>Previous</button><span>Page {galleryPage + 1} of {Math.max(1, Math.ceil(frames.length / 48))}</span><button disabled={(galleryPage + 1) * 48 >= frames.length} onClick={() => setGalleryPage(p => p + 1)}>Next</button></footer>
    </dialog>
    {error && <div className="copilot-error" role="alert">{error}</div>}


    <div className="dataset-layout"><section className="dataset-observer">

      <div className="dataset-image">{current ? <div className="dataset-labeled-frame"><FrameImage processing={showOriginals ? undefined : run?.processing} frame={current}/>{showLabels && <svg viewBox="0 0 1280 720" aria-label="Object detection boxes">{current.detections?.filter(d => d.box).map(d => { const [x, y, w, h] = d.box!; const c = design.classes.find(c => c.id === d.classId); return <g key={d.slot} stroke={d.review ? '#ffad52' : c?.color ?? '#60deb6'}><rect x={x * 1280} y={y * 720} width={w * 1280} height={h * 720} fill="none" strokeWidth="2"/><text x={x * 1280 + 4} y={Math.max(16, y * 720 - 5)} stroke="none" fill={d.review ? '#ffad52' : '#fff'} fontSize="17">{c?.name} · {d.slot}{d.review ? ' · review' : ''}</text></g>; })}</svg>}</div> : <div className="dataset-empty"><h2>Your calibrated camera</h2><p>Images appear here as each scene renders.</p></div>}<div ref={host} className="dataset-render-host" style={{ visibility: current ? 'hidden' : 'visible' }} aria-hidden="true"/></div>

      <div className="dataset-caption"><ImageProcessingPanel run={run} frame={current} frames={frames} disabled={running} onSave={updated => { setShowOriginals(false); setRun(updated); latest.current.run = updated; setRuns(previous => previous.map(r => r.id === updated.id ? updated : r)); }}/><span>{current ? `${preview ? 'Isaac preview' : `Image ${current.index}`} · 1280 × 720` : fixedView ? '1280 x 720 / calibrated view' : '1280 x 720 / static mount / variable PTZ'}</span>{current?.recipe.camera && <span>Pan {current.recipe.camera.pan.toFixed(1)}° · Tilt {current.recipe.camera.tilt.toFixed(1)}° · {current.recipe.camera.zoom.toFixed(1)}×</span>}<span>{current ? yoloLabel(current, detectionClasses(design, emptyClass).map(c => c.id)) === null ? 'Held for review' : `${current.detections?.filter(d => d.pixels).length ?? 0} object labels` : 'A3 reserved for waste bin'}</span><button aria-pressed={showOriginals} title="Compare original images without changing training output" onClick={() => setShowOriginals(v => !v)}>{showOriginals ? 'Originals' : 'Training output'}</button><button aria-pressed={showLabels} onClick={() => setShowLabels(v => !v)}>Labels</button>{selected && <button onClick={() => setSelected(null)}>Follow latest</button>}</div>


      <div className="dataset-filmstrip" aria-label="Generated images">{frames.slice(-24).map(f => <button key={f.id} aria-label={`View image ${f.index}`} aria-pressed={current?.id === f.id} onClick={() => { setPreview(null); setSelected(f.id); }}><FrameImage processing={showOriginals ? undefined : run?.processing} frame={f}/><span>{f.index}</span></button>)}</div>

      {current && <details className="dataset-state-details"><summary>Deck state</summary><div className="dataset-slot-states" aria-label="Deck slot states">{completeDeckState(current).map(s => <div key={s.slot} data-state={s.state} title={`${s.reason} · ${Math.round(s.visibility * 100)}% visible`}><strong>{s.slot}</strong><span>{s.state}</span>{s.state === 'occupied' && <small>{s.assetId === 'fixed-waste-bin' ? 'Waste bin' : design.classes.find(c => c.id === s.classId)?.name}</small>}</div>)}</div></details>}
      {current && <details><summary>Scene labels & recipe</summary><p>{current.recipe.note}</p>{current.recipe.camera && <p>Pan {current.recipe.camera.pan.toFixed(1)}° · Tilt {current.recipe.camera.tilt.toFixed(1)}° · Zoom {current.recipe.camera.zoom.toFixed(2)}×</p>}<div className="dataset-labels">{current.annotations.map(a => <span key={a.slot}>{a.slot} · {a.review ? 'Review' : design.classes.find(c => c.id === a.classId)?.name ?? 'Unmapped'}</span>)}</div></details>}



    </section><aside className="dataset-rail"><section className="dataset-feedback" aria-label="Dataset copilot"><div className="classifier-section-heading"><h2>Codex</h2></div><div className="dataset-conversation" role="log" aria-label="Generation guidance">{!notes.length && !run?.generationPlans?.length && <p className="copilot-intro">What should this dataset cover?</p>}{notes.map((n, i) => <div className="dataset-user-note" key={i}><small>You</small><p>{n}</p></div>)}{run?.generationPlans?.at(-1) && <div className="dataset-agent-note"><small>Codex · variation plan</small><p>{run.generationPlans.at(-1)!.plan.note}</p></div>}</div><form onSubmit={e => { e.preventDefault(); void guide(); }}><textarea disabled={frames.length >= target} aria-label="Generation feedback" maxLength={2000} placeholder="More empty slots, fewer tip racks…" value={feedback} onChange={e => setFeedback(e.target.value)}/><button type="button" className="dataset-attach" aria-label="Attach scene files" title="Attach STL or GLB" disabled={uploading} onClick={() => attachmentInput.current?.click()}><Paperclip size={17}/></button><input ref={attachmentInput} hidden aria-label="Upload scene assets" type="file" multiple accept=".stl,.glb" disabled={uploading} onChange={e => { if (e.target.files) void upload(e.target.files); e.target.value = ''; }}/><button className="dataset-send" aria-label="Send generation feedback" disabled={!feedback.trim() || frames.length >= target}><ArrowUp size={18}/></button></form><small className="dataset-feedback-hint">{running ? 'Feedback guides the next scenes' : frames.length >= target ? 'New run or increase the target to continue' : 'Describe the scenes, then generate'}</small></section><details className="dataset-assets classifier-card"><summary>Scene assets <span>{assets.length}</span></summary><div className="classifier-section-heading"><h2>Labware</h2></div><p className="classifier-note">Drop STL or GLB files anywhere.</p>

      <button onClick={() => changeAssets([...assets.filter(a => !a.id.startsWith('builtin-')), ...labwareLibrary(design).filter(a => !assets.some(b => b.id === a.id))])}>Load labware library</button>

      <label className="dataset-empty-class">Empty slot label<select aria-label="Empty slot class" value={emptyClass} disabled={running || !!frames.length} onChange={e => setEmptyClass(e.target.value)}><option value="">Manual review</option>{design.classes.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>

      {assets.map(a => <div className="dataset-asset" key={a.id}><div><strong>{a.name}</strong><button aria-label={`Remove ${a.name}`} onClick={() => changeAssets(assets.filter(x => x.id !== a.id))}><X size={12}/></button></div><small>{a.fidelity ?? (a.file ? 'Uploaded model' : 'Procedural approximation')}{a.source && <> · <a href={a.source} target="_blank" rel="noreferrer">Source</a></>}</small><select aria-label={`Class for ${a.name}`} value={a.classId} onChange={e => changeAssets(assets.map(x => x.id === a.id ? { ...x, classId: e.target.value } : x))}><option value="">Not used · choose class</option>{design.classes.filter(c => c.id !== emptyClass).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{a.file && <div className="dataset-asset-size"><label>Width mm<input aria-label={`Width of ${a.name}`} type="number" min={10} max={140} value={a.widthMm} onChange={e => changeAssets(assets.map(x => x.id === a.id ? { ...x, widthMm: Number(e.target.value) } : x))}/></label><label>Up<select aria-label={`Up axis of ${a.name}`} value={a.up} onChange={e => changeAssets(assets.map(x => x.id === a.id ? { ...x, up: e.target.value as 'Y' | 'Z' } : x))}><option>Y</option><option>Z</option></select></label></div>}</div>)}

      {!!missing.length && <p className="classifier-note">No asset yet: {missing.map(c => c.name).join(', ')}.</p>}

</details><details className="dataset-settings"><summary>Generation settings</summary><button disabled={running || previewing || !scene} onClick={() => void previewRenderer('isaac')}>{previewing ? 'Rendering...' : 'Preview Isaac'}</button>{preview && <button disabled={previewing} onClick={() => setPreview(null)}>Close preview</button>}<label>Renderer<select aria-label="Dataset renderer" disabled={running || previewing || !!frames.length} value={renderer} onChange={e => setRenderer(e.target.value as 'browser' | 'isaac')}><option value="browser">Browser - fast</option><option value="isaac">Isaac Sim - experimental</option></select></label><div className="dataset-setting-row"><label>Mode<select aria-label="Generation mode" disabled={running} value={generationMode} onChange={e => setGenerationMode(e.target.value as 'bulk' | 'directed')}><option value="bulk">Fast bulk</option><option value="directed">Codex per batch</option></select></label><label>Split<select aria-label="Dataset split" value={split} disabled={running || !!frames.length} onChange={e => setSplit(e.target.value as DatasetRun['split'])}><option value="train">Training</option><option value="validation">Validation</option><option value="test">Test</option></select></label></div>      <section className="dataset-camera"><h2>Camera view</h2>{onSideView && <button disabled={running || !scene} onClick={() => { try { const next = structuredClone(context); next.name = `${context.name.replace(/ · (Side view|Acrylic 10 in)$/, '')} · Acrylic 10 in`; next.savedAt = new Date().toISOString(); next.workspace.tiny2.pose = scene!.datasetSidePose(); next.workspace.flex.joints.front_door_lift_joint = 0; next.workspace.flex.joints.front_door_fold_joint = 0; next.view.horizontalFov = 70; delete next.view.cameraPtz; onSideView(next); } catch (e) { setError((e as Error).message); } }}>Acrylic mount · 10 in</button>}<label><input type="checkbox" aria-label="Lock calibrated camera and lighting" checked={fixedView} disabled={running || !!frames.length} onChange={e => setCameraRange(e.target.checked ? fixedRange() : { pan: [-140, 140], tilt: [-30, 70], zoom: [1, 4] })}/> Lock camera & lighting</label><p className="classifier-note">Keep the saved camera and lighting, or explore a different view.</p>

        {(['pan', 'tilt', 'zoom'] as const).map(axis => <div key={axis} className="dataset-camera-axis"><label>{axis}</label><div>{([0, 1] as const).map(end => <input key={end} aria-label={`${axis} ${end ? 'maximum' : 'minimum'}`} type="number" step={axis === 'zoom' ? .1 : 1} disabled={running || fixedView} value={cameraRange[axis][end]} onChange={e => setCameraRange(previous => ({ ...previous, [axis]: previous[axis].map((v, i) => i === end ? Number(e.target.value) : v) }))}/>)}</div><div className="dataset-coverage" aria-label={`${axis} coverage`}>{coverage[axis].map((count, i) => <span key={i} className={count ? 'covered' : ''} title={`${axis} range bin ${i + 1}: ${count} images`}>{count}</span>)}</div></div>)}

      </section>

</details>      <details className="dataset-runs"><summary>Saved runs</summary><select aria-label="Saved dataset run" disabled={running || loading} value={run?.id ?? ''} onChange={e => { const found = runs.find(r => r.id === e.target.value); if (found) { if (onOpenRun) onOpenRun(found); else void restoreRun(found).catch(e => setError(e.message)); } }}><option value="">New run</option>{runs.map(r => <option key={r.id} value={r.id}>{new Date(r.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {r.split} · {r.target} images</option>)}</select></details>

    </aside></div>

  </main>;

}
