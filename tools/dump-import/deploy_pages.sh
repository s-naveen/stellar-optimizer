#!/bin/zsh
# Build the GI frontend and publish ONLY the built site (no source, no dump) to GitHub Pages.
# Default target: org site https://gi-beta73.github.io/  (repo gi-beta73/gi-beta73.github.io, branch main)
# Usage: tools/dump-import/deploy_pages.sh [owner=gi-beta73] [repo=<owner>.github.io] [branch=main]
# Needs `gh auth login` once (account must be an owner of the org).
#
# A persistent local copy of the published site lives in ~/.cache/<repo>-site. New builds are
# copied on top WITHOUT deleting old content-hashed assets, so browsers that still have an older
# index.html cached can load their chunks; and only changed files are uploaded (fast deploys).
set -e
cd ${0:A:h}/../..
REPO_ROOT=$PWD
OWNER=${1:-gi-beta73}
REPO=${2:-$OWNER.github.io}
BRANCH=${3:-main}
SITE=$HOME/.cache/${REPO%.github.io}-site
eval "$(fnm env)" && fnm use 24 >/dev/null
gh auth setup-git

# every deploy is a release: the changelog's newest version must not be tagged yet (add one first:
# node tools/site/release.mjs draft > entry.json, edit it, release.mjs add entry.json, commit).
# REDEPLOY=1 publishes the same release again (say, after a failed Pages run).
VERSION=$(node -p "require('./libs/gi/ui/src/changelog/changelog.json')[0].version")
if git rev-parse -q --verify "refs/tags/v$VERSION" >/dev/null && [ "$REDEPLOY" != 1 ]; then
  echo "ABORT: v$VERSION is already released. Add the next release to the changelog first."; exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "ABORT: commit first (the release is tagged on HEAD)"; exit 1
fi
gh repo view $OWNER/$REPO >/dev/null 2>&1 || gh repo create $OWNER/$REPO --public --description "Genshin Optimizer (unofficial build)"

# images are converted to WebP at build time (apps/frontend/vite-plugin-webp.mts); without cwebp
# the site still works but ships ~4x larger PNGs
command -v cwebp >/dev/null || echo "WARNING: cwebp not found (brew install webp): images will ship as large PNGs"
rm -rf dist/apps/frontend   # vite does not empty an outDir outside the app root (stale bundles)
NX_DAEMON=false yarn nx run frontend:build --parallel=1 --skip-nx-cache
# safety scan: abort if tracker/ad code or build-machine environment leaked into the bundle
if grep -rqlE "googletagmanager|gtag\(|googlesyndication|adsbygoogle|lootbar|CLAUDE_CODE|SSH_AUTH_SOCK|$USER" dist/apps/frontend; then
  echo "ABORT: tracker/ad/env leak found in bundle"; exit 1
fi
touch dist/apps/frontend/.nojekyll            # keep files starting with "_"

if [ ! -d $SITE/.git ]; then
  git clone -q --depth 1 --branch $BRANCH https://github.com/$OWNER/$REPO.git $SITE 2>/dev/null || {
    mkdir -p $SITE && git -C $SITE init -q -b $BRANCH && git -C $SITE remote add origin https://github.com/$OWNER/$REPO.git; }
fi
# sitemap <lastmod>: the deployed date for unchanged pages, today for changed ones; the changed
# URLs are submitted to IndexNow once the push is live
node tools/site/seo-publish.mjs lastmod dist/apps/frontend $SITE > /tmp/indexnow-urls.txt
# copy the new build over the old one (no --delete: old hashed assets stay available)
rsync -a dist/apps/frontend/ $SITE/
cd $SITE
git add -A
git -c user.name="$OWNER" -c user.email="$OWNER@users.noreply.github.com" commit -q -m "Deploy v$VERSION $(date '+%F %T')" || echo "nothing changed"
git push -q origin $BRANCH
gh api -X POST repos/$OWNER/$REPO/pages -f "source[branch]=$BRANCH" -f "source[path]=/" >/dev/null 2>&1 || true
echo "Pushed $(git rev-parse --short HEAD). The Pages workflow deploys it (~30 s, longer with many new files): https://$REPO/"
# stellaroptimizer.com: the released-only build (no beta content: apps/frontend/beta-content.json)
# on Cloudflare Pages, a second copy whose canonical links point to the GitHub site. Built while
# GitHub Pages deploys; any beta content (or tracker/env leak) in it stops the upload.
# Needs `npx wrangler@4 login` once.
CF_PROJECT=${CF_PAGES_PROJECT:-stellar-optimizer}
cd $REPO_ROOT
rm -rf dist/apps/frontend-released
if ! GO_RELEASED=1 NX_DAEMON=false yarn nx run frontend:build --parallel=1 --skip-nx-cache; then
  echo "WARNING: the released build failed: stellaroptimizer.com not updated"
elif grep -rqlE "googletagmanager|gtag\(|googlesyndication|adsbygoogle|lootbar|CLAUDE_CODE|SSH_AUTH_SOCK|$USER" dist/apps/frontend-released; then
  echo "WARNING: tracker/ad/env leak in the released build: stellaroptimizer.com not updated"
elif ! node tools/site/beta-leak-scan.mjs dist/apps/frontend-released; then
  echo "WARNING: beta content in the released build: stellaroptimizer.com not updated"
else
  npx --yes wrangler@4 pages deploy dist/apps/frontend-released --project-name $CF_PROJECT \
    --branch main --commit-hash $(git rev-parse HEAD) --commit-message "v$VERSION" --commit-dirty=true ||
    echo "WARNING: the Cloudflare Pages upload failed: stellaroptimizer.com still serves the previous version"
fi
cd $SITE
# tell Bing/Yandex/… about the changed pages (waits until the deploy serves them)
node $REPO_ROOT/tools/site/seo-publish.mjs indexnow $SITE < /tmp/indexnow-urls.txt || echo "IndexNow submission failed (not fatal)"
# the release: tag v$VERSION on the source commit and publish its notes on GitHub
cd $REPO_ROOT && node tools/site/release.mjs publish
