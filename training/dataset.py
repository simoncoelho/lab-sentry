"""Validate exported observations and prepare reproducible local YOLO datasets."""
import collections
import hashlib
import json
import math
from pathlib import Path
import shutil
from PIL import Image

SLOTS = [r + c for r in 'ABCD' for c in '123']

def audit(source):
    source = Path(source)
    manifest = json.loads((source / 'manifest.json').read_text(encoding='utf8'))
    counts, instances, slot_counts = collections.Counter(), collections.Counter(), collections.Counter()
    hashes, recipes = {}, set()
    source_hashes = {}
    slot_instances, negatives = collections.Counter(), collections.Counter()
    layout_splits={}
    for frame in manifest['frames']:
        path = source / frame['path']
        if not path.resolve().is_relative_to(source.resolve()) or not path.is_file():
            raise ValueError('Missing or unsafe image path')
        split = frame['split']
        if split == 'review':
            continue
        if split not in ('train','val','test'):raise ValueError('Unknown dataset split')
        with Image.open(path) as image:
            if image.size!=(1280,720):raise ValueError('Expected calibrated 1280 x 720 render')
            image.verify()
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if digest in hashes and hashes[digest] != split:
            raise ValueError('Identical image occurs in different splits')
        hashes[digest] = split
        original = frame.get('sourceSha256', digest)
        if original in source_hashes and source_hashes[original] != split:
            raise ValueError('Same source image occurs in different splits after processing')
        source_hashes[original] = split
        counts[split] += 1
        labels = source / 'labels' / split / (path.stem + '.txt')
        label_rows=labels.read_text().splitlines()
        if not label_rows:negatives[split]+=1
        for row in label_rows:
            c, x, y, w, h = map(float, row.split())
            if not (all(math.isfinite(v) for v in (c,x,y,w,h)) and c.is_integer() and 0 <= c < len(manifest['classes']) and 0 <= x <= 1 and 0 <= y <= 1 and 0 < w <= 1 and 0 < h <= 1 and x-w/2 >= -1e-6 and y-h/2 >= -1e-6 and x+w/2 <= 1.000001 and y+h/2 <= 1.000001):
                raise ValueError('Invalid YOLO box')
            instances[f'{split}:{manifest["classes"][int(c)]["name"]}'] += 1
        states = frame.get('slotStates', [])
        if len(states) != 12 or {s['slot'] for s in states} != set(SLOTS):
            raise ValueError('Every frame requires all twelve slot states')
        for slot in states:
            slot_counts[f'{split}:{slot["state"]}'] += 1
        names={c['id']:c['name'] for c in manifest['classes']}
        for detection in frame.get('detections',[]):
            if detection.get('box') and not detection.get('review') and detection['classId'] in names:
                slot_instances[f'{split}:{detection["slot"]}:{names[detection["classId"]]}']+=1
        placements=frame['recipe']['placements']
        recipe=json.dumps(sorted(placements,key=lambda p:p['slot']),sort_keys=True)
        family=json.dumps(sorted((p['slot'],p['assetId']) for p in placements))
        if placements and family in layout_splits and layout_splits[family]!=split:
            raise ValueError('Same nonempty asset-slot layout occurs in different splits')
        if placements:layout_splits[family]=split
        recipes.add(recipe)
    if counts['train'] < 20 or counts['val'] < 10:
        raise ValueError('At least 20 training and 10 validation images are required for a baseline')
    supported = [i for i, c in enumerate(manifest['classes']) if instances[f'train:{c["name"]}']]
    report = dict(images=dict(counts), instances=dict(instances), slotStates=dict(slot_counts), uniqueImages=len(hashes), uniqueLayouts=len(recipes), supportedClasses=[manifest['classes'][i]['name'] for i in supported], unsupportedClasses=[c['name'] for i,c in enumerate(manifest['classes']) if i not in supported], readiness='synthetic baseline; real-world performance unverified')
    report.update(slotInstances=dict(slot_instances),negativeImages=dict(negatives),uniqueRecipes=len(recipes),uniqueLayouts=len(layout_splits)+(1 if '[]' in recipes else 0))
    report['gantryVariations']=sum(bool(f['recipe'].get('gantry')) for f in manifest['frames'])
    report['slotImages']={split:len(list((source/'slots/images'/split).glob('*.png'))) for split in ('train','val','test')}
    return manifest, supported, report

def prepare(source, destination):
    source, destination = Path(source), Path(destination)
    manifest, supported, report = audit(source)
    destination.mkdir(parents=True, exist_ok=True)
    mapping = {old: new for new, old in enumerate(supported)}
    for task in ('labware', 'slots'):
        root = destination / task
        for split in ('train', 'val', 'test'):
            image_dir = source / ('slots/images' if task == 'slots' else 'images') / split
            if not image_dir.exists(): continue
            (root / 'images' / split).mkdir(parents=True, exist_ok=True)
            (root / 'labels' / split).mkdir(parents=True, exist_ok=True)
            for image in image_dir.glob('*.png'):
                target = root / 'images' / split / image.name
                if not target.exists():
                    try: target.hardlink_to(image)
                    except OSError: shutil.copy2(image, target)
                label = source / ('slots/labels' if task == 'slots' else 'labels') / split / (image.stem + '.txt')
                rows = []
                for row in label.read_text().splitlines():
                    parts = row.split(); cls = int(parts[0])
                    if task == 'labware':
                        if cls not in mapping: continue
                        parts[0] = str(mapping[cls])
                    rows.append(' '.join(parts))
                (root / 'labels' / split / label.name).write_text('\n'.join(rows), encoding='utf8')
        names = [manifest['classes'][i]['name'] for i in supported] if task == 'labware' else ['occupied', 'empty', 'obscured', 'unknown']
        config = f'path: {json.dumps(root.resolve().as_posix())}\ntrain: images/train\nval: images/val\n'
        if (root / 'images/test').exists(): config += 'test: images/test\n'
        config += 'names:\n' + ''.join(f'  {i}: {json.dumps(n)}\n' for i,n in enumerate(names))
        (root / 'data.yaml').write_text(config, encoding='utf8')
    (destination / 'audit.json').write_text(json.dumps(report, indent=2), encoding='utf8')
    (destination / 'manifest.json').write_text(json.dumps(manifest), encoding='utf8')
    return report
