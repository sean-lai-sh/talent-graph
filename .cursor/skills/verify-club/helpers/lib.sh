# Shared paths and process helpers for verify-club. Source this; do not run it.

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
RUNS_DIR="$SKILL_DIR/runs"
EVIDENCE_ROOT="$SKILL_DIR/evidence"
CURRENT_FILE="$RUNS_DIR/current"

VERIFY_CLUB_HOST="${VERIFY_CLUB_HOST:-127.0.0.1}"
VERIFY_CLUB_PORT="${VERIFY_CLUB_PORT:-43173}"

die() {
  echo "verify-club: $*" >&2
  exit 1
}

is_tcp_port() {
  [[ "${1:-}" =~ ^[1-9][0-9]{0,4}$ ]] && (( 10#$1 <= 65535 ))
}

if ! is_tcp_port "$VERIFY_CLUB_PORT"; then
  die "VERIFY_CLUB_PORT must be an integer 1–65535 (got ${VERIFY_CLUB_PORT})"
fi

run_dir() {
  local id="${1:-}"
  if [[ -z "$id" ]]; then
    [[ -f "$CURRENT_FILE" ]] || die "no current run (launch first)"
    id="$(cat "$CURRENT_FILE")"
  fi
  echo "$RUNS_DIR/$id"
}

read_meta() {
  local dir
  dir="$(run_dir "${1:-}")"
  [[ -f "$dir/pid" && -f "$dir/port" && -f "$dir/url" ]] || die "run metadata missing in $dir"
  RUN_ID="$(basename "$dir")"
  RUN_PID="$(cat "$dir/pid")"
  RUN_PORT="$(cat "$dir/port")"
  if ! is_tcp_port "$RUN_PORT"; then
    die "recorded port is not a TCP port: $RUN_PORT"
  fi
  RUN_URL="$(cat "$dir/url")"
  RUN_LOG="$dir/log"
  EVIDENCE_DIR="$EVIDENCE_ROOT/$RUN_ID"
}

pid_alive() {
  local pid="$1"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

listening_pid() {
  local port="$1"
  if ! command -v lsof >/dev/null 2>&1; then
    echo "verify-club: lsof is required to find the listener on port $port" >&2
    return 1
  fi
  lsof -nP -iTCP:"$port" -sTCP:LISTEN -t 2>/dev/null | head -n 1
}

is_in_tree() {
  local target="$1"
  local ancestor="$2"
  local cur="$target"
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    [[ -n "$cur" ]] || return 1
    [[ "$cur" == "$ancestor" ]] && return 0
    [[ "$cur" == "1" || "$cur" == "0" ]] && return 1
    cur="$(ps -o ppid= -p "$cur" 2>/dev/null | tr -d ' ')"
  done
  return 1
}

pid_command() {
  local pid="$1"
  ps -o command= -p "$pid" 2>/dev/null || true
}

# Kill only a pid we started. Refuse reused PIDs whose command no longer matches.
kill_ours() {
  local pid="${1:-}"
  local mark="${2:-}"
  [[ -n "$pid" && "$pid" != "0" ]] || return 0
  if ! pid_alive "$pid"; then
    return 0
  fi
  local cmd
  cmd="$(pid_command "$pid")"
  if [[ -n "$mark" && "$cmd" != *"$mark"* ]]; then
    echo "verify-club: not killing pid $pid (command no longer matches '$mark')" >&2
    return 0
  fi
  kill_tree "$pid"
}

kill_tree() {
  local pid="$1"
  local child
  [[ -n "$pid" && "$pid" != "0" ]] || return 0
  if command -v pgrep >/dev/null 2>&1; then
    for child in $(pgrep -P "$pid" 2>/dev/null || true); do
      kill_tree "$child"
    done
  fi
  if pid_alive "$pid"; then
    kill "$pid" 2>/dev/null || true
    sleep 0.2
    if pid_alive "$pid"; then
      kill -9 "$pid" 2>/dev/null || true
    fi
  fi
}
