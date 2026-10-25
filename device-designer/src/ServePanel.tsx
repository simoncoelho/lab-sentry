import type { InstrumentScene } from './scene';
import { useEffect, useRef, useState } from 'react';
const endpoint = 'http://127.0.0.1:5102/api/v1/deck-state';
type DeckState = { status: string; fresh: boolean; modelId: string | null; ageMs: number | null; slots: {slot: string; state: string; labware: string | null; confidence: number}[] };
export function ServePanel({ onDetector, scene }: { onDetector: () => void; scene: InstrumentScene | null }) {
  const [state, setState] = useState<DeckState>();
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<ReturnType<InstrumentScene['attachStateView']> | null>(null);
  const [enclosure, setEnclosure] = useState(false);
  const [viewError, setViewError] = useState('');
  useEffect(() => {
    if (!scene || !host.current) return;
    const attach = () => { if (view.current || !host.current) return; try { view.current=scene.attachStateView(host.current);view.current.update([]);setViewError(''); } catch(e) { setViewError((e as Error).message); } };
    attach(); const retry=setInterval(attach,500);
    return () => { clearInterval(retry);view.current?.dispose(); view.current=null; };
  }, [scene]);
  useEffect(() => { view.current?.update(state?.slots ?? []); }, [state]);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    let lastMessage = Date.now();
    const stream = new EventSource('/training-api/api/v1/deck-state/stream');
    const receive = (event: MessageEvent) => {
      try {
        const next = JSON.parse(event.data);
        lastMessage = Date.now();
        if (!Array.isArray(next.slots)) throw new Error('Invalid state stream');
        setState(next); setError('');
      } catch { setState(undefined); setError('Invalid state received.'); }
    };
    stream.addEventListener('state', receive);
    stream.onerror = () => { setState(undefined); setError('State stream disconnected. Reconnecting…'); };
    const watchdog = setInterval(() => {
      if (Date.now()-lastMessage > 5000) { setState(undefined); setError('Waiting for state stream…'); }
    }, 1000);
    return () => { stream.close(); clearInterval(watchdog); };
  }, []);
  return <section className="serve-panel" aria-label="Serve deck state">
    <header><div><span className="small-label">06 / SERVE</span><h1>Deck state API</h1><p>Live observations for your applications.</p></div><span className="serve-status">{state?.status ?? 'Connecting'}</span></header>
    <section className="serve-model"><button className="serve-enclosure" aria-pressed={enclosure} onClick={() => { setEnclosure(!enclosure); view.current?.setEnclosure(!enclosure); }}>{enclosure ? "Fade enclosure" : "Show enclosure"}</button><div ref={host} className="serve-model-canvas"/><div className="serve-model-legend">Live Flex · drag to orbit · scroll to zoom <span>Live updates · simplified class models</span></div>{viewError && <p role="alert">{viewError}</p>}</section>
    <div className="serve-layout"><section className="serve-card"><h2>Local endpoint</h2><div className="serve-endpoint"><b>GET</b><code>{endpoint}</code></div><p>Available on this computer while the service is running. The browser can be closed.</p>
      <div className="serve-actions"><button onClick={async () => { try { await navigator.clipboard.writeText(endpoint); setCopied(true); } catch { setError('Select and copy the endpoint above.'); } }}>{copied ? 'Copied' : 'Copy URL'}</button><a href={endpoint} target="_blank" rel="noreferrer">Open JSON ↗</a></div>
      <h2>State stream · SSE</h2><code>{endpoint}/stream</code><pre>curl -N {endpoint}/stream</pre><p>Full state on each observation. Automatically reconnects; no polling required.</p>
      <h2>Detector</h2><p>{state?.modelId ?? 'No model running'}</p><button onClick={onDetector}>Manage detector</button>
      <p>Start or select a trained model in Train &amp; run. This endpoint always returns all 12 positions. Stale or stopped observations become unknown.</p>
      <h2>Request</h2><pre>curl {endpoint}</pre><p>Check <code>fresh</code> and each slot’s <code>state</code> before acting. Fresh images can still contain unknown slots.</p>
    </section><section className="serve-card"><header><h2>Live response</h2><span>{state?.ageMs != null ? `${state.ageMs} ms old` : 'No observations'}</span></header><pre className="serve-response" aria-label="Live deck state JSON">{state ? JSON.stringify(state, null, 2) : 'Waiting for service…'}</pre></section></div>
    {error && <p role="alert" className="serve-error">{error}</p>}
  </section>;
}
