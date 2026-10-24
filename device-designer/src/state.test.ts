import { describe, expect, it } from "vitest";
import {
  createWorkspace,
  displayValue,
  nativeValue,
  resetInstrument,
  setInstrumentPresent,
  translatedPose,
  updateJoint,
  type JointSpec,
} from "./state";

const joint: JointSpec = {
  name: "Slider_5",
  label: "Toolhead Z",
  type: "prismatic",
  lower: 0.05,
  upper: 0.17,
  initial: 0.05,
};

describe("independent instrument poses", () => {
  it("maps scene translation into URDF axes without changing yaw", () => {
    const pose = createWorkspace().tiny2.pose;
    expect(translatedPose(pose, { x: 0.25, y: 0.6, z: -0.4 })).toEqual({
      ...pose,
      x: 0.25,
      y: 0.4,
      z: 0.6,
      yaw: -90,
    });
    expect(translatedPose(pose, { x: 4, y: -1, z: -4 })).toEqual({
      ...pose,
      x: 3,
      y: 3,
      z: 0,
      yaw: -90,
    });
    expect(translatedPose(pose, { x: NaN, y: 0, z: 0 })).toBe(pose);
  });
  it("changes only the requested instrument and preserves placement", () => {
    const before = createWorkspace();
    const after = updateJoint(before, "ot2", joint, 0.12);
    expect(after.ot2.joints.Slider_5).toBe(0.12);
    expect(after.flex).toBe(before.flex);
    expect(after.tiny2).toBe(before.tiny2);
    expect(after.ot2.pose).toEqual(before.ot2.pose);
    expect(before.ot2.joints).toEqual({});
  });
  it("clamps joints to the real URDF range, including nonzero lower bounds", () => {
    const before = createWorkspace();
    expect(updateJoint(before, "ot2", joint, 0).ot2.joints.Slider_5).toBe(0.05);
    expect(updateJoint(before, "ot2", joint, 1).ot2.joints.Slider_5).toBe(0.17);
  });
  it("rejects nonfinite input without changing the scene", () => {
    const before = createWorkspace();
    expect(updateJoint(before, "ot2", joint, NaN)).toBe(before);
    expect(updateJoint(before, "ot2", joint, Infinity)).toBe(before);
  });
  it("resets only the selected instrument to valid joint and placement defaults", () => {
    const before = updateJoint(createWorkspace(), "ot2", joint, 0.12);
    before.ot2.pose = { x: 2, y: 1, z: 0.2, roll: 15, pitch: -20, yaw: 45 };
    before.ot2.visible = false;
    const after = resetInstrument(before, "ot2", [joint]);
    expect(after.ot2).toEqual({
      present: true,
      visible: true,
      pose: createWorkspace().ot2.pose,
      joints: { Slider_5: 0.05 },
    });
    expect(after.flex).toBe(before.flex);
    expect(after.tiny2).toBe(before.tiny2);
  });
  it("removes and restores an instrument without changing other poses", () => {
    const before = updateJoint(createWorkspace(), "ot2", joint, 0.12);
    const removed = setInstrumentPresent(before, "ot2", false);
    expect(removed.ot2.present).toBe(false);
    expect(removed.flex).toBe(before.flex);
    expect(removed.tiny2).toBe(before.tiny2);
    const restored = setInstrumentPresent(removed, "ot2", true);
    expect(restored.ot2).toEqual(before.ot2);
  });
  it("converts UI millimeters and degrees back to URDF meters and radians", () => {
    expect(displayValue(0.12, joint)).toBe(120);
    expect(nativeValue(120, joint)).toBe(0.12);
    const angular = { ...joint, type: "revolute" };
    expect(displayValue(Math.PI / 2, angular)).toBe(90);
    expect(nativeValue(90, angular)).toBeCloseTo(Math.PI / 2);
  });
});
