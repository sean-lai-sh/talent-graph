#!/usr/bin/env bash
# Throwaway anonymous Convex for verify-club. Never touches a cloud deployment.
# Usage: local-convex.sh start | stop
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

CONVEX_CLOUD_PORT=3210
CONVEX_SITE_PORT=3211
CONVEX_CLOUD_URL="http://127.0.0.1:${CONVEX_CLOUD_PORT}"
CONVEX_SITE_URL="http://127.0.0.1:${CONVEX_SITE_PORT}"
ENV_FILE="$REPO_ROOT/apps/club/.env.local"
CONVEX_BIN="$REPO_ROOT/apps/club/node_modules/.bin/convex"

usage() {
  die "usage: local-convex.sh start|stop"
}

current_id() {
  [[ -f "$CURRENT_FILE" ]] || die "no current run (launch first)"
  cat "$CURRENT_FILE"
}

run_path() {
  echo "$RUNS_DIR/$(current_id)"
}

refuse_cloud_env() {
  if [[ -f "$ENV_FILE" ]] && grep -q 'convex\.cloud' "$ENV_FILE"; then
    die "apps/club/.env.local points at Convex cloud. Refusing to launch or modify it."
  fi
  if [[ -f "$ENV_FILE" ]] && grep -q '^CONVEX_DEPLOYMENT=' "$ENV_FILE"; then
    local dep
    dep="$(grep '^CONVEX_DEPLOYMENT=' "$ENV_FILE" | head -n 1)"
    if [[ "$dep" != "CONVEX_DEPLOYMENT=anonymous:anonymous-agent" ]]; then
      die "apps/club/.env.local has $dep. Refusing to use anything but the anonymous local backend."
    fi
  fi
  if [[ "${CONVEX_DEPLOYMENT:-}" == *convex.cloud* || "${NEXT_PUBLIC_CONVEX_URL:-}" == *convex.cloud* ]]; then
    echo "verify-club: ignoring cloud Convex variables in the shell; this run uses the local backend" >&2
  fi
}

snapshot_env() {
  local dir="$1"
  if [[ -f "$ENV_FILE" ]]; then
    cp "$ENV_FILE" "$dir/env.local.pre"
  else
    : >"$dir/env.local.absent"
  fi
}

restore_env() {
  local dir="$1"
  if [[ -f "$dir/env.local.pre" ]]; then
    cp "$dir/env.local.pre" "$ENV_FILE"
    echo "verify-club: restored apps/club/.env.local from launch snapshot" >&2
  elif [[ -f "$dir/env.local.absent" ]]; then
    rm -f "$ENV_FILE"
    echo "verify-club: removed apps/club/.env.local created for this run" >&2
  fi
}

convex_pid() {
  local dir="$1"
  [[ -f "$dir/convex.pid" ]] || return 0
  cat "$dir/convex.pid"
}

stop_convex() {
  local dir="$1"
  local pid
  pid="$(convex_pid "$dir")"
  if [[ -n "$pid" ]]; then
    kill_ours "$pid" "convex"
  fi
  local listen
  listen="$(listening_pid "$CONVEX_CLOUD_PORT" || true)"
  if [[ -n "$listen" && -n "$pid" ]] && is_in_tree "$listen" "$pid"; then
    kill_ours "$listen" "convex"
  fi
}

wait_ready() {
  local dir="$1"
  local pid="$2"
  local i name
  for i in $(seq 1 90); do
    if ! pid_alive "$pid"; then
      echo "verify-club: convex exited before ready. last log:" >&2
      tail -n 50 "$dir/convex.log" >&2 || true
      return 1
    fi
    name="$(curl -fsS --max-time 2 "http://127.0.0.1:${CONVEX_CLOUD_PORT}/instance_name" 2>/dev/null | tr -d '\r\n' || true)"
    if [[ -n "$name" && "$name" != "anonymous-agent" ]]; then
      echo "verify-club: backend instance is '$name', not anonymous-agent" >&2
      return 1
    fi
    if [[ -f "$ENV_FILE" ]] && grep -q 'convex\.cloud' "$ENV_FILE"; then
      echo "verify-club: convex wrote a cloud URL into .env.local; stopping" >&2
      return 1
    fi
    if [[ "$name" == "anonymous-agent" ]] && grep -q "functions ready" "$dir/convex.log"; then
      return 0
    fi
    sleep 1
  done
  echo "verify-club: timed out waiting for anonymous convex. last log:" >&2
  tail -n 50 "$dir/convex.log" >&2 || true
  return 1
}

generate_secrets() {
  local dir="$1"
  local site_url="$2"
  umask 077
  local auth_secret provision_secret admin_password member_password
  auth_secret="$(openssl rand -base64 32)"
  provision_secret="$(openssl rand -base64 32)"
  admin_password="$(openssl rand -base64 18)"
  member_password="$(openssl rand -base64 18)"
  cat >"$dir/local.env" <<EOF
BETTER_AUTH_SECRET=$auth_secret
ADMIN_PROVISION_SECRET=$provision_secret
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=$admin_password
MEMBER_EMAIL=member@example.com
MEMBER_PASSWORD=$member_password
SITE_URL=$site_url
EOF
  chmod 600 "$dir/local.env"
}

set_convex_env() {
  local dir="$1"
  # shellcheck disable=SC1090
  set -a
  source "$dir/local.env"
  set +a
  (
    cd "$REPO_ROOT/apps/club"
    export CONVEX_AGENT_MODE=anonymous
    unset CONVEX_DEPLOY_KEY
    "$CONVEX_BIN" env set BETTER_AUTH_SECRET "$BETTER_AUTH_SECRET"
    "$CONVEX_BIN" env set SITE_URL "$SITE_URL"
    "$CONVEX_BIN" env set ADMIN_PROVISION_SECRET "$ADMIN_PROVISION_SECRET"
  )
}

provision_users() {
  local dir="$1"
  # shellcheck disable=SC1090
  set -a
  source "$dir/local.env"
  set +a
  (
    cd "$REPO_ROOT/apps/club"
    export CONVEX_AGENT_MODE=anonymous
    unset CONVEX_DEPLOY_KEY
    OWNER_EMAIL="$ADMIN_EMAIL" OWNER_NAME="Verify Admin" OWNER_PASSWORD="$ADMIN_PASSWORD" \
      ACCOUNT_ROLE=admin ADMIN_PROVISION_SECRET="$ADMIN_PROVISION_SECRET" \
      bun run provision-user
    OWNER_EMAIL="$MEMBER_EMAIL" OWNER_NAME="Verify Member" OWNER_PASSWORD="$MEMBER_PASSWORD" \
      ACCOUNT_ROLE=member ADMIN_PROVISION_SECRET="$ADMIN_PROVISION_SECRET" \
      bun run provision-user
  )
}

check_site() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${CONVEX_SITE_URL}/" || true)"
  if [[ "$code" == "000" ]]; then
    echo "verify-club: local convex site ${CONVEX_SITE_URL} did not respond" >&2
    return 1
  fi
}

patch_env_file() {
  local site_url="$1"
  [[ -f "$ENV_FILE" ]] || return 0
  if grep -q 'convex\.cloud' "$ENV_FILE"; then
    echo "verify-club: refusing to patch .env.local that contains convex.cloud" >&2
    return 1
  fi
  local tmp
  tmp="$(mktemp)"
  grep -vE '^(NEXT_PUBLIC_CONVEX_URL|NEXT_PUBLIC_CONVEX_SITE_URL|NEXT_PUBLIC_SITE_URL)=' "$ENV_FILE" >"$tmp" || true
  printf 'NEXT_PUBLIC_CONVEX_URL=%s\nNEXT_PUBLIC_CONVEX_SITE_URL=%s\nNEXT_PUBLIC_SITE_URL=%s\n' \
    "$CONVEX_CLOUD_URL" "$CONVEX_SITE_URL" "$site_url" >>"$tmp"
  mv "$tmp" "$ENV_FILE"
}

start() {
  local dir site_url owner pid
  dir="$(run_path)"
  [[ -d "$dir" ]] || die "run dir missing: $dir"
  [[ -x "$CONVEX_BIN" ]] || die "convex CLI missing. Run bun install in apps/club."
  command -v openssl >/dev/null 2>&1 || die "openssl is required to generate local secrets"
  refuse_cloud_env
  owner="$(listening_pid "$CONVEX_CLOUD_PORT" || true)"
  if [[ -n "$owner" ]]; then
    die "port $CONVEX_CLOUD_PORT is already listening (pid $owner). Not attaching to someone else's Convex."
  fi
  snapshot_env "$dir"
  if [[ ! -d "$REPO_ROOT/apps/club/.convex" ]]; then
    : >"$dir/convex-data-owned"
  fi
  site_url="http://${VERIFY_CLUB_HOST}:$(cat "$dir/port")"
  generate_secrets "$dir" "$site_url"
  echo "verify-club: anonymous convex on ${CONVEX_CLOUD_URL} (site ${CONVEX_SITE_URL})" >&2
  # setsid: bun resets SIGHUP, so nohup still dies with the launcher's process group.
  setsid nohup bash -c "
    cd \"$REPO_ROOT/apps/club\" &&
    export CONVEX_AGENT_MODE=anonymous &&
    unset CONVEX_DEPLOYMENT CONVEX_DEPLOY_KEY &&
    exec \"$CONVEX_BIN\" dev --typecheck disable --tail-logs disable
  " >"$dir/convex.log" 2>&1 &
  pid=$!
  echo "$pid" >"$dir/convex.pid"
  if ! wait_ready "$dir" "$pid"; then
    stop || true
    exit 1
  fi
  if ! set_convex_env "$dir"; then
    stop || true
    exit 1
  fi
  if ! provision_users "$dir"; then
    stop || true
    exit 1
  fi
  if ! check_site; then
    stop || true
    exit 1
  fi
  if ! patch_env_file "$site_url"; then
    stop || true
    exit 1
  fi
  echo "verify-club: local convex ready (anonymous-agent, users admin@example.com and member@example.com)" >&2
}

stop() {
  [[ -f "$CURRENT_FILE" ]] || return 0
  local dir
  dir="$(run_path)"
  [[ -d "$dir" ]] || return 0
  stop_convex "$dir"
  restore_env "$dir"
  if [[ -f "$dir/convex-data-owned" ]]; then
    rm -rf "$REPO_ROOT/apps/club/.convex"
  fi
}

cmd="${1:-}"
case "$cmd" in
  start) start ;;
  stop) stop ;;
  *) usage ;;
esac
