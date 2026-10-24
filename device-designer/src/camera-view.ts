import { MathUtils, Quaternion, Vector3 } from "three";
// ROS optical frame: right/down/forward. Three camera: right/up/backward.
export function opticalViewQuaternion(optical: Quaternion) {
  return optical.clone().multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), Math.PI));
}
export function verticalFov(horizontalDegrees: number, aspect: number) {
  return MathUtils.radToDeg(2 * Math.atan(Math.tan(MathUtils.degToRad(horizontalDegrees) / 2) / aspect));
}
