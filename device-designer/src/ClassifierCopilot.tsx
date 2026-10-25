import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Check, Square } from 'lucide-react';
import { isClassifierDesign, type ClassifierDesign } from './classifier';

type Message = { role: 'user' | 'assistant'; text: string; proposal?: ClassifierDesign | null };
export function ClassifierCopilot({ design, onChange }: { design: ClassifierDesign; onChange: (value: ClassifierDesign) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [proposal, setProposal] = useState<ClassifierDesign | null>(null);
  const [baseline, setBaseline] = useState('');
  const controller = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }); }, [messages, busy]);
  async function send() {
    if (busy || !input.trim()) return;
    const next: Message[] = [...messages, { role: 'user', text: input.trim() }];
    const original = input;
    const abort = new AbortController(); controller.current = abort;
    setMessages(next); setInput(''); setBusy(true); setError(''); setProposal(null);
    setBaseline(JSON.stringify(design));
    try {
      const response = await fetch('/classifier-api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ design, messages: next }), signal: abort.signal });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Codex is unavailable.');
      if (typeof result.message !== 'string' || (result.proposal !== null && !isClassifierDesign(result.proposal))) throw new Error('Invalid Codex response.');
      setMessages([...next, { role: 'assistant', text: result.message, proposal: result.proposal }]); setProposal(result.proposal);
    } catch (e) {
      setMessages(messages); setInput(original);
      setError(abort.signal.aborted ? 'Stopped. Your message is ready to retry.' : e instanceof Error ? e.message : 'Could not reach Codex.');
    } finally { setBusy(false); controller.current = null; }
  }
  const stale = !!proposal && baseline !== JSON.stringify(design);
  const preview = proposal ?? design;
  return <div className="copilot-layout">
    <section className="copilot-chat classifier-card" aria-label="Codex conversation">
      <div className="classifier-section-heading"><h2>Codex <small>{busy ? 'Thinking…' : 'Classifier copilot'}</small></h2><button disabled={busy || !messages.length} onClick={() => { setMessages([]); setProposal(null); setError(''); }}>New conversation</button></div>
      <div className="copilot-messages" aria-live="polite">
        {!messages.length && <div className="copilot-welcome"><h2>What should the camera recognize?</h2><p>Describe your task. We’ll shape the labels and dataset together.</p><button onClick={() => setInput('Design a classifier for labware and deck slot occupancy on the Flex. Help me decide the labels and handle obscured slots.')}>Labware & deck occupancy ↗</button></div>}
        {messages.map((m, i) => <div className={`copilot-message ${m.role}`} key={i}><small>{m.role === 'user' ? 'You' : 'Codex'}</small><p>{m.text}</p></div>)}
        {busy && <p className="copilot-thinking" role="status">Codex is designing…</p>}<div ref={end}/>
      </div>
      {error && <p className="copilot-error" role="alert">{error}</p>}
      <form className="copilot-composer" onSubmit={e => { e.preventDefault(); void send(); }}><textarea aria-label="Message Codex" placeholder="Describe your task or refine the draft…" value={input} maxLength={12000} disabled={busy} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}/>{busy ? <button type="button" aria-label="Stop Codex" onClick={() => controller.current?.abort()}><Square size={16}/></button> : <button type="submit" aria-label="Send to Codex" disabled={!input.trim()}><ArrowUp size={18}/></button>}</form>
    </section>
    <aside className="classifier-card copilot-draft"><div className="classifier-section-heading"><h2>{proposal ? 'Proposed draft' : 'Current draft'}</h2><small>{preview.classes.length} classes</small></div><h3>{preview.name}</h3><p>{preview.objective || 'Your classifier will take shape here.'}</p>
      <div className="copilot-labels">{preview.classes.map(c => <div key={c.id}><i style={{ background: c.color }}/><div><strong>{c.name}</strong><p>{c.description}</p>{c.exclude && <small>Exclude: {c.exclude}</small>}</div></div>)}</div>
      {!!preview.classes.length && <div className="copilot-plan"><span>{preview.unit === 'deck_slot' ? `${preview.slots.length} deck slots` : 'Whole image'}</span><span>{preview.examplesPerClass} examples / class</span><span>{100 - preview.validationPercent - preview.testPercent} / {preview.validationPercent} / {preview.testPercent} split</span></div>}
      {proposal && <><button className="primary-action" disabled={stale} onClick={() => { onChange(proposal); setProposal(null); setMessages(m => [...m, { role: 'user', text: 'I applied that draft.' }]); }}><Check size={14}/>Apply draft</button><button onClick={() => setProposal(null)}>Discard</button>{stale && <p className="copilot-error">The draft changed while Codex was working. Ask Codex to revise from your current draft.</p>}</>}
    </aside>
  </div>;
}
