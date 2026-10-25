"""Read-only LAN gateway. No training, camera, model files, or video routes."""
import argparse
import json
from state_api import deck_state
import requests
import uvicorn
from fastapi import FastAPI
from fastapi.responses import JSONResponse, StreamingResponse

app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
advertised_url = None

@app.get('/health')
def health():
    return {'service': 'lab-sentry-state', 'endpoint': advertised_url}

@app.get('/api/v1/deck-state')
def state():
    try:
        response = requests.get('http://127.0.0.1:5102/api/v1/deck-state', timeout=3)
        response.raise_for_status()
        return JSONResponse(response.json(), headers={'Cache-Control': 'no-store'})
    except (requests.RequestException, ValueError):
        return JSONResponse({'status': 'unavailable', 'fresh': False, 'error': 'Local detection service unavailable'}, status_code=503, headers={'Cache-Control': 'no-store'})

@app.get('/api/v1/deck-state/stream')
def stream():
    try:
        upstream = requests.get('http://127.0.0.1:5102/api/v1/deck-state/stream', stream=True, timeout=(3, 5))
        upstream.raise_for_status()
    except requests.RequestException:
        return JSONResponse({'status':'unavailable','fresh':False}, status_code=503)
    def relay():
        try:
            for line in upstream.iter_lines(chunk_size=1):
                yield line + b'\n'
        except requests.RequestException:
            yield ('event: state\ndata: '+json.dumps(deck_state({'error':'Local detection service unavailable'}))+'\n\n').encode()
        finally:
            upstream.close()
    return StreamingResponse(relay(), media_type='text/event-stream', headers={'Cache-Control':'no-cache, no-transform','X-Accel-Buffering':'no'})

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--host', required=True, help='LAN interface IPv4 address')
    parser.add_argument('--port', type=int, default=5103)
    args = parser.parse_args()
    advertised_url = f'http://{args.host}:{args.port}/api/v1/deck-state'
    uvicorn.run(app, host=args.host, port=args.port)
