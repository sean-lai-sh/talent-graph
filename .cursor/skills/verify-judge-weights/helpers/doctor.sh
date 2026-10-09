#!/usr/bin/env bash
# Read-only: is this judge-weights run worth driving?
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

jw_read_meta

if [[ ! "$JW_APP_URL" =~ ^http://127\.0\.0\.1:[0-9]+$ && ! "$JW_APP_URL" =~ ^http://localhost:[0-9]+$ ]]; then
  jw_die "app URL must be loopback, got $JW_APP_URL"
fi
case "$JW_APP_URL" in
  *:3000|*:3000/) jw_die "refusing :3000" ;;
esac

if [[ ! -f "$JW_RUN_DIR/convex_pid" ]] || ! pid_alive "$(cat "$JW_RUN_DIR/convex_pid")"; then
  jw_die "convex dev pid is not running (run $JW_RUN_ID)"
fi
mark="convex dev"
if [[ -f "$JW_RUN_DIR/convex_mark" ]]; then
  mark="$(cat "$JW_RUN_DIR/convex_mark")"
fi
if [[ "$(pid_command "$(cat "$JW_RUN_DIR/convex_pid")")" != *"$mark"* ]]; then
  jw_die "convex pid no longer matches '$mark'"
fi

deployment=""
if [[ -f "$JW_RUN_DIR/deployment" ]]; then
  deployment="$(cat "$JW_RUN_DIR/deployment")"
fi
if [[ "$deployment" == prod:* ]]; then
  jw_die "deployment $deployment is production"
fi

if [[ "$JW_MODE" == "local" ]]; then
  assert_local_backend_convex_url "$JW_CONVEX_URL"
  assert_local_backend_convex_url "$JW_CONVEX_SITE"
  if ! curl -fsS --max-time 5 "$JW_CONVEX_URL/instance_name" >/dev/null; then
    jw_die "local Convex is not answering at $JW_CONVEX_URL"
  fi
elif [[ "$JW_MODE" == "shared" ]]; then
  if convex_url_is_local "$JW_CONVEX_URL"; then
    jw_die "shared mode is pointed at a loopback Convex URL"
  fi
else
  jw_die "unknown mode $JW_MODE"
fi

if ! "$CLUB_SKILL/helpers/doctor.sh"; then
  jw_die "verify-club doctor failed"
fi

echo "verify-judge-weights doctor ok"
echo "  run      $JW_RUN_ID"
echo "  mode     $JW_MODE"
echo "  convex   $JW_CONVEX_URL"
echo "  app      $JW_APP_URL"
echo "  evidence $JW_EVIDENCE_DIR"
