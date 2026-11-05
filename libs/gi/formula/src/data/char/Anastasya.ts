import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import type { NumNode } from '@genshin-optimizer/pando/engine'
import { cmpEq, cmpGE, min, prod, sum } from '@genshin-optimizer/pando/engine'
import {
  allBoolConditionals,
  allListConditionals,
  customDmg,
  customParam,
  own,
  ownBuff,
  percent,
  register,
  target,
  team,
  teamBuff,
} from '../util'
import { dataGenToCharInfo, dmg, entriesForChar, talentSubscript } from './util'

const key: CharacterKey = 'Anastasya'
const data_gen = allStats.char.data[key]
const skillParam_gen = allStats.char.skillParam[key]

let a = 0,
  s = 0,
  b = 0
const dm = {
  normal: {
    hitArr: [
      skillParam_gen.auto[a++],
      skillParam_gen.auto[a++],
      skillParam_gen.auto[a++],
      skillParam_gen.auto[a++],
      skillParam_gen.auto[a++],
    ],
  },
  charged: {
    aimed: skillParam_gen.auto[a++],
    fullyCharged: skillParam_gen.auto[a++],
  },
  plunging: {
    dmg: skillParam_gen.auto[a++],
    low: skillParam_gen.auto[a++],
    high: skillParam_gen.auto[a++],
  },
  skill: {
    tapDmg: skillParam_gen.skill[s++],
    holdDmg: skillParam_gen.skill[s++],
    crownDmg: skillParam_gen.skill[s++],
    crownSc: skillParam_gen.skill[s++],
    crownSs: skillParam_gen.skill[s++],
    honorHitArr: [
      skillParam_gen.skill[s++],
      skillParam_gen.skill[s++],
      skillParam_gen.skill[s++],
      skillParam_gen.skill[s++],
      skillParam_gen.skill[s++],
    ],
    honorSgArr: [0, 1, 2, 3, 4].map(() => ({
      sc: skillParam_gen.skill[s++],
      ss: skillParam_gen.skill[s++],
    })),
    crownDuration: skillParam_gen.skill[s++][0],
    honorDuration: skillParam_gen.skill[s++][0],
    cd: skillParam_gen.skill[s++][0],
  },
  burst: {
    loveDmg: skillParam_gen.burst[b++],
    love_stellar_dmg_: skillParam_gen.burst[b++],
    crownSc: skillParam_gen.burst[b++],
    crownSs: skillParam_gen.burst[b++],
    triumphSc: skillParam_gen.burst[b++],
    triumphSs: skillParam_gen.burst[b++],
    evernightSc: skillParam_gen.burst[b++],
    evernightSs: skillParam_gen.burst[b++],
    doom1Dmg: skillParam_gen.burst[b++],
    doomSgArr: [0, 1, 2].map(() => ({
      sc: skillParam_gen.burst[b++],
      ss: skillParam_gen.burst[b++],
    })),
    loveDuration: skillParam_gen.burst[b++][0],
    honorDuration: skillParam_gen.burst[b++][0],
    cd: skillParam_gen.burst[b++][0],
    enerCost: skillParam_gen.burst[b++][0],
  },
  passive1: { critDMG_: skillParam_gen.passive1[0][0] },
  passive2: { stellarswirl_mult_: skillParam_gen.passive2[1][0] },
  passive3: {
    baseDmgPer100Atk: skillParam_gen.passive3![1][0],
    maxBaseDmg: skillParam_gen.passive3![2][0],
  },
  constellation1: {
    cryo_atk_: skillParam_gen.constellation1[0],
    eleMas: skillParam_gen.constellation1[1],
    sealedMult: skillParam_gen.constellation1[2],
  },
  constellation2: {
    stellar_critDMG_: skillParam_gen.constellation2[0],
    honorMult: skillParam_gen.constellation2[2],
    stellar_specialDmg_: skillParam_gen.constellation2[4],
  },
  constellation4: { accoladesInc: skillParam_gen.constellation4[0] },
  constellation6: {
    triumphMult: skillParam_gen.constellation6[2],
    love_specialDmg_: skillParam_gen.constellation6[3],
    doomMult: skillParam_gen.constellation6[4],
    honor_specialDmg_: skillParam_gen.constellation6[5],
  },
} as const

const OTHERS = 3

const info = dataGenToCharInfo(data_gen)
const {
  final,
  char: { ascension, constellation, skill, burst },
} = own

// WR cond(key, 'blessing') love | honor
const { blessing } = allListConditionals(info.key, ['love', 'honor'])
// WR cond(key, 'a0StellarRadianceSc') on | ss
const { a0StellarRadianceSc } = allListConditionals(info.key, ['on', 'ss'])
// WR cond(key, 'accolades') on | loveSeal | honorSeal
const { accolades } = allListConditionals(info.key, [
  'on',
  'loveSeal',
  'honorSeal',
])
// WR cond(key, 'burstActive') `'on'`
const { burstActive } = allBoolConditionals(info.key)

const love = blessing.map({ love: 1, honor: 0 })
const honor = blessing.map({ love: 0, honor: 1 })
const radSc = a0StellarRadianceSc.map({ on: 1, ss: 0 })
const radSs = a0StellarRadianceSc.map({ on: 0, ss: 1 })
const c1On = cmpGE(constellation, 1, 1)

/* A1 Accolades — WR computes units per destination (self vs others). Pando has no
 * "destination is source" tag, so: teamBuff = others' value, ownBuff = self - others. */
const othersUnits = accolades.map({
  on: 1,
  loveSeal: 0, // replaced below (needs C1 branch)
  honorSeal: 0,
})
// Own unit + 1/3 of Anastasya's, the shared part x3 at C1 (user-confirmed)
const othersLoveSeal = sum(
  1,
  prod(1 / OTHERS, cmpGE(constellation, 1, dm.constellation1.sealedMult, 1))
)
const othersHonorSeal = c1On
const othersU = sum(
  othersUnits,
  cmpEq(accolades.value, 2, othersLoveSeal),
  cmpEq(accolades.value, 3, othersHonorSeal)
)
const selfU = sum(
  cmpEq(accolades.value, 1, 1),
  cmpEq(accolades.value, 2, c1On),
  cmpEq(accolades.value, 3, 1 + OTHERS)
)
const c4Mult = sum(
  1,
  cmpGE(constellation, 4, percent(dm.constellation4.accoladesInc))
)
const a1 = (units: NumNode) =>
  cmpGE(ascension, 1, prod(units, c4Mult, percent(dm.passive1.critDMG_)))
const c1Atk = (units: NumNode) =>
  cmpGE(
    ascension,
    1,
    cmpGE(
      constellation,
      1,
      prod(units, c4Mult, percent(dm.constellation1.cryo_atk_))
    )
  )
const c1Em = (units: NumNode) =>
  cmpGE(
    ascension,
    1,
    cmpGE(constellation, 1, prod(units, c4Mult, dm.constellation1.eleMas))
  )
const selfMinusOthers = sum(selfU, prod(-1, othersU))
/* C1 copies keep the source's type (Cryo copy -> ATK, non-Cryo copy -> EM); see WR sheet. */
const v = accolades.value
const cryoAllies = sum(team.common.count.cryo, -1)
const nonCryoAllies = sum(OTHERS, prod(-1, cryoAllies))
const othersAtkCopies = (tc: NumNode) =>
  sum(cmpEq(v, 1, tc), cmpEq(v, 2, sum(tc, 1)), cmpEq(v, 3, tc))
const othersEmCopies = (tc: NumNode) =>
  sum(
    cmpEq(v, 1, sum(1, prod(-1, tc))),
    cmpEq(v, 2, sum(1, prod(-1, tc))),
    cmpEq(v, 3, sum(1, prod(-1, tc)))
  )
const selfAtkCopies = sum(
  cmpEq(v, 1, 1),
  cmpEq(v, 2, 1),
  cmpEq(v, 3, sum(1, cryoAllies))
)
const selfEmCopies = cmpEq(v, 3, nonCryoAllies)
const destCryo = cmpEq(target.char.ele, 'cryo', 1, 0)

const a4_stellarswirl_mult_ = cmpGE(
  ascension,
  4,
  percent(dm.passive2.stellarswirl_mult_)
)
const a0_baseDmg_ = min(
  prod(percent(dm.passive3.baseDmgPer100Atk), final.atk, 1 / 100),
  percent(dm.passive3.maxBaseDmg)
)
const love_stellar_dmg_ = burstActive.ifOn(
  prod(love, percent(talentSubscript(burst, dm.burst.love_stellar_dmg_)))
)
const c2Love_critDMG_ = cmpGE(
  constellation,
  2,
  prod(love, percent(dm.constellation2.stellar_critDMG_))
)
const honorMult = sum(
  1,
  cmpGE(constellation, 2, prod(honor, percent(dm.constellation2.honorMult - 1)))
)
const team_specialDmg_ = sum(
  cmpGE(constellation, 2, percent(dm.constellation2.stellar_specialDmg_)),
  cmpGE(
    constellation,
    6,
    prod(love, percent(dm.constellation6.love_specialDmg_))
  )
)
const c6Honor_selfSpecialDmg_ = cmpGE(
  constellation,
  6,
  prod(honor, percent(dm.constellation6.honor_specialDmg_))
)

const scOn = cmpGE(radSc, 1, 'infer', '')
const ssOn = cmpGE(radSs, 1, 'infer', '')
const notSsOn = cmpGE(sum(1, prod(-1, radSs)), 1, 'infer', '')
// Talent-scaled ATK hit (any talent) as a given move
const hit = (
  name: string,
  talent: typeof skill,
  arr: number[],
  move: 'normal' | 'skill' | 'burst',
  cond: ReturnType<typeof cmpGE> | 'infer' = 'infer',
  mult?: ReturnType<typeof sum> | ReturnType<typeof prod>
) =>
  customDmg(
    name,
    'cryo',
    move,
    prod(
      final.atk,
      percent(talentSubscript(talent, arr)),
      ...(mult ? [mult] : [])
    ),
    { cond }
  )

export default register(
  info.key,
  entriesForChar(info, data_gen),
  ownBuff.char.burst.add(cmpGE(constellation, 3, 3)),
  ownBuff.char.skill.add(cmpGE(constellation, 5, 3)),

  // A1 / C1 Accolades
  teamBuff.premod.critDMG_.add(a1(othersU)),
  ownBuff.premod.critDMG_.add(a1(selfMinusOthers)),
  teamBuff.premod.atk_.add(c1Atk(othersAtkCopies(destCryo))),
  ownBuff.premod.atk_.add(
    c1Atk(sum(selfAtkCopies, prod(-1, othersAtkCopies(sum(1))))) // Anastasya is Cryo
  ),
  teamBuff.premod.eleMas.add(c1Em(othersEmCopies(destCryo))),
  ownBuff.premod.eleMas.add(c1Em(selfEmCopies)),
  // A0 — WR stellarconduct/stellarswirl_baseDmg_ (no Pando baseDmg_ tag)
  teamBuff.premod.dmg_.stellarconduct.add(a0_baseDmg_),
  teamBuff.premod.dmg_.stellarswirl.add(a0_baseDmg_),
  // A4 — WR stellarswirl_mult_ (no Pando tag); listed as a param
  // Burst (Love) — team Stellar Glimmer DMG
  teamBuff.premod.dmg_.stellarconduct.add(love_stellar_dmg_),
  teamBuff.premod.dmg_.stellarswirl.add(love_stellar_dmg_),
  // C2 — Stellar Glimmer CRIT DMG (Love)
  teamBuff.premod.critDMG_.stellarconduct.add(c2Love_critDMG_),
  teamBuff.premod.critDMG_.stellarswirl.add(c2Love_critDMG_),
  // C2/C6 — WR *_specialDmg_ (no Pando tag)
  teamBuff.premod.dmg_.stellarconduct.add(team_specialDmg_),
  teamBuff.premod.dmg_.stellarswirl.add(team_specialDmg_),
  ownBuff.premod.dmg_.stellarconduct.add(c6Honor_selfSpecialDmg_),
  ownBuff.premod.dmg_.stellarswirl.add(c6Honor_selfSpecialDmg_),

  dm.normal.hitArr.flatMap((arr, i) =>
    dmg(`normal_${i}`, info, 'atk', arr, 'normal')
  ),
  dmg('charged_aimed', info, 'atk', dm.charged.aimed, 'charged', {
    ele: 'physical',
  }),
  dmg('charged_full', info, 'atk', dm.charged.fullyCharged, 'charged', {
    ele: 'cryo',
  }),
  Object.entries(dm.plunging).flatMap(([k, v]) =>
    dmg(`plunging_${k}`, info, 'atk', v, 'plunging')
  ),
  dmg('skill_tap', info, 'atk', dm.skill.tapDmg, 'skill'),
  dmg('skill_hold', info, 'atk', dm.skill.holdDmg, 'skill'),
  dmg('skill_crown', info, 'atk', dm.skill.crownDmg, 'skill'),
  // WR stellarDmgNode; talent-style listing until trans pipeline exists.
  hit('skill_crownSc', skill, dm.skill.crownSc, 'skill', scOn),
  hit('skill_crownSs', skill, dm.skill.crownSs, 'skill', ssOn),
  dm.skill.honorHitArr.flatMap((arr, i) => [
    ...hit(`skill_honor${i}`, skill, arr, 'normal', 'infer', honorMult),
    ...hit(
      `skill_honor${i}Sc`,
      skill,
      dm.skill.honorSgArr[i].sc,
      'normal',
      scOn,
      honorMult
    ),
    ...hit(
      `skill_honor${i}Ss`,
      skill,
      dm.skill.honorSgArr[i].ss,
      'normal',
      ssOn,
      honorMult
    ),
  ]),
  dmg('burst_love', info, 'atk', dm.burst.loveDmg, 'burst'),
  hit('burst_crownSc', burst, dm.burst.crownSc, 'burst', notSsOn),
  hit('burst_crownSs', burst, dm.burst.crownSs, 'burst', ssOn),
  hit('burst_triumphSc', burst, dm.burst.triumphSc, 'burst', notSsOn),
  hit('burst_triumphSs', burst, dm.burst.triumphSs, 'burst', ssOn),
  hit(
    'burst_evernightSc',
    burst,
    dm.burst.evernightSc,
    'burst',
    notSsOn,
    honorMult
  ),
  hit(
    'burst_evernightSs',
    burst,
    dm.burst.evernightSs,
    'burst',
    ssOn,
    honorMult
  ),
  hit('burst_doom1', burst, dm.burst.doom1Dmg, 'skill', 'infer', honorMult),
  dm.burst.doomSgArr.flatMap(({ sc, ss }, i) => [
    ...hit(`burst_doom${i}Sc`, burst, sc, 'burst', notSsOn, honorMult),
    ...hit(`burst_doom${i}Ss`, burst, ss, 'burst', ssOn, honorMult),
  ]),

  // C6 — extra Triumph (Love, 250%) / Doom 3rd hit (Honor, 200%)
  hit(
    'c6_triumphSc',
    burst,
    dm.burst.triumphSc,
    'burst',
    cmpGE(constellation, 6, cmpGE(love, 1, notSsOn, ''), ''),
    sum(dm.constellation6.triumphMult)
  ),
  hit(
    'c6_triumphSs',
    burst,
    dm.burst.triumphSs,
    'burst',
    cmpGE(constellation, 6, cmpGE(love, 1, ssOn, ''), ''),
    sum(dm.constellation6.triumphMult)
  ),
  hit(
    'c6_doom3Sc',
    burst,
    dm.burst.doomSgArr[2].sc,
    'burst',
    cmpGE(constellation, 6, cmpGE(honor, 1, notSsOn, ''), ''),
    prod(dm.constellation6.doomMult, honorMult)
  ),
  hit(
    'c6_doom3Ss',
    burst,
    dm.burst.doomSgArr[2].ss,
    'burst',
    cmpGE(constellation, 6, cmpGE(honor, 1, ssOn, ''), ''),
    prod(dm.constellation6.doomMult, honorMult)
  ),

  customParam('a0_stellarconduct_baseDmg_', a0_baseDmg_),
  customParam('a0_stellarswirl_baseDmg_', a0_baseDmg_),
  customParam('a4_stellarswirl_mult_', a4_stellarswirl_mult_, {
    cond: cmpGE(ascension, 4, 'infer', ''),
  }),
  customParam('skill_crownDuration', dm.skill.crownDuration),
  customParam('skill_honorDuration', dm.skill.honorDuration),
  customParam('skill_cd', dm.skill.cd),
  customParam('burst_loveDuration', dm.burst.loveDuration),
  customParam('burst_honorDuration', dm.burst.honorDuration),
  customParam('burst_cd', dm.burst.cd),
  customParam('burst_enerCost', dm.burst.enerCost)
)
