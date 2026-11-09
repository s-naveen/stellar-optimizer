"""Old-build cleanup for the published site repo (dry run unless --apply).

Keeps every file of the current build (DIST) and every asset reachable from index.html of the
last KEEP deploy commits (references followed through their JS/CSS, as of each commit), and
never touches anything outside assets/. Prints counts; with --apply, `git rm`s the rest.

usage: python3 -I prune_site.py <site_repo> <dist_dir> <keep_commits> [--apply]
"""
import os
import re
import subprocess
import sys

site, dist, keep_n = sys.argv[1], sys.argv[2], int(sys.argv[3])
apply = '--apply' in sys.argv

def git(*args):
    return subprocess.run(['git', '-C', site, *args], check=True, capture_output=True).stdout

tracked = set(git('ls-files').decode().split('\n')) - {''}
assets = {p for p in tracked if p.startswith('assets/')}
names = {}
for p in assets:
    names.setdefault(os.path.basename(p), set()).add(p)

current = set()
for root, _, files in os.walk(dist):
    for f in files:
        current.add(os.path.relpath(os.path.join(root, f), dist))

commits = git('log', f'-{keep_n}', '--format=%H').decode().split()
# hashed file names (name-HASH.ext) mentioned anywhere in a text file
REF = re.compile(rb'([A-Za-z0-9_.~-]+\.(?:js|mjs|css|webp|png|jpe?g|svg|gif|woff2?|ttf|otf|mp3|wasm|gz|json|txt))')
TEXT = ('.js', '.mjs', '.css', '.html', '.json', '.svg')

keep = set(current)
for c in commits:
    seen = set()
    queue = ['index.html']
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        if not path.endswith(TEXT):
            continue
        try:
            data = git('show', f'{c}:{path}')
        except subprocess.CalledProcessError:
            continue
        for m in REF.findall(data):
            for cand in names.get(os.path.basename(m.decode()), ()):
                if cand not in seen:
                    queue.append(cand)
    reach = {p for p in seen if p.startswith('assets/')}
    keep |= reach
    print(f'{c[:7]}: {len(reach)} reachable assets')

drop = sorted(p for p in assets if p not in keep)
size = sum(os.path.getsize(os.path.join(site, p)) for p in drop if os.path.exists(os.path.join(site, p)))
print(f'tracked {len(tracked)}, assets {len(assets)}, current build {len(current)}, keep (assets) {len(assets & keep)}')
print(f'drop {len(drop)} files, {size / 1e6:.0f} MB')
print('sample:', drop[:5])
missing = sorted(p for p in current if p not in tracked)
if missing:
    print('WARNING: current build files not in the site repo:', missing[:5])
if apply and drop:
    for i in range(0, len(drop), 500):
        git('rm', '-q', '--', *drop[i:i + 500])
    print('removed', len(drop))
