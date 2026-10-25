"""Collect raw camera observations for manual validation; never auto-label predictions as truth."""
import argparse
import json
from pathlib import Path
import time
import requests

def capture(destination, count, interval):
    destination=Path(destination);destination.mkdir(parents=True,exist_ok=True)
    # Reuse the inference owner's raw frames. A second MJPEG consumer can replace
    # the OBSBOT source connection and silently end the first stream.
    for index in range(1,count+1):
        state=requests.get('http://127.0.0.1:5102/status',timeout=5).json()['runtime']
        if not state.get('running') or state.get('stale'):raise RuntimeError('Start detection and wait for a fresh camera frame first')
        frame=requests.get('http://127.0.0.1:5102/runtime/raw.jpg',timeout=5)
        if frame.status_code!=200:raise RuntimeError('No raw camera frame available')
        (destination/f'{index:03d}.jpg').write_bytes(frame.content)
        metadata={'timestamp':time.time(),'review':'unlabeled camera observation; predictions are not ground truth','runtime':state}
        (destination/f'{index:03d}.json').write_text(json.dumps(metadata,indent=2),encoding='utf8')
        if index<count:time.sleep(interval)

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('destination');p.add_argument('--count',type=int,default=12);p.add_argument('--interval',type=float,default=5);a=p.parse_args();capture(a.destination,a.count,a.interval)
