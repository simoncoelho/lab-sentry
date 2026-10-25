"""Bounded latest-frame handoff: slow inference must not accumulate video lag."""
import threading
import time


def latest_frames(stream, stop):
    condition=threading.Condition()
    latest=None
    sequence=0
    finished=False
    failure=None
    closed=threading.Event()

    def read():
        nonlocal latest,sequence,finished,failure
        buffer=b''
        try:
            for chunk in stream.iter_content(16384):
                if stop.is_set() or closed.is_set():break
                buffer+=chunk
                while True:
                    a=buffer.find(b'\xff\xd8');b=buffer.find(b'\xff\xd9',a+2)
                    if a<0 or b<0:break
                    frame=buffer[a:b+2];buffer=buffer[b+2:]
                    with condition:
                        latest=(frame,time.time());sequence+=1;condition.notify_all()
                if len(buffer)>8*1024*1024:raise ValueError('Invalid or oversized MJPEG frame')
        except Exception as error:failure=error
        finally:
            with condition:finished=True;condition.notify_all()

    reader=threading.Thread(target=read,daemon=True,name='latest-camera-frame');reader.start()
    seen=0
    try:
        while not stop.is_set():
            with condition:
                condition.wait_for(lambda:sequence!=seen or finished or stop.is_set(),timeout=.5)
                if stop.is_set():break
                if sequence==seen:
                    if failure:raise failure
                    if finished:break
                    continue
                frame=latest;seen=sequence
            yield frame
    finally:
        closed.set()
        stream.close()
        reader.join(timeout=1)
