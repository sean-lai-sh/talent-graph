# Shared paths for verify-judge-weights. Source this; do not run it.
# Process and loopback helpers come from verify-club. Do not copy them.

JW_HELPERS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
JW_SKILL="$(cd "$JW_HELPERS/.." && pwd)"
JW_REPO="$(cd "$JW_SKILL/../../.." && pwd)"
CLUB_SKILL="$JW_REPO/.cursor/skills/verify-club"

# shellcheck source=/dev/null
source "$CLUB_SKILL/helpers/lib.sh"

JW_RUNS="$JW_SKILL/runs"
JW_EVIDENCE="$JW_SKILL/evidence"
JW_CURRENT="$JW_RUNS/current"

jw_die() {
  echo "verify-judge-weights: $*" >&2
  exit 1
}

jw_run_dir() {
  local id="${1:-}"
  if [[ -z "$id" ]]; then
    [[ -f "$JW_CURRENT" ]] || jw_die "no current run (launch first)"
    id="$(cat "$JW_CURRENT")"
  fi
  echo "$JW_RUNS/$id"
}

jw_read_meta() {
  local dir
  dir="$(jw_run_dir "${1:-}")"
  [[ -f "$dir/mode" && -f "$dir/app_url" && -f "$dir/convex_url" ]] || jw_die "run metadata missing in $dir"
  JW_RUN_ID="$(basename "$dir")"
  JW_RUN_DIR="$dir"
  JW_MODE="$(cat "$dir/mode")"
  JW_APP_URL="$(cat "$dir/app_url")"
  JW_CONVEX_URL="$(cat "$dir/convex_url")"
  JW_CONVEX_SITE="$(cat "$dir/convex_site_url")"
  JW_EVIDENCE_DIR="$JW_EVIDENCE/$JW_RUN_ID"
}

# App port is verify-club's port. Never the developer server.
if [[ "${VERIFY_CLUB_PORT}" == "3000" ]]; then
  jw_die "refusing port 3000. The app binds 127.0.0.1:43173."
fi
