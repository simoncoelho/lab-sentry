import { describe, it, expect } from "vitest";
import { Euler, Quaternion, Vector3 } from "three";
import { opticalViewQuaternion, verticalFov } from "./camera-view";
describe("modeled camera projection", () => {
  it("maps optical forward and down into a Three camera without mirroring", () => {
    for (const optical of [new Quaternion(), new Quaternion().setFromEuler(new Euler(.4, -.8, 1.1))]) {
      const view = opticalViewQuaternion(optical);
      expect(new Vector3(0,0,-1).applyQuaternion(view).distanceTo(new Vector3(0,0,1).applyQuaternion(optical))).toBeLessThan(1e-10);
      expect(new Vector3(0,1,0).applyQuaternion(view).distanceTo(new Vector3(0,-1,0).applyQuaternion(optical))).toBeLessThan(1e-10);
      expect(new Vector3(1,0,0).applyQuaternion(view).distanceTo(new Vector3(1,0,0).applyQuaternion(optical))).toBeLessThan(1e-10);
    }
  });
  it("preserves horizontal FOV when the capture aspect ratio changes", () => {
    expect(verticalFov(90, 1)).toBeCloseTo(90);
    expect(verticalFov(90, 2)).toBeCloseTo(53.130102);
    expect(verticalFov(70, 16/9)).toBeLessThan(verticalFov(70, 4/3));
  });
});
