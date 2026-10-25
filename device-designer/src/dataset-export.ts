import { processImage } from './image-processing';

import { detectionClasses, yoloLabel } from './dataset-labels';

import type { DatasetFrame } from './dataset';

import type { DatasetRun } from './dataset-store';

import { completeDeckState, slotYoloLabel, slotStateNames } from './deck-state';



export function yoloFiles(groups: { run: DatasetRun; frames: DatasetFrame[] }[], reference: DatasetRun) {

  const classes = detectionClasses(reference.context.classifier!, reference.emptyClass);

  const ids = classes.map(c => c.id), files: { name: string; data: Blob }[] = [];

  const counts = { train: 0, val: 0, test: 0, review: 0 };

  const records: unknown[] = [];

  for (const { run, frames } of groups) {

    if (JSON.stringify(detectionClasses(run.context.classifier!, run.emptyClass)) !== JSON.stringify(classes)) continue;

    const split = run.split === 'validation' ? 'val' : run.split;

    for (const frame of frames) {

      const label = yoloLabel(frame, ids), name = `${run.id}_${String(frame.index).padStart(6, '0')}`;

      const folder = label === null ? 'review' : split;

      counts[folder]++;

      files.push({ name: `images/${folder}/${name}.png`, data: frame.image });

      if (label !== null) files.push({ name: `labels/${folder}/${name}.txt`, data: new Blob([label]) });

      const slotStates = completeDeckState(frame);

      files.push({ name: `deck-state/${name}.json`, data: new Blob([JSON.stringify({ image: `images/${folder}/${name}.png`, slots: slotStates }, null, 2)]) });

      if (frame.slotStateVersion === 1 && frame.slotStates?.length === 12) {

        files.push({ name: `slots/images/${split}/${name}.png`, data: frame.image });

        files.push({ name: `slots/labels/${split}/${name}.txt`, data: new Blob([slotYoloLabel(slotStates)]) });

      }

      const { image: _, ...metadata } = frame;

      records.push({ ...metadata, slotStates, split: folder, path: `images/${folder}/${name}.png` });

    }

  }

  if (!counts.train || !counts.val) throw new Error(`YOLO export needs training and validation runs with usable labels (${counts.train} train, ${counts.val} validation, ${counts.review} held for review). Create a new run in the missing split. Legacy images must be regenerated.`);

  files.push({ name: 'data.yaml', data: new Blob([`# Run yolo with data=/absolute/path/to/data.yaml\ntrain: images/train\nval: images/val\n${counts.test ? 'test: images/test\n' : ''}names:\n${classes.map((c, i) => `  ${i}: ${JSON.stringify(c.name)}`).join('\n')}\n`]) });

  const slotSplits = new Set(groups.filter(g => g.frames.some(f => f.slotStateVersion === 1 && f.slotStates?.length === 12)).map(g => g.run.split));

  if (slotSplits.has('train') && slotSplits.has('validation')) files.push({ name: 'slots/data.yaml', data: new Blob([`train: images/train\nval: images/val\n${slotSplits.has('test') ? 'test: images/test\n' : ''}names:\n${slotStateNames.map((s, i) => `  ${i}: ${s}`).join('\n')}\n`]) });

  files.push({ name: 'manifest.json', data: new Blob([JSON.stringify({ version: 3, classes, counts, labelPolicy: 'Visible silhouette boxes, normalized xywh; fewer than 64 pixels or under 25% visibility holds the entire frame for review. Transparent labware is treated as solid for labeling; acrylic is ignored as an occluder. Labware classes exclude empty. Complete twelve-slot observed states are in deck-state JSON; separate slots/ labels classify occupied, empty, obscured, unknown. No off-camera boxes are invented. Scene truth is separate from observation. Legacy frames are held for review.', splitPolicy: 'Whole runs stay in their assigned split. Keep related reruns in the same split; evaluate against separately labeled real camera images.', runs: groups.map(({ run }) => ({ ...run, assets: run.assets.map(({ file: _, ...a }) => a), sourceAssets: undefined })), frames: records }, null, 2)]) });

  const sources = new Map(groups.flatMap(({ run }) => run.sourceAssets ?? run.assets).map(a => [a.id, a]));

  for (const a of sources.values()) if (a.file) files.push({ name: `assets/${a.id}.${a.kind}`, data: a.file });

  return { files, counts };

}



export async function processedYoloFiles(groups: { run: DatasetRun; frames: DatasetFrame[] }[], reference: DatasetRun, progress?: (done: number, total: number) => void) {
  let done = 0; const total = groups.reduce((sum, group) => sum + group.frames.length, 0);

  const processed = [];

  for (const group of groups) {

    const frames = [];

    for (let offset = 0; offset < group.frames.length; offset += 12) {
      frames.push(...await Promise.all(group.frames.slice(offset, offset + 12).map(async frame => {
        const digest = await crypto.subtle.digest('SHA-256', await frame.image.arrayBuffer());
        const sourceSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        const image = await processImage(frame.image, group.run.processing, frame.id);
        progress?.(++done, total);
        return { ...frame, sourceSha256, image };
      })));
    }
    processed.push({ run: group.run, frames });

  }

  return yoloFiles(processed, reference);

}
