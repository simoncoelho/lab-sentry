"""macOS counterpart of launch.py: one foreground owner for all local services.
Ctrl+C stops its children. The camera service replaces the Windows .NET video
(5100) and control (5101) services."""
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import time
import urllib.request
import webbrowser

ROOT = Path(__file__).resolve().parents[1]


def node_binary():
    import nodejs_wheel
    return str(Path(nodejs_wheel.__file__).parent / 'bin/node')


def main():
    if sys.platform != 'darwin':
        raise RuntimeError('This launcher is for macOS. On Windows use Start.cmd.')
    for port in (5100, 5101, 5102, 5173):
        with socket.socket() as sock:
            if sock.connect_ex(('127.0.0.1', port)) == 0:
                raise RuntimeError(f'Port {port} is already in use. Close the previous Lab Sentry launcher before starting again.')
    logs = ROOT / '.runtime/logs'
    logs.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env.setdefault('LAB_SENTRY_DEVICE', 'cpu')
    services = [
        ('camera', [sys.executable, str(ROOT / 'tools/mac_camera.py')], ROOT),
        ('inference', [sys.executable, str(ROOT / 'training/server.py')], ROOT / 'training'),
        ('web', [node_binary(), str(ROOT / 'device-designer/node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '5173', '--strictPort'], ROOT / 'device-designer'),
    ]
    children = []
    handles = []
    try:
        for name, command, cwd in services:
            handle = (logs / f'{name}.log').open('w', encoding='utf8')
            handles.append(handle)
            children.append((name, subprocess.Popen(command, cwd=cwd, env=env, stdout=handle, stderr=subprocess.STDOUT, start_new_session=True)))
        deadline = time.monotonic() + 120
        while True:
            for name, child in children:
                if child.poll() is not None:
                    raise RuntimeError(f'{name} stopped. See {logs / name}.log')
            try:
                for url in ('http://127.0.0.1:5101/state', 'http://127.0.0.1:5102/status', 'http://127.0.0.1:5173/'):
                    urllib.request.urlopen(url, timeout=2).close()
                break
            except (OSError, TimeoutError):
                if time.monotonic() > deadline:
                    raise RuntimeError(f'Startup timed out. See {logs}')
                time.sleep(1)
        print('Lab Sentry is ready: http://127.0.0.1:5173/\nOpen the included Flex deck setup, then Train & run > Run detection.\nKeep this window open. Ctrl+C stops all services.', flush=True)
        if '--smoke-test' in sys.argv:
            return
        if '--no-browser' not in sys.argv:
            webbrowser.open('http://127.0.0.1:5173/')
        while True:
            for name, child in children:
                if child.poll() is not None:
                    raise RuntimeError(f'{name} stopped. See {logs / name}.log')
            time.sleep(1)
    finally:
        for _, child in reversed(children):
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGTERM)
        for _, child in children:
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
        for handle in handles:
            handle.close()


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print('\nLab Sentry stopped.')
    except Exception as error:
        print(f'\n{error}', file=sys.stderr)
        sys.exit(1)
