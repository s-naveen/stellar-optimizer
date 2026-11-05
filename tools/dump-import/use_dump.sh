#!/bin/zsh
# Point the GI datamine pipeline (libs/gi/dm/GenshinData) at a YuanShenResources-style dump.
# Usage: tools/dump-import/use_dump.sh [dumpDir=./YuanShenResources]
#  - builds float32-rounded copies of the Excel tables the pipeline reads (dump stores full float precision)
#  - fixes field-name differences (HyperLink "ID" -> "id")
#  - links TextMaps, mapping RU/TH file names to what TextMapUtil.ts expects
#  - swaps deobf.ts property names to the dump's (readable) names
# Undo with tools/dump-import/restore_dm.sh
set -e
ROOT=${0:A:h}/../..; cd $ROOT
DUMP=${1:-$ROOT/YuanShenResources}; DUMP=${DUMP:A}
NORM=/tmp/gi-dump-excel-norm
DM=libs/gi/dm/GenshinData
[ -d $DM/.git ] || [ -f $DM/.git ] && { echo "GenshinData submodule is initialized; refusing to overwrite"; exit 1; }
FILES=($(grep -rhoE "readDMJSON\(\s*'ExcelBinOutput/[^']+'" libs/gi/dm/src | sed -E "s/.*ExcelBinOutput\///; s/'//" | sort -u))
rm -rf $NORM
python3 -I tools/dump-import/normalize_excel.py $DUMP/ExcelBinOutput $NORM "${FILES[@]}"
python3 -I - $NORM <<'PY'
import json,sys
# field names the dump spells differently from the official data: (file, dump name, expected name)
renames=[('HyperLinkNameExcelConifgData.json','ID','id'),
         # without this, gen-locale skips every artifact set (no set names/effects are generated)
         ('ReliquarySetExcelConfigData.json','EquipAffixId','equipAffixId')]
for f,old,new in renames:
    p=f'{sys.argv[1]}/{f}'
    d=json.load(open(p))
    for x in d:
        if old in x and new not in x: x[new]=x.pop(old)
    json.dump(d,open(p,'w'),ensure_ascii=False)
PY
rm -rf $DM/ExcelBinOutput $DM/TextMap; mkdir -p $DM/TextMap
ln -s $NORM $DM/ExcelBinOutput
for f in $DUMP/TextMap/*.json; do ln -s $f $DM/TextMap/; done
cd $DM/TextMap
# RU / TH split-file names expected by TextMapUtil.ts
[ -e TextMapRU.json ] && { ln -sf $DUMP/TextMap/TextMapRU.json TextMapRU_0.json; [ -e TextMapRU_1.json ] || echo '{}' > TextMapRU_1.json; }
[ -e TextMapTH_2.json ] && { rm -f TextMapTH_0.json TextMapTH_1.json; ln -s $DUMP/TextMap/TextMapTH_1.json TextMapTH_0.json; ln -s $DUMP/TextMap/TextMapTH_2.json TextMapTH_1.json; }
[ -e TextMap_MediumRU.json ] && { ln -sf $DUMP/TextMap/TextMap_MediumRU.json TextMap_MediumRU_0.json; echo '{}' > TextMap_MediumRU_1.json; }
[ -e TextMap_MediumTH.json ] && { ln -sf $DUMP/TextMap/TextMap_MediumTH.json TextMap_MediumTH_0.json; echo '{}' > TextMap_MediumTH_1.json; }
cd $ROOT
# deobf names -> dump names (see deobf.dump-names.json; re-derive if a new dump changes them, see README)
python3 -I - <<'PY'
import json,re
p='libs/gi/dm/src/mapping/deobf.ts'
m=json.load(open('tools/dump-import/deobf.dump-names.json'))
s=open(p).read()
for k,v in m.items():
    s=re.sub(rf"(\n  {k}: )'[^']*'", rf"\1'{v}'", s)
open(p,'w').write(s)
PY
echo "GenshinData now points at $DUMP"
