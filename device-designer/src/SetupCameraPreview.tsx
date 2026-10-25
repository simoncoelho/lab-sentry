import { useEffect, useRef, useState } from 'react';
import { Camera, ChevronDown, ChevronUp } from 'lucide-react';
import type { InstrumentScene } from './scene';

export function SetupCameraPreview({scene, fov, present}: {scene: InstrumentScene | null; fov: number; present: boolean}) {
  const [open, setOpen] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !present || !scene || !host.current) return;
    scene.attachExpectedView(host.current);
    scene.setExpectedLens(fov, 16 / 9);
    return () => scene.detachExpectedView();
  }, [open, present, scene]);
  useEffect(() => { if (open && present) scene?.setExpectedLens(fov, 16 / 9); }, [fov, open, present, scene]);
  return <section className={`setup-camera-preview${open ? '' : ' is-collapsed'}`} aria-label="Simulated camera preview">
    <button aria-expanded={open} aria-controls="setup-camera-view" onClick={() => setOpen(value => !value)}><Camera size={15}/><span>Camera view</span>{open ? <ChevronDown size={14}/> : <ChevronUp size={14}/>}</button>
    {open && <div id="setup-camera-view">{present ? <div ref={host} className="setup-camera-canvas"/> : <p>Add Tiny 2 to preview its view.</p>}</div>}
  </section>;
}
