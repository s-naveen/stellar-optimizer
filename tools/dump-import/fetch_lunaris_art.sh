#!/bin/zsh
# Real icons for new (beta) weapons / artifact sets from Lunaris (https://lunaris.moe), which mirrors the
# game's UI assets under their own file names, beta builds included (hakush.in / homdgcat are blocked
# on this network).
# Usage: tools/dump-import/fetch_lunaris_art.sh weapon <WeaponKey>... | artifact <SetKey>...
# For every image name listed for the key in AssetsData_gen.json it downloads
#   weapon:   https://api.lunaris.moe/data/assets/weaponicon/<name>.webp
#   artifact: https://api.lunaris.moe/data/assets/artifacts/<name>.webp
# into a fresh temp dir, checks it is a 256x256 image, converts it to PNG and writes it to
# libs/gi/dm/Texture2D (source for gi-assets gen-file) and libs/gi/assets/src/gen/<kind>s/<Key>/ (same file
# names as the index imports, so no regeneration or dev-server restart is needed; hard-reload the page).
# Missing images are reported and left as they are (e.g. the make_item_standins.sh stand-ins).
set -e
KIND=$1; shift
ROOT=${0:A:h}/../..
TEX=$ROOT/libs/gi/dm/Texture2D; mkdir -p $TEX
case $KIND in
  weapon) SRC=weaponicon; GEN=$ROOT/libs/gi/assets/src/gen/weapons ;;
  artifact) SRC=artifacts; GEN=$ROOT/libs/gi/assets/src/gen/artifacts ;;
  *) echo "usage: $0 weapon|artifact <Key>..."; exit 1 ;;
esac
TMP=$(mktemp -d /tmp/go-lunaris-art-XXXX)
for KEY in "$@"; do
  for name in $(python3 -I -c "import json,sys;d=json.load(open('$ROOT/libs/gi/assets-data/src/AssetsData_gen.json'));print(' '.join(d['${KIND}s']['$KEY'].values()))"); do
    code=$(curl -s --max-time 60 -A 'Mozilla/5.0' -o $TMP/$name.webp -w '%{http_code}' "https://api.lunaris.moe/data/assets/$SRC/$name.webp" || true)
    if [ "$code" != 200 ] || [ "$(magick identify -format '%m %wx%h' $TMP/$name.webp 2>/dev/null)" != "WEBP 256x256" ]; then
      echo "missing $KEY/$name (HTTP $code)"; continue
    fi
    magick $TMP/$name.webp -strip PNG32:$TEX/$name.png
    [ -d $GEN/$KEY ] && cp $TEX/$name.png $GEN/$KEY/$name.png
    echo "ok      $KEY/$name.png"
  done
done
rm -rf $TMP
