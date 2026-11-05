#!/bin/zsh
# Stand-in icons for new weapons / artifact sets whose art is not out yet.
# Usage: tools/dump-import/make_item_standins.sh weapon <WeaponKey>... | artifact <SetKey>...
# For every image name listed for the key in AssetsData_gen.json, writes a 256x256 transparent PNG to
# libs/gi/dm/Texture2D: the app's own weapon-type / artifact-slot glyph, centred. On the rarity
# background of the cards it reads as a generic silhouette, not as (wrong) art.
# Existing files are kept, so real images placed there first (same file names) win.
# Then run gi-assets:gen-file (see README).
set -e
KIND=$1; shift
ROOT=${0:A:h}/../..
OUT=$ROOT/libs/gi/dm/Texture2D; mkdir -p $OUT
GLYPHS=$ROOT/libs/gi/assets/src/assets
for KEY in "$@"; do
  python3 -I - $ROOT $KIND $KEY <<'PY' | while read name glyph; do
import json, sys
root, kind, key = sys.argv[1:]
assets = json.load(open(f'{root}/libs/gi/assets-data/src/AssetsData_gen.json'))
if kind == 'weapon':
    weapon_type = json.load(open(f'{root}/libs/gi/stats/src/allStat_gen.json'))['weapon']['data'][key]['weaponType']
    for name in assets['weapons'][key].values(): print(name, f'icon_{weapon_type}.png')
elif kind == 'artifact':
    for slot, name in assets['artifacts'][key].items(): print(name, f'icon_slot_{slot}.png')
else:
    sys.exit(f'unknown kind {kind}')
PY
    if [ -e $OUT/$name.png ]; then echo "keep   $name.png"; continue; fi
    magick $GLYPHS/$glyph -resize 168x168 -background none -gravity center -extent 256x256 -strip $OUT/$name.png
    echo "made   $name.png ($glyph)"
  done
done
