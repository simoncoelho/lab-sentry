"""Image-only camera effects, sampled online for training, never validation."""
import albumentations as A


def camera_augmentations():
    # Noise standard deviation is a fraction of the 8-bit range (roughly 1–5 DN).
    # Keep corruption modest: transparent labware and slot edges must stay visible.
    return [
        A.GaussianBlur(blur_limit=(3, 3), sigma_limit=(0.2, 0.7), p=0.15),
        A.GaussNoise(std_range=(0.004, 0.02), mean_range=(0, 0), p=0.35),
        A.ImageCompression(quality_range=(75, 98), compression_type='jpeg', p=0.30),
    ]


def augmentation_metadata():
    return {
        'scope': 'training only; validation/test and source images unchanged',
        'transforms': [A.to_dict(transform) for transform in camera_augmentations()],
        'exposure': {'hsv_h': 0.008, 'hsv_s': 0.12, 'hsv_v': 0.15},
        'note': 'Conservative initial ranges, not a measured OBSBOT sensor noise model',
    }
