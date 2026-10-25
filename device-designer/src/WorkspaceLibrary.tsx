import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { workspaceHistory } from './workspace-history';
import { loadRuns, type DatasetRun } from './dataset-store';
import { parseWorkspace, type SavedWorkspace } from './workspace-file';

export function WorkspaceLibrary({ onClose, onOpen }: { onClose: () => void; onOpen: (workspace: SavedWorkspace, runId?: string) => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [workspaces, setWorkspaces] = useState<SavedWorkspace[]>([]);
  const [runs, setRuns] = useState<DatasetRun[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<'workspaces' | 'runs'>('workspaces');
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    try { setWorkspaces(workspaceHistory()); } catch (e) { setError((e as Error).message); }
    loadRuns().then(items => { if (active) setRuns(items); }).catch(e => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const date = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const matches = (text: string) => text.toLowerCase().includes(query.toLowerCase());
  return <dialog ref={dialog} className="workspace-library-dialog" onCancel={onClose}>
    <header><div><h2>Open workspace</h2><p>Your saved setups and generated runs</p></div><button aria-label="Close workspace library" onClick={onClose}><X size={16}/></button></header>
    <div className="workspace-library-tools"><div><button aria-pressed={tab === 'workspaces'} onClick={() => setTab('workspaces')}>Setups · {workspaces.length}</button><button aria-pressed={tab === 'runs'} onClick={() => setTab('runs')}>Dataset runs · {runs.length}</button></div><input aria-label="Search saved setups and runs" placeholder="Search…" value={query} onChange={e => setQuery(e.target.value)}/></div>
    {error && <p role="alert">{error}</p>}
    <div className="workspace-library-list">
      {tab === 'workspaces' ? <>{workspaces.filter(w => matches(w.name)).map((w, i) => <button className="workspace-library-row" key={`${w.savedAt}-${i}`} onClick={() => onOpen(w)}><span><strong>{w.name}</strong><small>{w.classifier?.name ?? 'Workspace setup'} · {w.view.cameraPtz ? 'Saved camera view' : 'No saved PTZ'}</small></span><time>{date(w.savedAt)}</time></button>)}{!workspaces.filter(w => matches(w.name)).length && <p>No saved setups found.</p>}</> : <>{loading ? <p>Loading runs…</p> : runs.filter(r => matches(`${r.context.name} ${r.id} ${r.split}`)).map(r => <button className="workspace-library-row" key={r.id} onClick={() => onOpen(r.context, r.id)}><span><strong>{r.context.name}</strong><small>{r.split} · target {r.target} images · {r.id.slice(0, 8)}</small></span><time>{date(r.createdAt)}</time></button>)}{!loading && !runs.filter(r => matches(`${r.context.name} ${r.id} ${r.split}`)).length && <p>No saved runs found.</p>}</>}
    </div>
    <footer><span>Opening preserves your current setup. Runs reopen paused.</span><label className="file-action">Import setup<input type="file" aria-label="Import saved workspace" accept=".json,application/json" onChange={async e => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; try { if (file.size > 1000000) throw new Error('Workspace file is too large.'); onOpen(parseWorkspace(await file.text())); } catch (e) { setError((e as Error).message); } }}/></label></footer>
  </dialog>;
}
