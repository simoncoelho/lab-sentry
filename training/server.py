"""Loopback-only training and inference service; datasets never leave this PC."""

import json

import os

from pathlib import Path

import subprocess

import sys

import tarfile

import time

import uuid

import io

import zipfile

from fastapi.responses import StreamingResponse

import psutil

from fastapi import FastAPI, HTTPException, Request

from fastapi.responses import Response

from dataset import audit

from runtime import Runtime
from state_api import deck_state
from state_stream import state_events
from fastapi.responses import JSONResponse



ROOT=Path(__file__).resolve().parent

DEFAULT=Path(os.environ.get('LAB_SENTRY_DATASET',str(Path.home()/'Downloads/lab-sentry-fixed-deck-2026-10-24/dataset')))

REFERENCE=DEFAULT.parent/'calibration-fixed.jpg'

app=FastAPI();runtime=Runtime();worker=None;selected_dataset=DEFAULT

selection_file=ROOT/'state.json'

if selection_file.exists():

    try:selected_dataset=Path(json.loads(selection_file.read_text())['dataset'])

    except (ValueError,KeyError):pass

audit_cache={}



def dataset_report():

    key=str(selected_dataset)

    if key not in audit_cache:audit_cache[key]=audit(selected_dataset)[2]

    return audit_cache[key]



@app.middleware('http')

async def loopback(request:Request,call_next):

    origin=request.headers.get('origin','')

    if request.client.host not in ('127.0.0.1','::1') or origin not in ('','http://127.0.0.1:5173','http://localhost:5173') or request.headers.get('host','').split(':')[0] not in ('127.0.0.1','localhost'):

        return Response('Loopback access only',403)

    return await call_next(request)



def runs():

    result=[]

    for file in (ROOT/'runs').glob('*/status.json'):

        try:

            item=json.loads(file.read_text(encoding='utf8'))

            if item.get('pid') and item['state'] in ('preparing','training') and not psutil.pid_exists(item['pid']):

                item.update(state='interrupted',error='Training process stopped; existing checkpoints are preserved')

            metadata=file.parent/'model.json'

            if metadata.exists():item['name']=json.loads(metadata.read_text(encoding='utf8')).get('name',item['id'])

            result.append(item)

        except (OSError,ValueError):pass

    return sorted(result,key=lambda s:s['started'],reverse=True)



def training_active():

    if worker is not None and worker.poll() is None:return True

    for run in runs():

        if run['state'] not in ('preparing','training') or not run.get('pid'):continue

        try:

            if str(ROOT/'train.py').lower() in ' '.join(psutil.Process(run['pid']).cmdline()).lower():return True

        except (psutil.NoSuchProcess,psutil.AccessDenied):pass

    return False



@app.get('/status')

def status():

    try: report=dataset_report()

    except Exception as e: report={'error':str(e)}

    return {'dataset':report,'runs':runs(),'training':training_active(),'runtime':runtime.snapshot()}



@app.post('/dataset')

async def upload(request:Request):

    global selected_dataset

    if training_active():raise HTTPException(409,'Training is active')

    if runtime.snapshot().get('running'):raise HTTPException(409,'Stop detection before replacing its dataset')

    if request.headers.get('content-type')!='application/x-tar':raise HTTPException(415,'Expected dataset tar')

    folder=ROOT/'data'/str(uuid.uuid4());folder.mkdir(parents=True)

    archive=folder/'upload.tar';size=0

    with archive.open('wb') as f:

        async for chunk in request.stream():

            size+=len(chunk)

            if size>2_000_000_000:raise HTTPException(413,'Dataset exceeds 2 GB')

            f.write(chunk)

    try:

        with tarfile.open(archive) as t:

            for member in t.getmembers():

                target=(folder/member.name).resolve()

                if not target.is_relative_to(folder.resolve()) or not member.isfile() or target==archive:raise ValueError('Unsafe archive member')

            t.extractall(folder,filter='data')

        report=audit(folder)[2]

    except Exception as error:raise HTTPException(400,str(error))

    selected_dataset=folder

    audit_cache[str(folder)]=report

    selection_file.write_text(json.dumps({'dataset':str(folder)}),encoding='utf8')

    return report



def completed_run(identifier):

    found=next((run for run in runs() if run['id']==identifier and run['state']=='complete'),None)

    if found is None:raise HTTPException(404,'Completed model not found')

    return found



@app.post('/models/{identifier}/save')

async def save_model(identifier:str,request:Request):

    run=completed_run(identifier)

    body=await request.json();name=body.get('name','')

    if not isinstance(name,str) or not 1<=len(name.strip())<=80:raise HTTPException(400,'Name must be 1–80 characters')

    path=ROOT/'runs'/run['id']/'model.json'

    temporary=path.with_suffix('.tmp')

    temporary.write_text(json.dumps({'name':name.strip(),'savedAt':time.time()}),encoding='utf8');os.replace(temporary,path)

    return {'saved':True}



@app.get('/models/{identifier}/download')

def download_model(identifier:str):

    run=completed_run(identifier);folder=(ROOT/'runs'/run['id']).resolve()

    output=io.BytesIO()

    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED) as archive:

        archive.writestr('model.json',json.dumps(run,indent=2))

        for task,model in run['models'].items():

            path=Path(model['weights']).resolve()

            if not path.is_relative_to(folder) or not path.is_file():raise HTTPException(400,'Model weights missing or unsafe')

            archive.write(path,f'{task}/best.pt')

        for relative in ('data/manifest.json','data/audit.json'):

            if (folder/relative).is_file():archive.write(folder/relative,relative)

    output.seek(0)

    return StreamingResponse(output,media_type='application/zip',headers={'Content-Disposition':f'attachment; filename="deck-model-{run["id"]}.zip"'})



@app.post('/train')

async def train(request:Request):

    global worker

    body=await request.json();epochs=body.get('epochs',100)

    if not isinstance(epochs,int) or not 10<=epochs<=300:raise HTTPException(400,'Epochs must be 10–300')

    if training_active():raise HTTPException(409,'Training already active')

    if runtime.snapshot().get('running'):raise HTTPException(409,'Stop detection before training')

    try:audit(selected_dataset)

    except Exception as error:raise HTTPException(400,str(error))

    name=time.strftime('%Y%m%d-%H%M%S');run=ROOT/'runs'/name

    command=[sys.executable,str(ROOT/'train.py'),'--dataset',str(selected_dataset),'--name',name,'--epochs',str(epochs)]

    if body.get('extraNoise',True) is False:command.append('--no-camera-noise')

    if body.get('realReference'):

        real=ROOT/'data/real-check'

        if not (real/'image.jpg').is_file() or not (real/'labels.json').is_file():raise HTTPException(400,'No reviewed real-camera reference available')

        expected=json.loads((DEFAULT/'manifest.json').read_text(encoding='utf8'))['runs'][0]['context']

        actual=json.loads((selected_dataset/'manifest.json').read_text(encoding='utf8'))

        if any(run['context']['workspace']!=expected['workspace'] or run['context']['view']!=expected['view'] for run in actual['runs']) or len({json.dumps(frame['cameraMatrix']) for frame in actual['frames']})!=1:

            raise HTTPException(400,'Reviewed reference does not match this dataset calibration')

        command.extend(['--real-reference',str(real)])

    run.mkdir(parents=True)

    log=(run/'console.log').open('w',encoding='utf8')

    worker=subprocess.Popen(command,cwd=ROOT,stdout=log,stderr=subprocess.STDOUT,creationflags=subprocess.CREATE_NO_WINDOW if os.name=='nt' else 0)

    log.close();return {'id':name}



@app.post('/runtime/start')

async def start(request:Request):

    if training_active():raise HTTPException(409,'Wait for training to finish')

    body=await request.json();complete=[r for r in runs() if r['state']=='complete' and (not body.get('id') or r['id']==body['id'])]

    if not complete:raise HTTPException(400,'No completed model')

    # A reference belongs to one calibration, not to whichever dataset was last uploaded.

    try:

        initial=json.loads((DEFAULT/'manifest.json').read_text(encoding='utf8'))

        trained=json.loads((Path(complete[0]['models']['labware']['weights']).parents[2]/'data/manifest.json').read_text(encoding='utf8'))

        expected=initial['runs'][0]['context']

        for run in trained['runs']:

            actual=run['context']

            if actual['workspace']!=expected['workspace'] or actual['view']!=expected['view']:

                raise ValueError('This model needs a matching real-camera reference for its workspace calibration')

        if len({json.dumps(f['cameraMatrix']) for f in trained['frames']})!=1:

            raise ValueError('Fixed-view detection requires a fixed-camera dataset')

        if not REFERENCE.is_file():raise ValueError('Matching real-camera reference is missing')

    except (ValueError,KeyError,OSError) as error:raise HTTPException(400,str(error))

    try:runtime.start(complete[0],REFERENCE,restore_ptz=body.get('restorePtz',True))

    except ValueError as e:raise HTTPException(409,str(e))

    return {'started':True}



@app.get('/api/v1/deck-state/stream')
async def public_state_stream(request: Request):
    return StreamingResponse(state_events(runtime.snapshot, request.is_disconnected), media_type='text/event-stream', headers={'Cache-Control':'no-cache, no-transform', 'X-Accel-Buffering':'no'})

@app.get('/api/v1/deck-state')
def public_deck_state():
    return JSONResponse(deck_state(runtime.snapshot()), headers={'Cache-Control':'no-store'})

@app.post('/runtime/stop')

def stop():runtime.stop();return {'stopped':True}



@app.get('/runtime/frame.jpg')

def frame():

    with runtime.lock:data=runtime.jpeg

    if not data:return Response(status_code=204)

    return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store'})



@app.get('/runtime/raw.jpg')

def raw_frame():

    with runtime.lock:data=runtime.raw_jpeg

    if not data:return Response(status_code=204)

    return Response(data,media_type='image/jpeg',headers={'Cache-Control':'no-store'})



if __name__=='__main__':

    import uvicorn

    uvicorn.run(app,host='127.0.0.1',port=5102)
