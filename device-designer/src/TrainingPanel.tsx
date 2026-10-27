import { SimulationDeck } from './SimulationDeck';
import type { InstrumentScene } from './scene';
import { CameraHardwareControls } from './CameraHardwareControls';
import { useEffect, useState } from 'react';

import { Play, Square, RefreshCw, Database, Cpu, CheckCircle2 } from 'lucide-react';

import { loadRuns, loadFrames } from './dataset-store';

import { processedYoloFiles } from './dataset-export';

import { datasetTar } from './dataset';

import type { SavedWorkspace } from './workspace-file';



type Report = { inferenceOnly?: boolean; images?: Record<string, number>; uniqueLayouts?: number; supportedClasses?: string[]; unsupportedClasses?: string[]; error?: string };

type Run = { id: string; name?: string; state: string; task?: string; epoch: number; epochs: number; gpu?: string; error?: string; models: Record<string, { metrics: Record<string, number> }>; audit?: Report; realAdaptation?: { uniqueImages: number } };

type Slot = { slot: string; state: string; label?: string; confidence: number; reason: string };

type Status = { capabilities?: { training: boolean; device: string }; dataset: Report; training: boolean; runs: Run[]; runtime: { source?: 'camera' | 'simulation'; model?: string; running: boolean; error?: string; stale?: boolean; timestamp?: number; slots: Slot[]; alignment?: { ok: boolean; reason: string }; warning?: string } };

const key = (context: SavedWorkspace) => JSON.stringify({ workspace: context.workspace, view: context.view, classifier: context.classifier });

const percent = (n?: number) => n == null ? '—' : `${(100 * n).toFixed(1)}%`;



export function TrainingPanel({ context, scene }: { context: SavedWorkspace; scene: InstrumentScene | null }) {
  const [source, setSource] = useState<'camera' | 'simulation'>('camera');

  const [status, setStatus] = useState<Status | null>(null);

  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [epochs, setEpochs] = useState(100);

  const [model, setModel] = useState('bundled-deck');

  const [preparation, setPreparation] = useState('');
  const [savedName, setSavedName] = useState('');

  const [extraNoise, setExtraNoise] = useState(false);

  const [realReference, setRealReference] = useState(false);

  async function refresh() {

    try { const response = await fetch('/training-api/status'); if (!response.ok) throw new Error('Training service unavailable'); setStatus(await response.json()); setError(previous => previous.startsWith('Start the local training service:') ? '' : previous); }

    catch { setError('Start the local training service: training/start.ps1'); }

  }

  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), status?.runtime.running ? 500 : 2000); return () => clearInterval(timer); }, [status?.runtime.running]);

  const simulating = !busy && status?.runtime.running && status.runtime.source === 'simulation';
  useEffect(() => {
    if (!simulating || !scene) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function sendFrame() {
      try {
        const frame = scene!.captureSimulatedCamera();
        const response = await fetch('/training-api/runtime/simulation/frame', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(frame), signal: controller.signal,
        });
        if (!response.ok) throw new Error((await response.json()).detail || 'Simulation stream failed');
        if (!cancelled) timer = setTimeout(sendFrame, 250);
      } catch (e) {
        if (!cancelled) {
          setError((e as Error).message);
          await fetch('/training-api/runtime/stop', { method: 'POST' });
          void refresh();
        }
      }
    }
    void sendFrame();
    return () => { cancelled = true; clearTimeout(timer); controller.abort(); };
  }, [simulating, scene]);

  async function action(path: string, body: unknown = {}) {

    setBusy(true); setError('');

    try { const response = await fetch(`/training-api/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); if (!response.ok) throw new Error((await response.json()).detail || 'Request failed'); await refresh(); }

    catch (e) { setError((e as Error).message); } finally { setBusy(false); }

  }

  async function changeDetector(nextSource: 'camera' | 'simulation', nextModel: string) {
    setBusy(true); setError('');
    try {
      if (status?.runtime.running) {
        const response = await fetch('/training-api/runtime/stop', { method: 'POST' });
        if (!response.ok) throw new Error('Could not stop detection. Try again.');
      }
      setSource(nextSource); setModel(nextModel);
      setStatus(current => current ? { ...current, runtime: { ...current.runtime, running: false } } : current);
      await refresh();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function useDataset() {

    setBusy(true); setError('');

    try {

      setPreparation('Loading saved runs…');
      const runs = (await loadRuns()).filter(run => key(run.context) === key(context));

      if (!runs.length) throw new Error('Generate images for this workspace first.');

      setPreparation(`Reading ${runs.length} saved runs…`);
      const groups = await Promise.all(runs.map(async run => ({ run, frames: await loadFrames(run.id) })));

      const { files } = await processedYoloFiles(groups, runs[0], (done, total) => setPreparation(`Preparing ${done} / ${total} images`));
      setPreparation('Uploading and auditing dataset…');

      const response = await fetch('/training-api/dataset', { method: 'POST', headers: { 'Content-Type': 'application/x-tar' }, body: datasetTar(files) });

      if (!response.ok) throw new Error((await response.json()).detail || 'Dataset validation failed');

      await refresh();

    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }

  }

  const latest = status?.runs[0], complete = status?.runs.filter(run => run.state === 'complete') ?? [];

  const active = status?.training || status?.runtime.running || busy;

  const report = status?.dataset;
  const canTrain = status?.capabilities?.training === true;

  const chosen = complete.find(run => run.id === (status?.runtime.running ? status.runtime.model : model)) ?? complete[0];

  useEffect(() => { setSavedName(chosen?.name ?? chosen?.id ?? ''); }, [chosen?.id, chosen?.name]);

  return <section className={`training-panel${status?.runtime.running ? ' is-detecting' : ''}`} aria-label="Training and detection">

    <div className="training-toolbar"><div><span className="eyebrow">05 / TRAIN & RUN</span><h1>Test model</h1></div>

      {canTrain && <div className="training-actions"><button disabled={active} onClick={useDataset}><Database size={15}/> Use generated dataset</button>

        <label>Epochs <input aria-label="Training epochs" type="number" min={10} max={300} value={epochs} onChange={e => setEpochs(Number(e.target.value))}/></label>

        <button className="primary-action" title={status?.capabilities?.training === false ? 'Training needs an NVIDIA GPU. Run a saved model below on CPU.' : undefined} disabled={active || !report?.images || report.inferenceOnly || status?.capabilities?.training === false} onClick={() => action('train', { epochs, realReference, extraNoise })}><Cpu size={15}/> Train YOLO</button></div>}</div>


    {canTrain && <><label className="training-reference"><input type="checkbox" checked={realReference} disabled={active} onChange={e => setRealReference(e.target.checked)}/> Include reviewed camera reference <span>One layout · adaptation only</span></label>

    <label className="training-reference"><input type="checkbox" checked={extraNoise} disabled={active} onChange={e => setExtraNoise(e.target.checked)}/> Extra random camera effects during training <span>Off uses saved preview pixels</span></label></>}

    {busy && preparation && <p role="status">{preparation}</p>}
    {error && <p role="alert" className="training-error">{error}</p>}

    {canTrain && <><div className="training-summary">

      {['train', 'val', 'test'].map(split => <div key={split}><strong>{report?.images?.[split] ?? 0}</strong><span>{split === 'val' ? 'Validation' : split === 'train' ? 'Training images' : 'Test images'}</span></div>)}

      <div><strong>{report?.uniqueLayouts ?? 0}</strong><span>Distinct layouts</span></div>

      <p>{report?.supportedClasses?.join(' · ')}{report?.unsupportedClasses?.length ? <small>No examples: {report.unsupportedClasses.join(', ')}</small> : null}</p>

    </div>

    {latest && <div className="training-progress" role="status"><Cpu size={16}/><strong>{latest.state === 'training' ? `${latest.task === 'slots' ? '2 of 2 · Slot detector' : '1 of 2 · Labware detector'}` : latest.state === 'complete' ? 'Training complete' : latest.state}</strong><span>{latest.state === 'complete' ? 'Both models saved' : `${latest.epoch} / ${latest.epochs} epochs${latest.task === 'slots' ? ' · Labware complete' : ' · Slots next'}`}</span><progress aria-label="Overall two-model training progress" max={latest.epochs * 2} value={latest.state === 'complete' ? latest.epochs * 2 : latest.epoch + (latest.task === 'slots' ? latest.epochs : 0)}/>{latest.error && <span>{latest.error}</span>}</div>}

    </>}
    <div className="detection-layout">

      <div className="detection-main"><div className="detection-camera"><div className="detection-camera-toolbar"><strong>{(status?.runtime.running ? status.runtime.source : source) === 'simulation' ? 'Simulated camera' : 'Live camera'}</strong><span>{status?.runtime.running ? status.runtime.stale ? 'Waiting for frame' : status.runtime.alignment?.ok ? 'View aligned' : status.runtime.alignment?.reason === 'camera view changed' ? 'View changed · slot mapping unavailable' : status.runtime.alignment?.reason ?? 'Connecting' : status?.training ? 'Paused during training' : 'Stopped'}</span></div>

        <div className="detector-controls">
          <label title="Changing source pauses detection">Source<select aria-label="Camera source" value={status?.runtime.running ? status.runtime.source ?? 'camera' : source} disabled={busy || status?.training} onChange={e => void changeDetector(e.target.value as 'camera' | 'simulation', chosen?.id ?? model)}><option value="camera">OBSBOT</option><option value="simulation">Simulation</option></select></label>
          <label title="Changing model pauses detection">Model<select aria-label="Detection model" value={chosen?.id ?? ''} disabled={busy || status?.training} onChange={e => void changeDetector(status?.runtime.running ? status.runtime.source ?? 'camera' : source, e.target.value)}>{!complete.length && <option value="">No trained model</option>}{complete.map(run => <option key={run.id} value={run.id}>{run.name ?? run.id}</option>)}</select></label>
          {status?.runtime.running ? <button onClick={() => { setSource(status.runtime.source ?? 'camera'); setModel(chosen?.id ?? model); void action('runtime/stop'); }} disabled={busy}><Square size={14}/> Stop</button> : <button className="primary-action" disabled={active || !chosen} onClick={() => action('runtime/start', { id: chosen?.id, source })}><Play size={14}/> Run detection</button>}
        </div>


        {status?.runtime.running && status.runtime.timestamp && !status.runtime.stale ? <img src={`/training-api/runtime/frame.jpg?t=${status.runtime.timestamp}`} alt="Live YOLO labware detections"/> : <div className="detection-placeholder"><Cpu size={30}/><span>{status?.runtime.running ? 'Connecting to live camera…' : status?.training ? 'Training on your GPU' : chosen ? source === 'simulation' ? 'Run detection on the simulated camera' : 'Connect OBSBOT by USB, then Run detection' : 'Load a saved model to begin'}</span></div>}

        {(status?.runtime.running ? status.runtime.source : source) === 'simulation' && <div className="simulation-feed-caption"><span>Simulated feed</span><span>YOLO predictions</span></div>}
        {status?.runtime.error && <p role="alert" className="training-error">{status.runtime.error}</p>}

      </div>

      <section className="detection-results" aria-label="Predicted deck state"><header><strong>Predictions</strong><span>12 slots</span></header><div className="detection-slot-grid">{('ABCD'.split('').flatMap(row => [1, 2, 3].map(column => `${row}${column}`))).map(id => { const slot = status?.runtime.slots.find(slot => slot.slot === id); return <div className={`detection-slot state-${slot?.state ?? 'unknown'}`} key={id} title={slot?.reason}><strong>{id}</strong><span>{slot?.label ?? slot?.state ?? 'unknown'}</span>{slot && slot.confidence > 0 && <small>{percent(slot.confidence)}</small>}</div>; })}</div><p title="Labware recognition continues when the view changes, but deck positions require a matching calibration.">Unknown slots need more evidence</p></section></div>

      <aside className="detection-deck">{(status?.runtime.running ? status.runtime.source : source) === 'simulation' && <SimulationDeck scene={scene} running={!!status?.runtime.running}/>}{(status?.runtime.running ? status.runtime.source : source) !== 'simulation' && <section className="detection-camera-controls" aria-label="Live camera controls"><CameraHardwareControls detection preset={context.view.cameraPtz} onReading={() => {}}/></section>}</aside>

    </div>

    <details className="detection-model-details"><summary>Model & validation</summary>
    {chosen && <section className="model-library" aria-label="Saved model"><strong>Saved model</strong><input aria-label="Model name" maxLength={80} value={savedName} onChange={e => setSavedName(e.target.value)}/><button disabled={busy || !savedName.trim()} onClick={() => action(`models/${chosen.id}/save`, { name: savedName })}>Save name</button><a href={`/training-api/models/${chosen.id}/download`} download>Download model</a><small>Both detectors · calibration · metrics. Models are saved automatically.</small></section>}

    <div className="training-metrics"><CheckCircle2 size={16}/><strong>Synthetic validation</strong>{chosen && Object.entries(chosen.models).map(([task, result]) => <span key={task}>{task} mAP50 <b>{percent(result.metrics['metrics/mAP50(B)'])}</b> · mAP50–95 <b>{percent(result.metrics['metrics/mAP50-95(B)'])}</b></span>)}<button title="Refresh training status" aria-label="Refresh training status" onClick={refresh}><RefreshCw size={14}/></button></div>

    <p className="training-footnote">{chosen?.realAdaptation ? 'This model includes one real training layout. Checking that same layout is not independent validation. ' : ''}Validate on independently labeled real camera images before relying on detection. Synthetic scores do not measure real-world accuracy.</p></details>

  </section>;

}
