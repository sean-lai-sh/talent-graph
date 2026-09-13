#!/usr/bin/env bash
# Install engine deps and open a verification run. No long-lived server.
# Usage: helpers/launch.sh
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

mkdir -p "$RUNS_DIR" "$EVIDENCE_ROOT"

if [[ -f "$CURRENT_FILE" ]]; then
  if "$SKILL_DIR/helpers/doctor.sh" >/dev/null 2>&1; then
    read_meta
    echo "verify-engine: run $RUN_ID already ready"
    echo "verify-engine: evidence $EVIDENCE_DIR"
    exit 0
  fi
  echo "verify-engine: stale current run; cleaning before relaunch" >&2
  "$SKILL_DIR/helpers/cleanup.sh" || true
fi

if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  (cd "$REPO_ROOT" && bun install)
fi

RUN_ID="engine-$(date +%Y%m%dT%H%M%S)-$$"
RUN_DIR="$RUNS_DIR/$RUN_ID"
EVIDENCE_DIR="$EVIDENCE_ROOT/$RUN_ID"
mkdir -p "$RUN_DIR" "$EVIDENCE_DIR"
printf '%s\n' "$REPO_ROOT" >"$RUN_DIR/repo"
printf '%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >"$RUN_DIR/started"
echo "$RUN_ID" >"$CURRENT_FILE"

"$SKILL_DIR/helpers/doctor.sh"
echo "verify-engine: launched $RUN_ID"
echo "verify-engine: repo $REPO_ROOT"
echo "verify-engine: evidence $EVIDENCE_DIR"
