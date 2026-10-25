import { it, expect, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { Box3, Vector3 } from 'three';
import { labwareLibrary } from './labware-library';
import { loadDatasetAsset, disposeAsset } from './dataset-assets';
import { createLabwareClassifier } from './classifier';

it('loads downloaded models and definitions at deck scale with their base at zero', async () => {
  vi.stubGlobal('fetch', async (url: string) => new Response(await readFile(new URL(`../${url}`, import.meta.url))));
  try {
    for (const asset of labwareLibrary(createLabwareClassifier())) {
      const model = await loadDatasetAsset(asset), bounds = new Box3().setFromObject(model), size = bounds.getSize(new Vector3());
      expect(size.x).toBeCloseTo(asset.widthMm / 1000, 5);
      expect(size.y).toBeGreaterThan(.08); expect(size.y).toBeLessThan(.092);
      expect(size.z).toBeGreaterThan(.01); expect(size.z).toBeLessThan(.11);
      expect(bounds.min.z).toBeCloseTo(0, 6);
      expect(asset.source).toMatch(/^https:/); expect(asset.classId).toBeTruthy();
      disposeAsset(model);
    }
  } finally { vi.unstubAllGlobals(); }
});
