"""SSE latest-state stream: full snapshots, bounded memory, automatic resync."""
import asyncio
import json
import time
from state_api import deck_state

def state_key(value):
    return json.dumps({k:v for k,v in value.items() if k != 'ageMs'}, sort_keys=True)

async def state_events(snapshot, disconnected):
    previous = None
    sent = 0.
    yield 'retry: 1000\n\n'
    while not await disconnected():
        value = deck_state(snapshot())
        key = state_key(value)
        now = time.monotonic()
        # Send every new inference plus periodic full snapshots while idle.
        # No per-client frame queue: slow clients receive the latest state.
        if key != previous or now-sent >= 2:
            yield 'event: state\ndata: ' + json.dumps(value, separators=(',', ':')) + '\n\n'
            previous = key
            sent = now
        await asyncio.sleep(.05)
