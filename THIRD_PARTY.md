# Third-party components

This project uses Ultralytics YOLO26 and fine-tuned YOLO26n weights. Ultralytics is distributed under AGPL-3.0 with commercial licensing options; its license and notices apply to its software and models. See https://github.com/ultralytics/ultralytics and https://www.ultralytics.com/license. This handoff does not grant a separate proprietary license to those components.

Camera support is fetched from https://github.com/simoncoelho/obsbot-control at commit `517dffa4fdd822fa3f0619c519b4224d1e4e53fb`. Its source remains in `.dependencies` after setup. Other dependencies (PyTorch, OpenCV, React, Three.js, FastAPI, .NET and Node.js) retain their upstream licenses and notices in their installed distributions.

The bundled calibration photograph and model checkpoints come from this project's existing deck-detection setup. No generated training-image collection is bundled.
