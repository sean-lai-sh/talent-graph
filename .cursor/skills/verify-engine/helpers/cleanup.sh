#!/usr/bin/env bash
# End the verification run. No server to kill. Leaves evidence in place.
# Usage: helpers/cleanup.sh
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if [[ ! -f "$CURRENT_FILE" ]]; then
  echo "verify-engine: nothing to clean (no current run)"
  exit 0
fi

read_meta
rm -f "$CURRENT_FILE"
rm -rf "$RUN_DIR"

echo "verify-engine: cleaned run $RUN_ID"
echo "verify-engine: evidence retained at $EVIDENCE_DIR"
