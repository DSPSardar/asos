#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ASOS — Roll the deploy back to a previous commit.
#
#   bash deploy/rollback.sh <commit-ish>
#   bash deploy/rollback.sh HEAD~1
#   bash deploy/rollback.sh 4bab4d1 --force
#
# Rebuilds api + worker, rebuilds the SPA, restarts services. It
# will NOT undo Prisma migrations that were added between the
# target SHA and current HEAD — those are forward-only. If
# migrations were added in the range, the script aborts unless
# you pass --force (use only when the new migrations are
# backwards-compatible, e.g. additive columns).
# ─────────────────────────────────────────────────────────────

set -euo pipefail

ASOS_DIR=${ASOS_DIR:-/opt/asos}
ENV_FILE=${ENV_FILE:-.env.production}
FORCE=false

usage() {
  echo "Usage: bash deploy/rollback.sh <commit-ish> [--force]"
  echo "       bash deploy/rollback.sh HEAD~1"
  exit 1
}

[ $# -lt 1 ] && usage

TARGET=$1
shift || true
[ "${1:-}" = "--force" ] && FORCE=true

cd "$ASOS_DIR"

if [ ! -d ".git" ]; then
  echo "✗ $ASOS_DIR is not a git checkout. Run deploy/bootstrap-git.sh first."
  exit 1
fi

if ! git rev-parse --verify "$TARGET" >/dev/null 2>&1; then
  echo "✗ '$TARGET' is not a valid commit."
  exit 1
fi

OLD_SHA=$(git rev-parse --short HEAD)
NEW_SHA=$(git rev-parse --short "$TARGET")

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "✓ Already at $NEW_SHA. Nothing to do."
  exit 0
fi

echo "→ Rolling back: $OLD_SHA → $NEW_SHA"
echo "  Commits that will be reverted:"
git log --oneline "$NEW_SHA..$OLD_SHA" | sed 's/^/    /'

# Refuse to roll back across forward-only migrations unless --force.
MIGRATIONS_AHEAD=$(git diff --name-only --diff-filter=A "$NEW_SHA" "$OLD_SHA" -- 'backend/prisma/migrations/' || true)
if [ -n "$MIGRATIONS_AHEAD" ] && ! $FORCE; then
  echo ""
  echo "✗ Prisma migrations were added after $NEW_SHA:"
  echo "$MIGRATIONS_AHEAD" | sed 's/^/    /'
  echo ""
  echo "  Prisma migrations are forward-only — this script can't undo them."
  echo "  If the schema changes are backwards-compatible (additive only),"
  echo "  the old code may still work against the new schema. To proceed:"
  echo "    bash deploy/rollback.sh $TARGET --force"
  echo ""
  echo "  Otherwise, craft a down-migration manually first."
  exit 1
fi

echo "→ git reset --hard $NEW_SHA"
git reset --hard -q "$NEW_SHA"

DC="docker compose --env-file $ENV_FILE"

echo "→ Rebuilding api + worker images..."
$DC build api worker

echo "→ Restarting api + worker..."
$DC up -d api worker

if [ -d "vite-app" ]; then
  echo "→ Rebuilding vite-app SPA..."
  docker run --rm -v "$PWD/vite-app:/app" -w /app node:22-alpine \
    sh -c "npm ci --silent && npm run build"
fi

echo "→ Reloading nginx..."
$DC exec -T nginx nginx -t
$DC exec -T nginx nginx -s reload

echo "→ Health check..."
for i in $(seq 1 15); do
  if curl -fsS http://127.0.0.1:3000/health >/dev/null 2>&1; then
    echo "✓ api healthy"
    break
  fi
  if [ "$i" = "15" ]; then
    echo "✗ api did not become healthy after 30s. Check logs:"
    echo "  $DC logs --tail=80 api"
    exit 1
  fi
  sleep 2
done

echo ""
echo "╔══════════════════════════════════════════╗"
echo "║  Rollback complete: $OLD_SHA → $NEW_SHA"
echo "╚══════════════════════════════════════════╝"
