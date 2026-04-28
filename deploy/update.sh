#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ASOS — Update / redeploy script
#
# Run on the server inside the deploy directory (default /opt/asos)
# after the initial setup.sh provisioning. Pulls origin/main,
# rebuilds only what changed, runs migrations, restarts services.
#
#   bash deploy/update.sh
#
# Override defaults via env:
#   ASOS_DIR=/srv/asos BRANCH=main ENV_FILE=.env.production \
#     bash deploy/update.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

ASOS_DIR=${ASOS_DIR:-/opt/asos}
BRANCH=${BRANCH:-main}
ENV_FILE=${ENV_FILE:-.env.production}

cd "$ASOS_DIR"

# ── 1. Sanity checks ──────────────────────────────────────────
if [ ! -d ".git" ]; then
  echo "✗ $ASOS_DIR is not a git checkout."
  echo "  This script requires the server to be a git clone of the repo."
  echo "  If you originally rsync'd, convert with:"
  echo "    cd $ASOS_DIR && git init && git remote add origin <repo-url> && git fetch && git reset --hard origin/$BRANCH"
  exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "✗ $ENV_FILE not found in $ASOS_DIR."
  exit 1
fi

if ! git diff-index --quiet HEAD --; then
  echo "✗ Working tree has uncommitted changes — refusing to pull."
  git status --short
  echo "  Resolve these first (commit, stash, or discard) then re-run."
  exit 1
fi

# ── 2. Pull latest ────────────────────────────────────────────
OLD_SHA=$(git rev-parse --short HEAD)
echo "→ At $OLD_SHA — fetching origin/$BRANCH..."
git fetch --quiet origin "$BRANCH"
git checkout --quiet "$BRANCH"
git pull --ff-only --quiet origin "$BRANCH"
NEW_SHA=$(git rev-parse --short HEAD)

if [ "$OLD_SHA" = "$NEW_SHA" ]; then
  echo "✓ Already up to date at $NEW_SHA. Nothing to do."
  exit 0
fi

echo "→ Updated $OLD_SHA → $NEW_SHA"
echo "  Changed files:"
git diff --name-only "$OLD_SHA" "$NEW_SHA" | sed 's/^/    /'

# ── 3. Decide what needs doing ────────────────────────────────
CHANGED=$(git diff --name-only "$OLD_SHA" "$NEW_SHA")
need_migrate=false
need_backend_build=false
need_spa_build=false
need_nginx_reload=false
need_compose_up=false

while IFS= read -r f; do
  case "$f" in
    backend/prisma/migrations/*) need_migrate=true; need_backend_build=true ;;
    backend/prisma/schema.prisma) need_backend_build=true ;;
    backend/*)                   need_backend_build=true ;;
    vite-app/*)                  need_spa_build=true ;;
    nginx/nginx.conf)            need_nginx_reload=true ;;
    docker-compose.yml)          need_compose_up=true ;;
  esac
done <<< "$CHANGED"

# First-deploy safety: if dist/ doesn't exist yet, force a build.
if [ ! -d "vite-app/dist" ]; then
  need_spa_build=true
fi

DC="docker compose --env-file $ENV_FILE"

# ── 4. Apply changes ──────────────────────────────────────────
# Static HTML (top-level *.html, ./frontend/) is bind-mounted into
# nginx — the git pull already updated the files on disk, no
# container action needed.

if $need_backend_build; then
  echo "→ Rebuilding api + worker images..."
  $DC build api worker
fi

if $need_migrate; then
  echo "→ Running database migrations..."
  $DC run --rm migrate
fi

if $need_backend_build; then
  echo "→ Restarting api + worker..."
  $DC up -d api worker
fi

if $need_spa_build; then
  echo "→ Building vite-app SPA (dist is bind-mounted into nginx)..."
  docker run --rm -v "$PWD/vite-app:/app" -w /app node:22-alpine \
    sh -c "npm ci --silent && npm run build"
fi

if $need_nginx_reload; then
  echo "→ Validating + reloading nginx config..."
  $DC exec -T nginx nginx -t
  $DC exec -T nginx nginx -s reload
fi

if $need_compose_up; then
  echo "→ docker-compose.yml changed — reconciling all services..."
  $DC up -d
fi

# ── 5. Health check ───────────────────────────────────────────
echo "→ Waiting for api /health..."
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
echo "║  Deploy complete: $OLD_SHA → $NEW_SHA"
echo "╚══════════════════════════════════════════╝"
