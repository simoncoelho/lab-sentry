import type { ClassifierDesign } from './classifier';
import type { DatasetFrame } from './dataset';

// GPU readback is bottom-up. Bounds are pixel edges, not pixel centers.
export function maskBounds(pixels: Uint8Array, width: number, height: number) {
  let left = width, top = height, right = 0, bottom = 0, count = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4;
    if (pixels[i] < 200 || pixels[i + 1] < 200 || pixels[i + 2] < 200) continue;
    count++; left = Math.min(left, x); right = Math.max(right, x + 1);
    top = Math.min(top, height - y - 1); bottom = Math.max(bottom, height - y);
  }
  return { count, box: count ? [left / width, top / height, (right - left) / width, (bottom - top) / height] as [number, number, number, number] : null };
}
export const detectionClasses = (design: ClassifierDesign, emptyClass: string) => design.classes.filter(c => c.id !== emptyClass);
export function yoloLabel(frame: DatasetFrame, classIds: string[]): string | null {
  // Legacy images lack object masks. Never silently treat them as negatives.
  if (!frame.detections || frame.detections.some(d => d.review || (d.pixels > 0 && !classIds.includes(d.classId)))) return null;
  const lines: string[] = [];
  for (const d of frame.detections) {
    if (!d.box || !d.pixels) continue;
    const [x, y, w, h] = d.box;
    if (![x, y, w, h].every(Number.isFinite) || x < 0 || y < 0 || w <= 0 || h <= 0 || x + w > 1.000001 || y + h > 1.000001) return null;
    lines.push(`${classIds.indexOf(d.classId)} ${[x + w / 2, y + h / 2, w, h].map(v => v.toFixed(6)).join(' ')}`);
  }
  return lines.join('\n') + (lines.length ? '\n' : '');
}
