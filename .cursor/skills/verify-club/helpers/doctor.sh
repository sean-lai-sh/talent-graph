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
  if pid_alive "$RUN_PID" && curl -fsS --max-time 5 "$RUN_URL/demo" >/dev/null; then
    echo "verify-club: WARNING lsof saw no listener on $RUN_PORT; GET /demo is 200 and launch pid is alive" >&2
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
code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 5 "$RUN_URL/")"
if [[ "$code" != "200" ]]; then
  die "GET $RUN_URL/ should be the chips landing, got HTTP $code"
fi
if ! grep -q 'href="/info"' "$body" && ! grep -q "href=\\\"/info\\\"" "$body"; then
  die "GET $RUN_URL/ is not the chips landing (missing info link)"
fi
if ! grep -q "info" "$body"; then
  die "GET $RUN_URL/ is not the chips landing (missing info)"
fi

code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 5 "$RUN_URL/info")"
if [[ "$code" != "200" ]]; then
  die "GET $RUN_URL/info returned HTTP $code"
fi
if ! grep -q "Login" "$body"; then
  die "GET $RUN_URL/info is missing Login"
fi
if ! grep -q "chips@techatnyu.org" "$body"; then
  die "GET $RUN_URL/info is missing contact"
fi
if ! grep -q "Tech@NYU Chips" "$body"; then
  die "GET $RUN_URL/info is missing program copy"
fi
if ! grep -q "info-nav" "$body"; then
  die "GET $RUN_URL/info is missing Login/contact nav"
fi
if ! grep -q "info-home" "$body" && ! grep -q ">home<" "$body"; then
  die "GET $RUN_URL/info is missing home"
fi
if grep -q "Create account" "$body"; then
  die "GET $RUN_URL/info must not offer Create account"
fi
if grep -q "Cleo Marsh" "$body"; then
  die "GET $RUN_URL/info must not be the seed board"
fi

code="$(curl -sS -D "$headers" -o /dev/null -w "%{http_code}" --max-time 5 "$RUN_URL/example")"
if [[ "$code" != "307" && "$code" != "308" ]]; then
  die "GET $RUN_URL/example should redirect to /demo, got HTTP $code"
fi
location="$(awk 'tolower($1)=="location:" {print $2}' "$headers" | tr -d '\r')"
if [[ "$location" != *"/demo"* ]]; then
  die "GET $RUN_URL/example Location should be /demo, got ${location:-empty}"
fi

code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 5 "$RUN_URL/demo")"
if [[ "$code" != "200" ]]; then
  die "GET $RUN_URL/demo returned HTTP $code"
fi

if ! grep -q "Talent Graph" "$body"; then
  die "GET $RUN_URL/demo is not Club (missing Talent Graph identity)"
fi
if ! grep -q "Tech@NYU" "$body" && ! grep -q "Cleo Marsh" "$body"; then
  die "GET $RUN_URL/demo is not the public seed board (missing Tech@NYU / Cleo Marsh)"
fi

code="$(curl -sS -D "$headers" -o /dev/null -w "%{http_code}" --max-time 5 "$RUN_URL/club")"
if [[ "$code" != "307" && "$code" != "308" ]]; then
  die "GET $RUN_URL/club should redirect to /login, got HTTP $code"
fi
location="$(awk 'tolower($1)=="location:" {print $2}' "$headers" | tr -d '\r')"
if [[ "$location" != *"/login"* ]]; then
  die "GET $RUN_URL/club Location should be /login, got ${location:-empty}"
fi

code="$(curl -sS -o "$body" -w "%{http_code}" --max-time 5 "$RUN_URL/login")"
if [[ "$code" != "200" ]]; then
  die "GET $RUN_URL/login returned HTTP $code"
fi
if ! grep -q "Sign in" "$body"; then
  die "GET $RUN_URL/login is not the sign-in door (missing Sign in)"
fi
if grep -q "Create account" "$body"; then
  die "GET $RUN_URL/login must not offer Create account"
fi
if grep -q "Cleo Marsh" "$body"; then
  die "GET $RUN_URL/login must not be the seed board"
fi

if [[ "$RUN_PORT" == "3000" ]]; then
  echo "verify-club: WARNING default port 3000 — confirm this is the verification launch, not a developer session" >&2
fi

echo "verify-club doctor ok"
echo "  run     $RUN_ID"
echo "  pid     $RUN_PID"
echo "  listen  $listen"
echo "  url     $RUN_URL"
echo "  board   hidden public seed (/demo; /example redirects; / is landing; /club → /login)"
echo "  evidence $EVIDENCE_DIR"
