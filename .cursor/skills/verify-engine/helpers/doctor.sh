#!/usr/bin/env bash
# Read-only: is this checkout worth driving with demo / drift?
# Usage: helpers/doctor.sh
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

read_meta

if ! command -v bun >/dev/null 2>&1; then
  die "bun is not on PATH"
fi

[[ -f "$REPO_ROOT/package.json" ]] || die "package.json missing at $REPO_ROOT"
name="$(sed -n 's/.*"name": "\([^"]*\)".*/\1/p' "$REPO_ROOT/package.json" | head -n 1)"
[[ "$name" == "talent-graph" ]] || die "package name is '$name', expected talent-graph"

[[ -f "$REPO_ROOT/scripts/demo.ts" ]] || die "scripts/demo.ts missing"
[[ -f "$REPO_ROOT/scripts/drift.ts" ]] || die "scripts/drift.ts missing"
[[ -d "$REPO_ROOT/node_modules" ]] || die "node_modules missing; run launch"

if tg_dirty; then
  echo "verify-engine: WARNING TG_* is set in this shell; baseline demo/drift pins will not hold unless helpers unset them" >&2
fi

# Cheap load of the seed generator — not a feature proof.
(
  cd "$REPO_ROOT"
  unset_tg
  bun --eval 'import { generateSeed } from "./src/seed/generate.ts"; const d = generateSeed(); if (d.people.length < 6) process.exit(1);'
) || die "generateSeed() failed to load"

echo "verify-engine doctor ok"
echo "  run      $RUN_ID"
echo "  bun      $(bun --version)"
echo "  package  talent-graph"
echo "  demo     bun run demo"
echo "  drift    bun run drift -- --kind <kind> --before <ver> --after <ver>"
echo "  evidence $EVIDENCE_DIR"
