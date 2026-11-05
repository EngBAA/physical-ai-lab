#!/usr/bin/env bash
set -euo pipefail
SEGMENTS_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "$SEGMENTS_ROOT/scripts/serve.py" "$@"
