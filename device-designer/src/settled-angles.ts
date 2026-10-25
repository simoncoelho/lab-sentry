type Angles = { pan: number; tilt: number };
// Same two-degree settling tolerance as the bridge's feedback controller.
// Never conceal ongoing motion or a camera that has drifted away from its target.
export function settledAngles(actual: Angles, target: Angles, moving: boolean): Angles {
  return !moving && Math.abs(actual.pan - target.pan) <= 2 && Math.abs(actual.tilt - target.tilt) <= 2
    ? { ...target } : { ...actual };
}
