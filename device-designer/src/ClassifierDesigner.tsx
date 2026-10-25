import { useState } from "react";
import { ClassifierCopilot } from "./ClassifierCopilot";
import { Plus, Trash2, Download, Check, Tags } from "lucide-react";
import { classifierIssues, createLabwareClassifier, deckSlots, newClass, variationOptions, type ClassifierDesign } from "./classifier";

export function ClassifierDesigner({ design, onChange, onSave, onExport, clean, workspaceName }: {
  design: ClassifierDesign; onChange: (value: ClassifierDesign) => void; onSave: () => boolean;
  onExport: () => void; clean: boolean; workspaceName: string;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [manual, setManual] = useState(false);
  const selectedClass = design.classes.find(c => c.id === selected) ?? design.classes[0];
  const issues = classifierIssues(design);
  const update = (patch: Partial<ClassifierDesign>) => onChange({ ...design, ...patch });
  const total = design.classes.length * design.examplesPerClass;
  return <main className="classifier-designer" aria-label="Classifier design">
    <header className="classifier-heading"><div><span className="small-label">PHASE 03 · {workspaceName}</span><h1>Design your classifier</h1><p>Define the labels. Then plan the examples.</p></div><button className="primary-action" disabled={clean} onClick={onSave}><Check size={14}/>Save design</button></header>
    <div className="classifier-mode"><button aria-pressed={!manual} onClick={() => setManual(false)}>Copilot</button><button aria-pressed={manual} onClick={() => setManual(true)}>Edit definition</button><button disabled={!!issues.length} onClick={onExport}><Download size={14}/>Export spec</button></div>
    <div hidden={manual}><ClassifierCopilot design={design} onChange={onChange}/></div>
    <div className="classifier-layout" style={manual ? undefined : { display: 'none' }}>
      <section className="classifier-card classifier-purpose"><h2>Task</h2>
        {!design.classes.length && <button className="classifier-template" onClick={() => { onChange(createLabwareClassifier()); setSelected(null); }}>Use Labware & occupancy starter</button>}
        <label>Name<input aria-label="Classifier name" value={design.name} onChange={e => update({ name: e.target.value })}/></label>
        <label>What should it identify?<textarea aria-label="Classifier objective" placeholder="Describe the decision this classifier should make." value={design.objective} onChange={e => update({ objective: e.target.value })}/></label>
        <div className="classifier-fields"><label>Input<select value={design.unit} onChange={e => update({ unit: e.target.value as ClassifierDesign["unit"] })}><option value="frame">Whole image</option><option value="deck_slot">Deck slot</option></select></label>
        <label>Output<select value={design.mode} onChange={e => update({ mode: e.target.value as ClassifierDesign["mode"] })}><option value="single">One class</option><option value="multiple">Multiple classes</option></select></label></div>
        {design.unit === "deck_slot" && <fieldset className="classifier-slots"><legend>Deck slots</legend>{deckSlots.map(slot => <button key={slot} aria-pressed={design.slots.includes(slot)} onClick={() => update({ slots: design.slots.includes(slot) ? design.slots.filter(s => s !== slot) : [...design.slots, slot] })}>{slot}</button>)}</fieldset>}
        <div className="classifier-note">Unclear or obscured examples go to review, never silently into a class.</div>
      </section>
      <section className="classifier-card classifier-labels"><div className="classifier-section-heading"><h2>Classes <small>{design.classes.length}</small></h2><button disabled={design.classes.length >= 100} onClick={() => { const next = newClass(design.classes.length); update({ classes: [...design.classes, next] }); setSelected(next.id); }}><Plus size={14}/>Add class</button></div>
        {!design.classes.length ? <div className="classifier-empty"><Tags size={32}/><h3>Start with your labels</h3><p>Add a class for each outcome you need to distinguish.</p></div> : <>
          <div className="classifier-class-list" role="group" aria-label="Classes">{design.classes.map((item, i) => <button key={item.id} aria-pressed={selectedClass?.id === item.id} onClick={() => setSelected(item.id)}><i style={{ background: item.color }}/>{item.name || `Class ${i + 1}`}</button>)}</div>
          {selectedClass && <div className="classifier-class-editor" key={selectedClass.id}>
            <label>Class name<input aria-label="Class name" placeholder="e.g. Empty slot" value={selectedClass.name} onChange={e => update({ classes: design.classes.map(c => c.id === selectedClass.id ? { ...c, name: e.target.value } : c) })}/></label>
            <label>Label when<textarea aria-label="Class labeling rule" placeholder="Visible evidence that belongs in this class." value={selectedClass.description} onChange={e => update({ classes: design.classes.map(c => c.id === selectedClass.id ? { ...c, description: e.target.value } : c) })}/></label>
            <label>Exclude / easily confused with<textarea aria-label="Class exclusions" placeholder="Optional: edge cases and look-alikes." value={selectedClass.exclude} onChange={e => update({ classes: design.classes.map(c => c.id === selectedClass.id ? { ...c, exclude: e.target.value } : c) })}/></label>
            <button className="classifier-delete" onClick={() => update({ classes: design.classes.filter(c => c.id !== selectedClass.id) })}><Trash2 size={13}/>Remove class</button>
          </div>}
        </>}
      </section>
      <aside className="classifier-card classifier-dataset"><h2>Dataset plan</h2>
        <label>Examples per class<input aria-label="Examples per class" type="number" min={1} max={100000} value={design.examplesPerClass} onChange={e => update({ examplesPerClass: Number(e.target.value) })}/></label>
        <div className="classifier-total"><strong>{Number.isFinite(total) ? total.toLocaleString() : "—"}</strong><span>target label assignments</span></div>
        <div className="classifier-fields"><label>Validation %<input aria-label="Validation percent" type="number" min={1} max={40} value={design.validationPercent} onChange={e => update({ validationPercent: Number(e.target.value) })}/></label><label>Test %<input aria-label="Test percent" type="number" min={1} max={40} value={design.testPercent} onChange={e => update({ testPercent: Number(e.target.value) })}/></label></div>
        <p className="classifier-note">Train: {100 - design.validationPercent - design.testPercent}%. Keep frames from the same capture session in one split.</p>
        <fieldset className="classifier-variations"><legend>Vary the examples</legend>{variationOptions.map(v => <label key={v}><input type="checkbox" checked={design.variations.includes(v)} onChange={() => update({ variations: design.variations.includes(v) ? design.variations.filter(x => x !== v) : [...design.variations, v] })}/>{v}</label>)}</fieldset>
        <div className="classifier-readiness"><strong>{issues.length ? "Finish the definition" : "Ready for dataset generation"}</strong>{issues.length ? <ul>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul> : <p>Labels and sampling plan are defined. No images generated yet.</p>}</div>
        <button disabled={!!issues.length} onClick={onExport}><Download size={14}/>Export dataset spec</button>
      </aside>
    </div>
  </main>;
}
