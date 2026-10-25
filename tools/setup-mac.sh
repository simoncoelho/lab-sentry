#!/bin/bash
# macOS setup: private Python 3.13 with CPU PyTorch, camera support (AVFoundation
# video, USB/UVC pan-tilt-zoom), Node.js for the web UI, and the app itself.
# Everything is installed under .runtime/; the system Python and Node are untouched.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd)
for port in 5100 5101 5102 5173; do
  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port $port is in use. Stop Lab Sentry before running setup." >&2; exit 1
  fi
done
mkdir -p .runtime
if [ ! -x .runtime/bootstrap/bin/uv ]; then
  echo "Installing uv (Python installer)..."
  python3 -m venv .runtime/bootstrap
  .runtime/bootstrap/bin/pip install --quiet --upgrade pip uv
fi
UV=.runtime/bootstrap/bin/uv
PY=.runtime/python/bin/python
echo "Installing Python and CPU inference dependencies (first setup may take several minutes)..."
[ -x "$PY" ] || "$UV" venv --python 3.13 .runtime/python
"$UV" pip install --python "$PY" torch==2.11.0 torchvision==0.26.0
"$UV" pip install --python "$PY" -r training/requirements-cpu.lock.txt
"$UV" pip install --python "$PY" pyobjc-framework-AVFoundation pyusb libusb-package "nodejs-wheel-binaries>=24,<25"
# Node.js and npm from nodejs-wheel-binaries live in the private environment.
NODE_HOME=$("$PY" -c 'import nodejs_wheel, os; print(os.path.dirname(nodejs_wheel.__file__))')
export PATH="$NODE_HOME/bin:$PATH"
npm() { node "$NODE_HOME/lib/node_modules/npm/bin/npm-cli.js" "$@"; }
echo "Node $(node --version), npm $(npm --version)"
npm ci --prefix device-designer
npm run build --prefix device-designer
"$PY" tools/doctor.py
echo "Setup complete. Start Lab Sentry with: tools/start-mac.sh"
