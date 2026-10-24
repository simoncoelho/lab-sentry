import { Euler, Quaternion, MathUtils, Vector3 } from "three";
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

// Align the base's +Z to the clicked world-space normal, preserving heading
// with the smallest rotation. The actual base underside, not the URDF origin,
// is placed on the surface (renderer coordinates are Y-up).
export function surfaceMountedPose(pose: Pose, point: Vector3, normal: Vector3, bottom: number): Pose {
  const orientation = sceneOrientation(pose);
  const up = new Vector3(0, 0, 1).applyQuaternion(orientation);
  const target = normal.clone().normalize();
  orientation.premultiply(new Quaternion().setFromUnitVectors(up, target));
  const origin = point.clone().addScaledVector(target, -bottom);
  return rotatedPose({ ...pose, x: origin.x, y: -origin.z, z: origin.y }, orientation);
}
