"""Two transfer-learned detectors: labware identity and observed slot state."""
import argparse
import ctypes
import json
import os
from pathlib import Path
import time

ROOT = Path(__file__).resolve().parent

def write_status(path, data):
    temporary = path.with_suffix('.tmp')
    temporary.write_text(json.dumps(data, indent=2, default=lambda value: value.tolist()), encoding='utf8')
    os.replace(temporary, path)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dataset', required=True)
    parser.add_argument('--name', required=True)
    parser.add_argument('--epochs', type=int, default=100)
    parser.add_argument('--size', type=int, default=960)
    parser.add_argument('--real-reference', help='Directory with image.jpg and reviewed labels.json; one layout, never a validation split')
    parser.add_argument('--no-camera-noise', action='store_true', help='Use previewed input pixels without additional random camera corruption')
    parser.add_argument('--reuse-checkpoints', action='store_true', help='Validate existing completed checkpoints instead of retraining them')
    args = parser.parse_args()
    from dataset import prepare
    from camera_augmentation import camera_augmentations, augmentation_metadata
    from ultralytics import YOLO, settings
    import torch
    settings.update({'sync': False})
    torch.set_num_threads(6)
    run_dir = ROOT / 'runs' / args.name
    run_dir.mkdir(parents=True, exist_ok=True)
    status_path = run_dir / 'status.json'
    status = {'id': args.name, 'pid': os.getpid(), 'state': 'preparing', 'started': time.time(), 'epoch': 0, 'epochs': args.epochs, 'metrics': {}, 'models': {}}
    status['augmentation'] = augmentation_metadata() if not args.no_camera_noise else {'scope':'previewed input images; no additional camera noise or HSV changes'}
    write_status(status_path, status)
    if os.name == 'nt': ctypes.windll.kernel32.SetThreadExecutionState(0x80000001)
    try:
        if not torch.cuda.is_available(): raise RuntimeError('CUDA unavailable: refusing unintended CPU training')
        # Exercise a CUDA kernel rather than trusting discovery alone (Blackwell).
        (torch.ones(8, device='cuda') * 2).sum().item()
        status['gpu'] = torch.cuda.get_device_name(0)
        status['audit'] = prepare(args.dataset, run_dir / 'data')
        if args.real_reference:
            import shutil
            from PIL import Image
            real=Path(args.real_reference)
            labels=json.loads((real/'labels.json').read_text(encoding='utf8'))
            width,height=Image.open(real/'image.jpg').size
            classes=status['audit']['supportedClasses']
            rows=[]
            for obj in labels['objects']:
                if obj['label'] not in classes:raise ValueError('Real reference contains an unsupported class')
                x1,y1,x2,y2=obj['box']
                if not 0<=x1<x2<=width or not 0<=y1<y2<=height:raise ValueError('Invalid reviewed real reference bounds')
                rows.append(f'{classes.index(obj["label"])} {(x1+x2)/2/width} {(y1+y2)/2/height} {(x2-x1)/width} {(y2-y1)/height}')
            # Reweight this one reviewed frame, never pretend copies are independent images.
            slot_rows=[]
            if labels.get('slots'):
                source_manifest=json.loads((run_dir/'data/manifest.json').read_text(encoding='utf8'))
                states=['occupied','empty','obscured','unknown']
                for slot in source_manifest['frames'][0]['slotStates']:
                    points=slot.get('polygon')
                    if not points:continue
                    left=max(0,min(p[0] for p in points))/1280;right=min(1280,max(p[0] for p in points))/1280
                    top=max(0,min(p[1] for p in points))/720;bottom=min(720,max(p[1] for p in points))/720
                    if right>left and bottom>top:
                        slot_rows.append(f'{states.index(labels["slots"][slot["slot"]])} {(left+right)/2} {(top+bottom)/2} {right-left} {bottom-top}')
            for i in range(20):
                shutil.copy2(real/'image.jpg',run_dir/f'data/labware/images/train/real-reference-{i:02d}.jpg')
                (run_dir/f'data/labware/labels/train/real-reference-{i:02d}.txt').write_text('\n'.join(rows))
                if slot_rows:
                    shutil.copy2(real/'image.jpg',run_dir/f'data/slots/images/train/real-reference-{i:02d}.jpg')
                    (run_dir/f'data/slots/labels/train/real-reference-{i:02d}.txt').write_text('\n'.join(slot_rows))
            status['realAdaptation']={'uniqueImages':1,'samplingCopies':20,'scope':'One reviewed layout in training only. Live checks on this layout are not independent validation.'}
        for task in ('labware', 'slots'):
            status.update(state='training', task=task, epoch=0)
            write_status(status_path, status)
            best = run_dir / task / 'weights' / 'best.pt'
            model = YOLO(str(best if args.reuse_checkpoints and best.exists() else ROOT / 'yolo26n.pt'))
            def progress(trainer):
                status.update(epoch=min(trainer.epoch + 1,args.epochs), metrics={k:float(v) for k,v in trainer.metrics.items()}, elapsed=round(time.time()-status['started']))
                write_status(status_path, status)
            model.add_callback('on_fit_epoch_end', progress)
            if not (args.reuse_checkpoints and best.exists()):model.train(data=str(run_dir / 'data' / task / 'data.yaml'), project=str(run_dir), name=task,
                epochs=args.epochs, patience=25, imgsz=args.size, batch=8, device=0, workers=0,
                optimizer='AdamW', lr0=.001, seed=42, deterministic=True, cache=False,
                mosaic=0, mixup=0, copy_paste=0, fliplr=0, flipud=0, degrees=0,
                translate=.01, scale=.03, hsv_h=0 if args.no_camera_noise else .008, hsv_s=0 if args.no_camera_noise else .12, hsv_v=0 if args.no_camera_noise else .15,
                augmentations=camera_augmentations() if not args.no_camera_noise else [],
                plots=True, save=True, verbose=False, exist_ok=False)
            best = run_dir / task / 'weights' / 'best.pt'
            metrics = YOLO(str(best)).val(data=str(run_dir / 'data' / task / 'data.yaml'), imgsz=args.size, device=0, workers=0, plots=True)
            status['models'][task] = {'weights': str(best), 'metrics': {k:float(v) for k,v in metrics.results_dict.items()}, 'classes': metrics.names}
            status['models'][task]['perClass']=metrics.summary()
            if (run_dir/'data'/task/'images/test').exists():
                test=YOLO(str(best)).val(data=str(run_dir/'data'/task/'data.yaml'),split='test',imgsz=args.size,device=0,workers=0,plots=True,project=str(run_dir),name=f'{task}-test')
                status['models'][task]['testMetrics']={k:float(v) for k,v in test.results_dict.items()}
                status['models'][task]['testPerClass']=test.summary()
            write_status(status_path, status)
        status.update(state='complete', elapsed=round(time.time()-status['started']))
    except Exception as error:
        status.update(state='failed', error=str(error))
        raise
    finally:
        write_status(status_path, status)
        if os.name == 'nt': ctypes.windll.kernel32.SetThreadExecutionState(0x80000000)

if __name__ == '__main__': main()
