# Usage: python3 -I tools/dump-import/dump_kit.py <dumpDir> <CharacterName as in TextMap EN>
import json,sys,os
R=sys.argv[1]
NAME=sys.argv[2] if len(sys.argv)>2 else 'Mitya'
J=lambda f: json.load(open(f'{R}/ExcelBinOutput/{f}.json'))
tm={}
for f in ['TextMapEN','TextMap_MediumEN']: tm.update(json.load(open(f'{R}/TextMap/{f}.json')))
T=lambda h: tm.get(str(h),f'<{h}>')
av=next(a for a in J('AvatarExcelConfigData') if T(a['nameTextMapHash'])==NAME)
print('AVATAR',av['id'],'depot',av['skillDepotId'],av['qualityType'],av['weaponType'])
dep=next(d for d in J('AvatarSkillDepotExcelConfigData') if d['id']==av['skillDepotId'])
print('DEPOT',json.dumps(dep))
skills={s['id']:s for s in J('AvatarSkillExcelConfigData')}
proud=J('ProudSkillExcelConfigData')
def pgroup(g): return sorted([p for p in proud if p.get('proudSkillGroupId')==g],key=lambda p:p.get('level',0))
for sid in dep['skills']+[dep['energySkill']]+dep['subSkills']:
    if not sid or sid not in skills: continue
    s=skills[sid]
    print('\n### SKILL',sid,T(s.get('nameTextMapHash')),'| CD',s.get('cdTime'),'| energy',s.get('costElemVal'),s.get('costElemType'),'| charges',s.get('maxChargeNum'))
    print(T(s.get('descTextMapHash')))
    g=s.get('proudSkillGroupId')
    if g:
        ps=pgroup(g)
        if ps:
            descs=[T(h) for h in ps[0]['paramDescList'] if str(h) in tm and T(h)]
            for i,dsc in enumerate(descs): pass
            print('PARAM DESCS:'); [print('  ',d) for d in descs]
            print('PARAMS by level (lv1, lv10, lv13):')
            for lv in (0,9,12):
                if lv<len(ps): print('  lv',lv+1,ps[lv]['paramList'][:30])
print('\n### PASSIVES')
for o in dep['inherentProudSkillOpens']:
    g=o.get('proudSkillGroupId')
    if not g: continue
    for p in pgroup(g):
        print('\n--',g,'promote',o.get('needAvatarPromoteLevel'),T(p['nameTextMapHash']));print(T(p['descTextMapHash']));print('  params',p['paramList'][:20])
print('\n### CONSTELLATIONS')
tal={t['talentId']:t for t in J('AvatarTalentExcelConfigData')}
for t in dep['talents']:
    x=tal[t];print('\n--',t,T(x['nameTextMapHash']));print(T(x['descTextMapHash']));print('  params',x['paramList'])
