#!/bin/zsh
# Snapshot every generated output BEFORE running any gen-file target.
# Usage: tools/dump-import/snapshot.sh [snapshotDir=/tmp/gi-dump-snapshot]
set -e
cd ${0:A:h}/../..
SNAP=${1:-/tmp/gi-dump-snapshot}
rm -rf $SNAP && mkdir -p $SNAP
rsync -a --relative \
  libs/gi/stats/Data libs/gi/stats/src/allStat_gen.json \
  libs/gi/dm-localization/assets \
  libs/gi/mats/src/allCharacterMats_gen.json \
  libs/gi/assets-data/src/AssetsData_gen.json \
  libs/gi/dm/src/dm \
  $SNAP/
echo "snapshot saved to $SNAP"
