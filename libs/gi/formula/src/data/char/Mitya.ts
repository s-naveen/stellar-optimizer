import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import { cmpGE, cmpNE, min, prod, sum } from '@genshin-optimizer/pando/engine'
import { destIsActive } from '../common/conds'
import {
  allListConditionals,
  allNumConditionals,
  customDmg,
  customParam,
  enemyDebuff,
  own,
  ownBuff,
  percent,
  register,
  teamBuff,
} from '../util'
import {
  dataGenToCharInfo,
  dmg,
  entriesForChar,
  splitScaleDmg,
} from './util'

const key: CharacterKey = 'Mitya'
const data_gen = allStats.char.data[key]
const skillParam_gen = allStats.char.skillParam[key]

let a = 0,
  s = 0,
  b = 0
const dm = {
  normal: {
    hitArr: [
      skillParam_gen.auto[a++], // 1
      skillParam_gen.auto[a++], // 2
      skillParam_gen.auto[a++], // 3
    ],
  },
  charged: {
    dmg: skillParam_gen.auto[a++],
    stam: skillParam_gen.auto[a++][0],
  },
  plunging: {
    dmg: skillParam_gen.auto[a++],
    low: skillParam_gen.auto[a++],
    high: skillParam_gen.auto[a++],
  },
  gradient: {
    dmg: skillParam_gen.auto[a++],
    stellarDmg: skillParam_gen.auto[a++],
  },
  skill: {
    tapDmg: skillParam_gen.skill[s++],
    holdDmg: skillParam_gen.skill[s++],
    steadyCoreDmg: skillParam_gen.skill[s++],
    steadyConsumeDmg: skillParam_gen.skill[s++],
    steadyDetonateDmg: skillParam_gen.skill[s++],
    duration: skillParam_gen.skill[s++][0],
    cd: skillParam_gen.skill[s++][0],
  },
  burst: {
    atkDmg: skillParam_gen.burst[b++],
    emDmg: skillParam_gen.burst[b++],
    beacons: skillParam_gen.burst[b++][0],
    cd: skillParam_gen.burst[b++][0],
    enerCost: skillParam_gen.burst[b++][0],
  },
  passive1: {
    eleMasPerBeacon: skillParam_gen.passive1[0][0],
  },
  passive2: {
    critRate_: skillParam_gen.passive2[0][0],
  },
  passive3: {
    baseDmgPerEm: skillParam_gen.passive3![0][0],
    maxBaseDmg: skillParam_gen.passive3![1][0],
  },
  constellation1: {
    critDMG_: skillParam_gen.constellation1[0],
  },
  constellation2: {
    enemyRes_: skillParam_gen.constellation2[0],
    steadyEleMas: skillParam_gen.constellation2[1],
    overloadEleMas: skillParam_gen.constellation2[2],
  },
  constellation4: {
    dmg: skillParam_gen.constellation4[0],
  },
  constellation6: {
    stellarconduct_specialDmg_: skillParam_gen.constellation6[1],
    steadyDmgInc: skillParam_gen.constellation6[2],
  },
} as const

const info = dataGenToCharInfo(data_gen)
const {
  final,
  char: { ascension, constellation },
} = own

// WR cond(key, 'detectionCore') states steady | overloaded
const { detectionCore } = allListConditionals(info.key, [
  'steady',
  'overloaded',
])
// WR lookup gradientBeacons 1–5; a4Stacks 1–4
const { gradientBeacons } = allNumConditionals(info.key, true, 0, 5)
const { a4Stacks } = allNumConditionals(info.key, true, 0, 4)

const coreSteady = detectionCore.map({ steady: 1, overloaded: 0 })
const coreOverloaded = detectionCore.map({ steady: 0, overloaded: 1 })
const coreActive = cmpNE(detectionCore.value, 0, 1)

const a1_eleMas = cmpGE(
  ascension,
  1,
  prod(coreSteady, gradientBeacons, dm.passive1.eleMasPerBeacon)
)
const a4_critRate_ = cmpGE(
  ascension,
  4,
  prod(a4Stacks, percent(dm.passive2.critRate_))
)
const a0_stellarconduct_baseDmg_ = min(
  prod(percent(dm.passive3.baseDmgPerEm), final.eleMas),
  percent(dm.passive3.maxBaseDmg)
)
const c1_critDMG_ = cmpNE(
  destIsActive,
  0,
  cmpGE(constellation, 1, prod(coreActive, percent(dm.constellation1.critDMG_)))
)
const c2_enemyRes_ = cmpGE(
  constellation,
  2,
  prod(coreActive, percent(-dm.constellation2.enemyRes_))
)
const c2Steady_eleMas = cmpGE(
  constellation,
  2,
  prod(coreSteady, dm.constellation2.steadyEleMas)
)
const c2Overload_eleMas = cmpNE(
  destIsActive,
  0,
  cmpGE(constellation, 2, prod(coreOverloaded, dm.constellation2.overloadEleMas))
)
const c6_stellarconduct_specialDmg_ = cmpGE(
  constellation,
  6,
  percent(dm.constellation6.stellarconduct_specialDmg_)
)
const c6SteadyMult = sum(
  1,
  cmpGE(constellation, 6, percent(dm.constellation6.steadyDmgInc))
)

export default register(
  info.key,
  entriesForChar(info, data_gen),
  // C3 skill; C5 auto
  ownBuff.char.skill.add(cmpGE(constellation, 3, 3)),
  ownBuff.char.auto.add(cmpGE(constellation, 5, 3)),

  ownBuff.premod.critRate_.add(a4_critRate_),
  teamBuff.premod.eleMas.add(a1_eleMas),
  teamBuff.premod.eleMas.add(c2Steady_eleMas),
  teamBuff.premod.eleMas.add(c2Overload_eleMas),
  teamBuff.premod.critDMG_.add(c1_critDMG_),
  // A0 Stellar Jubilee — WR teamBuff stellarconduct_baseDmg_ (no Pando baseDmg_ tag, same as Sandrone)
  teamBuff.premod.dmg_.stellarconduct.add(a0_stellarconduct_baseDmg_),
  // C6 — WR teamBuff stellarconduct_specialDmg_ (no Pando specialDmg_ tag)
  teamBuff.premod.dmg_.stellarconduct.add(c6_stellarconduct_specialDmg_),
  // C2 — WR teamBuff.premod.<ele>_enemyRes_; Pando enemy preRes. Keep WR sign.
  enemyDebuff.common.preRes.cryo.add(c2_enemyRes_),
  enemyDebuff.common.preRes.electro.add(c2_enemyRes_),

  dm.normal.hitArr.flatMap((arr, i) =>
    dmg(`normal_${i}`, info, 'atk', arr, 'normal')
  ),
  dmg('charged', info, 'atk', dm.charged.dmg, 'charged'),
  dmg('charged_gradientDmg', info, 'atk', dm.gradient.dmg, 'charged'),
  // WR stellarDmgNode (stellarconduct / electro, EM); talent-style listing until trans pipeline exists.
  dmg(
    'charged_gradientStellarDmg',
    info,
    'eleMas',
    dm.gradient.stellarDmg,
    'charged'
  ),
  Object.entries(dm.plunging).flatMap(([k, v]) =>
    dmg(`plunging_${k}`, info, 'atk', v, 'plunging')
  ),
  dmg('skill_tap', info, 'atk', dm.skill.tapDmg, 'skill'),
  dmg('skill_hold', info, 'atk', dm.skill.holdDmg, 'skill'),
  dmg('skill_steadyCore', info, 'atk', dm.skill.steadyCoreDmg, 'skill', {
    baseMulti: c6SteadyMult,
  }),
  dmg(
    'skill_steadyConsume',
    info,
    'eleMas',
    dm.skill.steadyConsumeDmg,
    'skill',
    { baseMulti: c6SteadyMult }
  ),
  dmg(
    'skill_steadyDetonate',
    info,
    'eleMas',
    dm.skill.steadyDetonateDmg,
    'skill',
    { baseMulti: c6SteadyMult }
  ),
  splitScaleDmg(
    'burst',
    info,
    ['atk', 'eleMas'],
    [dm.burst.atkDmg, dm.burst.emDmg],
    'burst'
  ),
  customDmg(
    'c4',
    'electro',
    'elemental',
    prod(percent(dm.constellation4.dmg), final.eleMas),
    { cond: cmpGE(constellation, 4, 'infer', '') }
  ),

  customParam('a0_stellarconduct_baseDmg_', a0_stellarconduct_baseDmg_),
  customParam('charged_stam', dm.charged.stam),
  customParam('skill_duration', dm.skill.duration),
  customParam('skill_cd', dm.skill.cd),
  customParam('burst_beacons', dm.burst.beacons),
  customParam('burst_cd', dm.burst.cd),
  customParam('burst_enerCost', dm.burst.enerCost)
)
