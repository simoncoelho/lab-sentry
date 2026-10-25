"""Check a fresh installation without needing a camera or a GPU."""
import json
from pathlib import Path
import sys

root=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(root/'training'))
from inference_device import inference_device
from ultralytics import YOLO
import numpy as np

status=json.loads((root/'bundled/deck/status.json').read_text(encoding='utf-8-sig'))
for name,model in status['models'].items():
    path=root/'bundled/deck'/model['weights']
    detector=YOLO(str(path))
    detector.predict(np.zeros((360,640,3),dtype=np.uint8),device='cpu',imgsz=960,verbose=False)
    print(f'OK: {name} weights load and run on CPU')
for name in ('manifest.json','audit.json'):
    json.loads((root/'bundled/deck/data'/name).read_text(encoding='utf-8-sig'))
assert (root/'bundled/deck/calibration-fixed.jpg').is_file()
print('OK: bundled calibration. Inference device:',inference_device())
