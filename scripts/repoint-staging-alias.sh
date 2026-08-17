#!/usr/bin/env bash
set -euo pipefail

# Keeps every bookmarked staging URL pointed at the current `staging`
# branch build. Safe to run any time -- it only ever re-points aliases to
# wherever the branch's own build already is, and does nothing else.
#
# WHY THIS EXISTS
#
# malaysia-iko-gojuryu-kata-competition-staging.vercel.app is a manually
# created alias (someone ran `vercel alias set` once). Vercel does NOT move
# a manual alias on its own -- that is different from a real custom domain
# attached to the Production environment, which Vercel *does* repoint
# automatically after every deploy to `main`. The manual alias sat 21 hours
# stale while several rounds of fixes shipped and were verified, because
# every `git push origin staging` produces a brand-new preview URL and
# nothing was re-running the repoint. Testing against the bookmarked link
# kept showing old, already-fixed bugs.
#
# testkatacompetition.ikogojuryukaratedomalaysia.com is a real custom
# domain added later for the same purpose, and it has the exact same
# problem: `vercel alias set` snapshots the deployment it resolved to at
# the moment the command ran, it does not keep following anything
# afterward. Both aliases need the same repoint, every time. (Previously
# this was fockaratedokatacompetition.ikogojuryukaratedomalaysia.com,
# renamed 2026-08-17 and released back to the Vercel account.)
#
# THE FIX
#
# Vercel *does* maintain its own permanent, auto-updating alias for the
# `staging` branch:
#
#   malaysia-iko-gojuryu-kata-git-baf997-kimsiewkiew-1251s-projects.vercel.app
#
# ("baf997" is Vercel's own short hash of the branch name, not a commit --
# the literal name "...-git-staging-kimsiewkiew-1251s-projects.vercel.app"
# is 77 characters, over the 63-character DNS label limit, so Vercel
# substitutes a short hash to keep the alias unique and stable.) That URL
# always resolves to the newest READY deployment on `staging`, with zero
# maintenance -- confirmed by re-checking it across two different
# deployments hours apart and finding it had already moved on its own.
#
# This script resolves that platform-native alias once and points every
# FRIENDLY bookmark below at whatever it currently resolves to. That is
# deliberately more robust than grepping `vercel ls` for "the newest
# Preview deployment" ourselves: this project's Vercel scope can have
# preview deployments from other branches or PRs in flight, and
# re-deriving "which one is actually `staging`" by hand is exactly the
# kind of guess that caused the original staleness. Asking Vercel's own
# branch alias is not a guess.

AUTO_BRANCH_ALIAS="malaysia-iko-gojuryu-kata-git-baf997-kimsiewkiew-1251s-projects.vercel.app"

# Every human-facing URL that should always mean "the current staging
# build." Add new ones here -- this is the only place that needs to know.
FRIENDLY_ALIASES=(
  "malaysia-iko-gojuryu-kata-competition-staging.vercel.app"
  "testkatacompetition.ikogojuryukaratedomalaysia.com"
)

echo "==> Resolving the current staging build via Vercel's own branch alias..."
CURRENT_URL=$(npx vercel inspect "$AUTO_BRANCH_ALIAS" 2>&1 | grep -oE 'https://[a-zA-Z0-9.-]+\.vercel\.app' | head -1)

if [ -z "$CURRENT_URL" ]; then
  echo "Could not resolve $AUTO_BRANCH_ALIAS -- aborting without changing any alias." >&2
  echo "(If the branch alias's hash segment ever changes, update AUTO_BRANCH_ALIAS above --" >&2
  echo " check 'npx vercel inspect <any-recent-staging-preview-url>' for its current alias.)" >&2
  exit 1
fi

echo "==> Current staging build: $CURRENT_URL"

for alias in "${FRIENDLY_ALIASES[@]}"; do
  echo "==> Repointing $alias -> $CURRENT_URL"
  npx vercel alias set "$CURRENT_URL" "$alias"
done

echo "==> Verifying..."
for alias in "${FRIENDLY_ALIASES[@]}"; do
  npx vercel alias ls 2>&1 | grep "$alias"
done
