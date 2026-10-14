#!/usr/bin/env bash
# Evidence intake and snapshots against a LOCAL Convex backend (recipe: features/evidence-snapshots.md).
# Refuses unless apps/club/.env.local selects a local or anonymous deployment.
#
#   evidence-proof.sh env                         local-only env; Jev -> fake-jev.ts on 127.0.0.1:3320
#   evidence-proof.sh signup <contact>            member refers a candidate with a resume PDF; prints the id
#   evidence-proof.sh state <person>              resume lines, Jev records, intake row
#   evidence-proof.sh backdate <person> <days>    the referral was <days> ago, and the candidate is due now
#   evidence-proof.sh cron <label>                run evidence:daily (the cron) and save every snapshot row
#   evidence-proof.sh check <person> <label>      run evidence:check for one candidate and save every snapshot row
#   evidence-proof.sh set-github <person> <url>   late evidence: give the candidate a GitHub profile
#   evidence-proof.sh diff <label> <label>        snapshot rows added, and rows changed or removed
#
# Output goes to $EVIDENCE_DIR. Secrets come from the shell and are never printed.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

CLUB="$REPO_ROOT/apps/club"
CONVEX="$CLUB/node_modules/.bin/convex"
OUT="${EVIDENCE_DIR:?Set EVIDENCE_DIR (e.g. evidence/<run>/evidence-snapshots).}"
mkdir -p "$OUT"
cd "$CLUB"

deployment="$(sed -n 's/^CONVEX_DEPLOYMENT=\([^ #]*\).*/\1/p' .env.local 2>/dev/null | head -1)"
case "$deployment" in
  local:* | anonymous:*) ;;
  *) die "evidence-proof refuses CONVEX_DEPLOYMENT=${deployment:-unset}; select a local backend." ;;
esac
assert_local_backend_convex_url "${NEXT_PUBLIC_CONVEX_URL:-}"
assert_local_backend_convex_url "${NEXT_PUBLIC_CONVEX_SITE_URL:-}"

snapshots() {
  "$CONVEX" data evidenceSnapshots --limit 1000 --format jsonl | jq -S -c 'del(._creationTime)' | sort >"$OUT/$1.jsonl"
  echo "$1: $(wc -l <"$OUT/$1.jsonl" | tr -d ' ') snapshot rows"
}
jev_calls() {
  local log="$OUT/fake-jev.jsonl"
  [[ -f "$log" ]] && echo "fake jev requests: $(jq -r .kind "$log" | sort | uniq -c | tr -s ' ' | tr '\n' ' ')"
  return 0
}
candidate() {
  jq -c --arg p "$2" 'select(.candidateId == $p)
    | {id, kind, claimCount, thin, inputHash: .inputHash[0:12], evidenceCutoff, classYear, correctsSnapshotId}' "$OUT/$1.jsonl"
}

case "${1:-}" in
  env)
    : "${ADMIN_PROVISION_SECRET:?Set ADMIN_PROVISION_SECRET.}"
    "$CONVEX" env set TYPESAFE_BASE_URL "http://127.0.0.1:3320" >/dev/null
    "$CONVEX" env set TYPESAFE_API_KEY "fake-local-jev" >/dev/null
    "$CONVEX" env set SITE_URL "${SITE_URL:-http://127.0.0.1:43173}" >/dev/null
    "$CONVEX" env set CLUB_DEV_SEED 1 >/dev/null
    "$CONVEX" env set ADMIN_PROVISION_SECRET "$ADMIN_PROVISION_SECRET" >/dev/null
    "$CONVEX" env get BETTER_AUTH_SECRET >/dev/null 2>&1 ||
      "$CONVEX" env set BETTER_AUTH_SECRET "$(openssl rand -hex 32)" >/dev/null
    "$CONVEX" env list | cut -d= -f1
    ;;
  signup)
    bun "$SKILL_DIR/helpers/evidence-signup.ts" "${2:?contact}" "$OUT/resume.pdf"
    ;;
  state)
    person="${2:?person}"
    "$CONVEX" data resumeVersions --format jsonl |
      jq -c --arg p "$person" 'select(.personId == $p) | {personId, normalized, lineCount, evidenceKeys: (.evidenceKeys | length)}'
    "$CONVEX" data resumeLines --limit 1000 --format jsonl | jq -c '{index, statement}' | sort
    "$CONVEX" data jevJudgments --limit 1000 --format jsonl |
      jq -c --arg p "$person" 'select(.personId == $p) | (.claim | fromjson) as $c
        | {source, author, tier: $c.evidenceTier, startedAt: $c.jobDates.startedAt, specId, configHash: .configHash[0:12]}' | sort
    "$CONVEX" data evidenceIntakes --limit 1000 --format jsonl | jq -c --arg p "$person" 'select(.personId == $p)'
    jev_calls
    ;;
  backdate)
    person="${2:?person}" days="${3:?days}"
    "$CONVEX" data evidenceIntakes --limit 1000 --format jsonl |
      jq -c --arg p "$person" --argjson days "$days" --argjson now "$(date +%s)" 'del(._creationTime)
        | if .personId == $p then .intakeAt = (($now - $days * 86400) | todate) | .nextDueAt = ($now * 1000) else . end' \
        >"$OUT/intakes-backdated.jsonl"
    "$CONVEX" import --table evidenceIntakes --replace -y "$OUT/intakes-backdated.jsonl" 2>&1 | tail -1
    "$CONVEX" data evidenceIntakes --limit 1000 --format jsonl | jq -c --arg p "$person" 'select(.personId == $p) | {personId, intakeAt}'
    ;;
  cron)
    "$CONVEX" run evidence:daily | jq -c .
    sleep "${EVIDENCE_SETTLE_SECONDS:-20}"
    snapshots "${2:?label}"
    jev_calls
    ;;
  check)
    person="${2:?person}"
    "$CONVEX" run evidence:check "{\"personId\":\"$person\"}" | jq -c .
    snapshots "${3:?label}"
    candidate "$3" "$person"
    jev_calls
    ;;
  set-github)
    person="${2:?person}" url="${3:?url}"
    "$CONVEX" data clubPeople --limit 1000 --format jsonl |
      jq -c --arg p "$person" --arg url "$url" 'del(._creationTime) | if .id == $p then .github = $url else . end' \
        >"$OUT/people-edited.jsonl"
    "$CONVEX" import --table clubPeople --replace -y "$OUT/people-edited.jsonl" 2>&1 | tail -1
    "$CONVEX" data clubPeople --limit 1000 --format jsonl | jq -c --arg p "$person" 'select(.id == $p) | {id, status, github}'
    ;;
  diff)
    before="$OUT/${2:?label}.jsonl" after="$OUT/${3:?label}.jsonl"
    comm -13 "$before" "$after" | jq -c '{added: .id, kind, candidateId, correctsSnapshotId}'
    comm -23 "$before" "$after" | jq -c '{changedOrRemoved: .id}'
    echo "$2 -> $3: $(comm -13 "$before" "$after" | wc -l | tr -d ' ') added, $(comm -23 "$before" "$after" | wc -l | tr -d ' ') changed or removed"
    ;;
  *)
    sed -n '2,16p' "$0"
    exit 2
    ;;
esac
