#!/bin/zsh
# Usage: make_placeholders.sh <CharKey> <ImageCharName>
# Creates placeholder PNGs in libs/gi/dm/Texture2D for every asset of the character listed in AssetsData_gen.json
# Replace them with real images (same file names) when available, then re-run gi-assets:gen-file.
set -e
KEY=$1; NAME=${2:-$1}
ROOT=${0:A:h}/../..
OUT=$ROOT/libs/gi/dm/Texture2D; mkdir -p $OUT
for icon in $(python3 -I -c "import json,sys;d=json.load(open('$ROOT/libs/gi/assets-data/src/AssetsData_gen.json'));print(' '.join(v for v in d['chars']['$KEY'].values() if isinstance(v,str)))"); do
  case $icon in
    UI_NameCardPic_*_P) size=840x400;;
    UI_NameCardPic_*_Alpha) size=420x100;;
    UI_AvatarIcon_Side_*) size=128x128;;
    UI_AvatarIcon_*) size=256x256;;
    *) size=128x128;;
  esac
  magick -size $size xc:'#7b3fbf' -gravity center -font /System/Library/Fonts/Helvetica.ttc -fill white -pointsize 28 -annotate 0 "$NAME" $OUT/$icon.png
done
ls $OUT | grep -c "$NAME"
