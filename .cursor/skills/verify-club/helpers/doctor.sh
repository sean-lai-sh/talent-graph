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
  # Some sandboxes hide TCP LISTEN from lsof even when Next is healthy.
  if pid_alive "$RUN_PID" && curl -fsS --max-time 5 "$RUN_URL/example" >/dev/null; then
    echo "verify-club: WARNING lsof saw no listener on $RUN_PORT; GET /example is 200 and launch pid is alive" >&2
    listen="$RUN_PID"
  else
    die "nothing listens on $VERIFY_CLUB_HOST:$RUN_PORT (run $RUN_ID)"
  fi
fi
if [[ "$listen" != "$RUN_PID" ]] && ! is_in_tree "$listen" "$RUN_PID"; then
  die "port $RUN_PORT is owned by pid $listen, not launch pid $RUN_PID. Do not drive this port."
fi

body="$(mktemp)"
headers="$(mktemp)"
trap 'rm -f "$body" "$headers"' EXIT
code="$(curl -sS -D "$headers" -o /dev/null -w "%{http_code}" --max-time 5 "$RUN_URL/")"
if [[ "$code" != "307" && "$code" != "308" ]]; then
  die "GET $RUN_URL/ should redirect to /example, got HTTP $code"
fi
location="$(awk 'tolower($1)=="location:" {print $2}' "$headers" | tr -d '\r')"
if [[ "$location" != *"/example"* ]]; then
  die "GET $RUN_URL/ Location should be /example, got ${location:-empty}"
fi

code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 5 "$RUN_URL/example")"
if [[ "$code" != "200" ]]; then
  die "GET $RUN_URL/example returned HTTP $code"
fi

if ! grep -q "Talent Graph" "$body"; then
  die "GET $RUN_URL/example is not Club (missing Talent Graph identity)"
fi
if ! grep -q "Tech@NYU" "$body" && ! grep -q "Cleo Marsh" "$body"; then
  die "GET $RUN_URL/example is not the public seed board (missing Tech@NYU / Cleo Marsh)"
fi

if [[ "$RUN_PORT" == "3000" ]]; then
  echo "verify-club: WARNING default port 3000 — confirm this is the verification launch, not a developer session" >&2
fi

echo "verify-club doctor ok"
echo "  run     $RUN_ID"
echo "  pid     $RUN_PID"
echo "  listen  $listen"
echo "  url     $RUN_URL"
echo "  board   public seed (/example; / redirects)"
echo "  evidence $EVIDENCE_DIR"
