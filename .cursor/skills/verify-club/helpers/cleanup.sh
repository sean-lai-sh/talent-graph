#!/usr/bin/env bash
# Tear down the verification instance this run started. Leaves evidence in place.
# Usage: helpers/cleanup.sh
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

if [[ ! -f "$CURRENT_FILE" ]]; then
  echo "verify-club: nothing to clean (no current run)"
  exit 0
fi

read_meta
if [[ -f "$RUNS_DIR/$RUN_ID/chrome.json" ]]; then
  chrome_pid="$(sed -n 's/.*"pid": *\([0-9]*\).*/\1/p' "$RUNS_DIR/$RUN_ID/chrome.json" | head -n 1)"
  if [[ -n "$chrome_pid" ]]; then
    kill_tree "$chrome_pid"
  fi
fi
DIST_DIR=""
if [[ -f "$RUNS_DIR/$RUN_ID/dist" ]]; then
  DIST_DIR="$(cat "$RUNS_DIR/$RUN_ID/dist")"
fi
RECORDED_LISTEN=""
if [[ -f "$RUNS_DIR/$RUN_ID/listen_pid" ]]; then
  RECORDED_LISTEN="$(cat "$RUNS_DIR/$RUN_ID/listen_pid")"
fi
listen="$(listening_pid "$RUN_PORT" || true)"

kill_tree "$RUN_PID"
if [[ -n "$RECORDED_LISTEN" ]]; then
  kill_tree "$RECORDED_LISTEN"
fi
if [[ -n "$listen" ]]; then
  if [[ "$listen" == "$RUN_PID" || "$listen" == "$RECORDED_LISTEN" ]] || is_in_tree "$listen" "$RUN_PID"; then
    kill_tree "$listen"
  else
    echo "verify-club: not killing pid $listen on port $RUN_PORT (not our tree)" >&2
  fi
fi

if [[ -n "$DIST_DIR" && "$DIST_DIR" == .next-verify* ]]; then
  rm -rf "$REPO_ROOT/apps/club/$DIST_DIR"
fi

# next dev rewrites tsconfig include to add the verify distDir. Put it back.
if [[ -f "$REPO_ROOT/apps/club/tsconfig.json" ]] && grep -q '.next-verify' "$REPO_ROOT/apps/club/tsconfig.json"; then
  if git -C "$REPO_ROOT" checkout -- apps/club/tsconfig.json 2>/dev/null; then
    echo "verify-club: restored apps/club/tsconfig.json" >&2
  fi
fi

# Drop only run metadata. Evidence stays at $EVIDENCE_DIR.
rm -f "$CURRENT_FILE"
rm -f "$RUNS_DIR/$RUN_ID/pid" "$RUNS_DIR/$RUN_ID/port" "$RUNS_DIR/$RUN_ID/url" "$RUNS_DIR/$RUN_ID/host"
# Keep the log next to evidence for the post-mortem; copy then remove the run dir.
if [[ -f "$RUNS_DIR/$RUN_ID/log" ]]; then
  mkdir -p "$EVIDENCE_DIR"
  cp "$RUNS_DIR/$RUN_ID/log" "$EVIDENCE_DIR/server.log" 2>/dev/null || true
fi
rm -rf "$RUNS_DIR/$RUN_ID"

still="$(listening_pid "$RUN_PORT" || true)"
if [[ -n "$still" ]] && { [[ "$still" == "$RUN_PID" ]] || is_in_tree "$still" "$RUN_PID"; }; then
  die "port $RUN_PORT still held by our tree (pid $still)"
fi

echo "verify-club: cleaned run $RUN_ID"
echo "verify-club: evidence retained at $EVIDENCE_DIR"
