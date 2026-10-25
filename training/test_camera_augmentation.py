import unittest
import numpy as np
import albumentations as A
from camera_augmentation import camera_augmentations, augmentation_metadata
from ultralytics.data.augment import Albumentations
from ultralytics.data.dataset import YOLODataset
from ultralytics.cfg import get_cfg


class CameraAugmentationTests(unittest.TestCase):
    def test_validation_pipeline_has_no_camera_corruption(self):
        dataset = object.__new__(YOLODataset)
        dataset.augment = False
        dataset.imgsz = 960
        dataset.use_segments = dataset.use_keypoints = dataset.use_obb = False
        config = get_cfg()
        config.augmentations = camera_augmentations()
        pipeline = dataset.build_transforms(config)
        self.assertEqual([type(t).__name__ for t in pipeline.tolist()], ['LetterBox', 'Format'])

    def test_serialization_and_seeded_replay(self):
        transforms = [A.from_dict(t) for t in augmentation_metadata()['transforms']]
        first = A.Compose(transforms, seed=42)
        second = A.Compose(camera_augmentations(), seed=42)
        source = np.full((96, 160, 3), 120, dtype=np.uint8)
        changed = 0
        for _ in range(30):
            a, b = first(image=source)['image'], second(image=source)['image']
            np.testing.assert_array_equal(a, b)
            self.assertEqual(a.shape, source.shape)
            self.assertEqual(a.dtype, np.uint8)
            changed += not np.array_equal(a, source)
        self.assertGreater(changed, 0)
        np.testing.assert_array_equal(source, np.full_like(source, 120))

    def test_yolo_adapter_preserves_labels_and_negative_samples(self):
        adapter = Albumentations(transforms=camera_augmentations())
        self.assertIsNotNone(adapter.transform)
        self.assertFalse(adapter.contains_spatial)
        for classes in (np.array([[0], [2]]), np.empty((0, 1))):
            boxes = np.array([[.2, .3, .1, .1], [.7, .8, .2, .1]])
            labels = {'img': np.full((96, 160, 3), 120, dtype=np.uint8),
                      'cls': classes, 'instances': boxes, 'slotStates': ['empty', 'unknown']}
            for _ in range(20):
                result = adapter(labels.copy())
                self.assertIs(result['instances'], boxes)
                self.assertIs(result['cls'], classes)
                self.assertEqual(result['slotStates'], ['empty', 'unknown'])


if __name__ == '__main__':
    unittest.main()
