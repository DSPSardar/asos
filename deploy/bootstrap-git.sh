#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────
# ASOS — One-time conversion of an rsync'd deploy directory into
# a git checkout, so deploy/update.sh can pull updates from origin.
#
# Run once on the server, after the original setup.sh provisioning:
#   bash deploy/bootstrap-git.sh
#
# Override defaults via env:
#   ASOS_DIR=/opt/asos REPO_URL=https://github.com/DSPSardar/asos.git \
#     BRANCH=main bash deploy/bootstrap-git.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

ASOS_DIR=${ASOS_DIR:-/opt/asos}
REPO_URL=${REPO_URL:-https://github.com/DSPSardar/asos.git}
BRANCH=${BRANCH:-main}

cd "$ASOS_DIR"

if [ -d ".git" ]; then
  echo "✗ $ASOS_DIR is already a git repo. Use deploy/update.sh to pull updates."
  exit 1
fi

if [ ! -f "docker-compose.yml" ]; then
  echo "✗ Doesn't look like an ASOS deploy dir (no docker-compose.yml in $ASOS_DIR)."
  exit 1
fi

echo "→ Initializing git in $ASOS_DIR..."
git init -q -b "$BRANCH"
git remote add origin "$REPO_URL"

echo "→ Fetching $BRANCH from $REPO_URL..."
git fetch -q origin "$BRANCH"

# --mixed: HEAD + index point at origin/$BRANCH; working tree is
# left as-is. Local files that differ from origin will show up as
# "modified" in git status — review before running update.sh.
echo "→ Setting HEAD to origin/$BRANCH (working tree untouched)..."
git reset --mixed -q "origin/$BRANCH"
git branch --set-upstream-to="origin/$BRANCH" "$BRANCH" >/dev/null 2>&1

echo ""
echo "✓ Repo initialized at $(git rev-parse --short HEAD)"
echo ""
echo "  Local files that differ from origin/$BRANCH:"
git status --short || true
echo ""
echo "  Next steps:"
echo "    1. Review local diffs. setup.sh substitutes the real domain"
echo "       into nginx/nginx.conf — that diff is expected."
echo "    2. Either:"
echo "         git checkout -- <file>     # discard a local change"
echo "         git stash                  # set aside all local changes"
echo "    3. Once the working tree is clean:"
echo "         bash deploy/update.sh"
