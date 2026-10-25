import { describe, expect, it } from 'vitest';
import { recipeFromPlan, recipeKey, validatePlan, type GenerationPlan } from './generation-plan';
import { validateRecipe, type DatasetAsset } from './dataset';

const assets: DatasetAsset[] = [
  { id: 'tip', name: 'Tip rack', classId: 'tips', kind: 'tiprack', widthMm: 127, up: 'Z' },
  { id: 'plate', name: 'Plate', classId: 'plates', kind: 'plate', widthMm: 127, up: 'Z' },
];
const camera = { pan: [10, 10], tilt: [40, 40], zoom: [1, 1] } as const;
const plan = (): GenerationPlan => ({ note: 'Test variation', slots: ['A1', 'B1', 'C1', 'D1'].map(slot => ({ slot, assetIds: ['tip', 'plate'], required: slot === 'A1' })), occupancy: [1, 4], jitterMm: 1, yawDegrees: 2, gantryProbability: 0, exposure: [1, 1], warmth: [0, 0], camera: structuredClone(camera) as GenerationPlan['camera'] });
describe('bulk generation plans', () => {
  it('renders 400 distinct deterministic recipes within the calibrated constraints', () => {
    const p = plan(), slots = p.slots.map(s => s.slot);
    validatePlan(p, assets, slots, p.camera, true);
    const recipes = Array.from({ length: 400 }, (_, i) => recipeFromPlan(p, assets, `run:${i}`));
    expect(new Set(recipes.map(recipeKey)).size).toBe(400);
    expect(recipeFromPlan(p, assets, 'run:10')).toEqual(recipes[10]);
    for (const recipe of recipes) {
      expect(() => validateRecipe(recipe, assets, slots, p.camera)).not.toThrow();
      expect(recipe.camera).toEqual({ pan: 10, tilt: 40, zoom: 1 });
      expect(recipe.exposure).toBe(1); expect(recipe.warmth).toBe(0);
      expect(recipe.placements.some(p => p.slot === 'A1')).toBe(true);
    }
    expect(new Set(recipes.map(r => r.placements.length)).size).toBe(4);
    expect(new Set(recipes.flatMap(r => r.placements.map(p => p.assetId))).size).toBe(2);
  });
  it('honors slot-specific assets and rejects invalid or contradictory plans', () => {
    const p = plan(); p.slots[0].assetIds = ['plate'];
    expect(recipeFromPlan(p, assets, 'specific').placements.find(p => p.slot === 'A1')!.assetId).toBe('plate');
    for (const change of [
      { occupancy: [0, 4] }, { jitterMm: NaN }, { gantryProbability: 2 },
      { slots: [{ slot: 'A3', assetIds: ['tip'], required: false }] },
      { slots: [{ slot: 'A1', assetIds: ['missing'], required: false }] },
      { exposure: [.9, 1] }, { camera: { ...p.camera, zoom: [1, 2] } },
    ]) expect(() => validatePlan({ ...p, ...change } as GenerationPlan, assets, p.slots.map(s => s.slot), p.camera, true)).toThrow();
  });
  it('canonicalizes placement order and ignores prose when detecting duplicates', () => {
    const r = recipeFromPlan(plan(), assets, 'sample');
    expect(recipeKey(r)).toBe(recipeKey({ ...r, note: 'Different words', placements: [...r.placements].reverse() }));
  });
});
