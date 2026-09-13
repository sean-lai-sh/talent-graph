#!/usr/bin/env bash
# Run the user-facing demo CLI and capture a transcript.
# Usage: helpers/demo.sh [feature-id]
# Env: KEEP_TG=1 to leave TG_* in place (default: unset them for registered specs).
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
read_meta

FEATURE="${1:-demo}"
OUT="$EVIDENCE_DIR/$FEATURE"
if [[ "${KEEP_TG:-}" != "1" ]]; then
  unset_tg
fi

cd "$REPO_ROOT"
set +e
capture_cmd "$OUT" bun run demo
code=$?
set -e

echo "verify-engine: demo exit $code → $OUT"
echo "verify-engine: stdout $OUT/stdout.txt"
exit "$code"
