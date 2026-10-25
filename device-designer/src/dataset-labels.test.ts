import { describe, it, expect } from 'vitest';
import { maskBounds, objectMaskBounds, yoloLabel } from './dataset-labels';
import { yoloFiles } from './dataset-export';
import type { DatasetFrame, Detection } from './dataset';
import type { DatasetRun } from './dataset-store';
import { createLabwareClassifier } from './classifier';
import { completeDeckState, inferSlotState } from './deck-state';

const detection: Detection = { slot: 'D1', classId: 'tip', assetId: 'rack', box: [.1, .2, .3, .4], pixels: 100, visibility: 1, review: false };
const frame = (detections?: Detection[]) => ({ id: 'frame', runId: 'run', index: 1, image: new Blob(['png']), detections, annotations: [], recipe: { note: '', exposure: 1, warmth: 0, placements: [] }, feedback: [], createdAt: '' }) as DatasetFrame;
describe('YOLO ground truth', () => {
  it('separates overlapping object IDs, occluders, and absent objects in one readback', () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    for (const i of [0, 1, 4]) pixels[i * 4] = 1;
    for (const i of [5, 9]) pixels[i * 4] = 2;
    const masks = objectMaskBounds(pixels, 4, 4, 3);
    expect(masks).toEqual([
      { count: 3, box: [0, .5, .5, .5] },
      { count: 2, box: [.25, .25, .25, .5] },
      { count: 0, box: null },
    ]);
    for (let id = 1; id <= 3; id++) {
      const binary = new Uint8Array(pixels.length);
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] === id) binary.fill(255, i, i + 4);
      expect(masks[id - 1]).toEqual(maskBounds(binary, 4, 4));
    }
  });
  it('converts bottom-up GPU pixels into clipped top-left boxes', () => {
    const pixels = new Uint8Array(4 * 4 * 4);
    for (const i of [0, 1, 4, 5]) pixels.fill(255, i * 4, i * 4 + 4);
    expect(maskBounds(pixels, 4, 4)).toEqual({ count: 4, box: [0, .5, .5, .5] });
    expect(maskBounds(new Uint8Array(64), 4, 4).box).toBeNull();
  });
  it('exports normalized centers and preserves true negative images', () => {
    expect(yoloLabel(frame([detection]), ['tip'])).toBe('0 0.250000 0.400000 0.300000 0.400000\n');
    expect(yoloLabel(frame([]), ['tip'])).toBe('');
    expect(yoloLabel(frame([{ ...detection, pixels: 0, box: null }]), ['tip'])).toBe('');
  });
  it('quarantines whole frames for ambiguous objects, unknown classes, invalid boxes, or missing masks', () => {
    expect(yoloLabel(frame(), ['tip'])).toBeNull();
    expect(yoloLabel(frame([detection, { ...detection, review: true }]), ['tip'])).toBeNull();
    expect(yoloLabel(frame([detection]), ['other'])).toBeNull();
    expect(yoloLabel(frame([{ ...detection, box: [.9, .2, .3, .4] }]), ['tip'])).toBeNull();
  });
  it('exports image/label pairs and holds legacy images out of every training split', async () => {
    const design = createLabwareClassifier();
    const run = { id: 'train', split: 'train', emptyClass: design.classes[0].id, assets: [], context: { classifier: design } } as unknown as DatasetRun;
    const labeled = frame([{ ...detection, classId: design.classes[1].id }]);
    const groups = [{ run, frames: [labeled, { ...frame(), index: 2 }] }, { run: { ...run, id: 'validation', split: 'validation' as const }, frames: [frame([])] }];
    const result = yoloFiles(groups, run);
    expect(result.counts).toEqual({ train: 1, val: 1, test: 0, review: 1 });
    expect(result.files.map(f => f.name)).toContain('labels/val/validation_000001.txt');
    expect(result.files.map(f => f.name)).not.toContain('labels/review/train_000002.txt');
    const yaml = await result.files.find(f => f.name === 'data.yaml')!.data.text();
    expect(yaml).toContain('val: images/val'); expect(yaml).not.toContain('Empty slot');
    expect(() => yoloFiles([groups[0]], run)).toThrow(/validation/);
  });
  it('exports all slot states, including unknown, independently of labware detections', async () => {
    const design = createLabwareClassifier();
    const run = { id: 'train', split: 'train', emptyClass: design.classes[0].id, assets: [], context: { classifier: design } } as unknown as DatasetRun;
    const states = completeDeckState({ slotStateVersion: 1, slotStates: [inferSlotState({ slot: 'D2', inFrame: true, visibility: 1, occupied: false, recognized: false, classId: null, assetId: null, polygon: [[100, 100], [200, 200]] })] });
    const f = { ...frame([]), slotStateVersion: 1 as const, slotStates: states };
    const { files } = yoloFiles([{ run, frames: [f] }, { run: { ...run, id: 'val', split: 'validation' }, frames: [f] }], run);
    const report = JSON.parse(await files.find(f => f.name === 'deck-state/train_000001.json')!.data.text());
    expect(report.slots).toHaveLength(12);
    expect(report.slots.find((s: { slot: string }) => s.slot === 'A3').state).toBe('unknown');
    expect(await files.find(f => f.name === 'slots/labels/train/train_000001.txt')!.data.text()).toMatch(/^1 /);
    expect(await files.find(f => f.name === 'slots/data.yaml')!.data.text()).toContain('2: obscured');
    expect(await files.find(f => f.name === 'labels/train/train_000001.txt')!.data.text()).toBe('');
  });
});
