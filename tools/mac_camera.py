"""macOS replacement for the Windows camera services (obsbot-control video on
5100 and camera-bridge controls on 5101), with the same HTTP API.

Video: AVFoundation capture (as Photo Booth does), served as MJPEG at
  GET http://127.0.0.1:5100/obsbot/video.mjpeg?orientation=none
  OpenCV's own macOS capture receives only black frames from the OBSBOT Tiny SE,
  so OpenCV is used here just to resize and JPEG-encode.
Controls: standard USB Video Class camera-terminal requests (absolute pan/tilt
and zoom), served at http://127.0.0.1:5101 as /state, /connect, /target, /stop.

Pan/tilt are exchanged in degrees like DirectShow; UVC uses arc-seconds.
LAB_SENTRY_CAMERA selects the camera by index or name (default: first device
whose name contains OBSBOT and not Virtual).
"""
import json
import os
import struct
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

import cv2
import numpy as np

WIDTH, HEIGHT, JPEG_QUALITY = 640, 360, 85
STALL_SECONDS = 3  # restart the capture session after this long without a frame
RECOVERY_SECONDS = 15  # keep restarting a stalled camera this long before failing
ALLOWED_ORIGINS = {"http://127.0.0.1:5173", "http://localhost:5173"}


def camera_devices():
    import AVFoundation
    return list(AVFoundation.AVCaptureDevice.devicesWithMediaType_(AVFoundation.AVMediaTypeVideo))


def camera_names():
    return [str(d.localizedName()) for d in camera_devices()]


def ensure_camera_access():
    """Ask macOS for camera permission on the main thread (the prompt needs a run loop)."""
    import AVFoundation
    from Foundation import NSDate, NSRunLoop
    media = AVFoundation.AVMediaTypeVideo
    status = AVFoundation.AVCaptureDevice.authorizationStatusForMediaType_(media)
    if status == 0:  # not determined: show the system prompt and wait for the answer
        answer = []
        AVFoundation.AVCaptureDevice.requestAccessForMediaType_completionHandler_(media, lambda granted: answer.append(granted))
        while not answer:
            NSRunLoop.currentRunLoop().runUntilDate_(NSDate.dateWithTimeIntervalSinceNow_(0.1))
        status = 3 if answer[0] else 2
    if status != 3:
        print("Camera access is not allowed. Enable it for this terminal app in System Settings > "
              "Privacy & Security > Camera, then restart.", flush=True)


def find_camera():
    """(AVCaptureDevice, name): LAB_SENTRY_CAMERA by index or name, else the first physical OBSBOT."""
    wanted = os.environ.get("LAB_SENTRY_CAMERA", "")
    devices = camera_devices()
    names = [str(d.localizedName()) for d in devices]
    if wanted.isdigit() and int(wanted) < len(devices):
        return devices[int(wanted)], names[int(wanted)]
    for device, name in zip(devices, names):
        if (wanted.lower() in name.lower() if wanted else "obsbot" in name.lower()) and "virtual" not in name.lower():
            return device, name
    raise RuntimeError(f"No physical OBSBOT camera found. Connect it by USB. Cameras seen: {', '.join(names) or 'none'}")


_receiver_class = None


def frame_receiver(callback):
    """AVCaptureVideoDataOutput delegate that hands each BGRA frame to callback as a BGR array."""
    global _receiver_class
    if _receiver_class is None:
        import CoreMedia
        import objc
        import Quartz
        from Foundation import NSObject

        class FrameReceiver(NSObject):
            def initWithCallback_(self, cb):
                self = objc.super(FrameReceiver, self).init()
                self.cb = cb
                return self

            def captureOutput_didOutputSampleBuffer_fromConnection_(self, output, buffer, connection):
                image = CoreMedia.CMSampleBufferGetImageBuffer(buffer)
                Quartz.CVPixelBufferLockBaseAddress(image, 0)
                try:
                    height, width = Quartz.CVPixelBufferGetHeight(image), Quartz.CVPixelBufferGetWidth(image)
                    row = Quartz.CVPixelBufferGetBytesPerRow(image)
                    raw = Quartz.CVPixelBufferGetBaseAddress(image).as_buffer(row * height)
                    bgra = np.frombuffer(raw, np.uint8).reshape(height, row)[:, :width * 4].reshape(height, width, 4)
                    frame = cv2.cvtColor(bgra, cv2.COLOR_BGRA2BGR)  # copies before the buffer is unlocked
                finally:
                    Quartz.CVPixelBufferUnlockBaseAddress(image, 0)
                self.cb(frame)

        _receiver_class = FrameReceiver
    return _receiver_class.alloc().initWithCallback_(callback)


class Video:
    """One capture shared by all MJPEG clients; opened on demand, released when idle."""

    def __init__(self):
        self.cond = threading.Condition()
        self.frame, self.sequence, self.clients, self.error = None, 0, 0, None
        self.thread, self.last_frame_at = None, 0

    def subscribe(self):
        with self.cond:
            self.clients += 1
            if self.thread is None or not self.thread.is_alive():
                self.error = None
                self.thread = threading.Thread(target=self._capture, daemon=True, name="capture")
                self.thread.start()

    def unsubscribe(self):
        with self.cond:
            self.clients -= 1

    def next_frame(self, seen, timeout=RECOVERY_SECONDS + 5):
        with self.cond:
            self.cond.wait_for(lambda: self.sequence != seen or self.error, timeout)
            if self.error:
                raise RuntimeError(self.error)
            if self.sequence == seen:
                raise TimeoutError("Camera produced no frames")
            return self.frame, self.sequence

    def _on_frame(self, image):
        """Called on the capture queue for every camera frame."""
        self.last_frame_at = time.time()
        if image.shape[1] != WIDTH or image.shape[0] != HEIGHT:
            image = cv2.resize(image, (WIDTH, HEIGHT), interpolation=cv2.INTER_AREA)
        ok, jpeg = cv2.imencode(".jpg", image, [cv2.IMWRITE_JPEG_QUALITY, JPEG_QUALITY])
        if ok:
            with self.cond:
                self.frame, self.sequence = jpeg.tobytes(), self.sequence + 1
                self.cond.notify_all()

    def _start(self, device, name):
        import AVFoundation as AV
        import libdispatch
        import Quartz
        session = AV.AVCaptureSession.alloc().init()
        if session.canSetSessionPreset_(AV.AVCaptureSessionPreset1280x720):
            session.setSessionPreset_(AV.AVCaptureSessionPreset1280x720)  # 16:9 like 640x360; less to resize
        device_input, error = AV.AVCaptureDeviceInput.deviceInputWithDevice_error_(device, None)
        if device_input is None or not session.canAddInput_(device_input):
            raise RuntimeError(f"Could not open {name}: {error.localizedDescription() if error else 'in use'}. Allow camera "
                               "access for this terminal app (System Settings > Privacy & Security > Camera).")
        session.addInput_(device_input)
        output = AV.AVCaptureVideoDataOutput.alloc().init()
        output.setVideoSettings_({Quartz.kCVPixelBufferPixelFormatTypeKey: Quartz.kCVPixelFormatType_32BGRA})
        output.setAlwaysDiscardsLateVideoFrames_(True)
        receiver = frame_receiver(self._on_frame)  # the output holds its delegate weakly: keep a reference
        output.setSampleBufferDelegate_queue_(receiver, libdispatch.dispatch_queue_create(b"lab-sentry-camera", None))
        session.addOutput_(output)
        session.startRunning()
        return session, receiver

    def _capture(self):
        session = None
        try:
            # The OBSBOT sleeps as soon as nothing streams; while waking it can
            # stall. Restart the session after a stall and keep clients
            # connected; give up only after RECOVERY_SECONDS without frames.
            last_good, idle_since = time.time(), None
            while True:
                with self.cond:
                    if self.clients <= 0:
                        idle_since = idle_since or time.time()
                        if time.time() - idle_since > 5:
                            return
                    else:
                        idle_since = None
                if session is None:
                    device, name = find_camera()
                    self.last_frame_at = 0
                    session, receiver = self._start(device, name)
                    started_at = time.time()
                    print(f"video: started {name}", flush=True)
                last_good = max(last_good, self.last_frame_at)
                if time.time() - max(self.last_frame_at, started_at) > STALL_SECONDS:
                    session.stopRunning()
                    session = None
                    if time.time() - last_good > RECOVERY_SECONDS:
                        raise RuntimeError(f"{name} stopped delivering frames")
                    print(f"video: no frame from {name} for {STALL_SECONDS} s; restarting", flush=True)
                time.sleep(0.2)
        except Exception as e:
            with self.cond:
                self.error = str(e)
                self.cond.notify_all()
        finally:
            if session is not None:
                session.stopRunning()


# USB Video Class requests (UVC 1.5, section 4.2.2.1)
SET_CUR, GET_CUR, GET_MIN, GET_MAX, GET_RES = 0x01, 0x81, 0x82, 0x83, 0x84
CT_ZOOM_ABSOLUTE, CT_PANTILT_ABSOLUTE = 0x0B, 0x0D
ARCSEC = 3600


class Uvc:
    """Camera-terminal controls over the device's control endpoint. No interface
    is claimed, so macOS keeps streaming video from the same camera."""

    def __init__(self, device, interface, terminal, name):
        self.device, self.interface, self.terminal, self.name = device, interface, terminal, name

    @classmethod
    def find(cls):
        import libusb_package
        import usb.core
        import usb.util
        backend = libusb_package.get_libusb1_backend()
        for dev in usb.core.find(find_all=True, backend=backend):
            try:
                name = usb.util.get_string(dev, dev.iProduct) or ""
            except Exception:
                continue
            if "obsbot" not in name.lower() or "virtual" in name.lower():
                continue
            for cfg in dev:
                for intf in cfg:
                    if intf.bInterfaceClass == 0x0E and intf.bInterfaceSubClass == 0x01:  # video control
                        terminal = cls._camera_terminal(bytes(intf.extra_descriptors))
                        if terminal is not None:
                            return cls(dev, intf.bInterfaceNumber, terminal, name)
        raise RuntimeError("No physical OBSBOT camera found. Connect it by USB.")

    @staticmethod
    def _camera_terminal(extra):
        i = 0
        while i + 2 < len(extra):
            length, kind, subtype = extra[i], extra[i + 1], extra[i + 2]
            if length == 0:
                break
            # CS_INTERFACE / VC_INPUT_TERMINAL with wTerminalType ITT_CAMERA
            if kind == 0x24 and subtype == 0x02 and struct.unpack_from("<H", extra, i + 4)[0] == 0x0201:
                return extra[i + 3]
            i += length
        return None

    # pyusb's Device.ctrl_transfer claims the addressed interface first, which
    # macOS refuses because its camera driver owns it. UVC requests go over the
    # default control endpoint and need no claim, so call the backend directly.
    def _transfer(self, request_type, request, selector, data_or_length):
        import array
        import usb.util
        ctx = self.device._ctx
        ctx.managed_open()
        buffer = usb.util.create_buffer(data_or_length) if isinstance(data_or_length, int) else array.array("B", data_or_length)
        count = ctx.backend.ctrl_transfer(ctx.handle, request_type, request, selector << 8,
                                          (self.terminal << 8) | self.interface, buffer, 1000)
        return bytes(buffer[:count])

    def _get(self, request, selector, size):
        return self._transfer(0xA1, request, selector, size)

    def _set(self, selector, data):
        self._transfer(0x21, SET_CUR, selector, data)

    def pantilt(self, request=GET_CUR):
        pan, tilt = struct.unpack("<ii", self._get(request, CT_PANTILT_ABSOLUTE, 8))
        return pan / ARCSEC, tilt / ARCSEC

    def set_pantilt(self, pan, tilt):
        self._set(CT_PANTILT_ABSOLUTE, struct.pack("<ii", round(pan * ARCSEC), round(tilt * ARCSEC)))

    def zoom(self, request=GET_CUR):
        return struct.unpack("<H", self._get(request, CT_ZOOM_ABSOLUTE, 2))[0]

    def set_zoom(self, value):
        self._set(CT_ZOOM_ABSOLUTE, struct.pack("<H", value))

    def ranges(self):
        lo, hi, res = self.pantilt(GET_MIN), self.pantilt(GET_MAX), self.pantilt(GET_RES)
        out = {"Pan": {"min": round(lo[0]), "max": round(hi[0]), "step": max(1, round(res[0]))},
               "Tilt": {"min": round(lo[1]), "max": round(hi[1]), "step": max(1, round(res[1]))}}
        try:
            out["Zoom"] = {"min": self.zoom(GET_MIN), "max": self.zoom(GET_MAX), "step": max(1, self.zoom(GET_RES))}
        except Exception:
            pass  # zoom is optional, as in the Windows bridge
        return out


class Controls:
    """Same behaviour as camera-bridge: one active move, one replaceable target."""

    def __init__(self):
        self.lock = threading.Lock()
        self.uvc, self.ranges, self.last_error = None, {}, None
        self.target, self.version, self.moving, self.motion_error = None, 0, False, None
        self.wake = threading.Event()
        threading.Thread(target=self._mover, daemon=True, name="motion").start()

    def state(self):
        if self.uvc is None:
            return {"isConnected": False, "controls": {}, "lastError": self.last_error}
        controls = {}
        try:
            pan, tilt = self.uvc.pantilt()
            controls["Pan"] = {"value": round(pan), "range": self.ranges["Pan"]}
            controls["Tilt"] = {"value": round(tilt), "range": self.ranges["Tilt"]}
            if "Zoom" in self.ranges:
                controls["Zoom"] = {"value": self.uvc.zoom(), "range": self.ranges["Zoom"]}
        except Exception as e:
            self.uvc, self.last_error = None, f"Camera disconnected: {e}"
            return {"isConnected": False, "controls": {}, "lastError": self.last_error}
        return {"isConnected": True, "device": {"displayName": self.uvc.name}, "controls": controls,
                "lastError": self.last_error}

    def connect(self):
        self.uvc = Uvc.find()
        self.ranges = self.uvc.ranges()
        self.last_error = None
        return self.state()

    def set_target(self, pan, tilt, zoom):
        if self.uvc is None:
            raise ValueError("Connect camera controls first.")
        for kind, value in (("Pan", pan), ("Tilt", tilt)) + ((("Zoom", zoom),) if zoom is not None else ()):
            r = self.ranges.get(kind)
            if r is None or not isinstance(value, int) or not r["min"] <= value <= r["max"] or (value - r["min"]) % r["step"]:
                raise ValueError(f"{kind} is outside the hardware range or step.")
        with self.lock:
            self.version += 1
            self.target, self.moving, self.motion_error = (pan, tilt, zoom), True, None
        self.wake.set()

    def stop(self):
        with self.lock:
            self.version += 1
            self.target, self.moving, self.motion_error = None, False, None
        if self.uvc is not None:
            try:  # absolute control has no stop request: hold the current position
                self.uvc.set_pantilt(*self.uvc.pantilt())
            except Exception as e:
                self.last_error = str(e)
        return self.state()

    def _mover(self):
        while True:
            self.wake.wait()
            self.wake.clear()
            with self.lock:
                version, target = self.version, self.target
            if target is None:
                continue
            pan, tilt, zoom = target
            error = None
            try:
                if zoom is not None and zoom != self.uvc.zoom():
                    self.uvc.set_zoom(zoom)
                deadline, stable, last_send = time.time() + 8, 0, 0
                while True:
                    if self.version != version:
                        break
                    if time.time() - last_send > 0.5:  # re-send: some firmware stops short of a single setpoint
                        self.uvc.set_pantilt(pan, tilt)
                        last_send = time.time()
                    time.sleep(0.04)
                    now_pan, now_tilt = self.uvc.pantilt()
                    stable = stable + 1 if abs(now_pan - pan) <= 2 and abs(now_tilt - tilt) <= 2 else 0
                    if stable >= 2:
                        break
                    if time.time() > deadline:
                        error = f"Camera did not reach pan {pan}, tilt {tilt} within 8 s"
                        break
            except Exception as e:
                error = str(e)
            with self.lock:
                if self.version == version:
                    self.moving, self.motion_error = False, error


video, controls = Video(), Controls()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *args):
        pass

    def send_json(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def allowed(self):
        origin = self.headers.get("Origin", "")
        if origin and origin not in ALLOWED_ORIGINS:
            return False
        return self.command != "POST" or self.headers.get("Content-Type", "").startswith("application/json")


class VideoHandler(Handler):
    def do_GET(self):
        if urlparse(self.path).path != "/obsbot/video.mjpeg":
            return self.send_json(404, {"error": "not found"})
        video.subscribe()
        try:
            self.send_response(200)
            self.send_header("Content-Type", "multipart/x-mixed-replace; boundary=frame")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Connection", "close")
            self.end_headers()
            seen = 0
            while True:
                frame, seen = video.next_frame(seen)
                self.wfile.write(b"--frame\r\nContent-Type: image/jpeg\r\nContent-Length: %d\r\n\r\n" % len(frame))
                self.wfile.write(frame + b"\r\n")
        except (BrokenPipeError, ConnectionResetError):
            pass
        except Exception as e:
            print(f"video: {e}", flush=True)
        finally:
            video.unsubscribe()
            self.close_connection = True


class ControlHandler(Handler):
    def do_GET(self):
        if not self.allowed():
            return self.send_json(403, {"error": "forbidden"})
        if self.path == "/state":
            return self.send_json(200, {"state": controls.state(),
                                        "motion": {"moving": controls.moving, "error": controls.motion_error}})
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if not self.allowed():
            return self.send_json(403, {"error": "forbidden"})
        length = int(self.headers.get("Content-Length") or 0)
        try:
            body = json.loads(self.rfile.read(length) or b"{}")
        except ValueError:
            return self.send_json(400, {"error": "invalid JSON"})
        try:
            if self.path == "/connect":
                return self.send_json(200, controls.connect())
            if self.path == "/target":
                controls.set_target(body.get("pan"), body.get("tilt"), body.get("zoom"))
                return self.send_json(202, {})
            if self.path == "/stop":
                return self.send_json(200, controls.stop())
        except ValueError as e:
            return self.send_json(400, {"error": str(e)})
        except RuntimeError as e:
            return self.send_json(404, {"error": str(e)})
        except Exception as e:
            return self.send_json(400, {"error": str(e)})
        self.send_json(404, {"error": "not found"})


def main():
    ensure_camera_access()
    servers = [ThreadingHTTPServer(("127.0.0.1", 5100), VideoHandler),
               ThreadingHTTPServer(("127.0.0.1", 5101), ControlHandler)]
    for s in servers:
        s.daemon_threads = True
        threading.Thread(target=s.serve_forever, daemon=True).start()
    print("Camera video on http://127.0.0.1:5100, controls on http://127.0.0.1:5101", flush=True)
    try:
        while True:
            time.sleep(3600)
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
