import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import { cmpGE, cmpNE, min, prod, sum } from '@genshin-optimizer/pando/engine'
import { destIsActive } from '../common/conds'
import {
  allBoolConditionals,
  allListConditionals,
  allNumConditionals,
  customDmg,
  customParam,
  customShield,
  enemyDebuff,
  own,
  ownBuff,
  percent,
  register,
  teamBuff,
} from '../util'
import { dataGenToCharInfo, dmg, entriesForChar, talentSubscript } from './util'

const key: CharacterKey = 'Danica'
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
    ],
  },
  charged: {
    spinningDmg: skillParam_gen.auto[a++],
    finalDmg: skillParam_gen.auto[a++],
    stam: skillParam_gen.auto[a++][0],
    duration: skillParam_gen.auto[a++][0],
  },
  plunging: {
    dmg: skillParam_gen.auto[a++],
    low: skillParam_gen.auto[a++],
    high: skillParam_gen.auto[a++],
  },
  skill: {
    dmg: skillParam_gen.skill[s++],
    entryDmg: skillParam_gen.skill[s++],
    onFieldDmg: skillParam_gen.skill[s++],
    coordDmg: skillParam_gen.skill[s++],
    shieldAtk_: skillParam_gen.skill[s++],
    shieldFlat: skillParam_gen.skill[s++],
    anchorHitArr: [
      skillParam_gen.skill[s++],
      skillParam_gen.skill[s++],
      skillParam_gen.skill[s++],
      skillParam_gen.skill[s++],
    ],
    anchorDuration: skillParam_gen.skill[s++][0],
    entryCd: skillParam_gen.skill[s++][0],
    cd: skillParam_gen.skill[s++][0],
  },
  burst: {
    hit1Dmg: skillParam_gen.burst[b++],
    hit1ScDmg: skillParam_gen.burst[b++],
    hit234Dmg: skillParam_gen.burst[b++],
    hit5Dmg: skillParam_gen.burst[b++],
    hit5ScDmg: skillParam_gen.burst[b++],
    atkRatio: skillParam_gen.burst[b++],
    maxAtk: skillParam_gen.burst[b++],
    onFieldDmg_: skillParam_gen.burst[b++],
    duration: skillParam_gen.burst[b++][0],
    cd: skillParam_gen.burst[b++][0],
    enerCost: skillParam_gen.burst[b++][0],
  },
  passive1: {
    electro_enemyRes_: skillParam_gen.passive1[0][0],
    radElectro_enemyRes_: skillParam_gen.passive1[1][0],
    radCryo_enemyRes_: skillParam_gen.passive1[2][0],
  },
  passive2: { atk_: skillParam_gen.passive2[0][0], atkSPD_: 0.2 },
  passive3: {
    baseDmgPer100Atk: skillParam_gen.passive3![0][0],
    maxBaseDmg: skillParam_gen.passive3![1][0],
  },
  constellation1: {
    defenseInc: skillParam_gen.constellation1[2],
    battleInc: skillParam_gen.constellation1[3],
  },
  constellation2: {
    allyAtkMult: skillParam_gen.constellation2[2],
    selfAtkMult: skillParam_gen.constellation2[3],
  },
  constellation6: {
    stellarconduct_specialDmg_: skillParam_gen.constellation6[0],
    defenseAtkStep: skillParam_gen.constellation6[1],
    defenseDmg_: skillParam_gen.constellation6[2],
    defenseMaxDmg_: skillParam_gen.constellation6[3],
    battleAtkStep: skillParam_gen.constellation6[4],
    battleCritRate_: skillParam_gen.constellation6[5],
    battleCritDMG_: skillParam_gen.constellation6[6],
    battleMaxCritRate_: skillParam_gen.constellation6[7],
    battleMaxCritDMG_: skillParam_gen.constellation6[8],
  },
} as const

const info = dataGenToCharInfo(data_gen)
const {
  final,
  premod,
  char: { ascension, constellation, burst },
} = own

// WR cond(key, 'anchor' | 'burstEnhanced' | 'a0StellarRadianceSc' | 'c2Toast') `'on'`
const { anchor, burstEnhanced, a0StellarRadianceSc, c2Toast } =
  allBoolConditionals(info.key)
// WR cond(key, 'maidForm') defense | battle
const { maidForm } = allListConditionals(info.key, ['defense', 'battle'])
// WR lookup a4Stacks 1–3; c2SelfToast 1–7
const { a4Stacks } = allNumConditionals(info.key, true, 0, 3)
const { c2SelfToast } = allNumConditionals(info.key, true, 0, 7)

const inDefense = maidForm.map({ defense: 1, battle: 0 })
const inBattle = maidForm.map({ defense: 0, battle: 1 })
const radiance = a0StellarRadianceSc.ifOn(1)

const a1_electro_enemyRes_ = cmpGE(
  ascension,
  1,
  anchor.ifOn(
    sum(
      percent(-dm.passive1.electro_enemyRes_),
      prod(radiance, percent(-dm.passive1.radElectro_enemyRes_))
    )
  )
)
const a1_cryo_enemyRes_ = cmpGE(
  ascension,
  1,
  anchor.ifOn(prod(radiance, percent(-dm.passive1.radCryo_enemyRes_)))
)
const a4_atk_ = cmpGE(
  ascension,
  4,
  prod(inDefense, percent(dm.passive2.atk_)) // one-time, does not stack
)
const a4_atkSPD_ = cmpGE(
  ascension,
  4,
  prod(inBattle, a4Stacks, percent(dm.passive2.atkSPD_))
)
const a0_stellarconduct_baseDmg_ = min(
  prod(percent(dm.passive3.baseDmgPer100Atk), final.atk, 1 / 100),
  percent(dm.passive3.maxBaseDmg)
)
const c1DefenseMult = sum(
  1,
  cmpGE(constellation, 1, percent(dm.constellation1.defenseInc))
)
const c1BattleMult = sum(
  1,
  cmpGE(constellation, 1, percent(dm.constellation1.battleInc))
)
const burstDefense_atk = burstEnhanced.ifOn(
  prod(
    inDefense,
    c1DefenseMult,
    min(
      prod(percent(talentSubscript(burst, dm.burst.atkRatio)), premod.atk),
      talentSubscript(burst, dm.burst.maxAtk)
    )
  )
)
const burstBattle_onField_dmg_ = burstEnhanced.ifOn(
  prod(
    inBattle,
    c1BattleMult,
    percent(talentSubscript(burst, dm.burst.onFieldDmg_))
  )
)
const c2Toast_dmgInc = cmpGE(
  constellation,
  2,
  c2Toast.ifOn(prod(percent(dm.constellation2.allyAtkMult), final.atk))
)
const c2SelfToast_dmgInc = cmpGE(
  constellation,
  2,
  prod(inBattle, c2SelfToast, percent(dm.constellation2.selfAtkMult), final.atk)
)
const c6_specialDmg_ = cmpGE(
  constellation,
  6,
  anchor.ifOn(percent(dm.constellation6.stellarconduct_specialDmg_))
)
const c6Defense_dmg_ = cmpNE(
  destIsActive,
  0,
  cmpGE(
    constellation,
    6,
    prod(
      inDefense,
      min(
        prod(
          percent(dm.constellation6.defenseDmg_),
          final.atk,
          1 / dm.constellation6.defenseAtkStep
        ),
        percent(dm.constellation6.defenseMaxDmg_)
      )
    )
  )
)
const c6Battle_critRate_ = cmpGE(
  constellation,
  6,
  prod(
    inBattle,
    min(
      prod(
        percent(dm.constellation6.battleCritRate_),
        final.atk,
        1 / dm.constellation6.battleAtkStep
      ),
      percent(dm.constellation6.battleMaxCritRate_)
    )
  )
)
const c6Battle_critDMG_ = cmpGE(
  constellation,
  6,
  prod(
    inBattle,
    min(
      prod(
        percent(dm.constellation6.battleCritDMG_),
        final.atk,
        1 / dm.constellation6.battleAtkStep
      ),
      percent(dm.constellation6.battleMaxCritDMG_)
    )
  )
)

const shieldBase = sum(
  prod(
    percent(talentSubscript(own.char.skill, dm.skill.shieldAtk_)),
    final.atk
  ),
  talentSubscript(own.char.skill, dm.skill.shieldFlat)
)

export default register(
  info.key,
  entriesForChar(info, data_gen),
  // C3 burst; C5 skill
  ownBuff.char.burst.add(cmpGE(constellation, 3, 3)),
  ownBuff.char.skill.add(cmpGE(constellation, 5, 3)),

  ownBuff.premod.atk_.add(a4_atk_),
  ownBuff.premod.atkSPD_.add(a4_atkSPD_),
  // WR teamBuff.premod.<ele>_enemyRes_; Pando enemy preRes. Keep WR sign.
  enemyDebuff.common.preRes.electro.add(a1_electro_enemyRes_),
  enemyDebuff.common.preRes.cryo.add(a1_cryo_enemyRes_),
  // A0 — WR teamBuff stellarconduct_baseDmg_ (no Pando baseDmg_ tag, same as Sandrone/Mitya)
  teamBuff.premod.dmg_.stellarconduct.add(a0_stellarconduct_baseDmg_),
  // C6 — WR teamBuff stellarconduct_specialDmg_ (no Pando specialDmg_ tag)
  teamBuff.premod.dmg_.stellarconduct.add(c6_specialDmg_),
  teamBuff.premod.dmg_.stellarconduct.add(c6Defense_dmg_),
  // Burst (Defense Maid, Radiance) — WR teamBuff.total.atk from Danica's premod ATK
  teamBuff.final.atk.add(burstDefense_atk),

  dm.normal.hitArr.flatMap((arr, i) =>
    dmg(`normal_${i}`, info, 'atk', arr, 'normal')
  ),
  dmg('charged_spinning', info, 'atk', dm.charged.spinningDmg, 'charged'),
  dmg('charged_final', info, 'atk', dm.charged.finalDmg, 'charged'),
  Object.entries(dm.plunging).flatMap(([k, v]) =>
    dmg(`plunging_${k}`, info, 'atk', v, 'plunging')
  ),
  dmg('skill', info, 'atk', dm.skill.dmg, 'skill'),
  dmg('skill_coord', info, 'atk', dm.skill.coordDmg, 'skill'),
  // Anchor Special Normal Attacks: Electro Normal Attack DMG scaling with Skill level
  dm.skill.anchorHitArr.flatMap((arr, i) =>
    customDmg(
      `skill_anchor${i}`,
      'electro',
      'normal',
      prod(final.atk, percent(talentSubscript(own.char.skill, arr)))
    )
  ),
  // WR stellarDmgNode (stellarconduct / electro, ATK); talent-style listing until trans pipeline exists.
  dmg('skill_entry', info, 'atk', dm.skill.entryDmg, 'skill'),
  dmg(
    'skill_onField',
    info,
    'atk',
    dm.skill.onFieldDmg,
    'skill',
    {},
    ownBuff.premod.dmg_.skill.add(burstBattle_onField_dmg_),
    ownBuff.premod.critRate_.add(c6Battle_critRate_),
    ownBuff.premod.critDMG_.add(c6Battle_critDMG_)
  ),
  customShield('skill_shield', undefined, shieldBase),
  customShield('skill_electroShield', 'electro', shieldBase),
  dmg('burst_hit1', info, 'atk', dm.burst.hit1Dmg, 'burst'),
  dmg('burst_hit1Sc', info, 'atk', dm.burst.hit1ScDmg, 'burst', {
    cond: cmpGE(radiance, 1, 'infer', ''),
  }),
  dmg('burst_hit234', info, 'atk', dm.burst.hit234Dmg, 'burst'),
  dmg('burst_hit5', info, 'atk', dm.burst.hit5Dmg, 'burst'),
  dmg('burst_hit5Sc', info, 'atk', dm.burst.hit5ScDmg, 'burst', {
    cond: cmpGE(radiance, 1, 'infer', ''),
  }),

  customParam('a0_stellarconduct_baseDmg_', a0_stellarconduct_baseDmg_),
  customParam('c2Toast_dmgInc', c2Toast_dmgInc),
  customParam('c2SelfToast_dmgInc', c2SelfToast_dmgInc),
  customParam('charged_stam', dm.charged.stam),
  customParam('skill_anchorDuration', dm.skill.anchorDuration),
  customParam('skill_entryCd', dm.skill.entryCd),
  customParam('skill_cd', dm.skill.cd),
  customParam('burst_duration', dm.burst.duration),
  customParam('burst_cd', dm.burst.cd),
  customParam('burst_enerCost', dm.burst.enerCost)
)
