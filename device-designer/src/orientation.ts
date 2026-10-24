import { Euler, Quaternion, MathUtils } from "three";
import type { Pose } from "./state";

// URDF roll/pitch/yaw uses Rz(yaw) * Ry(pitch) * Rx(roll).
const frame = new Quaternion().setFromEuler(new Euler(-Math.PI / 2, 0, 0));
export function sceneOrientation(pose: Pose): Quaternion {
  return frame
    .clone()
    .multiply(
      new Quaternion().setFromEuler(
        new Euler(
          MathUtils.degToRad(pose.roll ?? 0),
          MathUtils.degToRad(pose.pitch ?? 0),
          MathUtils.degToRad(pose.yaw),
          "ZYX",
        ),
      ),
    );
}
export function rotatedPose(pose: Pose, orientation: Quaternion): Pose {
  const native = frame.clone().invert().multiply(orientation);
  const angles = new Euler().setFromQuaternion(native, "ZYX");
  return {
    ...pose,
    roll: MathUtils.radToDeg(angles.x),
    pitch: MathUtils.radToDeg(angles.y),
    yaw: MathUtils.radToDeg(angles.z),
  };
}
