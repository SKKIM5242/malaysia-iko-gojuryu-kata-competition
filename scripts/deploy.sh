#!/usr/bin/env bash
set -euo pipefail

# Deploys the current `main` commit to Production, fast-forwards `staging`
# to match, waits for both builds, then repoints the bookmarked staging
# alias as an unskippable last step (see repoint-staging-alias.sh for why
# that step exists at all).
#
# Run this instead of the git push steps by hand. The whole reason the
# staging bookmark went 21 hours stale is that the repoint was a step to
# REMEMBER, done by hand, after a multi-step process -- exactly the kind of
# step that gets dropped under a backlog of unrelated fixes. Folding it into
# one script removes the "remember to" part entirely.
#
# Production's custom domains (ikogojuryukaratedomalaysia.com and its
# subdomains) already auto-track the newest Production deployment on their
# own -- confirmed against production's own deploy history, not assumed.
# Nothing needs to be aliased for those; this script only ever touches the
# staging alias.

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_DIR"

echo "==> Pushing main (production)..."
git push origin main

echo "==> Fast-forwarding staging to main..."
git checkout staging
git merge --ff-only main
git push origin staging
git checkout main

# Polls `vercel ls` for the newest deployment in the given environment
# column ("Production" or "Preview") to reach Ready. Only used to know WHEN
# to stop waiting -- which exact deployment is "the" staging one is left to
# repoint-staging-alias.sh's own, more reliable resolution.
wait_for_ready() {
  local env_label="$1"
  local line=""
  for _ in $(seq 1 24); do
    line=$(npx vercel ls --yes 2>&1 | grep "$env_label" | head -1 || true)
    if echo "$line" | grep -q "Ready"; then
      echo "$line" | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app'
      return 0
    fi
    sleep 15
  done
  echo "Timed out waiting for a Ready $env_label deployment" >&2
  return 1
}

echo "==> Waiting for the Production build..."
PROD_URL=$(wait_for_ready "Production")
echo "==> Production build ready: $PROD_URL"

echo "==> Waiting for the staging Preview build..."
wait_for_ready "Preview" >/dev/null

echo "==> Repointing the staging bookmark..."
bash "$PROJECT_DIR/scripts/repoint-staging-alias.sh"

echo
echo "Done."
echo "  Production (custom domains already point here automatically): $PROD_URL"
echo "  Staging bookmark: https://malaysia-iko-gojuryu-kata-competition-staging.vercel.app"
