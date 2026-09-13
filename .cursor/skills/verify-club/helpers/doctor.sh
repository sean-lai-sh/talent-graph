#!/usr/bin/env bash
# Read-only: is the current verification instance worth driving?
# Usage: helpers/doctor.sh
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

read_meta

if ! command -v lsof >/dev/null 2>&1; then
  die "lsof is required to confirm this run owns its port"
fi

if ! pid_alive "$RUN_PID"; then
  die "launch pid $RUN_PID is not running (run $RUN_ID)"
fi

listen="$(listening_pid "$RUN_PORT" || true)"
if [[ -z "$listen" ]]; then
  die "nothing listens on $VERIFY_CLUB_HOST:$RUN_PORT (run $RUN_ID)"
fi
if [[ "$listen" != "$RUN_PID" ]] && ! is_in_tree "$listen" "$RUN_PID"; then
  die "port $RUN_PORT is owned by pid $listen, not launch pid $RUN_PID. Do not drive this port."
fi

body="$(mktemp)"
trap 'rm -f "$body"' EXIT
code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 5 "$RUN_URL/")"
if [[ "$code" != "200" ]]; then
  die "GET $RUN_URL/ returned HTTP $code"
fi

if ! grep -q "Talent Graph" "$body"; then
  die "GET $RUN_URL/ is not Club (missing Talent Graph identity)"
fi
if ! grep -q "Tech@NYU" "$body" && ! grep -q "Cleo Marsh" "$body"; then
  die "GET $RUN_URL/ is not the public seed board (missing Tech@NYU / Cleo Marsh)"
fi

if [[ "$RUN_PORT" == "3000" ]]; then
  echo "verify-club: WARNING default port 3000 — confirm this is the verification launch, not a developer session" >&2
fi

echo "verify-club doctor ok"
echo "  run     $RUN_ID"
echo "  pid     $RUN_PID"
echo "  listen  $listen"
echo "  url     $RUN_URL"
echo "  board   public seed (/)"
echo "  evidence $EVIDENCE_DIR"
