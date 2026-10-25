#!/bin/bash
# Start Lab Sentry on macOS. Run tools/setup-mac.sh first.
cd "$(dirname "$0")/.."
if [ ! -x .runtime/python/bin/python ]; then echo "Run tools/setup-mac.sh first." >&2; exit 1; fi
exec .runtime/python/bin/python tools/launch_mac.py "$@"
