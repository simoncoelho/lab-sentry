import { useEffect, useRef, useState } from 'react';
import { cleanProcessing, checkedProcessing, processImage, type ImageProcessing } from './image-processing';
import { SlidersHorizontal, X, RotateCcw } from 'lucide-react';
import type { DatasetFrame } from './dataset';
import { saveRun, type DatasetRun } from './dataset-store';
export function ImageProcessingPanel({ run, frames, frame: initialFrame, disabled, onSave }: { run: DatasetRun | null; frames: DatasetFrame[]; frame?: DatasetFrame; disabled: boolean; onSave: (run: DatasetRun) => void }) {
  const count = frames.length;
  const [open, setOpen] = useState(false), [selected, setSelected] = useState<string | null>(null), [before, setBefore] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const frame = frames.find(f => f.id === selected) ?? initialFrame;
  useEffect(() => { if (open) dialog.current?.showModal(); else dialog.current?.close(); }, [open]);
  function close() { setOpen(false); setBefore(false); setDraft(run?.processing ?? cleanProcessing); setError(''); }
  const [draft, setDraft] = useState<ImageProcessing>(run?.processing ?? cleanProcessing);
  const [url, setUrl] = useState(''), [error, setError] = useState(''), [saving, setSaving] = useState(false);
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
    if (open && frame) void processImage(frame.image, draft, frame.id).then(image => {
      if (!cancelled) { next = URL.createObjectURL(image); setUrl(next); }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; if (next) URL.revokeObjectURL(next); };
  }, [frame, draft, open]);
  const [savedMessage, setSavedMessage] = useState('');
  useEffect(() => { setSavedMessage(''); }, [draft, run?.id]);
  const [originalUrl, setOriginalUrl] = useState('');
  useEffect(() => { if (!frame) { setOriginalUrl(''); return; } const next = URL.createObjectURL(frame.image); setOriginalUrl(next); return () => URL.revokeObjectURL(next); }, [frame]);
  async function apply() {
    if (!run || disabled || saving || !count) return; setSaving(true); setError('');
    try { const updated = { ...run, processing: checkedProcessing({ ...draft }) }; await saveRun(updated); onSave(updated); setSavedMessage(`Applied to all ${count} images`); setOpen(false); } catch(e) { setError((e as Error).message); } finally { setSaving(false); }
  }
  const dirty = JSON.stringify(draft) !== JSON.stringify(run?.processing ?? cleanProcessing);
  return <>
    <button className="effects-launch" disabled={!count || disabled} onClick={() => { setSelected(initialFrame?.id ?? null); setDraft(run?.processing ?? cleanProcessing); setBefore(false); setOpen(true); }}><SlidersHorizontal size={14}/>Camera effects</button>
    {savedMessage && <span className="effects-applied" role="status">{savedMessage}</span>}
    <dialog ref={dialog} className="photo-editor" aria-labelledby="effects-title" onCancel={close} onClose={() => setOpen(false)}>
      {open && <><header className="photo-editor-header"><div><h2 id="effects-title">Camera effects</h2><span>{count} images</span></div><button aria-label="Close camera effects" disabled={saving} onClick={close}><X size={18}/></button></header>
      <div className="photo-editor-body"><div className="photo-editor-canvas"><div className="photo-editor-toolbar"><span>Image {frame?.index}</span><button aria-pressed={before} onClick={() => setBefore(v => !v)}>{before ? 'Show edited' : 'Compare original'}</button></div>
        <div className="photo-editor-image">{(before ? originalUrl : url) ? <img src={before ? originalUrl : url} alt={before ? 'Original generated image' : 'Camera effects preview'}/> : <span>Updating preview…</span>}<small>{before ? 'Original' : 'Edited'}</small></div>
        <div className="photo-editor-strip" aria-label="Preview images">{frames.filter((_, i) => i % Math.max(1, Math.floor(count / 12)) === 0).slice(0,12).map(f => <button key={f.id} aria-label={`Preview image ${f.index}`} aria-pressed={frame?.id === f.id} onClick={() => setSelected(f.id)}><EffectThumbnail frame={f}/><span>{f.index}</span></button>)}</div>
      </div><aside className="photo-editor-adjustments"><div className="photo-editor-adjust-title"><h3>Adjust</h3><button title="Reset adjustments" aria-label="Reset adjustments" disabled={saving} onClick={() => setDraft(cleanProcessing)}><RotateCcw size={15}/></button></div>
      <div className="photo-editor-presets">{[{name:'Original',noise:0,quality:100,scale:1},{name:'Light',noise:2,quality:90,scale:.75},{name:'Compressed',noise:4,quality:70,scale:.5}].map(p => <button key={p.name} disabled={saving} aria-pressed={draft.noise===p.noise && draft.quality===p.quality && draft.scale===p.scale} onClick={() => setDraft({...draft,noise:p.noise,quality:p.quality,scale:p.scale})}>{p.name}</button>)}</div>
      <div className="processing-controls photo-editor-sliders">{([{key:'noise',name:'Noise',min:0,max:12,step:1},{key:'quality',name:'JPEG quality',min:40,max:100,step:1},{key:'scale',name:'Resolution',min:.25,max:1,step:.05}] as const).map(control => <label key={control.key}>{control.name}<output>{control.key === 'scale' ? `${Math.round(draft.scale*1280)} × ${Math.round(draft.scale*720)}` : draft[control.key]}</output><input disabled={saving || !frame} aria-label={control.name} type="range" min={control.min} max={control.max} step={control.step} value={draft[control.key]} onChange={e => setDraft({...draft,[control.key]:Number(e.target.value)})}/></label>)}</div>
      <button className="photo-match-camera" disabled={disabled || saving} onClick={matchResolution}>Match camera resolution</button>
      {referenceUrl && <img className="effects-reference" src={referenceUrl} alt="Captured live camera reference"/>}
      <p className="photo-editor-note">Preview any image. Apply the same look to all.</p>
      {error && <p role="alert">{error}</p>}
      </aside></div>
      <footer className="photo-editor-footer"><span>Originals preserved · export & training stay in sync</span><button disabled={saving} onClick={close}>Cancel</button><button className="primary-action" disabled={!run || !count || disabled || saving || !dirty} onClick={apply}>{saving ? 'Applying…' : `Apply to all ${count}`}</button></footer></>}
    </dialog>
  </>;
}
function EffectThumbnail({frame}: {frame: DatasetFrame}) {
  const [url,setUrl] = useState('');
  useEffect(() => { const next=URL.createObjectURL(frame.image); setUrl(next); return () => URL.revokeObjectURL(next); },[frame.image]);
  return <img src={url || undefined} alt=""/>;
}
