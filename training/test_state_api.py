import unittest
from state_api import deck_state

class StateApiTests(unittest.TestCase):
    def test_current_observation_and_all_positions(self):
        result=deck_state({'running':True,'timestamp':100,'model':'test','slots':[{'slot':'D1','state':'occupied','label':'Microplate','confidence':.9}]},102)
        self.assertTrue(result['fresh'])
        self.assertEqual(len(result['slots']),12)
        self.assertEqual(next(s for s in result['slots'] if s['slot']=='D1')['labware'],'Microplate')
        self.assertEqual(result['ageMs'],2000)

    def test_stale_stopped_and_error_clear_old_observations(self):
        for extra in [{'running':False}, {'running':True,'timestamp':90}, {'running':True,'error':'offline'}, {'running':True,'stale':True}]:
            result=deck_state({'timestamp':100,'slots':[{'slot':'A1','state':'occupied','label':'Tip rack','confidence':.9}],**extra},102)
            self.assertFalse(result['fresh'])
            self.assertTrue(all(s['state']=='unknown' and s['labware'] is None for s in result['slots']))

    def test_no_camera_yet(self):
        result=deck_state({},102)
        self.assertEqual(result['status'],'stopped')
        self.assertIsNone(result['observedAt'])

if __name__=='__main__': unittest.main()
