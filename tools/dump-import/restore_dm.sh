#!/bin/zsh
# Undo use_dump.sh: unlink the dump and restore the official deobf mapping.
set -e
cd ${0:A:h}/../..
rm -rf libs/gi/dm/GenshinData/ExcelBinOutput libs/gi/dm/GenshinData/TextMap
git checkout -- libs/gi/dm/src/mapping/deobf.ts
echo "restored"
