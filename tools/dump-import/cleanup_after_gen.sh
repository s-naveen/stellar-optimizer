#!/bin/zsh
# After running gen-file targets against a NEWER (e.g. beta) dump, keep only the additions for the
# characters/weapons/artifact sets you are adding and restore everything else from the snapshot.
# Usage: tools/dump-import/cleanup_after_gen.sh "<comma separated allow-list keys>" [snapshotDir]
#   allow-list = CharKey, <CharKey>sStellaFortuna, new material keys, avatar id, new material ids, tooltip ids,
#                WeaponKey, weapon id, weapon affix id (1<weaponId>), ArtifactSetKey, set id, set affix id (2<setId>)
set -e
cd ${0:A:h}/../..
ALLOW=$1; SNAP=${2:-/tmp/gi-dump-snapshot}
[ -z "$ALLOW" ] && { echo "allow-list required"; exit 1; }
MERGE=(python3 -I tools/dump-import/merge_gen_json.py $SNAP $ALLOW)
# 1. Combined/aggregate files: merge only allow-listed keys
AGG=(libs/gi/stats/src/allStat_gen.json libs/gi/stats/Data/Materials/material.json
  libs/gi/stats/Data/Artifacts/artifact_set.json
  libs/gi/dm/src/dm/character/AvatarExcelConfigData_idmap_gen.json
  libs/gi/dm/src/dm/material/MaterialExcelConfigData_idmap_gen.json
  libs/gi/dm/src/dm/weapon/WeaponExcelConfigData_idmap_gen.json
  libs/gi/dm/src/dm/common/EquipAffixExcelConfigData_idmap_gen.json
  libs/gi/assets-data/src/AssetsData_gen.json)
"${MERGE[@]}" $AGG
# artifact piece ids are new keys whose value names the set: keep those of allow-listed set ids
python3 -I - $SNAP $ALLOW <<'PY'
import json,sys
snap,allow=sys.argv[1],set(sys.argv[2].split(','))
f='libs/gi/dm/src/dm/artifact/ReliquaryExcelConfigData_idmap_gen.json'
before,after=json.load(open(f'{snap}/{f}')),json.load(open(f))
before.update({k:v for k,v in after.items() if k not in before and str(v[0]) in allow})
raw=open(f'{snap}/{f}').read()
open(f,'w').write(json.dumps(before,indent=2,ensure_ascii=False)+('\n' if raw.endswith('\n') else ''))
PY
LOC=($(git diff --name-only libs/gi/dm-localization | grep -E "/(charNames_gen|material_gen|tooltips_gen|weaponNames_gen|artifactNames_gen)\.json$" || true))
[ ${#LOC} -gt 0 ] && "${MERGE[@]}" "${LOC[@]}" >/dev/null
# 2. Every other modified (tracked) generated file: restore from snapshot (per-entity files of existing chars/weapons)
for f in $(git diff --name-only libs/gi/stats/Data libs/gi/dm/src/dm libs/gi/dm-localization/assets); do
  case $f in
    */AvatarExcelConfigData_idmap_gen.json|*/MaterialExcelConfigData_idmap_gen.json|libs/gi/stats/Data/Materials/material.json) ;;
    */WeaponExcelConfigData_idmap_gen.json|*/EquipAffixExcelConfigData_idmap_gen.json|*/ReliquaryExcelConfigData_idmap_gen.json) ;;
    libs/gi/stats/Data/Artifacts/artifact_set.json) ;;
    */charNames_gen.json|*/material_gen.json|*/tooltips_gen.json|*/weaponNames_gen.json|*/artifactNames_gen.json) ;;
    *) cp $SNAP/$f $f ;;
  esac
done
# 3. Untracked files from earlier imports (e.g. a previous character's *_gen.json) that this run
#    regenerated: restore them too, unless their path names an allow-listed key
python3 -I - $SNAP $ALLOW <<'PY'
import filecmp,os,re,shutil,subprocess,sys
snap,allow=sys.argv[1],[a for a in sys.argv[2].split(',') if not a.isdigit()]
roots=['libs/gi/stats/Data','libs/gi/dm-localization/assets']
out=subprocess.run(['git','ls-files','--others','--exclude-standard',*roots],capture_output=True,text=True).stdout.split()
for p in out:
    s=os.path.join(snap,p)
    if not os.path.exists(s) or filecmp.cmp(s,p,shallow=False): continue
    if any(re.search(rf'(^|[/_]){re.escape(a)}([/_.]|$)',p) for a in allow): continue
    shutil.copy2(s,p); print('restored (earlier import)',p)
PY
git diff --stat libs/gi/stats libs/gi/dm/src/dm libs/gi/dm-localization libs/gi/assets-data | tail -1
