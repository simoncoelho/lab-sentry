import time
import unittest
from runtime import Runtime, resolve_slots, unknown, alignment_quality
import numpy as np

POLYGONS = {'A1': [[.1,.1],[.3,.1],[.3,.3],[.1,.3]], 'A2': [[.4,.1],[.6,.1],[.6,.3],[.4,.3]]}

class ObservationTests(unittest.TestCase):
    def test_missing_detections_are_unknown_not_empty(self):
        states = resolve_slots([], [], POLYGONS, {})
        self.assertEqual(len(states), 12)
        self.assertTrue(all(s['state']=='unknown' for s in states))

    def test_low_confidence_empty_is_not_reported(self):
        states = resolve_slots([], [{'box':[.1,.1,.3,.3],'label':'empty','confidence':.6}], POLYGONS, {})
        self.assertEqual(states[0]['state'], 'unknown')

    def test_cropped_slot_cannot_be_called_empty(self):
        states = resolve_slots([], [{'box':[0,.1,.3,.3],'label':'empty','confidence':.99}], {'A1':[[-.1,.1],[.3,.1],[.3,.3],[-.1,.3]]}, {})
        self.assertEqual(states[0]['state'], 'unknown')

    def test_cropped_occupancy_requires_recognized_labware(self):
        states=resolve_slots([], [{'box':[0,.1,.3,.3],'label':'occupied','confidence':.99}], {'A1':[[-.1,.1],[.3,.1],[.3,.3],[-.1,.3]]}, {})
        self.assertEqual(states[0]['state'],'unknown')

    def test_confident_labware_overrides_empty(self):
        obj={'box':[.1,.1,.3,.3],'label':'Tip rack','confidence':.95}
        states=resolve_slots([obj],[{'box':obj['box'],'label':'empty','confidence':.9}],POLYGONS,{('Tip rack','A1'):[obj['box']]})
        self.assertEqual(states[0]['state'],'occupied')
        self.assertEqual(states[0]['label'],'Tip rack')

    def test_ambiguous_labware_not_assigned(self):
        obj={'box':[.1,.1,.3,.3],'label':'Tip rack','confidence':.95}
        states=resolve_slots([obj],[],POLYGONS,{('Tip rack','A1'):[obj['box']],('Tip rack','A2'):[obj['box']]})
        self.assertTrue(all(s['state']=='unknown' for s in states))

    def test_stale_camera_clears_previous_states(self):
        runtime=Runtime()
        runtime.state={'running':True,'timestamp':time.time()-10,'slots':[{'slot':'A1','state':'empty'}]}
        self.assertTrue(runtime.snapshot()['stale'])
        self.assertEqual(runtime.snapshot()['slots'],unknown('stale camera frame'))

class AlignmentTests(unittest.TestCase):
    def check_translation(self, distance, clustered=False, outliers=False):
        src=np.float32([[x,y] for x in [100,200,300,400,500] for y in [70,140,210,280]])
        if clustered:src=src*.1+100
        h=np.float64([[1,0,distance],[0,1,0],[0,0,1]])
        dst=src+np.float32([distance,0])
        mask=np.ones((len(src),1),dtype=np.uint8)
        if outliers:dst[:]=dst+10
        return alignment_quality(h,src,dst,mask)

    def test_supported_moderate_motion_is_corrected(self):
        self.assertTrue(self.check_translation(50)['ok'])

    def test_large_motion_stays_unknown(self):
        self.assertFalse(self.check_translation(90)['ok'])

    def test_clustered_or_inaccurate_matches_cannot_relax_gate(self):
        self.assertFalse(self.check_translation(50,clustered=True)['ok'])
        self.assertFalse(self.check_translation(50,outliers=True)['ok'])

if __name__=='__main__':unittest.main()
