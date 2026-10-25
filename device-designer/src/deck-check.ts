// Deck check: compare each slot of the live camera image against a reference
// photo of the empty deck, and against what the protocol expects in that slot.
// Simple image differencing, meant for a fixed, calibrated camera.

import { FLEX_SLOT, flexSlotCenter, type ExpectedDeck } from "./protocol-deck";

export const DECK_SLOTS = ["A1", "A2", "A3", "B1", "B2", "B3", "C1", "C2", "C3", "D1", "D2", "D3"];

export type Point = [number, number];
export type SlotStatus = "ok-empty" | "ok-occupied" | "missing" | "unexpected" | "hidden";
export type SlotResult = {
  slot: string;
  /** What the protocol puts here (labware names or fixture), empty if nothing. */
  expected: string[];
  /** 0..1 difference from the empty-deck reference; null when not visible. */
  score: number | null;
  occupied: boolean | null;
  status: SlotStatus;
};
type Frame = { data: Uint8ClampedArray; width: number; height: number };

/** Slot floor as a 3D polygon in the Flex URDF frame, shrunk to avoid neighboring slots. */
export function slotPolygon(slot: string, shrink = 0.8): [number, number, number][] | null {
  const center = flexSlotCenter(slot);
  if (!center) return null;
  const hx = FLEX_SLOT.width / 2 * shrink, hy = FLEX_SLOT.depth / 2 * shrink;
  return [[-hx, -hy], [hx, -hy], [hx, hy], [-hx, hy]].map(([x, y]) => [center[0] + x, center[1] + y, center[2]]);
}

export function insidePolygon([x, y]: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i], [xj, yj] = polygon[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Pixel indices inside a normalized (0..1) polygon, sampled every `step` pixels. */
export function polygonPixels(polygon: Point[], width: number, height: number, step = 2) {
  const xs = polygon.map(p => p[0] * width), ys = polygon.map(p => p[1] * height);
  const x0 = Math.max(0, Math.floor(Math.min(...xs))), x1 = Math.min(width - 1, Math.ceil(Math.max(...xs)));
  const y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(height - 1, Math.ceil(Math.max(...ys)));
  const pixels: number[] = [];
  for (let y = y0; y <= y1; y += step) for (let x = x0; x <= x1; x += step)
    if (insidePolygon([(x + .5) / width, (y + .5) / height], polygon)) pixels.push(y * width + x);
  return pixels;
}

const luminance = (data: Uint8ClampedArray, i: number) => .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];

/**
 * How different a region is from the reference, 0..1. Each frame is first
 * normalized by its mean brightness in the region, so a small lighting change
 * does not count as an object; color differences still do.
 */
export function regionDifference(live: Frame, reference: Frame, pixels: number[]) {
  if (!pixels.length) return 0;
  let liveMean = 0, refMean = 0;
  for (const p of pixels) { liveMean += luminance(live.data, p * 4); refMean += luminance(reference.data, p * 4); }
  liveMean = Math.max(liveMean / pixels.length, 1); refMean = Math.max(refMean / pixels.length, 1);
  const gain = refMean / liveMean;
  let total = 0;
  for (const p of pixels) {
    const i = p * 4;
    total += (Math.abs(live.data[i] * gain - reference.data[i]) + Math.abs(live.data[i + 1] * gain - reference.data[i + 1]) + Math.abs(live.data[i + 2] * gain - reference.data[i + 2])) / 3;
  }
  // Brightness shifts also matter when large (e.g. a white plate on a grey deck).
  const brightness = Math.abs(Math.log(liveMean / refMean)) / Math.log(4);
  return Math.min(1, total / pixels.length / 255 * 2 + brightness);
}

/** What the protocol expects in each slot. */
export function expectedBySlot(deck: ExpectedDeck | null) {
  const bySlot = new Map<string, string[]>();
  const add = (slot: string, name: string) => bySlot.set(slot, [...(bySlot.get(slot) ?? []), name]);
  for (const l of deck?.labware ?? []) add(l.slot, l.displayName);
  for (const m of deck?.modules ?? []) add(m.slot, m.model);
  for (const f of deck?.fixtures ?? []) add(f.slot, f.kind === "trashBin" ? "Trash bin" : "Waste chute");
  return bySlot;
}

export function classifySlot(expected: string[], occupied: boolean | null): SlotStatus {
  if (occupied === null) return "hidden";
  if (expected.length) return occupied ? "ok-occupied" : "missing";
  return occupied ? "unexpected" : "ok-empty";
}

/** Run the check for every slot with a projected polygon (null polygon = not visible). */
export function checkDeck(live: Frame, reference: Frame, polygons: Map<string, Point[] | null>, deck: ExpectedDeck | null, threshold: number): SlotResult[] {
  const expected = expectedBySlot(deck);
  return [...polygons].map(([slot, polygon]) => {
    // Partly visible slots are clipped to the image; tiny slivers count as hidden.
    const pixels = polygon ? polygonPixels(polygon, live.width, live.height) : [];
    const score = pixels.length >= 30 ? regionDifference(live, reference, pixels) : null;
    const occupied = score === null ? null : score >= threshold;
    return { slot, expected: expected.get(slot) ?? [], score, occupied, status: classifySlot(expected.get(slot) ?? [], occupied) };
  });
}
