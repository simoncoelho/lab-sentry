import { expect, it } from 'vitest';
import { settledAngles } from './settled-angles';
it('holds the commanded projection through settled encoder jitter', () => {
  expect(settledAngles({ pan: 10, tilt: 39 }, { pan: 10, tilt: 40 }, false)).toEqual({ pan: 10, tilt: 40 });
});
it('keeps measured motion and out-of-tolerance drift visible to the model', () => {
  expect(settledAngles({ pan: 10, tilt: 39 }, { pan: 10, tilt: 40 }, true)).toEqual({ pan: 10, tilt: 39 });
  expect(settledAngles({ pan: 10, tilt: -84 }, { pan: 10, tilt: 40 }, false)).toEqual({ pan: 10, tilt: -84 });
});
it('honors a new one-degree target instead of pinning to the saved preset', () => {
  expect(settledAngles({ pan: 10, tilt: 39 }, { pan: 10, tilt: 39 }, false)).toEqual({ pan: 10, tilt: 39 });
});
