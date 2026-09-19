#!/usr/bin/env bash
# Start an isolated Club example admin for verification.
# Usage: helpers/launch.sh
# Env: VERIFY_CLUB_HOST (default 127.0.0.1), VERIFY_CLUB_PORT (default 43173)
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

mkdir -p "$RUNS_DIR" "$EVIDENCE_ROOT"
ulimit -n 10240 2>/dev/null || true

if [[ -f "$CURRENT_FILE" ]]; then
  if "$SKILL_DIR/helpers/doctor.sh" >/dev/null 2>&1; then
    read_meta
    die "a verification instance is already healthy at $RUN_URL (run $RUN_ID). Drive that, or cleanup first."
  fi
  echo "verify-club: stale current run; cleaning before relaunch" >&2
  "$SKILL_DIR/helpers/cleanup.sh" || true
fi

owner="$(listening_pid "$VERIFY_CLUB_PORT" || true)"
if [[ -n "$owner" ]]; then
  die "port $VERIFY_CLUB_PORT is already listening (pid $owner). Set VERIFY_CLUB_PORT to a free port. Never steal :3000."
fi

if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
  (cd "$REPO_ROOT" && bun install)
fi
if [[ ! -d "$REPO_ROOT/apps/club/node_modules" ]]; then
  (cd "$REPO_ROOT/apps/club" && bun install)
fi

RUN_ID="club-$(date +%Y%m%dT%H%M%S)-$$"
RUN_DIR="$RUNS_DIR/$RUN_ID"
EVIDENCE_DIR="$EVIDENCE_ROOT/$RUN_ID"
DIST_DIR=".next-verify-${VERIFY_CLUB_PORT}"
mkdir -p "$RUN_DIR" "$EVIDENCE_DIR"
URL="http://${VERIFY_CLUB_HOST}:${VERIFY_CLUB_PORT}"
printf '%s\n' "$DIST_DIR" >"$RUN_DIR/dist"
printf '%s\n' "$VERIFY_CLUB_PORT" >"$RUN_DIR/port"
printf '%s\n' "$URL" >"$RUN_DIR/url"
printf '%s\n' "$VERIFY_CLUB_HOST" >"$RUN_DIR/host"
cp "$REPO_ROOT/apps/club/tsconfig.json" "$RUN_DIR/tsconfig.pre.json"
echo "$RUN_ID" >"$CURRENT_FILE"

# Isolated distDir so we do not share apps/club/.next with developer next dev.
# next start + typed routes fails typecheck on a custom distDir; next dev works.
# WATCHPACK_POLLING avoids EMFILE when another Next is already watching the repo.
echo "verify-club: next dev on $URL (dist $DIST_DIR)" >&2
# nohup: survive launch.sh exiting (otherwise the process group gets SIGHUP).
# Unset TG_* so Club loadSpecs() matches documented seed pins (same as verify-engine).
nohup bash -c "
  cd \"$REPO_ROOT/apps/club\" &&
  unset TG_BT_REGULARIZATION TG_BT_MAX_ITERATIONS TG_BT_TOLERANCE \
    TG_MIN_COMPARISONS TG_MIN_OPPONENTS TG_TOP_K_REFERRALS &&
  exec env NEXT_DIST_DIR=\"$DIST_DIR\" WATCHPACK_POLLING=true CHOKIDAR_USEPOLLING=true \
    bun run dev -- -p \"$VERIFY_CLUB_PORT\"
" >"$RUN_DIR/log" 2>&1 &
echo $! >"$RUN_DIR/pid"
printf '%s\n' "bun run dev" >"$RUN_DIR/pid_mark"

ready=0
for _ in $(seq 1 60); do
  if curl -fsS --max-time 2 "$URL/demo" >/dev/null 2>&1; then
    ready=1
    break
  fi
  if ! pid_alive "$(cat "$RUN_DIR/pid")"; then
    echo "verify-club: process exited before ready. last log:" >&2
    tail -n 40 "$RUN_DIR/log" >&2 || true
    "$SKILL_DIR/helpers/cleanup.sh" || true
    exit 1
  fi
  sleep 1
done

if [[ "$ready" -ne 1 ]]; then
  echo "verify-club: timed out waiting for $URL. last log:" >&2
  tail -n 40 "$RUN_DIR/log" >&2 || true
  "$SKILL_DIR/helpers/cleanup.sh" || true
  exit 1
fi

listen="$(listening_pid "$VERIFY_CLUB_PORT" || true)"
if [[ -n "$listen" ]]; then
  echo "$listen" >"$RUN_DIR/listen_pid"
fi

if ! "$SKILL_DIR/helpers/doctor.sh"; then
  echo "verify-club: doctor failed after listen; cleaning up" >&2
  "$SKILL_DIR/helpers/cleanup.sh" || true
  exit 1
fi
echo "verify-club: launched $RUN_ID at $URL"
echo "verify-club: evidence directory $EVIDENCE_DIR"
