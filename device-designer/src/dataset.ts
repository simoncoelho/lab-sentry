import { deckSlots, type ClassifierDesign } from './classifier.ts';
import type { SlotState } from './deck-state';
export type DatasetAsset = { id: string; name: string; classId: string; kind: 'tiprack' | 'plate' | 'reservoir' | 'tuberack' | 'stl' | 'glb'; widthMm: number; up: 'Y' | 'Z'; file?: Blob; source?: string; modelUrl?: string; definitionUrl?: string; fidelity?: string };
export type Placement = { slot: string; assetId: string; yaw: number; offsetX: number; offsetY: number };
export type CameraRange = { pan: [number, number]; tilt: [number, number]; zoom: [number, number] };
export type CameraSetting = { pan: number; tilt: number; zoom: number };
export type Recipe = { note: string; exposure: number; warmth: number; placements: Placement[]; camera?: CameraSetting; gantry?: { x: number; y: number; z: number } | null };
export function validCameraRange(range: CameraRange) {
  return !!range && (['pan', 'tilt', 'zoom'] as const).every(key => Array.isArray(range[key]) && range[key].length === 2 && range[key].every(Number.isFinite) && range[key][0] <= range[key][1]) && range.pan[0] >= -140 && range.pan[1] <= 140 && range.tilt[0] >= -30 && range.tilt[1] <= 90 && range.zoom[0] >= 1 && range.zoom[1] <= 4;
}
export function zoomedFov(horizontalFov: number, zoom: number) { return 2 * Math.atan(Math.tan(horizontalFov * Math.PI / 360) / zoom) * 180 / Math.PI; }
export function cameraCoverage(frames: { recipe: Recipe }[], range: CameraRange) {
  return Object.fromEntries((['pan', 'tilt', 'zoom'] as const).map(key => {
    const bins = [0, 0, 0, 0, 0], [min, max] = range[key];
    frames.forEach(f => { const value = f.recipe.camera?.[key]; if (value !== undefined && value >= min && value <= max) bins[Math.min(4, Math.floor((value - min) / (max - min || 1) * 5))]++; });
    return [key, bins];
  })) as Record<'pan' | 'tilt' | 'zoom', number[]>;
}
export type Annotation = { slot: string; classId: string | null; assetId: string | null; polygon: number[][]; visibility: number; review: boolean };
export type Detection = { slot: string; assetId: string; classId: string; box: [number, number, number, number] | null; pixels: number; visibility: number; review: boolean };
export type DatasetFrame = { id: string; runId: string; index: number; image: Blob; recipe: Recipe; annotations: Annotation[]; slotStates?: SlotState[]; slotStateVersion?: 1; detections?: Detection[]; feedback: string[]; createdAt: string; cameraMatrix?: number[]; assetSettings?: Omit<DatasetAsset, 'file'>[] };
export const availableSlots = (design: ClassifierDesign) => (design.unit === 'deck_slot' ? design.slots : deckSlots).filter(s => s !== 'A3');
export function initialAssets(design: ClassifierDesign): DatasetAsset[] {
  const kinds = { 'tip rack': 'tiprack', microplate: 'plate', reservoir: 'reservoir', 'tube rack': 'tuberack' } as const;
  return Object.entries(kinds).map(([name, kind]) => ({ id: `builtin-${kind}`, name: `${name} · procedural`, kind, classId: design.classes.find(c => c.name.toLowerCase() === name)?.id ?? '', widthMm: 127.76, up: 'Z' as const }));
}
export function validateRecipe(recipe: Recipe, assets: DatasetAsset[], slots: string[], range?: CameraRange) {
  if (!recipe || typeof recipe.note !== 'string' || !Number.isFinite(recipe.exposure) || recipe.exposure < .65 || recipe.exposure > 1.35 || !Number.isFinite(recipe.warmth) || Math.abs(recipe.warmth) > .12 || !Array.isArray(recipe.placements) || recipe.placements.length > slots.length) throw new Error('Invalid scene recipe.');
  const used = new Set<string>();
  if (recipe.gantry && (!Number.isFinite(recipe.gantry.x) || recipe.gantry.x < -.28 || recipe.gantry.x > .24 || !Number.isFinite(recipe.gantry.y) || recipe.gantry.y < -.1 || recipe.gantry.y > .22 || !Number.isFinite(recipe.gantry.z) || recipe.gantry.z < 0 || recipe.gantry.z > .12)) throw new Error('Gantry pose is outside the modeled travel range.');
  if (range && (!validCameraRange(range) || !recipe.camera || !(['pan', 'tilt', 'zoom'] as const).every(key => Number.isFinite(recipe.camera![key]) && recipe.camera![key] >= range[key][0] && recipe.camera![key] <= range[key][1]))) throw new Error('Camera variation is outside the selected pan, tilt or zoom range.');
  for (const p of recipe.placements) {
    if (!slots.includes(p.slot) || used.has(p.slot) || !assets.some(a => a.id === p.assetId && a.classId) || ![p.yaw, p.offsetX, p.offsetY].every(Number.isFinite) || Math.abs(p.yaw) > 10 || Math.abs(p.offsetX) > 4 || Math.abs(p.offsetY) > 4) throw new Error('Scene recipe contains an unsupported placement.');
    used.add(p.slot);
  }
  return recipe;
}
export function runSignature(context: unknown, assets: DatasetAsset[], emptyClass: string) {
  return JSON.stringify({ context, assets: assets.map(({ file: _, ...asset }) => asset), emptyClass });
}

// Uncompressed tar keeps PNGs and the JSON manifest portable without a service dependency.
export function datasetTar(files: { name: string; data: Blob }[]): Blob {
  const parts: BlobPart[] = [];
  for (const { name, data } of files) {
    const header = new Uint8Array(512), encode = new TextEncoder();
    const put = (offset: number, value: string, length: number) => header.set(encode.encode(value).subarray(0, length), offset);
    put(0, name, 100); put(100, '0000644\0', 8); put(108, '0000000\0', 8); put(116, '0000000\0', 8);
    put(124, data.size.toString(8).padStart(11, '0') + '\0', 12); put(136, '00000000000\0', 12);
    put(148, '        ', 8); put(156, '0', 1); put(257, 'ustar\0', 6); put(263, '00', 2);
    const checksum = header.reduce((sum, b) => sum + b, 0);
    put(148, checksum.toString(8).padStart(6, '0') + '\0 ', 8);
    parts.push(header, data, new Uint8Array((512 - data.size % 512) % 512));
  }
  parts.push(new Uint8Array(1024));
  return new Blob(parts, { type: 'application/x-tar' });
}
