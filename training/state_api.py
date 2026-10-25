"""Stable public deck-state contract; stopped/stale observations are never current."""
from datetime import datetime, timezone
import time
from dataset import SLOTS

def deck_state(snapshot, now=None):
    now = time.time() if now is None else now
    timestamp = snapshot.get('timestamp')
    age = max(0, now-timestamp) if timestamp is not None else None
    fresh = bool(snapshot.get('running') and not snapshot.get('error') and not snapshot.get('stale') and age is not None and age <= 5)
    status = 'live' if fresh else 'error' if snapshot.get('error') else 'stale' if snapshot.get('running') else 'stopped'
    observations = {item['slot']: item for item in snapshot.get('slots', [])}
    slots = []
    for position in SLOTS:
        item = observations.get(position, {}) if fresh else {}
        slots.append({'slot': position, 'state': item.get('state', 'unknown'), 'labware': item.get('label'),
                      'confidence': item.get('confidence', 0), 'reason': item.get('reason', status if not fresh else 'no confident observation')})
    return {'schemaVersion': 1, 'instrument': 'opentrons-flex', 'modelId': snapshot.get('model'),
            'status': status, 'fresh': fresh, 'observedAt': datetime.fromtimestamp(timestamp, timezone.utc).isoformat() if timestamp else None,
            'ageMs': round(age*1000) if age is not None else None,
            'error': snapshot.get('error'), 'slots': slots}
