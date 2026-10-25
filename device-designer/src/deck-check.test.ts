import { describe, expect, it } from "vitest";
import { checkDeck, classifySlot, expectedBySlot, insidePolygon, polygonPixels, regionDifference, slotPolygon, type Point } from "./deck-check";
import type { ExpectedDeck } from "./protocol-deck";

const W = 40, H = 20;
const frame = (color: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) data.set([...color(x, y), 255], (y * W + x) * 4);
  return { data, width: W, height: H };
};
const grey = frame(() => [120, 120, 120]);
const square = (x0: number, x1: number): Point[] => [[x0, 0], [x1, 0], [x1, 1], [x0, 1]];

describe("deck check", () => {
  it("builds slot floors around the slot center", () => {
    const d1 = slotPolygon("D1", 1)!;
    expect(d1[0][0]).toBeCloseTo(-0.177 - 0.12776 / 2);
    expect(d1[2][1]).toBeCloseTo(-0.206 + 0.08548 / 2);
    expect(d1.every(p => p[2] === 0.169)).toBe(true);
    expect(slotPolygon("Z9")).toBeNull();
  });

  it("finds pixels inside a polygon", () => {
    expect(insidePolygon([.25, .5], square(0, .5))).toBe(true);
    expect(insidePolygon([.75, .5], square(0, .5))).toBe(false);
    const pixels = polygonPixels(square(0, .5), W, H, 1);
    expect(pixels.length).toBe(20 * 20);
    expect(pixels.every(p => p % W < 20)).toBe(true);
  });

  it("ignores small lighting changes but not new objects", () => {
    const pixels = polygonPixels(square(0, 1), W, H);
    expect(regionDifference(grey, grey, pixels)).toBe(0);
    expect(regionDifference(frame(() => [132, 132, 132]), grey, pixels)).toBeLessThan(.1);
    expect(regionDifference(frame(() => [60, 110, 220]), grey, pixels)).toBeGreaterThan(.3);
    expect(regionDifference(frame(() => [240, 240, 240]), grey, pixels)).toBeGreaterThan(.3);
  });

  it("classifies slots against the protocol", () => {
    expect(classifySlot(["Tips"], true)).toBe("ok-occupied");
    expect(classifySlot(["Tips"], false)).toBe("missing");
    expect(classifySlot([], true)).toBe("unexpected");
    expect(classifySlot([], false)).toBe("ok-empty");
    expect(classifySlot(["Tips"], null)).toBe("hidden");
  });

  it("checks every projected slot", () => {
    const deck = { labware: [{ slot: "C1", displayName: "Tips" }], modules: [], fixtures: [{ kind: "trashBin", slot: "A3" }] } as unknown as ExpectedDeck;
    expect(expectedBySlot(deck).get("A3")).toEqual(["Trash bin"]);
    // Left half has a blue object, right half is still the empty deck.
    const live = frame(x => x < 20 ? [60, 110, 220] : [120, 120, 120]);
    const polygons = new Map<string, Point[] | null>([["C1", square(0, .5)], ["C2", square(.5, 1)], ["A3", null]]);
    const results = checkDeck(live, grey, polygons, deck, .18);
    expect(results.map(r => [r.slot, r.status])).toEqual([["C1", "ok-occupied"], ["C2", "ok-empty"], ["A3", "hidden"]]);
    const moved = checkDeck(frame(x => x >= 20 ? [60, 110, 220] : [120, 120, 120]), grey, polygons, deck, .18);
    expect(moved.map(r => r.status)).toEqual(["missing", "unexpected", "hidden"]);
  });
});
