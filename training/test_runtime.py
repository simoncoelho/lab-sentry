import time
import unittest
from runtime import Runtime, resolve_slots, unknown

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

if __name__=='__main__':unittest.main()
