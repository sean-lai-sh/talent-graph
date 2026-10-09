#!/usr/bin/env bash
# Local throwaway Convex (127.0.0.1:3210) plus the verify-club app on :43173.
# Opt in to the shared dev deployment with VERIFY_JUDGE_WEIGHTS_SHARED=1.
# Never runs `convex deploy`.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

mkdir -p "$JW_RUNS" "$JW_EVIDENCE"
ulimit -n 10240 2>/dev/null || true

if [[ -f "$JW_CURRENT" ]]; then
  if "$JW_HELPERS/doctor.sh" >/dev/null 2>&1; then
    jw_read_meta
    jw_die "a verification instance is already healthy at $JW_APP_URL (run $JW_RUN_ID). Drive that, or cleanup first."
  fi
  echo "verify-judge-weights: stale current run; cleaning before relaunch" >&2
  "$JW_HELPERS/cleanup.sh" || true
fi

MODE="local"
if [[ "${VERIFY_JUDGE_WEIGHTS_SHARED:-}" == "1" ]]; then
  MODE="shared"
fi

if [[ "$MODE" == "local" ]]; then
  owner="$(listening_pid 3210 || true)"
  if [[ -n "$owner" ]]; then
    jw_die "port 3210 is already listening (pid $owner). Stop that process or cleanup the run that owns it."
  fi
fi

owner="$(listening_pid "$VERIFY_CLUB_PORT" || true)"
if [[ -n "$owner" ]]; then
  jw_die "port $VERIFY_CLUB_PORT is already listening (pid $owner). Set VERIFY_CLUB_PORT. Never steal :3000."
fi

if [[ ! -d "$JW_REPO/node_modules" ]]; then
  (cd "$JW_REPO" && bun install)
fi
if [[ ! -d "$JW_REPO/apps/club/node_modules" ]]; then
  (cd "$JW_REPO/apps/club" && bun install)
fi

RUN_ID="jw-$(date +%Y%m%dT%H%M%S)-$$"
RUN_DIR="$JW_RUNS/$RUN_ID"
EVIDENCE_DIR="$JW_EVIDENCE/$RUN_ID"
mkdir -p "$RUN_DIR" "$EVIDENCE_DIR"
umask 077
openssl rand -base64 24 | tr -d '\n' >"$RUN_DIR/password"
openssl rand -base64 24 | tr -d '\n' >"$RUN_DIR/provision-secret"
if (( $(wc -c <"$RUN_DIR/password") < 8 )); then
  jw_die "generated password was too short"
fi

APP_URL="http://${VERIFY_CLUB_HOST}:${VERIFY_CLUB_PORT}"
printf '%s\n' "$MODE" >"$RUN_DIR/mode"
printf '%s\n' "$APP_URL" >"$RUN_DIR/app_url"
printf '%s\n' "$RUN_ID" >"$JW_CURRENT"

CLUB_DIR="$JW_REPO/apps/club"
ENV_LOCAL="$CLUB_DIR/.env.local"
if [[ -f "$ENV_LOCAL" ]]; then
  cp "$ENV_LOCAL" "$RUN_DIR/env.local.pre"
  printf '%s\n' "preexisting" >"$RUN_DIR/env_local_state"
else
  printf '%s\n' "absent" >"$RUN_DIR/env_local_state"
fi

unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY

if [[ "$MODE" == "local" && -f "$ENV_LOCAL" ]]; then
  mv "$ENV_LOCAL" "$RUN_DIR/env.local.aside"
fi

echo "verify-judge-weights: starting convex ($MODE)" >&2
if [[ "$MODE" == "local" ]]; then
  nohup bash -c "
    cd \"$CLUB_DIR\" &&
    unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY &&
    exec env CONVEX_AGENT_MODE=anonymous \
      ./node_modules/.bin/convex dev --typecheck disable --tail-logs disable \
      --local-cloud-port 3210 --local-site-port 3211
  " >"$RUN_DIR/convex.log" 2>&1 &
else
  nohup bash -c "
    cd \"$CLUB_DIR\" &&
    exec ./node_modules/.bin/convex dev --typecheck disable --tail-logs disable
  " >"$RUN_DIR/convex.log" 2>&1 &
fi
echo $! >"$RUN_DIR/convex_pid"
printf '%s\n' "convex dev" >"$RUN_DIR/convex_mark"

ready=0
for _ in $(seq 1 180); do
  if grep -q "Convex functions ready" "$RUN_DIR/convex.log" 2>/dev/null; then
    ready=1
    break
  fi
  if ! pid_alive "$(cat "$RUN_DIR/convex_pid")"; then
    echo "verify-judge-weights: convex exited before ready. last log:" >&2
    tail -n 50 "$RUN_DIR/convex.log" >&2 || true
    "$JW_HELPERS/cleanup.sh" || true
    exit 1
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo "verify-judge-weights: timed out waiting for convex. last log:" >&2
  tail -n 50 "$RUN_DIR/convex.log" >&2 || true
  "$JW_HELPERS/cleanup.sh" || true
  exit 1
fi

if [[ ! -f "$ENV_LOCAL" ]]; then
  echo "verify-judge-weights: convex did not write .env.local" >&2
  tail -n 40 "$RUN_DIR/convex.log" >&2 || true
  "$JW_HELPERS/cleanup.sh" || true
  exit 1
fi

read_env() {
  local key="$1" line
  line="$(grep -E "^${key}=" "$ENV_LOCAL" | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%\"}"
  line="${line#\"}"
  line="${line%\'}"
  line="${line#\'}"
  printf '%s' "$line"
}

CONVEX_URL="$(read_env NEXT_PUBLIC_CONVEX_URL)"
CONVEX_SITE="$(read_env NEXT_PUBLIC_CONVEX_SITE_URL)"
DEPLOYMENT="$(read_env CONVEX_DEPLOYMENT)"
printf '%s\n' "$CONVEX_URL" >"$RUN_DIR/convex_url"
printf '%s\n' "$CONVEX_SITE" >"$RUN_DIR/convex_site_url"
printf '%s\n' "$DEPLOYMENT" >"$RUN_DIR/deployment"

if [[ "$DEPLOYMENT" == prod:* ]]; then
  jw_die "refusing production deployment $DEPLOYMENT"
fi
if [[ "$MODE" == "local" ]]; then
  assert_local_backend_convex_url "$CONVEX_URL"
  assert_local_backend_convex_url "$CONVEX_SITE"
  if [[ "$CONVEX_URL" != http://127.0.0.1:3210* && "$CONVEX_URL" != http://localhost:3210* ]]; then
    jw_die "local mode expected Convex on port 3210, got $CONVEX_URL"
  fi
else
  if convex_url_is_local "$CONVEX_URL"; then
    jw_die "shared mode got a loopback Convex URL. Unset VERIFY_JUDGE_WEIGHTS_SHARED to use the local backend."
  fi
fi

# seed-dev and provision-user call `npx convex`. Some agent images ship a
# broken npx. A shim on PATH runs the local convex binary instead.
mkdir -p "$RUN_DIR/bin"
cat >"$RUN_DIR/bin/npx" <<'EOF'
#!/bin/bash
exec "$@"
EOF
chmod +x "$RUN_DIR/bin/npx"
export PATH="$RUN_DIR/bin:$CLUB_DIR/node_modules/.bin:$PATH"

AUTH_SECRET="$(openssl rand -base64 32 | tr -d '\n')"
umask 077
cat >"$RUN_DIR/convex.env" <<EOF
BETTER_AUTH_SECRET=${AUTH_SECRET}
SITE_URL=${APP_URL}
ADMIN_PROVISION_SECRET=$(cat "$RUN_DIR/provision-secret")
CLUB_DEV_SEED=1
EOF
(
  cd "$CLUB_DIR"
  unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
  ./node_modules/.bin/convex env set --force --from-file "$RUN_DIR/convex.env"
) >>"$RUN_DIR/convex.log" 2>&1

if ! (
  cd "$CLUB_DIR"
  unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
  export SEED_DEV_PASSWORD="$(cat "$RUN_DIR/password")"
  export ADMIN_PROVISION_SECRET="$(cat "$RUN_DIR/provision-secret")"
  bun scripts/seed-dev.ts
) >>"$RUN_DIR/seed.log" 2>&1; then
  echo "verify-judge-weights: seed failed. last log:" >&2
  tail -n 30 "$RUN_DIR/seed.log" >&2 || true
  "$JW_HELPERS/cleanup.sh" || true
  exit 1
fi

if [[ "$MODE" == "local" ]]; then
  (
    cd "$JW_REPO"
    export NEXT_PUBLIC_CONVEX_URL="$CONVEX_URL"
    export NEXT_PUBLIC_CONVEX_SITE_URL="$CONVEX_SITE"
    export SEED_DEV_PASSWORD="$(cat "$RUN_DIR/password")"
    export ADMIN_PROVISION_SECRET="$(cat "$RUN_DIR/provision-secret")"
    "$CLUB_SKILL/helpers/provision-local-admin.sh"
  ) >>"$RUN_DIR/seed.log" 2>&1
else
  (
    cd "$CLUB_DIR"
    unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY CONVEX_SELF_HOSTED_URL CONVEX_SELF_HOSTED_ADMIN_KEY
    export OWNER_EMAIL="council.clerk@example.test"
    export OWNER_NAME="Council Clerk"
    export OWNER_PASSWORD="$(cat "$RUN_DIR/password")"
    export ACCOUNT_ROLE=admin
    export ADMIN_PROVISION_SECRET="$(cat "$RUN_DIR/provision-secret")"
    bun scripts/provision-user.ts
  ) >>"$RUN_DIR/seed.log" 2>&1
fi

if [[ "$MODE" == "local" ]]; then
  VERIFY_CLUB_LOCAL=1 \
    NEXT_PUBLIC_CONVEX_URL="$CONVEX_URL" \
    NEXT_PUBLIC_CONVEX_SITE_URL="$CONVEX_SITE" \
    "$CLUB_SKILL/helpers/launch.sh"
else
  "$CLUB_SKILL/helpers/launch.sh"
fi

if [[ -f "$CLUB_SKILL/runs/current" ]]; then
  cat "$CLUB_SKILL/runs/current" >"$RUN_DIR/club_run"
fi

if ! "$JW_HELPERS/doctor.sh"; then
  echo "verify-judge-weights: doctor failed after launch" >&2
  "$JW_HELPERS/cleanup.sh" || true
  exit 1
fi

echo "verify-judge-weights: launched $RUN_ID at $APP_URL"
echo "verify-judge-weights: evidence directory $EVIDENCE_DIR"
