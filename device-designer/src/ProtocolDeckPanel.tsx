import { useEffect, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { parseAnalysis, type ExpectedDeck } from "./protocol-deck";

type AppAnalysis = { id: string; source: string; protocolName: string; analyzedAt: number };

// Category swatches match the box colors in scene.ts.
const swatch: Record<string, string> = { tipRack: "#4f8fe0", wellPlate: "#e0a04f", reservoir: "#4fc08f", adapter: "#8a8f99", aluminumBlock: "#a9adb5", tubeRack: "#c06fd0" };

export function ProtocolDeckPanel({ deck, onDeck }: { deck: ExpectedDeck | null; onDeck: (deck: ExpectedDeck | null) => void }) {
  const [analyses, setAnalyses] = useState<AppAnalysis[] | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const response = await fetch("/opentrons-app/analyses");
      if (!response.ok) throw new Error();
      setAnalyses(await response.json());
    } catch { setAnalyses(null); }
  };
  useEffect(() => { void refresh(); }, []);

  const load = async (id: string) => {
    setSelected(id); setError("");
    if (!id) { onDeck(null); return; }
    try {
      const response = await fetch(`/opentrons-app/analyses/${id}`);
      if (!response.ok) throw new Error();
      onDeck(parseAnalysis(await response.json()));
    } catch (e) { setError(e instanceof Error && e.message ? e.message : "Could not load that protocol's analysis."); }
  };

  return <section className="protocol-deck" aria-label="Protocol deck">
    <div className="protocol-deck-heading"><span className="small-label">PROTOCOL DECK</span>
      {analyses && <button className="icon-button" aria-label="Refresh Opentrons App protocols" title="Refresh Opentrons App protocols" onClick={() => void refresh()}><RefreshCw size={12} /></button>}
    </div>
    {analyses ? <select aria-label="Protocol from the Opentrons App" value={selected} onChange={e => void load(e.target.value)}>
      <option value="">{analyses.length ? "Choose a protocol from the Opentrons App" : "No analyzed protocols found"}</option>
      {analyses.map(a => <option key={a.id} value={a.id}>{a.protocolName} · {a.source}</option>)}
    </select> : <p className="protocol-deck-note">Opentrons App protocols are listed when running <code>npm run dev</code>. You can still open an analysis file.</p>}
    <label className="file-action">Open analysis JSON<input type="file" accept=".json,application/json" aria-label="Open Opentrons analysis file" onChange={async e => {
      const file = e.target.files?.[0]; e.target.value = ""; if (!file) return;
      setSelected(""); setError("");
      try { onDeck(parseAnalysis(JSON.parse(await file.text()))); }
      catch (err) { setError(err instanceof Error ? err.message : "Could not read that file."); }
    }} /></label>
    {error && <p className="protocol-deck-error" role="alert">{error}</p>}
    {deck && <div className="protocol-deck-result">
      <div className="protocol-deck-title"><strong>{deck.protocolName}</strong>
        <button className="icon-button" aria-label="Clear protocol deck" title="Clear protocol deck" onClick={() => { setSelected(""); onDeck(null); }}><X size={12} /></button>
      </div>
      <ul>
        {[...deck.labware].sort((a, b) => a.slot.localeCompare(b.slot)).map(l => <li key={l.id}>
          <span className="slot-badge">{l.slot}</span>
          <i style={{ background: swatch[l.category] ?? "#d8d8d0" }} />
          <span>{l.displayName}{l.onLabware && <small> stacked</small>}{l.onModule && <small> on module</small>}</span>
        </li>)}
        {deck.modules.map(m => <li key={m.id}><span className="slot-badge">{m.slot}</span><i /><span>{m.model} <small>module</small></span></li>)}
        {!deck.labware.length && <li className="protocol-deck-note">This protocol loads no labware.</li>}
      </ul>
      {deck.warnings.map(w => <p key={w} className="protocol-deck-warning">{w}</p>)}
    </div>}
  </section>;
}
