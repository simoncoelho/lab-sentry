import json
from pathlib import Path
import tempfile
import unittest
from PIL import Image
from dataset import audit, SLOTS

class AuditTests(unittest.TestCase):
    def make_dataset(self, root):
        frames=[]
        for split,n in [('train',20),('val',10)]:
            (root/'images'/split).mkdir(parents=True);(root/'labels'/split).mkdir(parents=True)
            for i in range(n):
                image=root/f'images/{split}/{i}.png';Image.new('RGB',(1280,720),(i,50 if split=='train' else 100,0)).save(image)
                (root/f'labels/{split}/{i}.txt').write_text('0 .5 .5 .2 .2\n')
                frames.append({'path':f'images/{split}/{i}.png','split':split,'slotStates':[{'slot':s,'state':'unknown'} for s in SLOTS],'recipe':{'placements':[]}})
        manifest={'classes':[{'id':'plate','name':'Plate'}],'frames':frames}
        (root/'manifest.json').write_text(json.dumps(manifest));return manifest

    def test_cross_split_duplicates_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.make_dataset(root)
            (root/'images/val/0.png').write_bytes((root/'images/train/0.png').read_bytes())
            with self.assertRaisesRegex(ValueError,'different splits'):audit(root)

    def test_outside_boxes_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.make_dataset(root)
            (root/'labels/train/0.txt').write_text('0 .1 .5 .8 .2')
            with self.assertRaisesRegex(ValueError,'Invalid YOLO'):audit(root)

    def test_incomplete_deck_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);m=self.make_dataset(root);m['frames'][0]['slotStates'].pop()
            (root/'manifest.json').write_text(json.dumps(m))
            with self.assertRaisesRegex(ValueError,'twelve'):audit(root)

    def test_counts_and_supported_classes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.make_dataset(root);report=audit(root)[2]
            self.assertEqual(report['images'],{'train':20,'val':10})
            self.assertEqual(report['uniqueImages'],30)
            self.assertEqual(report['supportedClasses'],['Plate'])

if __name__=='__main__':unittest.main()
