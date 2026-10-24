import { expect, it } from "vitest";
import { Vector3 } from "three";
import { createWorkspace } from "./state";
import { rotatedPose, sceneOrientation } from "./orientation";

it("maps URDF yaw about Z to the renderer vertical axis", () => {
  const pose = { ...createWorkspace().tiny2.pose, yaw: 90 };
  const forward = new Vector3(1, 0, 0).applyQuaternion(sceneOrientation(pose));
  expect(forward.distanceTo(new Vector3(0, 0, -1))).toBeLessThan(1e-10);
});

it.each([
  [30, 20, -70],
  [-45, 90, 120],
  [160, -120, -170],
])(
  "preserves orientation through quaternion roundtrips (%s, %s, %s)",
  (roll, pitch, yaw) => {
    const pose = { ...createWorkspace().tiny2.pose, roll, pitch, yaw };
    const quaternion = sceneOrientation(pose);
    const updated = rotatedPose(pose, quaternion);
    expect(sceneOrientation(updated).angleTo(quaternion)).toBeLessThan(1e-6);
    expect([updated.x, updated.y, updated.z]).toEqual([pose.x, pose.y, pose.z]);
  },
);
