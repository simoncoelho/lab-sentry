"""Single-layout diagnostic, deliberately separate from synthetic validation."""
import argparse
import json
from pathlib import Path
from ultralytics import YOLO
from runtime import overlap

def evaluate(weights, image, labels, destination, held_out_layout=False):
    truth=json.loads(Path(labels).read_text(encoding='utf8'))
    pred=YOLO(str(weights)).predict(str(image),imgsz=960,conf=.5,device=0,verbose=False)[0]
    detected=[{'label':pred.names[int(k)],'box':b,'confidence':float(c)} for b,c,k in zip(pred.boxes.xyxy.cpu().tolist(),pred.boxes.conf.cpu().tolist(),pred.boxes.cls.cpu().tolist())]
    used=set();matches=[]
    for obj in sorted(detected,key=lambda o:-o['confidence']):
        candidates=sorted([(overlap(obj['box'],target['box']),i) for i,target in enumerate(truth['objects']) if i not in used and target['label']==obj['label']],reverse=True)
        if candidates and candidates[0][0]>=.5:
            score,i=candidates[0];used.add(i);matches.append({'slot':truth['objects'][i]['slot'],'iou':score,'confidence':obj['confidence']})
    report={'scope':'One real-camera layout; manual approximate boxes. Diagnostic only, not deployment validation.', 'threshold':.5,'iouThreshold':.5,'truePositive':len(matches),'falsePositive':len(detected)-len(matches),'falseNegative':len(truth['objects'])-len(matches),'precision':len(matches)/max(1,len(detected)),'recall':len(matches)/len(truth['objects']),'matches':matches,'missed':[t for i,t in enumerate(truth['objects']) if i not in used],'detections':detected}
    status_file=Path(weights).resolve().parents[2]/'status.json'
    adapted=status_file.exists() and json.loads(status_file.read_text()).get('realAdaptation')
    report['evaluationKind']='held-out physical layout (single-layout diagnostic)' if held_out_layout else 'training-reference-fit (not held out)' if adapted else 'single-layout real diagnostic'
    destination=Path(destination);destination.parent.mkdir(parents=True,exist_ok=True)
    destination.write_text(json.dumps(report,indent=2),encoding='utf8');pred.save(str(destination.with_suffix('.jpg')))
    print(json.dumps(report,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--weights',required=True);p.add_argument('--image',required=True);p.add_argument('--labels',required=True);p.add_argument('--output',required=True);p.add_argument('--held-out-layout',action='store_true');a=p.parse_args()
    evaluate(a.weights,a.image,a.labels,a.output,a.held_out_layout)
