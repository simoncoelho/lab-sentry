import json
import unittest
from state_stream import state_events, state_key

class StreamTests(unittest.IsolatedAsyncioTestCase):
    async def test_initial_state_and_changed_state(self):
        value={'running':False}
        async def connected():return False
        stream=state_events(lambda:value,connected)
        self.assertIn('retry:',await anext(stream))
        initial=await anext(stream)
        self.assertIn('event: state',initial)
        data=json.loads(initial.split('data: ')[1])
        self.assertEqual(len(data['slots']),12)
        value['error']='camera offline'
        update=await anext(stream)
        self.assertIn('camera offline',update)
        await stream.aclose()

    async def test_disconnect_ends_generator(self):
        async def disconnected():return True
        stream=state_events(lambda:{},disconnected)
        await anext(stream)
        with self.assertRaises(StopAsyncIteration):await anext(stream)

    def test_age_alone_does_not_create_observation(self):
        self.assertEqual(state_key({'ageMs':1,'status':'live'}),state_key({'ageMs':50,'status':'live'}))
        self.assertNotEqual(state_key({'status':'live'}),state_key({'status':'stale'}))

if __name__=='__main__':unittest.main()
