import json
from pathlib import Path
import tempfile
import threading
import unittest
import asyncio
import shutil
from unittest.mock import patch
from inference_device import inference_device
from camera_frames import latest_frames


class PortableTests(unittest.TestCase):
    def test_relocated_bundle_registry_and_reference(self):
        import server
        source=Path(__file__).resolve().parents[1]/'bundled/deck'
        with tempfile.TemporaryDirectory(prefix='lab handoff ') as tmp:
            root=Path(tmp);training=root/'training';training.mkdir()
            target=root/'bundled/deck';target.mkdir(parents=True)
            for name in ('status.json','calibration-fixed.jpg'):
                shutil.copy2(source/name,target/name)
            (target/'data').mkdir()
            shutil.copy2(source/'data/manifest.json',target/'data/manifest.json')
            class Request:
                async def json(self):return {'id':'bundled-deck','restorePtz':False}
            with patch.object(server,'ROOT',training),patch.object(server,'training_active',return_value=False),patch.object(server.runtime,'start') as start:
                run=server.completed_run('bundled-deck')
                self.assertEqual(Path(run['models']['labware']['weights']),target/'labware/weights/best.pt')
                asyncio.run(server.start(Request()))
                self.assertEqual(start.call_args.args[1],target/'calibration-fixed.jpg')

    def test_cpu_fallback(self):
        with patch.dict('os.environ',{'LAB_SENTRY_DEVICE':'auto'}),patch('torch.cuda.is_available',return_value=False):
            self.assertEqual(inference_device(),'cpu')

    def test_explicit_cpu_even_with_gpu(self):
        with patch.dict('os.environ',{'LAB_SENTRY_DEVICE':'cpu'}),patch('torch.cuda.is_available',return_value=True):
            self.assertEqual(inference_device(),'cpu')

    def test_unavailable_explicit_cuda_is_actionable(self):
        with patch.dict('os.environ',{'LAB_SENTRY_DEVICE':'cuda'}),patch('torch.cuda.is_available',return_value=False):
            with self.assertRaisesRegex(ValueError,'CPU|cpu'):inference_device()

    def test_bundled_weights_are_relative_and_exist(self):
        folder=Path(__file__).resolve().parents[1]/'bundled/deck'
        status=json.loads((folder/'status.json').read_text())
        self.assertEqual(set(status['models']),{'labware','slots'})
        for item in status['models'].values():
            self.assertFalse(Path(item['weights']).is_absolute())
            self.assertTrue((folder/item['weights']).is_file())

    def test_camera_drops_backlog(self):
        class Stream:
            def iter_content(self,n):
                yield b'\xff\xd8first\xff\xd9\xff\xd8latest\xff\xd9'
            def close(self):pass
        frames=list(latest_frames(Stream(),threading.Event()))
        self.assertEqual(frames[-1][0],b'\xff\xd8latest\xff\xd9')

if __name__=='__main__':unittest.main()
