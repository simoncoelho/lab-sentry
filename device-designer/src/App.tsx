import { useEffect, useRef, useState } from "react";
import {
  Box,
  Camera,
  Check,
  ChevronRight,
  Crosshair,
  Expand,
  ExternalLink,
  Eye,
  EyeOff,
  Focus,
  Grid2X2,
  Info,
  Layers3,
  Move3D,
  RotateCcw,
  Rotate3D,
  SlidersHorizontal,
  SquareDashed,
  Trash2,
  Plus,
  X,
} from "lucide-react";
import { InstrumentScene, type ModelInfo } from "./scene";
import {
  clamp,
  createWorkspace,
  displayValue,
  instruments,
  nativeValue,
  resetInstrument,
  setInstrumentPresent,
  updateJoint,
  type InstrumentId,
  type JointSpec,
  type Pose,
} from "./state";

type LoadState = { progress: number; info?: ModelInfo; error?: string };

function Numeric({
  value,
  min,
  max,
  step = 1,
  label,
  unit,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  label: string;
  unit: string;
  onChange: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value.toFixed(1));
  useEffect(() => setDraft(value.toFixed(1)), [value]);
  function commit() {
    const next = draft.trim() === "" ? NaN : Number(draft);
    if (Number.isFinite(next)) {
      const v = clamp(next, min, max);
      onChange(v);
      setDraft(v.toFixed(1));
    } else setDraft(value.toFixed(1));
  }
  return (
    <span className="numeric">
      <input
        aria-label={label}
        type="number"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value.toFixed(1));
          }
        }}
      />
      <span>{unit}</span>
    </span>
  );
}

function JointControl({
  joint,
  value,
  onChange,
}: {
  joint: JointSpec;
  value: number;
  onChange: (value: number) => void;
}) {
  const linear = joint.type === "prismatic";
  const min = displayValue(joint.lower, joint),
    max = displayValue(joint.upper, joint),
    current = displayValue(value, joint);
  const unit = linear ? "mm" : "°";
  return (
    <div className="joint-control">
      <div className="control-label">
        <label htmlFor={joint.name}>{joint.label}</label>
        <Numeric
          label={`${joint.label} value`}
          unit={unit}
          min={min}
          max={max}
          value={current}
          step={0.1}
          onChange={(v) => onChange(nativeValue(v, joint))}
        />
      </div>
      <input
        id={joint.name}
        type="range"
        aria-label={joint.label}
        min={min}
        max={max}
        step={0.1}
        value={current}
        style={
          {
            "--fill": `${((current - min) / (max - min)) * 100}%`,
          } as React.CSSProperties
        }
        onChange={(e) => onChange(nativeValue(Number(e.target.value), joint))}
      />
      <div className="range-labels">
        <span>
          {min.toFixed(0)} {unit}
        </span>
        <span>{linear ? "PRISMATIC" : "REVOLUTE"}</span>
        <span>
          {max.toFixed(0)} {unit}
        </span>
      </div>
    </div>
  );
}

function InstrumentGlyph({ id }: { id: InstrumentId }) {
  return (
    <div className={`instrument-glyph ${id}`}>
      {id === "tiny2" ? (
        <Camera size={26} strokeWidth={1.25} />
      ) : (
        <svg viewBox="0 0 40 44" aria-hidden="true">
          <path
            d="M7 7 25 3 35 9 35 35 17 41 7 35Z M7 7 17 13 35 9 M17 13V41 M10 12V32L14 34V15 M21 16V34L31 31V14 M21 25 31 22 M25 15V23"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.1"
          />
        </svg>
      )}
    </div>
  );
}

export default function App() {
  const [selected, setSelected] = useState<InstrumentId>("flex");
  const [workspace, setWorkspace] = useState(createWorkspace);
  const [loads, setLoads] = useState<Record<string, LoadState>>({});
  const [tab, setTab] = useState<"joints" | "placement">("joints");
  const [placementMode, setPlacementMode] = useState<"translate" | "rotate">(
    "translate",
  );
  const [mounting, setMounting] = useState(false);
  const [mountNotice, setMountNotice] = useState("");
  const [isolated, setIsolated] = useState(false);
  const [grid, setGrid] = useState(true);
  const [acrylicVisible, setAcrylicVisible] = useState(true);
  const [help, setHelp] = useState(false);
  const [sceneError, setSceneError] = useState("");
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<InstrumentScene | null>(null);
  const instrument = instruments.find((i) => i.id === selected)!;
  const state = workspace[selected];
  const activeInstruments = instruments.filter((i) => workspace[i.id].present);
  const availableInstruments = instruments.filter(
    (i) => !workspace[i.id].present,
  );
  const info = loads[selected]?.info;
  const ready = instruments.filter((i) => loads[i.id]?.info).length;

  useEffect(() => {
    try {
      scene.current = new InstrumentScene(host.current!, {
        move: (id, pose) =>
          setWorkspace((previous) => ({
            ...previous,
            [id]: { ...previous[id], pose },
          })),
        mounted: (pose) => {
          setWorkspace(previous => ({ ...previous, tiny2: { ...previous.tiny2, pose, visible: true } }));
          setMounting(false);
          setMountNotice("Tiny 2 placed flush on the Flex surface.");
          setSelected("tiny2");
          setTab("joints");
        },
        select: (id) => { setSelected(id); setMounting(false); },
        progress: (id, progress) =>
          setLoads((previous) => ({
            ...previous,
            [id]: { ...previous[id], progress },
          })),
        ready: (id, modelInfo) => {
          setLoads((previous) => ({
            ...previous,
            [id]: { progress: 100, info: modelInfo },
          }));
          setWorkspace((previous) => ({
            ...previous,
            [id]: {
              ...previous[id],
              joints: Object.fromEntries(
                modelInfo.joints.map((j) => [j.name, j.initial]),
              ),
            },
          }));
        },
        error: (id, error) =>
          setLoads((previous) => ({
            ...previous,
            [id]: { progress: 0, error },
          })),
      });
    } catch (error) {
      setSceneError(
        error instanceof Error ? error.message : "WebGL is unavailable",
      );
    }
    return () => {
      scene.current?.dispose();
      scene.current = null;
    };
  }, []);
  useEffect(() => {
    scene.current?.update(workspace, selected, isolated);
  }, [workspace, selected, isolated]);
  useEffect(() => {
    scene.current?.setPlacementEnabled(tab === "placement", placementMode);
    if (tab === "placement") setMounting(false);
  }, [tab, placementMode]);
  useEffect(() => {
    if (isolated) scene.current?.focus(selected);
  }, [selected, isolated]);
  useEffect(() => {
    scene.current?.setSurfaceMount(mounting);
    if (mounting) scene.current?.focus("flex");
  }, [mounting]);
  useEffect(() => {
    if (!workspace.flex.present || !workspace.flex.visible || !workspace.tiny2.present || !workspace.tiny2.visible || isolated) setMounting(false);
  }, [workspace, isolated]);
  useEffect(() => {
    scene.current?.setGrid(grid);
  }, [grid]);
  useEffect(() => {
    scene.current?.setAcrylicVisible(acrylicVisible);
  }, [acrylicVisible]);
  useEffect(() => {
    if (ready === instruments.length) scene.current?.focus();
  }, [ready]);
  useEffect(() => {
    if (!help) return;
    const restore = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Workspace help"]',
    );
    const trapFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const buttons = document.querySelectorAll<HTMLButtonElement>(
        ".help-dialog button",
      );
      const first = buttons[0],
        last = buttons[buttons.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", trapFocus);
    return () => {
      document.removeEventListener("keydown", trapFocus);
      restore?.focus();
    };
  }, [help]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.ctrlKey ||
        e.metaKey ||
        e.altKey
      )
        return;
      if (help && e.key !== "Escape") return;
      if (e.key.toLowerCase() === "f" && state.present) {
        e.preventDefault();
        scene.current?.focus(selected);
      }
      if (e.key.toLowerCase() === "a") {
        e.preventDefault();
        scene.current?.focus();
      }
      if (e.key === "Escape") { setHelp(false); setMounting(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, help, state.present]);

  function updatePose(axis: keyof Pose, value: number) {
    setWorkspace((previous) => ({
      ...previous,
      [selected]: {
        ...previous[selected],
        pose: { ...previous[selected].pose, [axis]: value },
      },
    }));
  }
  function toggleVisibility(id: InstrumentId) {
    setWorkspace((previous) => ({
      ...previous,
      [id]: { ...previous[id], visible: !previous[id].visible },
    }));
  }
  function removeInstrument(id: InstrumentId) {
    setWorkspace((previous) => setInstrumentPresent(previous, id, false));
    if (selected === id) {
      const next = activeInstruments.find((i) => i.id !== id);
      if (next) setSelected(next.id);
      else setIsolated(false);
    }
  }
  function addInstrument(id: InstrumentId) {
    setWorkspace((previous) => setInstrumentPresent(previous, id, true));
    setSelected(id);
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-icon">
            <Layers3 size={19} />
          </span>
          <strong>lab sentry</strong>
          <span className="brand-divider" />
          <span className="app-name">instrument workspace</span>
        </div>
        <div className="top-actions">
          <span className="mode-tag">
            <span /> LOCAL SIMULATION
          </span>
          <button
            className="icon-button"
            title="Workspace help"
            aria-label="Workspace help"
            onClick={() => setHelp(!help)}
          >
            <Info size={16} />
          </button>
        </div>
      </header>

      <aside className="library">
        <div className="panel-heading">
          <span>INSTRUMENTS</span>
          <span className="count">
            {String(activeInstruments.length).padStart(2, "0")}
          </span>
        </div>
        <div className="library-intro">
          <h1>Your workspace</h1>
          <p>
            {activeInstruments.length}{" "}
            {activeInstruments.length === 1 ? "instrument" : "instruments"} in
            this space.
          </p>
        </div>
        <div className="instrument-list">
          {activeInstruments.map((item, index) => (
            <div
              key={item.id}
              className={`instrument-card ${selected === item.id ? "active" : ""} ${!workspace[item.id].visible ? "muted" : ""}`}
            >
              <button
                className="instrument-select"
                aria-pressed={selected === item.id}
                aria-label={`Select ${item.name}`}
                onClick={() => { setSelected(item.id); setMounting(false); }}
              >
                <div className="instrument-card-top">
                  <span className="instrument-index">0{index + 1}</span>
                  <span
                    className={`status-dot ${loads[item.id]?.error ? "error" : loads[item.id]?.info ? "ready" : ""}`}
                  />
                  <span className="instrument-maker">{item.maker}</span>
                </div>
                <div className="instrument-card-main">
                  <InstrumentGlyph id={item.id} />
                  <div>
                    <strong>{item.name}</strong>
                    <span>{item.category}</span>
                  </div>
                  <ChevronRight size={15} className="card-chevron" />
                </div>
                <div className="instrument-meta">
                  {loads[item.id]?.error
                    ? "Model unavailable"
                    : loads[item.id]?.info
                      ? `${loads[item.id].info!.joints.length} joints · URDF`
                      : `Loading meshes · ${loads[item.id]?.progress || 0}%`}
                </div>
              </button>
              <button
                className="visibility-button icon-button"
                aria-label={`${workspace[item.id].visible ? "Hide" : "Show"} ${item.name}`}
                title={`${workspace[item.id].visible ? "Hide" : "Show"} ${item.name}`}
                onClick={() => toggleVisibility(item.id)}
              >
                {workspace[item.id].visible ? (
                  <Eye size={14} />
                ) : (
                  <EyeOff size={14} />
                )}
              </button>
            </div>
          ))}
        </div>
        {availableInstruments.length > 0 && (
          <div className="available-instruments">
            <span className="small-label">ADD TO WORKSPACE</span>
            {availableInstruments.map((item) => (
              <button
                key={item.id}
                onClick={() => addInstrument(item.id)}
                aria-label={`Add ${item.name} to workspace`}
              >
                <Plus size={14} />
                <span>{item.name}</span>
              </button>
            ))}
          </div>
        )}
        <div className="library-note">
          <SquareDashed size={17} />
          <p>
            Independent models.
            <br />
            Select one to adjust its pose.
          </p>
        </div>
        <div className="library-footer">
          <span className="small-label">WORKSPACE UNITS</span>
          <div>
            <span>millimeters / degrees</span>
            <span className="unit-badge">1:1</span>
          </div>
        </div>
      </aside>

      <main className="viewport">
        <div className="viewport-toolbar">
          <div className="breadcrumb">
            <Box size={14} />
            <span>Scene</span>
            <ChevronRight size={12} />
            <strong>
              {state.present ? instrument.name : "Empty workspace"}
            </strong>
          </div>
          <div className="view-actions">
            <button
              title="Fit all visible instruments (A)"
              aria-label="Fit all instruments"
              onClick={() => scene.current?.focus()}
            >
              <Expand size={14} />
              <span>Fit all</span>
            </button>
            <button
              className={`icon-button ${grid ? "on" : ""}`}
              title="Toggle grid"
              aria-label="Toggle grid"
              aria-pressed={grid}
              onClick={() => setGrid(!grid)}
            >
              <Grid2X2 size={15} />
            </button>
          </div>
        </div>
        <div className="canvas-host" ref={host} />
        {activeInstruments.length === 0 && !sceneError && (
          <div className="scene-message">
            <Box size={28} />
            <h2>Your workspace is empty</h2>
            <p>Add an instrument from the library to get started.</p>
          </div>
        )}
        <div className="viewport-caption">
          <span className="small-label">SHARED WORKSPACE</span>
          <span>True scale · Z-up</span>
        </div>
        <div className="view-presets">
          <button
            onClick={() => scene.current?.focus(undefined, "perspective")}
            title="Perspective view"
          >
            3D
          </button>
          <button onClick={() => scene.current?.focus(undefined, "front")}>
            Front
          </button>
          <button onClick={() => scene.current?.focus(undefined, "top")}>
            Top
          </button>
        </div>
        {mounting && (
          <div className="isolation-banner mount-banner" role="status">
            <Crosshair size={15} /> Click a Flex surface to mount Tiny 2
            <button onClick={() => setMounting(false)} aria-label="Cancel surface mounting"><X size={14} /></button>
          </div>
        )}
        {isolated && (
          <div className="isolation-banner">
            <Focus size={13} /> Isolating {instrument.name}
            <button
              onClick={() => setIsolated(false)}
              aria-label="Exit isolation"
            >
              <X size={13} />
            </button>
          </div>
        )}
        {sceneError && (
          <div className="scene-message">
            <Box size={28} />
            <h2>3D view unavailable</h2>
            <p>{sceneError}</p>
            <p>Use a browser with WebGL enabled.</p>
          </div>
        )}
        {!sceneError &&
          activeInstruments.length > 0 &&
          ready === 0 &&
          !instruments.every((i) => loads[i.id]?.error) && (
            <div className="scene-message loading">
              <div className="spinner" />
              <h2>Assembling your workspace</h2>
              <p>Loading URDFs and mesh geometry…</p>
            </div>
          )}
        {!sceneError &&
          activeInstruments.length > 0 &&
          ready === 0 &&
          instruments.every((i) => loads[i.id]?.error) && (
            <div className="scene-message">
              <h2>Models could not load</h2>
              <p>
                Check that the models folder is served alongside the viewer.
              </p>
              <button onClick={() => window.location.reload()}>
                Retry loading
              </button>
            </div>
          )}
        <div className="viewport-bottom">
          <span>
            <span className="mouse-icon" /> Drag to orbit <i /> Right-drag to
            pan <i /> Scroll to zoom
          </span>
          <span className="axis-legend">
            <b className="axis-x">X</b>
            <b className="axis-y">Y</b>
            <b className="axis-z">Z</b>
          </span>
        </div>
      </main>

      <aside
        className="inspector"
        aria-label={
          state.present ? `${instrument.name} controls` : "Instrument controls"
        }
      >
        <div className="panel-heading">
          <span>INSTRUMENT CONTROL</span>
          <SlidersHorizontal size={13} />
        </div>
        {state.present ? (
          <>
            <div className="inspector-title">
              <span className="small-label">{instrument.maker}</span>
              <h2>
                {instrument.name}
                <span className="selected-badge">SELECTED</span>
              </h2>
              <p>{instrument.description}</p>
              <div className="inspector-actions">
                <button
                  aria-pressed={
                    tab === "placement" && placementMode === "translate"
                  }
                  disabled={!info || !state.visible}
                  onClick={() => {
                    setTab(
                      tab === "placement" && placementMode === "translate"
                        ? "joints"
                        : "placement",
                    );
                    setPlacementMode("translate");
                    if (tab !== "placement") scene.current?.focus(selected);
                  }}
                  title="Move this device using the scene handles"
                >
                  <Move3D size={14} />
                  Move
                </button>
                <button
                  aria-pressed={
                    tab === "placement" && placementMode === "rotate"
                  }
                  disabled={!info || !state.visible}
                  onClick={() => {
                    setTab(
                      tab === "placement" && placementMode === "rotate"
                        ? "joints"
                        : "placement",
                    );
                    setPlacementMode("rotate");
                    if (tab !== "placement") scene.current?.focus(selected);
                  }}
                  title="Rotate this device using the scene rings"
                >
                  <Rotate3D size={14} />
                  Rotate
                </button>
                <button
                  disabled={!info || !state.visible}
                  onClick={() => scene.current?.focus(selected)}
                  title="Focus selected instrument (F)"
                >
                  <Crosshair size={14} />
                  Focus
                </button>
                <button
                  className={isolated ? "on" : ""}
                  aria-pressed={isolated}
                  disabled={!info}
                  onClick={() => setIsolated(!isolated)}
                >
                  <Focus size={14} />
                  Isolate
                </button>
              </div>
            </div>
            {selected === "flex" && (
              <div className="surface-mount-control">
                <button
                  disabled={!info}
                  aria-pressed={!acrylicVisible}
                  onClick={() => setAcrylicVisible(visible => !visible)}
                >
                  {acrylicVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                  {acrylicVisible ? "Hide acrylic panels" : "Show acrylic panels"}
                </button>
              </div>
            )}
            {(selected === "flex" || selected === "tiny2") && (
              <div className="surface-mount-control">
                <button aria-pressed={mounting}
                  disabled={!loads.flex?.info || !loads.tiny2?.info || !workspace.flex.present || !workspace.tiny2.present}
                  onClick={() => {
                    if (mounting) { setMounting(false); return; }
                    setIsolated(false);
                    setTab("joints");
                    setMountNotice("");
                    setWorkspace(previous => ({ ...previous, flex: { ...previous.flex, visible: true }, tiny2: { ...previous.tiny2, visible: true } }));
                    setMounting(true);
                  }}>
                  <Crosshair size={15} /> {mounting ? "Cancel mounting" : "Mount Tiny 2 on Flex"}
                </button>
                <p role="status">{mounting ? "Hover to preview the base. Click to place; Esc cancels. Drag to orbit." : mountNotice || "Choose a surface; the camera's base aligns flush. Both devices stay independently editable."}</p>
              </div>
            )}
            <div
              className="tabs"
              role="tablist"
              aria-label="Instrument controls"
            >
              <button
                role="tab"
                id="joints-tab"
                aria-controls="control-panel"
                aria-selected={tab === "joints"}
                onClick={() => setTab("joints")}
              >
                <SlidersHorizontal size={14} />
                Joints<span>{info?.joints.length ?? "–"}</span>
              </button>
              <button
                role="tab"
                id="placement-tab"
                aria-controls="control-panel"
                aria-selected={tab === "placement"}
                onClick={() => setTab("placement")}
              >
                <Move3D size={14} />
                Placement
              </button>
            </div>
            <div
              className="control-content"
              id="control-panel"
              role="tabpanel"
              aria-labelledby={`${tab}-tab`}
            >
              {!state.visible && (
                <div className="hidden-notice">
                  <EyeOff size={14} />
                  <span>Hidden in the workspace</span>
                  <button onClick={() => toggleVisibility(selected)}>
                    Show
                  </button>
                </div>
              )}
              {loads[selected]?.error ? (
                <div className="model-error">
                  <h3>Unable to load {instrument.name}</h3>
                  <p>{loads[selected].error}</p>
                  <button onClick={() => window.location.reload()}>
                    Retry loading
                  </button>
                </div>
              ) : !info ? (
                <div className="panel-loading">
                  <div className="spinner" />
                  <p>Loading model… {loads[selected]?.progress || 0}%</p>
                </div>
              ) : tab === "joints" ? (
                <>
                  <div className="section-caption">
                    <span>JOINT POSITION</span>
                    <span>URDF limits</span>
                  </div>
                  {info.joints.map((joint) => (
                    <JointControl
                      key={`${selected}-${joint.name}`}
                      joint={joint}
                      value={state.joints[joint.name] ?? joint.initial}
                      onChange={(value) =>
                        setWorkspace((previous) =>
                          updateJoint(previous, selected, joint, value),
                        )
                      }
                    />
                  ))}
                  <div className="control-hint">
                    <Check size={13} />
                    <span>Values stay within the model’s joint limits.</span>
                  </div>
                </>
              ) : (
                <div className={`placement-fields ${placementMode}`}>
                  <div className="move-hint">
                    <Move3D size={15} />
                    <span>
                      {placementMode === "rotate"
                        ? `Drag the colored rings to rotate ${instrument.name} around its local axes. Position and joint settings stay unchanged.`
                        : `Drag the colored arrows in the scene to move ${instrument.name}. Use the square handles to move along a plane.`}
                    </span>
                  </div>
                  <div className="translation-fields">
                    <div className="section-caption">
                      <span>WORLD POSITION</span>
                      <span>URDF origin</span>
                    </div>
                    {(["x", "y", "z"] as const).map((axis) => (
                      <div className="position-row" key={`${selected}-${axis}`}>
                        <label className={`axis-${axis}`}>
                          {axis.toUpperCase()}
                          <span>
                            {axis === "z"
                              ? "Elevation"
                              : axis === "x"
                                ? "Horizontal"
                                : "Depth"}
                          </span>
                        </label>
                        <Numeric
                          label={`${axis.toUpperCase()} position`}
                          unit="mm"
                          value={state.pose[axis] * 1000}
                          min={axis === "z" ? 0 : -3000}
                          max={3000}
                          onChange={(value) => updatePose(axis, value / 1000)}
                        />
                      </div>
                    ))}
                  </div>
                  <div className="rotation-fields">
                    <div className="section-caption">
                      <span>ORIENTATION</span>
                      <span>Roll / pitch / yaw</span>
                    </div>
                    {(["roll", "pitch", "yaw"] as const).map((axis, index) => (
                      <div className="position-row" key={`${selected}-${axis}`}>
                        <label>
                          {["X", "Y", "Z"][index]}
                          <span>{axis[0].toUpperCase() + axis.slice(1)}</span>
                        </label>
                        <Numeric
                          label={`${axis[0].toUpperCase() + axis.slice(1)} rotation`}
                          unit="°"
                          value={state.pose[axis] ?? 0}
                          min={-180}
                          max={180}
                          onChange={(value) => updatePose(axis, value)}
                        />
                      </div>
                    ))}
                  </div>
                  <p className="placement-hint">
                    Moves this instrument in the shared workspace. Joint
                    positions are preserved.
                  </p>
                </div>
              )}
            </div>
            <div className="inspector-footer">
              <button
                className="remove-button"
                onClick={() => removeInstrument(selected)}
              >
                <Trash2 size={13} />
                Remove {instrument.name} from workspace
              </button>
              <button
                className="reset-button"
                disabled={!info}
                onClick={() =>
                  setWorkspace((previous) =>
                    resetInstrument(previous, selected, info!.joints),
                  )
                }
              >
                <RotateCcw size={13} />
                Reset {instrument.name}
                <span>pose + joints</span>
              </button>
              <div className="model-summary">
                <span>{info?.links ?? "–"} links</span>
                <span>
                  {info
                    ? info.dimensions
                        .map((d) => Math.round(d * 1000))
                        .join(" × ")
                    : "–"}{" "}
                  mm
                </span>
              </div>
              <a href={instrument.source} target="_blank" rel="noreferrer">
                {instrument.notice}
                <ExternalLink size={11} />
              </a>
            </div>
          </>
        ) : (
          <div className="empty-inspector">
            <SquareDashed size={26} />
            <h2>No instrument selected</h2>
            <p>Add an instrument to view its controls.</p>
          </div>
        )}
      </aside>
      <footer className="statusbar">
        <span>
          <span className={`status-dot ${ready === 3 ? "ready" : ""}`} />
          {ready === 3 ? "Workspace ready" : `${ready}/3 models loaded`}
        </span>
        <span>Scene preview · no hardware connection</span>
        <span>
          {
            instruments.filter(
              (i) =>
                workspace[i.id].present &&
                workspace[i.id].visible &&
                (!isolated || i.id === selected),
            ).length
          }{" "}
          visible<span className="status-divider">/</span>
          {state.present ? (info?.joints.length ?? "–") : 0} active controls
        </span>
      </footer>
      {help && (
        <div className="help-backdrop" onClick={() => setHelp(false)}>
          <section
            className="help-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button close-help"
              autoFocus
              aria-label="Close help"
              onClick={() => setHelp(false)}
            >
              <X size={18} />
            </button>
            <Layers3 size={25} />
            <h2 id="help-title">Your instrument workspace</h2>
            <p>
              Select an instrument from the library, its label, or its geometry.
              Only that instrument’s controls appear.
            </p>
            <dl>
              <dt>Orbit / pan</dt>
              <dd>Drag / right-drag</dd>
              <dt>Zoom</dt>
              <dd>Scroll or pinch</dd>
              <dt>Focus selected</dt>
              <dd>F or double-click</dd>
              <dt>Fit visible models</dt>
              <dd>A</dd>
            </dl>
            <p>
              All models retain their actual scale. Use Focus to inspect the
              Tiny 2 up close. Placement uses the URDF’s Z-up coordinate system;
              positive yaw rotates around Z.
            </p>
            <p>
              Poses last for this session. Reset affects only the selected
              instrument. This viewer does not simulate collisions or connect to
              hardware.
            </p>
            <button onClick={() => setHelp(false)}>
              Back to workspace <ChevronRight size={14} />
            </button>
          </section>
        </div>
      )}
    </div>
  );
}
