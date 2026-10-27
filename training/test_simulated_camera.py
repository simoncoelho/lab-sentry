import json
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import cv2
import numpy as np
from simulated_camera import SimulatedCamera, matches_calibration
from runtime import Runtime
from state_api import deck_state


class SimulationTests(unittest.TestCase):
    def test_latest_frame_and_calibration(self):
        camera = SimulatedCamera()
        matrix = np.eye(4).flatten().tolist()
        camera.submit(b'old', matrix, 70)
        camera.submit(b'new', matrix, 70)
        self.assertEqual(next(camera.frames(threading.Event()))[0], b'new')
        manifest = {'frames': [{'cameraMatrix': matrix}], 'runs': [{'context': {'view': {'horizontalFov': 70}}}]}
        self.assertTrue(matches_calibration(matrix, 70, manifest))
        self.assertFalse(matches_calibration(matrix, 80, manifest))
        moved = matrix.copy(); moved[12] = .1
        self.assertFalse(matches_calibration(moved, 70, manifest))
        with self.assertRaises(ValueError): camera.submit(b'bad', [0], 70)

    def test_stale_simulation_is_unknown_and_identified(self):
        result = deck_state({'running': True, 'timestamp': 1, 'source': 'simulation'}, now=10)
        self.assertEqual(result['source'], 'simulation')
        self.assertFalse(result['fresh'])
        self.assertTrue(all(slot['state'] == 'unknown' for slot in result['slots']))

    def test_simulation_infers_without_hardware(self):
        class Tensor:
            def cpu(self): return self
            def tolist(self): return []
        prediction = SimpleNamespace(names={}, boxes=SimpleNamespace(xyxyn=Tensor(), conf=Tensor(), cls=Tensor()))
        model = SimpleNamespace(predict=lambda *args, **kwargs: [prediction])
        matrix = np.eye(4).flatten().tolist()
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder); (root/'data').mkdir()
            (root/'data/manifest.json').write_text(json.dumps({'classes': [], 'frames': [{'cameraMatrix': matrix}], 'runs': [{'context': {'view': {'horizontalFov': 70}}}]}))
            status = {'id': 'test', 'models': {k: {'weights': str(root/k/'weights/best.pt')} for k in ['labware', 'slots']}}
            runtime = Runtime()
            with patch.dict('sys.modules', {'ultralytics': SimpleNamespace(YOLO=lambda _: model)}), patch('requests.post', side_effect=AssertionError('Hardware called')), patch('requests.get', side_effect=AssertionError('Hardware called')):
                runtime.start(status, None, source='simulation')
                encoded = cv2.imencode('.jpg', np.zeros((720,1280,3), np.uint8))[1].tobytes()
                runtime.simulated.submit(encoded, matrix, 70)
                deadline = time.monotonic()+10
                while runtime.jpeg is None and runtime.snapshot()['running'] and time.monotonic()<deadline:
                    time.sleep(.05)
                try:
                    self.assertIsNotNone(runtime.jpeg, runtime.snapshot())
                    self.assertEqual(runtime.snapshot()['source'], 'simulation')
                    self.assertTrue(runtime.snapshot()['alignment']['ok'])
                finally:
                    runtime.stop()
                self.assertFalse(runtime.thread.is_alive())


if __name__ == '__main__': unittest.main()
