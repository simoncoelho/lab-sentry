import { describe, expect, it } from 'vitest';
import { Box3, Vector3 } from 'three';
import { createLabwareClassifier } from './classifier';
import { availableSlots, cameraCoverage, validCameraRange, zoomedFov, datasetTar, initialAssets, validateRecipe } from './dataset';
import { disposeAsset, loadDatasetAsset } from './dataset-assets';

describe('synthetic dataset scenes', () => {
  const design = createLabwareClassifier(), assets = initialAssets(design), slots = availableSlots(design);
  const recipe = { note: 'one tip rack', exposure: 1, warmth: 0, placements: [{ slot: 'B1', assetId: assets[0].id, yaw: 0, offsetX: 0, offsetY: 0 }] };
  it('maps known classes and reserves the physical waste-bin slot', () => {
    expect(assets.every(a => design.classes.some(c => c.id === a.classId))).toBe(true);
    expect(slots).toHaveLength(11); expect(slots).not.toContain('A3');
    expect(validateRecipe(recipe, assets, slots)).toEqual(recipe);
  });
  it('rejects overlapping slots, unknown assets and unsafe perturbations', () => {
    expect(() => validateRecipe({ ...recipe, placements: [...recipe.placements, ...recipe.placements] }, assets, slots)).toThrow();
    expect(() => validateRecipe({ ...recipe, placements: [{ ...recipe.placements[0], assetId: 'unknown' }] }, assets, slots)).toThrow();
    expect(() => validateRecipe({ ...recipe, exposure: NaN }, assets, slots)).toThrow();
    expect(() => validateRecipe({ ...recipe, placements: [{ ...recipe.placements[0], offsetX: 100 }] }, assets, slots)).toThrow();
    expect(() => validateRecipe({ ...recipe, placements: [{ ...recipe.placements[0], slot: 'A3' }] }, assets, slots)).toThrow();
  });
  it('builds deck-sized geometry with its bottom on the mounting plane', async () => {
    for (const asset of assets) {
      const object = await loadDatasetAsset(asset), bounds = new Box3().setFromObject(object), size = bounds.getSize(new Vector3());
      expect(size.x).toBeCloseTo(.12776, 4); expect(size.y).toBeLessThan(.092); expect(bounds.min.z).toBeCloseTo(0, 6);
      disposeAsset(object);
    }
    await expect(loadDatasetAsset({ ...assets[0], widthMm: NaN })).rejects.toThrow();
  });
  it('allows bounded simulated gantry occlusions and rejects invalid travel', () => {
    expect(validateRecipe({ ...recipe, gantry: { x: .1, y: -.05, z: .08 } }, assets, slots)).toBeTruthy();
    expect(() => validateRecipe({ ...recipe, gantry: { x: .5, y: 0, z: 0 } }, assets, slots)).toThrow();
    expect(() => validateRecipe({ ...recipe, gantry: { x: 0, y: 0, z: NaN } }, assets, slots)).toThrow();
  });
  it('exports correct tar boundaries and file contents', async () => {
    const archive = datasetTar([{ name: 'manifest.json', data: new Blob(['{"count":2}']) }, { name: 'images/000001.png', data: new Blob([new Uint8Array(600).fill(42)]) }]);
    const bytes = new Uint8Array(await archive.arrayBuffer()), decode = new TextDecoder();
    expect(bytes.length % 512).toBe(0);
    expect(decode.decode(bytes.slice(0, 13))).toBe('manifest.json');
    expect(decode.decode(bytes.slice(512, 523))).toBe('{"count":2}');
    expect(decode.decode(bytes.slice(1024, 1041))).toBe('images/000001.png');
    expect(bytes.slice(-1024).every(b => b === 0)).toBe(true);
  });
  it('validates camera ranges and narrows the pinhole lens with zoom', () => {
    const range = { pan: [-140, 140] as [number, number], tilt: [-30, 70] as [number, number], zoom: [1, 4] as [number, number] };
    expect(validCameraRange(range)).toBe(true);
    expect(validCameraRange({ ...range, zoom: [4, 1] })).toBe(false);
    expect(zoomedFov(70, 1)).toBeCloseTo(70);
    expect(zoomedFov(70, 2)).toBeCloseTo(38.59, 1);
    expect(() => validateRecipe(recipe, assets, slots, range)).toThrow();
    expect(() => validateRecipe({ ...recipe, camera: { pan: 150, tilt: 0, zoom: 1 } }, assets, slots, range)).toThrow();
    const frames = [-140, 0, 140].map((pan, i) => ({ recipe: { ...recipe, camera: { pan, tilt: -30 + 50 * i, zoom: 1 + 1.5 * i } } }));
    expect(cameraCoverage(frames, range)).toEqual({ pan: [1, 0, 1, 0, 1], tilt: [1, 0, 1, 0, 1], zoom: [1, 0, 1, 0, 1] });
  });
});
