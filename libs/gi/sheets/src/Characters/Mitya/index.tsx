import { objKeyMap, range } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import {
  constant,
  equal,
  equalStr,
  greaterEq,
  infoMut,
  input,
  lookup,
  min,
  naught,
  percent,
  prod,
  stellarDmgNode,
  subscript,
  sum,
  target,
  unequal,
} from '@genshin-optimizer/gi/wr'
import { cond, st, stg } from '../../SheetUtil'
import { CharacterSheet } from '../CharacterSheet'
import { charTemplates } from '../charTemplates'
import {
  dataObjForCharacterSheet,
  dmgNode,
  plungingDmgNodes,
  splitScaleDmgNode,
} from '../dataUtil'
import type { TalentSheet } from '../ICharacterSheet'

const key: CharacterKey = 'Mitya'
const skillParam_gen = allStats.char.skillParam[key]
const ct = charTemplates(key)

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
    // Special Charged Attack: Gradient Detonation (ATK)
    dmg: skillParam_gen.auto[a++],
    // Per Gradient Beacon consumed, Stellar-Conduct DMG (EM)
    stellarDmg: skillParam_gen.auto[a++],
  },
  skill: {
    tapDmg: skillParam_gen.skill[s++],
    holdDmg: skillParam_gen.skill[s++],
    steadyCoreDmg: skillParam_gen.skill[s++], // ATK
    steadyConsumeDmg: skillParam_gen.skill[s++], // EM, Stellar-Conduct
    steadyDetonateDmg: skillParam_gen.skill[s++], // EM per beacon, Stellar-Conduct
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
    energyRegen: skillParam_gen.constellation1[1],
    cd: skillParam_gen.constellation1[2],
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
    beaconChance: skillParam_gen.constellation6[0],
    stellarconduct_specialDmg_: skillParam_gen.constellation6[1],
    steadyDmgInc: skillParam_gen.constellation6[2],
  },
} as const

// kqmsim 7bdf45f: four prisms at C0, five at C1.
const BASE_MAX_BEACONS = 4
const C1_MAX_BEACONS = 5

/* ---------- Conditionals ---------- */

// Detection Core state. Undefined means no Detection Core is on the field.
const [condCorePath, condCore] = cond(key, 'detectionCore')
const coreActive = unequal(condCore, undefined, 1)

// Number of Gradient Beacons Mitya currently has (A1 EM, C2/C1 context)
const [condBeaconsPath, condBeacons] = cond(key, 'gradientBeacons')
const beaconsArr = range(1, C1_MAX_BEACONS)
const beaconCount = lookup(
  condBeacons,
  objKeyMap(beaconsArr, (n) => constant(n)),
  naught
)

// A4 CRIT Rate stacks
const [condA4StacksPath, condA4Stacks] = cond(key, 'a4Stacks')
const a4StacksArr = range(1, 4)

// Inside Polestar Field: Radiance: Stellar-Conduct
const [condA0RadiancePath, condA0Radiance] = cond(key, 'a0StellarRadianceSc')

/* ---------- Buffs ---------- */

// A1: Steady State core, all party members gain EM per Gradient Beacon
const a1Steady_eleMasDisp = infoMut(
  greaterEq(
    input.asc,
    1,
    equal(condCore, 'steady', prod(dm.passive1.eleMasPerBeacon, beaconCount))
  ),
  { path: 'eleMas', isTeamBuff: true }
)

// A4: CRIT Rate per stack
const a4_critRate_ = greaterEq(
  input.asc,
  4,
  lookup(
    condA4Stacks,
    objKeyMap(a4StacksArr, (n) => percent(dm.passive2.critRate_ * n)),
    naught
  )
)

// A0 (Stellar Jubilee): Base Stellar-Conduct DMG increase from Mitya's EM
const a0_stellarconduct_baseDmg_ = min(
  prod(percent(dm.passive3.baseDmgPerEm), input.total.eleMas),
  percent(dm.passive3.maxBaseDmg)
)

// C1: active character CRIT DMG while Detection Core is present
const c1_critDMG_disp = greaterEq(
  input.constellation,
  1,
  equal(coreActive, 1, percent(dm.constellation1.critDMG_)),
  { path: 'critDMG_', isTeamBuff: true }
)
const c1_critDMG_ = equal(input.activeCharKey, target.charKey, c1_critDMG_disp)

// C2: Cryo/Electro RES shred while Detection Core is present (opponents in Polestar Field)
const c2_cryo_enemyRes_ = greaterEq(
  input.constellation,
  2,
  equal(coreActive, 1, percent(-dm.constellation2.enemyRes_))
)
const c2_electro_enemyRes_ = { ...c2_cryo_enemyRes_ }

// C2: Steady -> all party EM; Overloaded -> active character EM
const c2Steady_eleMasDisp = greaterEq(
  input.constellation,
  2,
  equal(condCore, 'steady', dm.constellation2.steadyEleMas),
  { path: 'eleMas', isTeamBuff: true }
)
const c2Overload_eleMasDisp = greaterEq(
  input.constellation,
  2,
  equal(condCore, 'overloaded', dm.constellation2.overloadEleMas),
  { path: 'eleMas', isTeamBuff: true }
)
const c2Overload_eleMas = equal(
  input.activeCharKey,
  target.charKey,
  c2Overload_eleMasDisp
)
const teamEleMas = sum(
  a1Steady_eleMasDisp,
  c2Steady_eleMasDisp,
  c2Overload_eleMas
)

// C6: Stellar-Conduct DMG Elevated for all party members
const c6_stellarconduct_specialDmg_ = greaterEq(
  input.constellation,
  6,
  percent(dm.constellation6.stellarconduct_specialDmg_)
)
// C6: Steady State core deals 115% of its original DMG
const c6SteadyMult = sum(
  percent(1),
  greaterEq(input.constellation, 6, percent(dm.constellation6.steadyDmgInc))
)

/* ---------- Damage ---------- */

const stellarTalent = (
  lvlMultiplier: number[],
  talentType: 'auto' | 'skill',
  specialMultiplier?: ReturnType<typeof sum>
) =>
  stellarDmgNode(
    subscript(input.total[`${talentType}Index`], lvlMultiplier, { unit: '%' }),
    'eleMas',
    'stellarconduct',
    'electro',
    undefined,
    specialMultiplier
  )

const dmgFormulas = {
  normal: Object.fromEntries(
    dm.normal.hitArr.map((arr, i) => [i, dmgNode('atk', arr, 'normal')])
  ),
  charged: {
    dmg: dmgNode('atk', dm.charged.dmg, 'charged'),
    gradientDmg: dmgNode('atk', dm.gradient.dmg, 'charged'),
    gradientStellarDmg: stellarTalent(dm.gradient.stellarDmg, 'auto'),
  },
  plunging: plungingDmgNodes('atk', dm.plunging),
  skill: {
    tapDmg: dmgNode('atk', dm.skill.tapDmg, 'skill'),
    holdDmg: dmgNode('atk', dm.skill.holdDmg, 'skill'),
    steadyCoreDmg: dmgNode(
      'atk',
      dm.skill.steadyCoreDmg,
      'skill',
      undefined,
      c6SteadyMult
    ),
    steadyConsumeDmg: stellarTalent(
      dm.skill.steadyConsumeDmg,
      'skill',
      c6SteadyMult
    ),
    steadyDetonateDmg: stellarTalent(
      dm.skill.steadyDetonateDmg,
      'skill',
      c6SteadyMult
    ),
  },
  burst: {
    dmg: splitScaleDmgNode(
      ['atk', 'eleMas'],
      [dm.burst.atkDmg, dm.burst.emDmg],
      'burst'
    ),
  },
  passive3: {
    a0_stellarconduct_baseDmg_,
  },
  constellation4: {
    dmg: greaterEq(
      input.constellation,
      4,
      stellarDmgNode(
        percent(dm.constellation4.dmg),
        'eleMas',
        'stellarconduct',
        'electro'
      )
    ),
  },
}

const skillC3 = greaterEq(input.constellation, 3, 3)
const autoC5 = greaterEq(input.constellation, 5, 3)

export const data = dataObjForCharacterSheet(key, dmgFormulas, {
  premod: {
    skillBoost: skillC3,
    autoBoost: autoC5,
    critRate_: a4_critRate_,
  },
  teamBuff: {
    premod: {
      eleMas: teamEleMas,
      critDMG_: c1_critDMG_,
      stellarconduct_baseDmg_: a0_stellarconduct_baseDmg_,
      stellarconduct_specialDmg_: c6_stellarconduct_specialDmg_,
      cryo_enemyRes_: c2_cryo_enemyRes_,
      electro_enemyRes_: c2_electro_enemyRes_,
    },
  },
  flags: {
    radiance: equalStr(condA0Radiance, 'on', 'sc'),
  },
})

const sheet: TalentSheet = {
  auto: ct.talentTem('auto', [
    { text: ct.chg('auto.fields.normal') },
    {
      fields: dm.normal.hitArr.map((_, i) => ({
        node: infoMut(dmgFormulas.normal[i], {
          name: ct.chg(`auto.skillParams.${i}`),
        }),
      })),
    },
    { text: ct.chg('auto.fields.charged') },
    {
      fields: [
        {
          node: infoMut(dmgFormulas.charged.dmg, {
            name: ct.chg('auto.skillParams.3'),
          }),
        },
        {
          text: ct.chg('auto.skillParams.4'),
          value: dm.charged.stam,
        },
        {
          node: infoMut(dmgFormulas.charged.gradientDmg, {
            name: ct.chg('auto.skillParams.7'),
          }),
        },
        {
          node: infoMut(dmgFormulas.charged.gradientStellarDmg, {
            name: ct.chg('auto.skillParams.8'),
            textSuffix: ct.ch('perBeacon'),
          }),
        },
      ],
    },
    { text: ct.chg('auto.fields.plunging') },
    {
      fields: [
        {
          node: infoMut(dmgFormulas.plunging.dmg, {
            name: stg('plunging.dmg'),
          }),
        },
        {
          node: infoMut(dmgFormulas.plunging.low, {
            name: stg('plunging.low'),
          }),
        },
        {
          node: infoMut(dmgFormulas.plunging.high, {
            name: stg('plunging.high'),
          }),
        },
      ],
    },
  ]),

  skill: ct.talentTem('skill', [
    {
      fields: [
        {
          node: infoMut(dmgFormulas.skill.tapDmg, {
            name: ct.chg('skill.skillParams.0'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.holdDmg, {
            name: ct.chg('skill.skillParams.1'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.steadyCoreDmg, {
            name: ct.chg('skill.skillParams.2'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.steadyConsumeDmg, {
            name: ct.chg('skill.skillParams.3'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.steadyDetonateDmg, {
            name: ct.chg('skill.skillParams.4'),
            textSuffix: ct.ch('perBeacon'),
          }),
        },
        {
          text: ct.chg('skill.skillParams.5'),
          value: dm.skill.duration,
          unit: 's',
        },
        {
          text: stg('cd'),
          value: dm.skill.cd,
          unit: 's',
        },
      ],
    },
    ct.condTem('skill', {
      path: condCorePath,
      value: condCore,
      name: ct.ch('coreCond'),
      teamBuff: true,
      states: {
        steady: {
          name: ct.ch('steady'),
          fields: [
            { node: c1_critDMG_disp },
            { node: infoMut(c2_cryo_enemyRes_, { path: 'cryo_enemyRes_' }) },
            {
              node: infoMut(c2_electro_enemyRes_, {
                path: 'electro_enemyRes_',
              }),
            },
            { node: c2Steady_eleMasDisp },
          ],
        },
        overloaded: {
          name: ct.ch('overloaded'),
          fields: [
            { node: c1_critDMG_disp },
            { node: infoMut(c2_cryo_enemyRes_, { path: 'cryo_enemyRes_' }) },
            {
              node: infoMut(c2_electro_enemyRes_, {
                path: 'electro_enemyRes_',
              }),
            },
            { node: c2Overload_eleMasDisp },
          ],
        },
      },
    }),
    ct.condTem('skill', {
      path: condBeaconsPath,
      value: condBeacons,
      name: ct.ch('beaconsCond'),
      teamBuff: true,
      states: (data) =>
        objKeyMap(
          range(
            1,
            data.get(input.constellation).value >= 1
              ? C1_MAX_BEACONS
              : BASE_MAX_BEACONS
          ),
          (n) => ({
            name: st('stack', { count: n }),
            fields: [{ node: a1Steady_eleMasDisp }],
          })
        ),
    }),
  ]),

  burst: ct.talentTem('burst', [
    {
      fields: [
        {
          node: infoMut(dmgFormulas.burst.dmg, {
            name: ct.chg('burst.skillParams.0'),
          }),
        },
        {
          text: ct.chg('burst.skillParams.1'),
          value: dm.burst.beacons,
        },
        {
          text: stg('cd'),
          value: dm.burst.cd,
          unit: 's',
        },
        {
          text: stg('energyCost'),
          value: dm.burst.enerCost,
        },
      ],
    },
  ]),

  passive1: ct.talentTem('passive1', [
    ct.headerTem('passive1', {
      teamBuff: true,
      canShow: equal(condCore, 'steady', 1),
      fields: [{ node: a1Steady_eleMasDisp }],
    }),
  ]),
  passive2: ct.talentTem('passive2', [
    ct.condTem('passive2', {
      path: condA4StacksPath,
      value: condA4Stacks,
      name: ct.ch('a4Cond'),
      states: objKeyMap(a4StacksArr, (n) => ({
        name: st('stack', { count: n }),
        fields: [
          { node: a4_critRate_ },
          { text: stg('duration'), value: 15, unit: 's' },
        ],
      })),
    }),
  ]),
  passive3: ct.talentTem('passive3', [
    ct.headerTem('passive3', {
      teamBuff: true,
      fields: [
        {
          node: infoMut(a0_stellarconduct_baseDmg_, {
            path: 'stellarconduct_baseDmg_',
            isTeamBuff: true,
          }),
        },
      ],
    }),
    ct.condTem('passive3', {
      path: condA0RadiancePath,
      value: condA0Radiance,
      name: st('elementalReaction.polestar.inside'),
      teamBuff: true,
      states: {
        on: {
          fields: [{ text: st('elementalReaction.stellar.gainRadianceSc') }],
        },
      },
    }),
  ]),
  passive: ct.talentTem('passive'),
  constellation1: ct.talentTem('constellation1', [
    ct.headerTem('constellation1', {
      teamBuff: true,
      canShow: equal(coreActive, 1, 1),
      fields: [{ node: c1_critDMG_disp }],
    }),
  ]),
  constellation2: ct.talentTem('constellation2', [
    ct.headerTem('constellation2', {
      teamBuff: true,
      canShow: equal(coreActive, 1, 1),
      fields: [
        { node: infoMut(c2_cryo_enemyRes_, { path: 'cryo_enemyRes_' }) },
        {
          node: infoMut(c2_electro_enemyRes_, { path: 'electro_enemyRes_' }),
        },
        { node: c2Steady_eleMasDisp },
        { node: c2Overload_eleMasDisp },
      ],
    }),
  ]),
  constellation3: ct.talentTem('constellation3', [
    { fields: [{ node: skillC3 }] },
  ]),
  constellation4: ct.talentTem('constellation4', [
    {
      fields: [
        {
          node: infoMut(dmgFormulas.constellation4.dmg, {
            name: ct.ch('c4Dmg'),
          }),
        },
      ],
    },
  ]),
  constellation5: ct.talentTem('constellation5', [
    { fields: [{ node: autoC5 }] },
  ]),
  constellation6: ct.talentTem('constellation6', [
    {
      fields: [
        {
          node: infoMut(c6_stellarconduct_specialDmg_, {
            path: 'stellarconduct_specialDmg_',
            isTeamBuff: true,
          }),
        },
      ],
    },
  ]),
}

export default new CharacterSheet(sheet, data)
