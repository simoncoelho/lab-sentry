import { describe, expect, it } from "vitest";
import { Matrix3, Matrix4, Euler, Vector3 } from "three";
import { sceneOrientation, surfaceMountedPose } from "./orientation";
const pose = { x: 1, y: -2, z: 0.2, roll: 15, pitch: -20, yaw: 75 };
describe("surface mounting", () => {
  for (const [label, normal] of [
    ["top", new Vector3(0, 1, 0)],
    ["side", new Vector3(1, 0, 0)],
    ["underside", new Vector3(0, -1, 0)],
    ["slope", new Vector3(1, 2, -3).normalize()],
  ] as const) {
    it(`places the underside flush on a ${label} surface`, () => {
      const point = new Vector3(-0.6, 0.73, 0.18);
      const bottom = -0.003;
      const result = surfaceMountedPose(pose, point, normal, bottom);
      const q = sceneOrientation(result);
      expect(new Vector3(0, 0, 1).applyQuaternion(q).distanceTo(normal)).toBeLessThan(1e-10);
      const origin = new Vector3(result.x, result.z, -result.y);
      // Every point of the flat underside lies in the target plane.
      for (const [x, y] of [[0, 0], [-0.02, 0.018], [0.02, -0.018]]) {
        const contact = new Vector3(x, y, bottom).applyQuaternion(q).add(origin);
        expect(Math.abs(contact.clone().sub(point).dot(normal))).toBeLessThan(1e-10);
      }
      expect(new Vector3(0, 0, bottom).applyQuaternion(q).add(origin).distanceTo(point)).toBeLessThan(1e-10);
    });
  }
  it("handles a transformed Flex face and preserves heading on repeat placement", () => {
    const matrix = new Matrix4().makeRotationFromEuler(new Euler(.3, -.8, .4));
    const normal = new Vector3(0, 1, 0).applyNormalMatrix(new Matrix3().getNormalMatrix(matrix));
    const first = surfaceMountedPose(pose, new Vector3(1, 2, 3), normal, 0);
    const next = surfaceMountedPose(first, new Vector3(2, 3, 4), normal, 0);
    expect(sceneOrientation(first).angleTo(sceneOrientation(next))).toBeLessThan(1e-7);
    expect(next.x).toBe(2); expect(next.y).toBe(-4); expect(next.z).toBe(3);
  });
});
