"""Conservative, fixed-view deck observations. Missing evidence stays unknown."""
import json
import threading
import time
from pathlib import Path
import cv2
import numpy as np
import requests
from dataset import SLOTS

def overlap(a, b):
    x = max(0., min(a[2],b[2])-max(a[0],b[0])); y = max(0., min(a[3],b[3])-max(a[1],b[1]))
    inter = x*y
    return inter / max(1e-9, (a[2]-a[0])*(a[3]-a[1])+(b[2]-b[0])*(b[3]-b[1])-inter)

def unknown(reason):
    return [{'slot':s,'state':'unknown','label':None,'confidence':0,'reason':reason} for s in SLOTS]

def resolve_slots(objects, observations, polygons, templates, confidence=.5):
    result = {s:dict(slot=s,state='unknown',label=None,confidence=0.,reason='no confident observation') for s in SLOTS}
    slot_boxes = {s:[max(0,min(p[0] for p in points)),max(0,min(p[1] for p in points)),min(1,max(p[0] for p in points)),min(1,max(p[1] for p in points))] for s,points in polygons.items()}
    # Greedy one-to-one assignment; ambiguous locations are never forced.
    used = set()
    for obs in sorted(observations, key=lambda x:-x['confidence']):
        scores = sorted([(overlap(obs['box'],b),s) for s,b in slot_boxes.items()],reverse=True)
        if not scores or scores[0][0]<.35 or (len(scores)>1 and scores[0][0]-scores[1][0]<.08): continue
        slot = scores[0][1]
        if slot in used: continue
        used.add(slot)
        if obs['confidence'] < (.7 if obs['label']=='empty' else confidence): continue
        full = all(0<=x<=1 and 0<=y<=1 for x,y in polygons[slot])
        if not full and obs['label']!='unknown': continue
        result[slot].update(state=obs['label'],confidence=obs['confidence'],reason='slot detector')
    occupied = set()
    for obj in sorted(objects,key=lambda x:-x['confidence']):
        if obj['confidence']<confidence: continue
        scores=[]
        for slot in SLOTS:
            candidates=templates.get((obj['label'],slot),[])
            if candidates: scores.append((max(overlap(obj['box'],b) for b in candidates),slot))
        scores.sort(reverse=True)
        if not scores or scores[0][0]<.25 or (len(scores)>1 and scores[0][0]-scores[1][0]<.08):
            for score, candidate in scores:
                if score >= .25 and result[candidate]['state']=='empty':
                    result[candidate].update(state='unknown',confidence=0.,reason='ambiguous labware near slot')
            continue
        slot=scores[0][1]
        if slot in occupied:
            result[slot].update(state='unknown',label=None,reason='multiple labware candidates'); continue
        occupied.add(slot)
        result[slot].update(state='occupied',label=obj['label'],confidence=obj['confidence'],reason='labware detector + calibrated slot geometry')
        obj['slot']=slot
    return [result[s] for s in SLOTS]

def moving_slots(previous, current, polygons):
    """Local motion in rectified deck coordinates must not invalidate other slots."""
    if previous is None:return set(polygons)
    changed=cv2.absdiff(current,previous)>25
    height,width=current.shape
    moving=set()
    for slot,points in polygons.items():
        mask=np.zeros(current.shape,np.uint8)
        cv2.fillPoly(mask,[np.int32([[x*width,y*height] for x,y in points])],1)
        area=int(mask.sum())
        if area and float(np.count_nonzero(changed & (mask>0)))/area>.025:moving.add(slot)
    return moving

def settle_slots(slots, last_motion, now):
    return [dict(slot=item['slot'],state='unknown',label=None,confidence=0.,reason='motion in slot; waiting to settle')
            if now-last_motion.get(item['slot'],-float('inf'))<.8 else item for item in slots]

def alignment_quality(h, src, dst, mask):
    """Accept moderate PTZ drift only when landmarks support a stable correction."""
    corners=np.float32([[[80,60],[560,60],[560,330],[80,330]]])
    moved=cv2.perspectiveTransform(corners,h)
    drift=float(np.max(np.linalg.norm(moved-corners,axis=2)))
    inliers=mask.ravel().astype(bool)
    count=int(inliers.sum())
    projected=cv2.perspectiveTransform(src.reshape(1,-1,2),h)[0]
    error=float(np.median(np.linalg.norm(projected[inliers]-dst[inliers],axis=1))) if count else float('inf')
    span=np.ptp(src[inliers],axis=0) if count else np.zeros(2)
    supported=count>=16 and count/len(src)>=.45 and error<=2.5 and span[0]>=160 and span[1]>=90
    ok=bool(np.isfinite(h).all() and drift<72 and (drift<24 or supported))
    return {'ok':ok,'driftPixels':round(drift,1),'inliers':count,
            'reason':'matched; PTZ drift corrected' if ok else 'camera view changed'}

class Runtime:
    def __init__(self):
        self.lock=threading.Lock(); self.stop_event=threading.Event(); self.thread=None
        self.state={'running':False,'slots':unknown('not running')}; self.jpeg=None; self.raw_jpeg=None

    def snapshot(self):
        with self.lock: state=dict(self.state)
        if state.get('running') and time.time()-state.get('timestamp',0)>5:
            state.update(slots=unknown('stale camera frame'),stale=True)
        return state

    def stop(self):
        self.stop_event.set()
        if self.thread: self.thread.join(timeout=15)
        with self.lock: self.state.update(running=False,slots=unknown('not running'))

    def start(self, status, reference, restore_ptz=True):
        if self.thread and self.thread.is_alive(): raise ValueError('Runtime already running')
        self.stop_event.clear()
        with self.lock: self.state={'running':True,'timestamp':time.time(),'slots':unknown('warming up'),'model':status['id']}
        self.thread=threading.Thread(target=self.loop,args=(status,reference,restore_ptz),daemon=True);self.thread.start()

    def loop(self, status, reference, restore_ptz=True):
        try:
            from ultralytics import YOLO
            import torch
            torch.set_num_threads(6)
            models={k:YOLO(v['weights']) for k,v in status['models'].items()}
            run_dir=Path(status['models']['labware']['weights']).parents[2]
            manifest=json.loads((run_dir/'data/manifest.json').read_text(encoding='utf8'))
            polygons={};templates={};names={c['id']:c['name'] for c in manifest['classes']}
            for frame in manifest['frames']:
                for s in frame.get('slotStates',[]):
                    if s.get('polygon'):polygons[s['slot']]=[[x/1280,y/720] for x,y in s['polygon']]
                for d in frame.get('detections',[]):
                    if d.get('box') and not d.get('review') and d.get('visibility',1)>=.5:
                        x,y,w,h=d['box'];templates.setdefault((names.get(d['classId']),d['slot']),[]).append([x,y,x+w,y+h])
            ref=cv2.imread(str(reference),0) if reference else None
            sift=cv2.SIFT_create(nfeatures=1500)
            refkp,refdesc=sift.detectAndCompute(ref,None) if ref is not None else ([],None)
            with requests.get('http://127.0.0.1:5100/obsbot/video.mjpeg?orientation=none',stream=True,timeout=(5,12)) as stream:
                stream.raise_for_status()
                ptz=manifest['runs'][0]['context']['view'].get('cameraPtz')
                if not ptz: raise ValueError('Dataset has no saved hardware PTZ')
                requests.post('http://127.0.0.1:5101/connect',json={},timeout=8).raise_for_status()
                if restore_ptz:
                    requests.post('http://127.0.0.1:5101/target',json={k:ptz[k] for k in ['pan','tilt','zoom']},timeout=8).raise_for_status()
                buffer=b'';last=0;started=time.time();alignment={'ok':False,'reason':'settling camera'};previous_gray=None;last_motion={}
                for chunk in stream.iter_content(16384):
                    if self.stop_event.is_set():break
                    buffer+=chunk; a=buffer.find(b'\xff\xd8');b=buffer.find(b'\xff\xd9',a+2)
                    while a>=0 and b>=0:
                        encoded=buffer[a:b+2];buffer=buffer[b+2:];a=buffer.find(b'\xff\xd8');b=buffer.find(b'\xff\xd9',a+2)
                        if time.time()-last<.25:continue
                        last=time.time();image=cv2.imdecode(np.frombuffer(encoded,np.uint8),cv2.IMREAD_COLOR)
                        if image is None:continue
                        if last-started<5:continue
                        gray=cv2.resize(cv2.cvtColor(image,cv2.COLOR_BGR2GRAY),(640,360))
                        kp,desc=sift.detectAndCompute(gray,None)
                        alignment={'ok':False,'reason':'reference landmarks unavailable'}; view_transform=None
                        if refdesc is not None and desc is not None and len(desc)>=2:
                            pairs=cv2.BFMatcher().knnMatch(refdesc,desc,k=2);good=[m for pair in pairs if len(pair)==2 for m,n in [pair] if m.distance<.7*n.distance]
                            if len(good)>=12:
                                src=np.float32([refkp[m.queryIdx].pt for m in good]);dst=np.float32([kp[m.trainIdx].pt for m in good])
                                h,mask=cv2.findHomography(src,dst,cv2.RANSAC,3)
                                if h is not None and mask is not None and mask.sum()>=12:
                                    alignment=alignment_quality(h,src,dst,mask)
                                    if alignment['ok']:view_transform=h
                        # Correct supported PTZ drift before using fixed-view geometry.
                        inference_image=cv2.warpPerspective(cv2.resize(image,(640,360)),np.linalg.inv(view_transform),(640,360)) if view_transform is not None else image
                        observed_gray=cv2.GaussianBlur(cv2.cvtColor(cv2.resize(inference_image,(640,360)),cv2.COLOR_BGR2GRAY),(5,5),0)
                        if alignment['ok']:
                            for slot in moving_slots(previous_gray,observed_gray,polygons):last_motion[slot]=last
                            previous_gray=observed_gray
                        else:
                            previous_gray=None
                        detections={}
                        for task,model in models.items():
                            pred=model.predict(inference_image,imgsz=960,conf=.25,device=0,verbose=False)[0]
                            detections[task]=[{'box':b,'confidence':float(c),'label':pred.names[int(k)]} for b,c,k in zip(pred.boxes.xyxyn.cpu().tolist(),pred.boxes.conf.cpu().tolist(),pred.boxes.cls.cpu().tolist())]
                        observations=detections['slots']
                        if view_transform is not None:
                            # Mask slot-only evidence for positions partly outside the actual camera frame.
                            visible_slots={}
                            for slot, points in polygons.items():
                                live=cv2.perspectiveTransform(np.float32([[[x*640,y*360] for x,y in points]]),view_transform)[0]
                                if all(0<=x<=640 and 0<=y<=360 for x,y in live):visible_slots[slot]=points
                            slots=resolve_slots(detections['labware'],observations,visible_slots,templates) if alignment['ok'] else unknown(alignment['reason'])
                        else:
                            slots=unknown(alignment['reason'])
                        if alignment['ok']:
                            slots=settle_slots(slots,last_motion,last)
                            moving={item['slot'] for item in slots if item['reason']=='motion in slot; waiting to settle'}
                            for obj in detections['labware']:
                                if obj.get('slot') in moving:obj.pop('slot',None)
                        height,width=image.shape[:2]
                        for obj in detections['labware']:
                            box=obj['box']
                            if view_transform is not None:
                                x1,y1,x2,y2=box
                                corners=np.float32([[[x1*640,y1*360],[x2*640,y1*360],[x2*640,y2*360],[x1*640,y2*360]]])
                                moved=cv2.perspectiveTransform(corners,view_transform)[0]
                                box=[float(moved[:,0].min()/640),float(moved[:,1].min()/360),float(moved[:,0].max()/640),float(moved[:,1].max()/360)]
                            obj['liveBox']=box
                            x1,y1,x2,y2=[int(v*(width if i%2==0 else height)) for i,v in enumerate(box)]
                            cv2.rectangle(image,(x1,y1),(x2,y2),(98,218,153),2)
                            label = f'{obj["label"]} {obj["confidence"]:.0%}'
                            if obj.get('slot'): label = f'{obj["slot"]} | {label}'
                            (tw,th),baseline=cv2.getTextSize(label,cv2.FONT_HERSHEY_SIMPLEX,.4,1)
                            tx=max(0,min(x1,width-tw-8));ty=max(th+8,min(y1-4,height-baseline-2))
                            cv2.rectangle(image,(tx,ty-th-6),(tx+tw+8,ty+baseline+2),(20,32,27),-1)
                            cv2.putText(image,label,(tx+4,ty-2),cv2.FONT_HERSHEY_SIMPLEX,.4,(170,239,201),1,cv2.LINE_AA)
                        ok,jpeg=cv2.imencode('.jpg',image)
                        if self.stop_event.is_set():break
                        with self.lock:
                            self.raw_jpeg=encoded
                            self.jpeg=jpeg.tobytes() if ok else None
                            self.state={'running':True,'timestamp':time.time(),'model':status['id'],'alignment':alignment,'slots':slots,'objects':detections['labware'],'warning':'Synthetic-trained baseline. Real-world validation pending.'}
        except Exception as error:
            with self.lock:self.state.update(running=False,error=str(error),slots=unknown(str(error)))
        finally:
            with self.lock:
                if self.state.get('running'):
                    reason='stopped' if self.stop_event.is_set() else 'Camera stream ended. Run detection to reconnect.'
                    self.state.update(running=False,error=None if self.stop_event.is_set() else reason,slots=unknown(reason))
