#!/usr/bin/env bash
# Create the local-backend council account. Refuses before provision-user
# unless both Convex URLs pass the same loopback check doctor uses.
# Password is SEED_DEV_PASSWORD. Never print it.
set -euo pipefail
source "$(cd "$(dirname "$0")" && pwd)/lib.sh"

assert_local_backend_convex_url "${NEXT_PUBLIC_CONVEX_URL:-}"
assert_local_backend_convex_url "${NEXT_PUBLIC_CONVEX_SITE_URL:-}"

password="${SEED_DEV_PASSWORD:-}"
secret="${ADMIN_PROVISION_SECRET:-}"
if [[ -z "$password" || -z "$secret" ]]; then
  die "Set SEED_DEV_PASSWORD and ADMIN_PROVISION_SECRET."
fi
if ((${#password} < 8)); then
  die "SEED_DEV_PASSWORD must be at least 8 characters."
fi

email="council.clerk@example.test"
cd "$REPO_ROOT/apps/club"
exec env \
  OWNER_EMAIL="$email" \
  OWNER_NAME="Council Clerk" \
  OWNER_PASSWORD="$password" \
  ACCOUNT_ROLE=admin \
  ADMIN_PROVISION_SECRET="$secret" \
  bun scripts/provision-user.ts
