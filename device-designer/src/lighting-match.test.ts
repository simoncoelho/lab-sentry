import { describe, expect, it } from "vitest";
import { defaultLighting, matchLighting, neutralMidtones } from "./lighting-match";
import { createWorkspace } from "./state";
import { matchesSaved, parseWorkspace, snapshot } from "./workspace-file";

describe("lighting match", () => {
  it("preserves an already matched view", () => {
    expect(matchLighting([.5, .5, .5], [.5, .5, .5], defaultLighting)).toEqual(defaultLighting);
  });
  it("brightens a dim render and follows a warmer reference with bounded correction", () => {
    const result = matchLighting([.7, .65, .6], [.5, .5, .5], defaultLighting);
    expect(result.exposure).toBeGreaterThan(defaultLighting.exposure);
    expect(result.tint[0]).toBeGreaterThan(result.tint[2]);
    expect(matchLighting([1, 1, 1], [.1, .1, .1], { exposure: 2, tint: [1, 1, 1] }).exposure).toBe(2.5);
  });
  it("ignores colored objects and rejects frames without neutral midtones", () => {
    const pixels = new Uint8ClampedArray(40 * 40 * 4);
    for (let i = 0; i < pixels.length; i += 4) pixels.set([128, 128, 128, 255], i);
    for (let i = 0; i < 400; i += 4) pixels.set([255, 0, 0, 255], i);
    expect(neutralMidtones(pixels, 40, 40)).toEqual([128 / 255, 128 / 255, 128 / 255]);
    expect(() => neutralMidtones(new Uint8ClampedArray(pixels.length), 40, 40)).toThrow("neutral");
  });
  it("saves lighting, detects changes, and rejects invalid imports", () => {
    const workspace = createWorkspace(), view = { acrylicVisible: true, grid: true, lighting: defaultLighting };
    const saved = snapshot("Lab", workspace, view);
    expect(parseWorkspace(JSON.stringify(saved)).view.lighting).toEqual(defaultLighting);
    expect(matchesSaved(saved, "Lab", workspace, { ...view, lighting: { ...defaultLighting, exposure: 1.2 } })).toBe(false);
    expect(() => parseWorkspace(JSON.stringify({ ...saved, view: { ...view, lighting: { exposure: 100, tint: [1, 1, 1] } } }))).toThrow("lighting");
  });
});
