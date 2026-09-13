# Shared paths for verify-engine. Source this; do not run it.

SKILL_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$SKILL_DIR/../../.." && pwd)"
RUNS_DIR="$SKILL_DIR/runs"
EVIDENCE_ROOT="$SKILL_DIR/evidence"
CURRENT_FILE="$RUNS_DIR/current"

# Registered tunables. A dirty process env tags specs +env and invalidates seed pins.
TG_KEYS=(
  TG_BT_REGULARIZATION
  TG_BT_MAX_ITERATIONS
  TG_BT_TOLERANCE
  TG_MIN_COMPARISONS
  TG_MIN_OPPONENTS
  TG_TOP_K_REFERRALS
)

die() {
  echo "verify-engine: $*" >&2
  exit 1
}

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
  [[ -f "$dir/repo" ]] || die "run metadata missing in $dir"
  RUN_ID="$(basename "$dir")"
  RUN_DIR="$dir"
  EVIDENCE_DIR="$EVIDENCE_ROOT/$RUN_ID"
}

unset_tg() {
  local key
  for key in "${TG_KEYS[@]}"; do
    unset "$key"
  done
}

tg_dirty() {
  local key
  for key in "${TG_KEYS[@]}"; do
    if [[ -n "${!key:-}" ]]; then
      return 0
    fi
  done
  return 1
}

capture_cmd() {
  local out="$1"
  shift
  mkdir -p "$out"
  local start end
  start="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  set +e
  "$@" >"$out/stdout.txt" 2>"$out/stderr.txt"
  local code=$?
  set -e
  end="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf '%s\n' "$code" >"$out/exit_code"
  {
    echo "cwd $REPO_ROOT"
    echo "cmd $*"
    echo "started $start"
    echo "ended $end"
    echo "exit $code"
  } >"$out/meta.txt"
  return "$code"
}
