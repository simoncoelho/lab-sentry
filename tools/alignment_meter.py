"""Live check of how well the camera view matches the detection reference.

Run while detection is running (it holds the saved pan/tilt/zoom). Once a second
it applies detection's own landmark matching and acceptance check to the live
frame; adjust the camera mount until it reports DETECTION ACCEPTS. Ctrl+C stops it.

    .runtime/python/bin/python tools/alignment_meter.py [reference.jpg]
"""
import sys
import time
import urllib.request
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'training'))
from runtime import alignment_quality  # noqa: E402

reference = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'bundled/deck/calibration-fixed.jpg'
sift = cv2.SIFT_create(nfeatures=1500)
ref = cv2.resize(cv2.imread(str(reference), cv2.IMREAD_GRAYSCALE), (640, 360))
ref_kp, ref_desc = sift.detectAndCompute(ref, None)
matcher = cv2.BFMatcher()
print(f'Reference: {reference} ({len(ref_kp)} landmarks). Ctrl+C to stop.', flush=True)
while True:
    try:
        data = urllib.request.urlopen('http://127.0.0.1:5102/runtime/raw.jpg', timeout=3).read()
        gray = cv2.resize(cv2.cvtColor(cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR), cv2.COLOR_BGR2GRAY), (640, 360))
        kp, desc = sift.detectAndCompute(gray, None)
        # Same matching as training/runtime.py
        pairs = matcher.knnMatch(ref_desc, desc, k=2) if desc is not None and len(desc) >= 2 else []
        good = [m for pair in pairs if len(pair) == 2 for m, n in [pair] if m.distance < .7 * n.distance]
        result, shift = {'ok': False, 'inliers': 0, 'driftPixels': None}, ''
        if len(good) >= 12:
            src = np.float32([ref_kp[m.queryIdx].pt for m in good])
            dst = np.float32([kp[m.trainIdx].pt for m in good])
            H, mask = cv2.findHomography(src, dst, cv2.RANSAC, 3)
            if H is not None and mask is not None and mask.sum() >= 12:
                result = alignment_quality(H, src, dst, mask)
                center = np.float32([[[320, 180]]])
                moved = cv2.perspectiveTransform(center, H)[0, 0] - center[0, 0]
                shift = f'  reference center is {moved[0]:+.0f} px right, {moved[1]:+.0f} px down; drift {result["driftPixels"]} px'
        inliers = result['inliers']
        verdict = 'DETECTION ACCEPTS' if result['ok'] else 'close' if inliers >= 12 else 'not matching'
        print(f'{time.strftime("%H:%M:%S")}  matches {inliers:4d} {"#" * min(40, inliers // 2):<40} {verdict}{shift}', flush=True)
    except Exception as e:
        print(f'{time.strftime("%H:%M:%S")}  waiting for detection frames ({e})', flush=True)
    time.sleep(1)
