# Usage: python3 -I tools/dump-import/find_allow_list.py <snapshotDir> <CharKey> [<CharKey> ...]
# Run AFTER gen targets, BEFORE cleanup. Prints the comma-separated allow-list for cleanup_after_gen.sh:
#   char keys, <Key>sStellaFortuna, avatar ids, NEW material keys+ids used by their ascension/talents,
#   NEW tooltip ids referenced by char_<Key>_gen.json.
import json,re,sys
snap,keys=sys.argv[1],sys.argv[2:]
E='libs/gi/dm/GenshinData/ExcelBinOutput'
J=lambda f: json.load(open(f'{E}/{f}.json'))
mapping={int(i):k for i,k in re.findall(r"^\s*(\d{8}): '(\w+)'",open('libs/gi/dm/src/mapping/character.ts').read(),re.M)}
ids={k:i for i,k in mapping.items() if k in keys}
av={a['id']:a for a in J('AvatarExcelConfigData')}
skills={s['id']:s for s in J('AvatarSkillExcelConfigData')}
depots={d['id']:d for d in J('AvatarSkillDepotExcelConfigData')}
promote=J('AvatarPromoteExcelConfigData'); proud=J('ProudSkillExcelConfigData')
idmap=json.load(open('libs/gi/dm/src/dm/material/MaterialExcelConfigData_idmap_gen.json'))
oldmat=json.load(open(f'{snap}/libs/gi/stats/Data/Materials/material.json'))
oldtip=json.load(open(f'{snap}/libs/gi/dm-localization/assets/locales/en/tooltips_gen.json'))
allow=[]
for k in keys:
    a=av[ids[k]]; allow+= [k, f'{k}sStellaFortuna', str(a['id'])]
    dep=depots[a['skillDepotId']]
    groups={skills[s]['proudSkillGroupId'] for s in dep['skills']+[dep['energySkill']] if s and skills[s].get('proudSkillGroupId')}
    matids={c['id'] for p in promote if p['avatarPromoteId']==a['avatarPromoteId'] for c in p.get('costItems',[]) if c.get('id')}
    matids|={c['id'] for p in proud if p.get('proudSkillGroupId') in groups for c in p.get('costItems',[]) if c.get('id')}
    for m in sorted(matids):
        name=idmap.get(str(m))
        if name and name not in oldmat: allow+=[name,str(m)]; print(f'# {k}: new material {name} ({m})',file=sys.stderr)
    loc=open(f'libs/gi/dm-localization/assets/locales/en/char_{k}_gen.json').read()
    for t in sorted(set(re.findall(r'baseKey18=(\d+)',loc))):
        if t not in oldtip: allow.append(t); print(f'# {k}: new tooltip {t}',file=sys.stderr)
print(','.join(dict.fromkeys(allow)))
