#!/usr/bin/env bash
# Stop the convex dev and Club app this run started. Keep evidence.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if [[ ! -f "$JW_CURRENT" ]]; then
  echo "verify-judge-weights: nothing to clean (no current run)"
  exit 0
fi

# Launch can fail before convex_url exists. Still stop the process we started.
JW_RUN_ID="$(cat "$JW_CURRENT")"
JW_RUN_DIR="$JW_RUNS/$JW_RUN_ID"
JW_EVIDENCE_DIR="$JW_EVIDENCE/$JW_RUN_ID"
if [[ ! -d "$JW_RUN_DIR" ]]; then
  rm -f "$JW_CURRENT"
  echo "verify-judge-weights: current run directory already gone"
  exit 0
fi

CONVEX_PID=""
CONVEX_MARK="convex dev"
if [[ -f "$JW_RUN_DIR/convex_pid" ]]; then
  CONVEX_PID="$(cat "$JW_RUN_DIR/convex_pid")"
fi
if [[ -f "$JW_RUN_DIR/convex_mark" ]]; then
  CONVEX_MARK="$(cat "$JW_RUN_DIR/convex_mark")"
fi

# Only stop Club when this run launched it. An early Convex failure has no club_run.
if [[ -f "$JW_RUN_DIR/club_run" && -f "$CLUB_SKILL/runs/current" ]]; then
  "$CLUB_SKILL/helpers/cleanup.sh" || true
fi

kill_ours "$CONVEX_PID" "$CONVEX_MARK"

CLUB_DIR="$JW_REPO/apps/club"
ENV_LOCAL="$CLUB_DIR/.env.local"
state=""
if [[ -f "$JW_RUN_DIR/env_local_state" ]]; then
  state="$(cat "$JW_RUN_DIR/env_local_state")"
fi
if [[ "$state" == "preexisting" && -f "$JW_RUN_DIR/env.local.pre" ]]; then
  cp "$JW_RUN_DIR/env.local.pre" "$ENV_LOCAL"
elif [[ "$state" == "absent" ]]; then
  rm -f "$ENV_LOCAL"
fi
if [[ -f "$JW_RUN_DIR/env.local.aside" && ! -f "$ENV_LOCAL" ]]; then
  mv "$JW_RUN_DIR/env.local.aside" "$ENV_LOCAL"
fi

mkdir -p "$JW_EVIDENCE_DIR"
if [[ -f "$JW_RUN_DIR/convex.log" ]]; then
  cp "$JW_RUN_DIR/convex.log" "$JW_EVIDENCE_DIR/convex.log" 2>/dev/null || true
fi
if [[ -f "$JW_RUN_DIR/seed.log" ]]; then
  cp "$JW_RUN_DIR/seed.log" "$JW_EVIDENCE_DIR/seed.log" 2>/dev/null || true
fi

rm -f "$JW_CURRENT"
rm -rf "$JW_RUN_DIR"

echo "verify-judge-weights: cleaned run $JW_RUN_ID"
echo "verify-judge-weights: evidence retained at $JW_EVIDENCE_DIR"
