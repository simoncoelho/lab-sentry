import copy
import json
import unittest
from pathlib import Path
from isaac_server import validate_scene


class SceneValidation(unittest.TestCase):
    def setUp(self):
        self.scene = json.loads(Path(__file__).with_name('smoke.json').read_text())

    def test_valid_scene(self):
        validate_scene(self.scene)

    def test_bad_indices_and_transforms_rejected(self):
        for key, value in [('indices', [0, 1, 90]), ('matrix', [float('nan')] * 16)]:
            scene = copy.deepcopy(self.scene)
            scene['meshes'][0][key] = value
            with self.assertRaises(ValueError):
                validate_scene(scene)

    def test_invalid_projection_rejected(self):
        self.scene['camera']['verticalFov'] = 180
        with self.assertRaises(ValueError):
            validate_scene(self.scene)


if __name__ == '__main__':
    unittest.main()
