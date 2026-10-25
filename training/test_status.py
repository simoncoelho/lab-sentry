import json
import tempfile
import unittest
from pathlib import Path
import numpy as np
from train import write_status

class StatusTests(unittest.TestCase):
    def test_per_class_numpy_metrics_are_serializable(self):
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'status.json'
            write_status(path,{'state':'complete','perClass':[{'Images':np.int64(20),'Precision':np.float64(.9)}]})
            self.assertEqual(json.loads(path.read_text())['perClass'][0],{'Images':20,'Precision':.9})

if __name__=='__main__':unittest.main()
