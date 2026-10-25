import { useEffect, useState } from 'react';
import { cleanProcessing, processImage, type ImageProcessing } from './image-processing';
import type { DatasetFrame } from './dataset';
import { saveRun, type DatasetRun } from './dataset-store';
export function ImageProcessingPanel({ run, frame, disabled, onSave }: { run: DatasetRun | null; frame?: DatasetFrame; disabled: boolean; onSave: (run: DatasetRun) => void }) {
  const [draft, setDraft] = useState<ImageProcessing>(run?.processing ?? cleanProcessing);
  const [url, setUrl] = useState(''), [original, setOriginal] = useState(false), [error, setError] = useState(''), [saving, setSaving] = useState(false);
  const [reference, setReference] = useState<Blob | null>(null), [referenceUrl, setReferenceUrl] = useState('');
  useEffect(() => { if (!reference) return; const next = URL.createObjectURL(reference); setReferenceUrl(next); return () => URL.revokeObjectURL(next); }, [reference]);
  async function matchResolution() {
    setError('');
    try {
      const status = await fetch('/training-api/status').then(r => r.json());
      if (!status.runtime?.running || status.runtime.stale) throw new Error('Start live detection to capture a fresh camera reference.');
      const response = await fetch('/training-api/runtime/raw.jpg');
      if (!response.ok || response.status === 204) throw new Error('Camera frame unavailable');
      const image = await response.blob(), bitmap = await createImageBitmap(image);
      try {
        if (Math.abs(bitmap.width / bitmap.height - 16 / 9) > .01) throw new Error('Camera aspect ratio differs; recalibrate before matching.');
        const scale = Math.max(.25, Math.min(1, bitmap.width / 1280));
        setDraft(previous => ({ ...previous, scale }));
        setReference(image);
      } finally { bitmap.close(); }
    } catch (e) { setError((e as Error).message); }
  }
  useEffect(() => { setDraft(run?.processing ?? cleanProcessing); }, [run?.id, run?.processing]);
  useEffect(() => {
    let cancelled = false, next = ''; setUrl('');
    if (frame) void (original ? Promise.resolve(frame.image) : processImage(frame.image, draft, frame.id)).then(image => {
      if (!cancelled) { next = URL.createObjectURL(image); setUrl(next); }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; if (next) URL.revokeObjectURL(next); };
  }, [frame, draft, original]);
  async function apply() {
    if (!run) return; setSaving(true); setError('');
    try { const updated = { ...run, processing: draft }; await saveRun(updated); onSave(updated); } catch(e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(run?.processing ?? cleanProcessing);
  return <section className="image-processing" aria-label="Image processing"><header><h2>Camera effects</h2><button onClick={matchResolution}>Match stream resolution</button><button aria-pressed={original} onClick={() => setOriginal(!original)}>{original ? 'Show processed' : 'Compare original'}</button></header>
    <div className={`processing-layout${referenceUrl ? " has-reference" : ""}`}><div className="processing-preview">{url && <img src={url} alt={original ? 'Original generated image' : 'Processed training image preview'}/>}<span>{original ? 'Original' : dirty ? 'Preview · unsaved' : 'Saved output'}</span></div>
    {referenceUrl && <div className="processing-preview"><img src={referenceUrl} alt="Captured live camera reference"/><span>Camera reference · captured frame</span></div>}<div className="processing-controls">{([{key:'noise',name:'Noise',min:0,max:12,step:1},{key:'quality',name:'JPEG quality',min:40,max:100,step:1},{key:'scale',name:'Resolution',min:.25,max:1,step:.05}] as const).map(control => <label key={control.key}>{control.name}<output>{control.key === 'scale' ? `${Math.round(draft.scale*1280)} × ${Math.round(draft.scale*720)}` : draft[control.key]}</output><input aria-label={control.name} type="range" min={control.min} max={control.max} step={control.step} value={draft[control.key]} onChange={e => setDraft({...draft,[control.key]:Number(e.target.value)})}/></label>)}
      <div><button onClick={() => setDraft(cleanProcessing)}>Reset</button><button className="primary-action" disabled={!run || disabled || saving || !dirty} onClick={apply}>{saving ? 'Saving…' : 'Apply to this run'}</button></div><small>{disabled ? 'Pause generation to apply.' : 'Saved output is passed to training. Originals are retained.'} Resolution is restored to 1280 × 720 after downsampling; labels stay aligned. Noise and JPEG quality are manual approximations.</small></div></div>{error && <p role="alert">{error}</p>}
  </section>;
}
