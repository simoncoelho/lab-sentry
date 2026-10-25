import { describe, expect, it } from 'vitest';
import { addNoise, checkedProcessing, cleanProcessing, processImage } from './image-processing';
describe('reviewed image processing', () => {
  it('preserves original bytes for clean output', async () => { const source = new Blob(['original']); expect(await processImage(source)).toBe(source); });
  it('uses repeatable noise without changing alpha or array dimensions', () => {
    const a = new Uint8ClampedArray(400).fill(128), b = a.slice(), c = a.slice();
    addNoise(a, 4, 42); addNoise(b, 4, 42); addNoise(c, 4, 43);
    expect(a).toEqual(b); expect(a).not.toEqual(c); expect(a.length).toBe(400);
    for (let i=3;i<a.length;i+=4) expect(a[i]).toBe(128);
  });
  it('rejects invalid effect ranges', () => {
    for (const change of [{noise:NaN},{noise:13},{quality:0},{scale:0},{scale:2},{seed:1.2}]) expect(() => checkedProcessing({...cleanProcessing,...change})).toThrow();
  });
});
