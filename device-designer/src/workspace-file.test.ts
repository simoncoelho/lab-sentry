import { describe, expect, it } from "vitest";
import { createWorkspace } from "./state";
import { matchesSaved, parseWorkspace, snapshot } from "./workspace-file";
const view = { acrylicVisible: false, grid: true };
describe("workspace handoff", () => {
  it("persists the fitted lens and marks subsequent lens edits unsaved", () => {
    const workspace = createWorkspace();
    const lens = { ...view, horizontalFov: 63.3 };
    const saved = snapshot("Calibrated Flex", workspace, lens);
    expect(parseWorkspace(JSON.stringify(saved)).view.horizontalFov).toBe(63.3);
    expect(matchesSaved(saved, saved.name, workspace, { ...lens, horizontalFov: 70 })).toBe(false);
    for (const horizontalFov of [0, 180, NaN]) {
      expect(() => parseWorkspace(JSON.stringify({ ...saved, view: { ...view, horizontalFov } }))).toThrow();
    }
  });
  it("round-trips removed devices, visibility, full poses and joint positions", () => {
    const workspace = createWorkspace();
    workspace.ot2.present = false; workspace.flex.visible = false;
    workspace.tiny2.pose = { x: -.25, y: .18, z: .6, roll: 90, pitch: 15, yaw: -35 };
    workspace.tiny2.joints = { obsbot_pan_joint: .7, obsbot_tilt_joint: -.1 };
    const saved = snapshot("Bench A", workspace, view);
    expect(parseWorkspace(JSON.stringify(saved))).toEqual(saved);
    expect(matchesSaved(saved, "Bench A", workspace, view)).toBe(true);
  });
  it("keeps the calibration snapshot independent from further editing", () => {
    const workspace = createWorkspace(); const saved = snapshot("Bench", workspace, view);
    workspace.tiny2.pose.x += 1; workspace.tiny2.joints.obsbot_pan_joint = .5;
    expect(saved.workspace.tiny2.pose.x).toBe(0);
    expect(saved.workspace.tiny2.joints).toEqual({});
    expect(matchesSaved(saved, "Bench", workspace, view)).toBe(false);
    expect(matchesSaved(saved, "Renamed", saved.workspace, view)).toBe(false);
    expect(matchesSaved(saved, "Bench", saved.workspace, { ...view, grid: false })).toBe(false);
  });
  it("rejects malformed and incompatible saves", () => {
    for (const raw of ["not json", "null", "{}", JSON.stringify({ ...snapshot("Bench", createWorkspace(), view), version: 2 })]) {
      expect(() => parseWorkspace(raw)).toThrow();
    }
    const saved = snapshot("Bench", createWorkspace(), view);
    saved.workspace.flex.pose.x = NaN;
    expect(() => parseWorkspace(JSON.stringify(saved))).toThrow();
  });
});
