import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import {
  cmpEq,
  cmpGE,
  cmpNE,
  min,
  prod,
  sum,
} from '@genshin-optimizer/pando/engine'
import { destIsActive } from '../common/conds'
import {
  allBoolConditionals,
  allNumConditionals,
  customParam,
  customShield,
  own,
  ownBuff,
  percent,
  register,
  teamBuff,
} from '../util'
import { dataGenToCharInfo, dmg, entriesForChar, talentSubscript } from './util'

const key: CharacterKey = 'Valeriy'
const data_gen = allStats.char.data[key]
const skillParam_gen = allStats.char.skillParam[key]

let a = -1,
  s = 0,
  b = 0
const dm = {
  normal: {
    hitArr: [
      skillParam_gen.auto[++a], // 1
      skillParam_gen.auto[++a], // 2
      skillParam_gen.auto[++a], // 3
    ],
  },
  charged: {
    dmg: skillParam_gen.auto[++a],
    mortarDmg: skillParam_gen.auto[++a],
    stam: skillParam_gen.auto[++a][0],
  },
  directive: {
    electro_dmgInc: skillParam_gen.auto[++a],
    stellarconduct_dmgInc: skillParam_gen.auto[++a],
    stacks: skillParam_gen.auto[++a][0],
    duration: skillParam_gen.auto[++a][0],
  },
  plunging: {
    dmg: skillParam_gen.auto[++a],
    low: skillParam_gen.auto[++a],
    high: skillParam_gen.auto[++a],
  },
  skill: {
    dmg: skillParam_gen.skill[s++],
    shieldAtk_: skillParam_gen.skill[s++],
    shieldFlat: skillParam_gen.skill[s++],
    shieldDuration: skillParam_gen.skill[s++][0],
    cd: skillParam_gen.skill[s++][0],
  },
  burst: {
    dmg: skillParam_gen.burst[b++],
    shellDmg: skillParam_gen.burst[b++],
    duration: skillParam_gen.burst[b++][0],
    cd: skillParam_gen.burst[b++][0],
    enerCost: skillParam_gen.burst[b++][0],
  },
  passive2: {
    perMomentum: skillParam_gen.passive2[0][0],
    perMomentumRadiance: skillParam_gen.passive2[1][0],
  },
  constellation2: {
    shieldPerExcess: skillParam_gen.constellation2[0],
    eleMas: skillParam_gen.constellation2[1],
    maxExcess: skillParam_gen.constellation2[2],
    duration: skillParam_gen.constellation2[3],
  },
  constellation6: {
    dmg_: skillParam_gen.constellation6[0],
    duration: skillParam_gen.constellation6[1],
    electro_critRate_: skillParam_gen.constellation6[2],
    stellarconduct_critDMG_: skillParam_gen.constellation6[3],
  },
} as const

// Impact Momentum: 100 max, C4 +30 (text, not a param)
const maxMomentum = 100
const c4MaxMomentum = 30

const info = dataGenToCharInfo(data_gen)
const {
  final,
  char: { auto, skill, ascension, constellation },
} = own
// WR cond(key, …) `'on'`
const { offensiveDirective, a0StellarRadianceSc, c2Skill, c2Excess, c6Hit } =
  allBoolConditionals(info.key)
// WR cond(key, 'a4Momentum') '40' … '130'
const { a4Momentum } = allNumConditionals(info.key, true, 0, 130)

const radiance = a0StellarRadianceSc.ifOn(1)
const momentum = cmpGE(
  ascension,
  4,
  min(a4Momentum, sum(maxMomentum, cmpGE(constellation, 4, c4MaxMomentum)))
)

// Offensive Directive (WR teamBuff, dest-gated to the active character): Electro DMG outside
// Radiance, Stellar-Conduct DMG in Radiance: Stellar-Conduct; flat, from Valeriy's ATK
const directive_electro_dmgIncDisp = offensiveDirective.ifOn(
  cmpEq(
    radiance,
    0,
    prod(
      sum(
        percent(talentSubscript(auto, dm.directive.electro_dmgInc)),
        prod(momentum, percent(dm.passive2.perMomentum))
      ),
      final.atk
    )
  )
)
const directive_stellarconduct_dmgIncDisp = offensiveDirective.ifOn(
  cmpEq(
    radiance,
    1,
    prod(
      sum(
        percent(talentSubscript(auto, dm.directive.stellarconduct_dmgInc)),
        prod(momentum, percent(dm.passive2.perMomentumRadiance))
      ),
      final.atk
    )
  )
)
const directive_electro_dmgInc = cmpNE(
  destIsActive,
  0,
  directive_electro_dmgIncDisp
)
const directive_stellarconduct_dmgInc = cmpNE(
  destIsActive,
  0,
  directive_stellarconduct_dmgIncDisp
)

const c2_eleMas = cmpGE(
  constellation,
  2,
  c2Skill.ifOn(dm.constellation2.eleMas)
)
const c2_shieldAtk_ = cmpGE(
  constellation,
  2,
  c2Excess.ifOn(
    percent(dm.constellation2.shieldPerExcess * dm.constellation2.maxExcess)
  )
)
const c6_dmg_ = cmpGE(constellation, 6, percent(dm.constellation6.dmg_))
const c6_electro_critRate_ = cmpGE(
  constellation,
  6,
  c6Hit.ifOn(percent(dm.constellation6.electro_critRate_))
)
const c6_stellarconduct_critDMG_ = cmpGE(
  constellation,
  6,
  c6Hit.ifOn(percent(dm.constellation6.stellarconduct_critDMG_))
)

const shieldBase = sum(
  prod(percent(talentSubscript(skill, dm.skill.shieldAtk_)), final.atk),
  talentSubscript(skill, dm.skill.shieldFlat),
  prod(c2_shieldAtk_, final.atk)
)

export default register(
  info.key,
  entriesForChar(info, data_gen),
  // C3 normal attack; C5 skill
  ownBuff.char.auto.add(cmpGE(constellation, 3, 3)),
  ownBuff.char.skill.add(cmpGE(constellation, 5, 3)),

  // WR teamBuff.premod.electro_dmgInc / stellarconduct_dmgInc → formula.base
  teamBuff.formula.base.electro.add(directive_electro_dmgInc),
  teamBuff.formula.base.stellarconduct.add(directive_stellarconduct_dmgInc),
  teamBuff.premod.eleMas.add(c2_eleMas),
  teamBuff.premod.critRate_.electro.add(c6_electro_critRate_),
  teamBuff.premod.critDMG_.stellarconduct.add(c6_stellarconduct_critDMG_),

  dm.normal.hitArr.flatMap((arr, i) =>
    dmg(`normal_${i}`, info, 'atk', arr, 'normal')
  ),
  dmg('charged', info, 'atk', dm.charged.dmg, 'charged'),
  dmg(
    'charged_mortar',
    info,
    'atk',
    dm.charged.mortarDmg,
    'charged',
    { ele: 'electro' },
    ownBuff.premod.dmg_.add(c6_dmg_)
  ),
  Object.entries(dm.plunging).flatMap(([k, v]) =>
    dmg(`plunging_${k}`, info, 'atk', v, 'plunging')
  ),
  dmg('skill', info, 'atk', dm.skill.dmg, 'skill'),
  customShield('skill_shield', undefined, shieldBase),
  customShield('skill_electroShield', 'electro', shieldBase),
  dmg('burst', info, 'atk', dm.burst.dmg, 'burst'),
  dmg(
    'burst_shell',
    info,
    'atk',
    dm.burst.shellDmg,
    'burst',
    {},
    ownBuff.premod.dmg_.add(c6_dmg_)
  ),

  customParam('directive_electro_dmgInc', directive_electro_dmgIncDisp),
  customParam(
    'directive_stellarconduct_dmgInc',
    directive_stellarconduct_dmgIncDisp
  ),
  customParam('charged_stam', dm.charged.stam),
  customParam('directive_stacks', dm.directive.stacks),
  customParam('directive_duration', dm.directive.duration),
  customParam('skill_shieldDuration', dm.skill.shieldDuration),
  customParam('skill_cd', dm.skill.cd),
  customParam('burst_duration', dm.burst.duration),
  customParam('burst_cd', dm.burst.cd),
  customParam('burst_enerCost', dm.burst.enerCost),
  customParam('c2_duration', dm.constellation2.duration),
  customParam('c6_duration', dm.constellation6.duration)
)
