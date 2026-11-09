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
git -c user.name="$OWNER" -c user.email="$OWNER@users.noreply.github.com" commit -q -m "Deploy $(date '+%F %T')" || echo "nothing changed"
git push -q origin $BRANCH
gh api -X POST repos/$OWNER/$REPO/pages -f "source[branch]=$BRANCH" -f "source[path]=/" >/dev/null 2>&1 || true
echo "Pushed $(git rev-parse --short HEAD). Pages rebuild takes ~1 min: https://$REPO/"
# tell Bing/Yandex/… about the changed pages (waits until the deploy serves them)
node $REPO_ROOT/tools/site/seo-publish.mjs indexnow $SITE < /tmp/indexnow-urls.txt || echo "IndexNow submission failed (not fatal)"
