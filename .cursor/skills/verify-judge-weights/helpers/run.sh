#!/usr/bin/env bash
# Launch (if needed) and run every check. Exit 0 when nothing failed.
# Skipped checks do not count as passes.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if [[ ! -f "$JW_CURRENT" ]] || ! "$JW_HELPERS/doctor.sh" >/dev/null 2>&1; then
  "$JW_HELPERS/launch.sh"
fi
exec bun "$JW_HELPERS/run.ts"
