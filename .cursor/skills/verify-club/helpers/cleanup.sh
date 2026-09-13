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
PID_MARK="bun run dev"
if [[ -f "$RUNS_DIR/$RUN_ID/pid_mark" ]]; then
  PID_MARK="$(cat "$RUNS_DIR/$RUN_ID/pid_mark")"
fi
if [[ -f "$RUNS_DIR/$RUN_ID/chrome.json" ]]; then
  chrome_pid="$(bun -e 'const m=JSON.parse(await Bun.file(process.argv[1]).text()); process.stdout.write(String(m.pid??""))' "$RUNS_DIR/$RUN_ID/chrome.json" 2>/dev/null || true)"
  if [[ "$chrome_pid" =~ ^[1-9][0-9]*$ ]]; then
    kill_ours "$chrome_pid" "remote-debugging-port"
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

launch_ours=0
if pid_alive "$RUN_PID" && [[ "$(pid_command "$RUN_PID")" == *"$PID_MARK"* ]]; then
  launch_ours=1
elif pid_alive "$RUN_PID"; then
  echo "verify-club: not killing launch pid $RUN_PID (command no longer matches '$PID_MARK')" >&2
fi

ours_listen() {
  local pid="${1:-}"
  [[ -n "$pid" ]] || return 1
  if [[ "$launch_ours" -eq 1 ]]; then
    [[ "$pid" == "$RUN_PID" ]] || is_in_tree "$pid" "$RUN_PID"
    return $?
  fi
  # Launch pid was reused or dead — only kill a listener still on our port
  # whose command still looks like Next.
  [[ "$(listening_pid "$RUN_PORT" || true)" == "$pid" ]] && [[ "$(pid_command "$pid")" == *next* ]]
}

# Identify listeners while the launch pid is still alive, then kill.
if [[ -n "$RECORDED_LISTEN" ]]; then
  if ours_listen "$RECORDED_LISTEN"; then
    kill_ours "$RECORDED_LISTEN" "next"
  else
    echo "verify-club: not killing recorded listen pid $RECORDED_LISTEN (not our tree)" >&2
  fi
fi
if [[ -n "$listen" && "$listen" != "$RECORDED_LISTEN" ]]; then
  if ours_listen "$listen"; then
    kill_ours "$listen" "next"
  else
    echo "verify-club: not killing pid $listen on port $RUN_PORT (not our tree)" >&2
  fi
fi
if [[ "$launch_ours" -eq 1 ]]; then
  kill_ours "$RUN_PID" "$PID_MARK"
fi

if [[ "$DIST_DIR" =~ ^\.next-verify-[0-9]+$ ]]; then
  rm -rf "$REPO_ROOT/apps/club/$DIST_DIR"
elif [[ -n "$DIST_DIR" ]]; then
  echo "verify-club: refusing to remove dist '$DIST_DIR' (not .next-verify-<port>)" >&2
fi

# Restore the tsconfig snapshot taken at launch — never git checkout (that
# would discard unrelated dirty edits).
if [[ -f "$RUNS_DIR/$RUN_ID/tsconfig.pre.json" ]]; then
  cp "$RUNS_DIR/$RUN_ID/tsconfig.pre.json" "$REPO_ROOT/apps/club/tsconfig.json"
  echo "verify-club: restored apps/club/tsconfig.json from launch snapshot" >&2
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
