#!/usr/bin/env bash
# Run the user-facing drift CLI and capture a transcript.
# Usage: helpers/drift.sh <feature-id> -- --kind ... --before ... --after ...
# Everything after the first -- is passed to `bun run drift`.
# Env: KEEP_TG=1 to leave TG_* in place (needed for --after env).
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"
read_meta

if [[ $# -lt 1 ]]; then
  die "usage: helpers/drift.sh <feature-id> -- --kind <kind> --before <ver> (--after <ver> | --after-json '<json>')"
fi

FEATURE="$1"
shift
if [[ "${1:-}" == "--" ]]; then
  shift
fi
if [[ $# -lt 1 ]]; then
  die "missing drift flags after --"
fi

if [[ "${KEEP_TG:-}" != "1" ]]; then
  unset_tg
fi

OUT="$EVIDENCE_DIR/$FEATURE"
cd "$REPO_ROOT"
set +e
capture_cmd "$OUT" bun run drift -- "$@"
code=$?
set -e

echo "verify-engine: drift exit $code → $OUT"
echo "verify-engine: stdout $OUT/stdout.txt"
exit "$code"
