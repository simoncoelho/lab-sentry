import { validateRecipe, validCameraRange, type CameraRange, type DatasetAsset, type Recipe } from './dataset';

export type GenerationPlan = {
  note: string;
  slots: { slot: string; assetIds: string[]; required: boolean }[];
  occupancy: [number, number];
  jitterMm: number;
  yawDegrees: number;
  gantryProbability: number;
  exposure: [number, number];
  warmth: [number, number];
  camera: CameraRange;
};
const ordered = (v: number[], min: number, max: number) => Array.isArray(v) && v.length === 2 && v.every(Number.isFinite) && min <= v[0] && v[0] <= v[1] && v[1] <= max;
export function validatePlan(plan: GenerationPlan, assets: DatasetAsset[], slots: string[], range: CameraRange, fixed: boolean) {
  if (!plan || typeof plan.note !== 'string' || !Array.isArray(plan.slots) || !plan.slots.length || plan.slots.length > slots.length ||
      new Set(plan.slots.map(s => s.slot)).size !== plan.slots.length || !plan.slots.every(s => slots.includes(s.slot) && typeof s.required === 'boolean' && Array.isArray(s.assetIds) && s.assetIds.length > 0 && new Set(s.assetIds).size === s.assetIds.length && s.assetIds.every(id => assets.some(a => a.id === id && a.classId))) ||
      !ordered(plan.occupancy, 0, plan.slots.length) || !plan.occupancy.every(Number.isInteger) || plan.occupancy[0] < plan.slots.filter(s => s.required).length ||
      !Number.isFinite(plan.jitterMm) || plan.jitterMm < 0 || plan.jitterMm > 2 || !Number.isFinite(plan.yawDegrees) || plan.yawDegrees < 0 || plan.yawDegrees > 4 ||
      !Number.isFinite(plan.gantryProbability) || plan.gantryProbability < 0 || plan.gantryProbability > 1 ||
      !ordered(plan.exposure, .65, 1.35) || !ordered(plan.warmth, -.12, .12) || !validCameraRange(plan.camera) ||
      !(['pan', 'tilt', 'zoom'] as const).every(axis => ordered(plan.camera[axis], range[axis][0], range[axis][1]))) throw new Error('Codex returned an unsupported generation plan.');
  if (fixed && (plan.exposure.some(x => x !== 1) || plan.warmth.some(x => x !== 0) || (['pan', 'tilt', 'zoom'] as const).some(axis => plan.camera[axis].some(x => x !== range[axis][0])))) throw new Error('The plan must preserve the calibrated camera and lighting.');
  return plan;
}

/** Seeded scene sampling, not image duplication. Each image is rendered and labeled. */
export function recipeFromPlan(plan: GenerationPlan, assets: DatasetAsset[], seed: string): Recipe {
  let state = 2166136261;
  for (const character of seed) state = Math.imul(state ^ character.charCodeAt(0), 16777619);
  const random = () => { state += 0x6D2B79F5; let t = state; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const sample = ([min, max]: [number, number]) => min + (max - min) * random();
  const pick = <T>(items: T[]) => items[Math.floor(random() * items.length)];
  const optional = plan.slots.filter(s => !s.required);
  for (let i = optional.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [optional[i], optional[j]] = [optional[j], optional[i]]; }
  const required = plan.slots.filter(s => s.required);
  const count = plan.occupancy[0] + Math.floor(random() * (plan.occupancy[1] - plan.occupancy[0] + 1));
  const selected = [...required, ...optional.slice(0, count - required.length)];
  const recipe: Recipe = {
    note: plan.note,
    exposure: sample(plan.exposure), warmth: sample(plan.warmth),
    camera: { pan: sample(plan.camera.pan), tilt: sample(plan.camera.tilt), zoom: sample(plan.camera.zoom) },
    gantry: random() < plan.gantryProbability ? { x: sample([-.28, .24]), y: sample([-.1, .22]), z: sample([0, .12]) } : null,
    placements: selected.map(slot => {
      const eligible = assets.filter(a => slot.assetIds.includes(a.id));
      const classId = pick([...new Set(eligible.map(a => a.classId))]);
      return { slot: slot.slot, assetId: pick(eligible.filter(a => a.classId === classId)).id, yaw: sample([-plan.yawDegrees, plan.yawDegrees]), offsetX: sample([-plan.jitterMm, plan.jitterMm]), offsetY: sample([-plan.jitterMm, plan.jitterMm]) };
    }),
  };
  return validateRecipe(recipe, assets, plan.slots.map(s => s.slot), plan.camera);
}

export const recipeKey = (recipe: Recipe) => JSON.stringify({ ...recipe, note: undefined, placements: [...recipe.placements].sort((a, b) => a.slot.localeCompare(b.slot)) });
