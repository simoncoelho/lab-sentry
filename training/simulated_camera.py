"""Latest-frame mailbox. Simulation never opens or moves physical hardware."""
import threading
import time
import numpy as np


class SimulatedCamera:
    def __init__(self):
        self.condition = threading.Condition()
        self.frame = None
        self.sequence = 0

    def submit(self, encoded, matrix, fov):
        if len(matrix) != 16 or not np.isfinite(matrix).all() or not np.isfinite(fov) or not 1 < fov < 179:
            raise ValueError('Invalid simulated camera calibration')
        with self.condition:
            self.sequence += 1
            self.frame = (encoded, time.time(), matrix, fov)
            self.condition.notify_all()

    def frames(self, stop):
        sequence = 0
        while not stop.is_set():
            with self.condition:
                self.condition.wait_for(lambda: self.sequence != sequence or stop.is_set(), timeout=.25)
                if stop.is_set():
                    return
                if self.sequence == sequence:
                    continue
                sequence = self.sequence
                frame = self.frame
            yield frame


def matches_calibration(matrix, fov, manifest):
    frames = manifest.get('frames', [])
    expected = frames[0].get('cameraMatrix') if frames else None
    runs = manifest.get('runs', [])
    view = runs[0].get('context', {}).get('view', {}) if runs else {}
    expected_fov = view.get('horizontalFov')
    return bool(expected is not None and len(expected) == 16 and expected_fov is not None
                and np.allclose(matrix, expected, atol=1e-5, rtol=0)
                and abs(fov - expected_fov) < .01)
