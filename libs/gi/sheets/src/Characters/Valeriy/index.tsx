import { objKeyMap, range } from '@genshin-optimizer/common/util'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import type { UIData } from '@genshin-optimizer/gi/uidata'
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
  subscript,
  sum,
  target,
} from '@genshin-optimizer/gi/wr'
import { cond, st, stg } from '../../SheetUtil'
import { CharacterSheet } from '../CharacterSheet'
import { charTemplates } from '../charTemplates'
import {
  customShieldNode,
  dataObjForCharacterSheet,
  dmgNode,
  hitEle,
  plungingDmgNodes,
  shieldElement,
} from '../dataUtil'
import type { TalentSheet } from '../ICharacterSheet'

const key: CharacterKey = 'Valeriy'
const skillParam_gen = allStats.char.skillParam[key]
const ct = charTemplates(key)

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
    // Direct-Fire Mortar: Point-Blank Bombardment (special Charged Attack, Electro)
    mortarDmg: skillParam_gen.auto[++a],
    stam: skillParam_gen.auto[++a][0],
  },
  // Offensive Directive: flat DMG increase per stack, as a ratio of Valeriy's ATK
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
    // Offensive Directive +x% of ATK per point of Impact Momentum consumed
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

// Impact Momentum: 100 max, C4 +30 (glossary 11370003 / C4 text; not a param)
const maxMomentum = 100
const c4MaxMomentum = 30
// the special Charged Attack needs at least 40
const momentumArr = range(4, 13).map((n) => n * 10)

/* ---------- Conditionals ---------- */
const [condDirectivePath, condDirective] = cond(key, 'offensiveDirective')
const directiveOn = equal(condDirective, 'on', 1)
const [condRadiancePath, condRadiance] = cond(key, 'a0StellarRadianceSc')
const radianceOn = equal(condRadiance, 'on', 1)
const [condMomentumPath, condMomentum] = cond(key, 'a4Momentum')
const [condC2SkillPath, condC2Skill] = cond(key, 'c2Skill')
const [condC2ExcessPath, condC2Excess] = cond(key, 'c2Excess')
const [condC6HitPath, condC6Hit] = cond(key, 'c6Hit')

/* ---------- Buffs ---------- */
// A4: Impact Momentum consumed by the special Charged Attack, capped by the current maximum
const a4Momentum = greaterEq(
  input.asc,
  4,
  min(
    lookup(
      condMomentum,
      // C4's 30% gain bonus produces half-points (e.g. 78 + 6.5).
      // The simulator supplies the exact consumed amount; the UI keeps its ten-point presets.
      objKeyMap(
        range(0, 260).map((n) => n / 2),
        (n) => constant(n)
      ),
      naught
    ),
    sum(maxMomentum, greaterEq(input.constellation, 4, c4MaxMomentum))
  )
)

// Offensive Directive: the active character's Electro DMG (outside Radiance) or Stellar-Conduct DMG
// (in Radiance: Stellar-Conduct) gets a flat increase based on Valeriy's ATK
const directive_electro_dmgIncDisp = infoMut(
  equal(
    directiveOn,
    1,
    equal(
      radianceOn,
      0,
      prod(
        sum(
          subscript(input.total.autoIndex, dm.directive.electro_dmgInc, {
            unit: '%',
          }),
          prod(a4Momentum, percent(dm.passive2.perMomentum))
        ),
        input.total.atk
      )
    )
  ),
  { path: 'electro_dmgInc', isTeamBuff: true }
)
const directive_electro_dmgInc = equal(
  input.activeCharKey,
  target.charKey,
  directive_electro_dmgIncDisp
)
const directive_stellarconduct_dmgIncDisp = infoMut(
  equal(
    directiveOn,
    1,
    equal(
      radianceOn,
      1,
      prod(
        sum(
          subscript(input.total.autoIndex, dm.directive.stellarconduct_dmgInc, {
            unit: '%',
          }),
          prod(a4Momentum, percent(dm.passive2.perMomentumRadiance))
        ),
        input.total.atk
      )
    )
  ),
  { path: 'stellarconduct_dmgInc', isTeamBuff: true }
)
const directive_stellarconduct_dmgInc = equal(
  input.activeCharKey,
  target.charKey,
  directive_stellarconduct_dmgIncDisp
)

// C2: party EM after the Elemental Skill
const c2_eleMas = greaterEq(
  input.constellation,
  2,
  equal(condC2Skill, 'on', dm.constellation2.eleMas),
  { path: 'eleMas', isTeamBuff: true }
)
// C2: excess Impact Momentum (max 20) -> shield +8% ATK each
const c2_shieldAtk_ = greaterEq(
  input.constellation,
  2,
  equal(
    condC2Excess,
    'on',
    percent(dm.constellation2.shieldPerExcess * dm.constellation2.maxExcess)
  )
)

// C6: Mortar and Thunderburst Shell DMG +100%; opponents hit take +10% Electro CRIT Rate,
// and Stellar-Conduct DMG to them +40% CRIT DMG
const c6_dmg_ = greaterEq(
  input.constellation,
  6,
  percent(dm.constellation6.dmg_)
)
const c6_electro_critRate_ = greaterEq(
  input.constellation,
  6,
  equal(condC6Hit, 'on', percent(dm.constellation6.electro_critRate_)),
  { path: 'electro_critRate_', isTeamBuff: true }
)
const c6_stellarconduct_critDMG_ = greaterEq(
  input.constellation,
  6,
  equal(
    // Direct Stellar Conduct variants use their owner's element; hit-local reads do
    // not cross the team-buff snapshot boundary.
    target.charEle,
    'electro',
    equal(condC6Hit, 'on', percent(dm.constellation6.stellarconduct_critDMG_))
  ),
  { path: 'stellarconduct_critDMG_', isTeamBuff: true }
)

/* ---------- Damage ---------- */
// a fresh node per use: infoMut would otherwise relabel the shared one
const skillShield = () =>
  customShieldNode(
    sum(
      prod(
        subscript(input.total.skillIndex, dm.skill.shieldAtk_, { unit: '%' }),
        input.total.atk
      ),
      subscript(input.total.skillIndex, dm.skill.shieldFlat),
      prod(c2_shieldAtk_, input.total.atk)
    )
  )

const dmgFormulas = {
  normal: Object.fromEntries(
    dm.normal.hitArr.map((arr, i) => [i, dmgNode('atk', arr, 'normal')])
  ),
  charged: {
    dmg: dmgNode('atk', dm.charged.dmg, 'charged'),
    mortarDmg: dmgNode('atk', dm.charged.mortarDmg, 'charged', {
      ...hitEle.electro,
      premod: { all_dmg_: c6_dmg_ },
    }),
  },
  plunging: plungingDmgNodes('atk', dm.plunging),
  skill: {
    dmg: dmgNode('atk', dm.skill.dmg, 'skill'),
    shield: skillShield(),
    electroShield: shieldElement('electro', skillShield()),
  },
  burst: {
    dmg: dmgNode('atk', dm.burst.dmg, 'burst'),
    shellDmg: dmgNode('atk', dm.burst.shellDmg, 'burst', {
      premod: { all_dmg_: c6_dmg_ },
    }),
  },
}

const autoC3 = greaterEq(input.constellation, 3, 3)
const skillC5 = greaterEq(input.constellation, 5, 3)

export const data = dataObjForCharacterSheet(key, dmgFormulas, {
  premod: {
    autoBoost: autoC3,
    skillBoost: skillC5,
  },
  teamBuff: {
    premod: {
      electro_dmgInc: directive_electro_dmgInc,
      stellarconduct_dmgInc: directive_stellarconduct_dmgInc,
      eleMas: c2_eleMas,
      electro_critRate_: c6_electro_critRate_,
      stellarconduct_critDMG_: c6_stellarconduct_critDMG_,
    },
  },
  flags: {
    radiance: equalStr(condRadiance, 'on', 'sc'),
  },
})

// only the variant that applies (outside / inside Radiance: Stellar-Conduct)
const inRadiance = (data: UIData) => data.get(radianceOn).value === 1
const directiveFields = [
  {
    node: directive_electro_dmgIncDisp,
    canShow: (data: UIData) => !inRadiance(data),
  },
  {
    node: directive_stellarconduct_dmgIncDisp,
    canShow: (data: UIData) => inRadiance(data),
  },
]

const sheet: TalentSheet = {
  auto: ct.talentTem('auto', [
    {
      text: ct.chg('auto.fields.normal'),
    },
    {
      fields: dm.normal.hitArr.map((_, i) => ({
        node: infoMut(dmgFormulas.normal[i], {
          name: ct.chg(`auto.skillParams.${i}`),
        }),
      })),
    },
    {
      text: ct.chg('auto.fields.charged'),
    },
    {
      fields: [
        {
          node: infoMut(dmgFormulas.charged.dmg, {
            name: ct.chg('auto.skillParams.3'),
          }),
        },
        {
          node: infoMut(dmgFormulas.charged.mortarDmg, {
            name: ct.chg('auto.skillParams.4'),
          }),
        },
        {
          text: ct.chg('auto.skillParams.5'),
          value: dm.charged.stam,
        },
        {
          text: ct.chg('auto.skillParams.8'),
          value: dm.directive.stacks,
        },
        {
          text: ct.chg('auto.skillParams.9'),
          value: dm.directive.duration,
          unit: 's',
        },
      ],
    },
    ct.condTem('auto', {
      path: condDirectivePath,
      value: condDirective,
      name: ct.ch('directiveCond'),
      teamBuff: true,
      states: {
        on: {
          fields: directiveFields,
        },
      },
    }),
    {
      text: ct.chg('auto.fields.plunging'),
    },
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
          node: infoMut(dmgFormulas.skill.dmg, {
            name: ct.chg('skill.skillParams.0'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.shield, {
            name: st('dmgAbsorption.none'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.electroShield, {
            name: st('dmgAbsorption.electro'),
          }),
        },
        {
          text: ct.chg('skill.skillParams.2'),
          value: dm.skill.shieldDuration,
          unit: 's',
        },
        {
          text: stg('cd'),
          value: dm.skill.cd,
          unit: 's',
        },
      ],
    },
    ct.condTem('constellation2', {
      path: condC2SkillPath,
      value: condC2Skill,
      name: st('afterUse.skill'),
      teamBuff: true,
      states: {
        on: {
          fields: [
            { node: c2_eleMas },
            {
              text: stg('duration'),
              value: dm.constellation2.duration,
              unit: 's',
            },
          ],
        },
      },
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
          node: infoMut(dmgFormulas.burst.shellDmg, {
            name: ct.chg('burst.skillParams.1'),
          }),
        },
        {
          text: stg('duration'),
          value: dm.burst.duration,
          unit: 's',
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

  passive1: ct.talentTem('passive1'),
  passive2: ct.talentTem('passive2', [
    ct.condTem('passive2', {
      path: condMomentumPath,
      value: condMomentum,
      name: ct.ch('momentumCond'),
      teamBuff: true,
      states: (data) =>
        objKeyMap(
          momentumArr.filter(
            (n) =>
              n <=
              maxMomentum +
                (data.get(input.constellation).value >= 4 ? c4MaxMomentum : 0)
          ),
          (n) => ({
            name: `${n}`,
            fields: directiveFields,
          })
        ),
    }),
  ]),
  passive3: ct.talentTem('passive3', [
    ct.condTem('passive3', {
      path: condRadiancePath,
      value: condRadiance,
      name: st('elementalReaction.polestar.inside'),
      teamBuff: true,
      states: {
        on: {
          fields: [
            {
              text: st('elementalReaction.stellar.gainRadianceSc'),
            },
          ],
        },
      },
    }),
  ]),
  constellation1: ct.talentTem('constellation1'),
  constellation2: ct.talentTem('constellation2', [
    ct.condTem('constellation2', {
      path: condC2ExcessPath,
      value: condC2Excess,
      name: ct.ch('c2ExcessCond'),
      states: {
        on: {
          fields: [{ node: dmgFormulas.skill.shield }],
        },
      },
    }),
  ]),
  constellation3: ct.talentTem('constellation3', [
    { fields: [{ node: autoC3 }] },
  ]),
  constellation4: ct.talentTem('constellation4'),
  constellation5: ct.talentTem('constellation5', [
    { fields: [{ node: skillC5 }] },
  ]),
  constellation6: ct.talentTem('constellation6', [
    ct.condTem('constellation6', {
      path: condC6HitPath,
      value: condC6Hit,
      name: ct.ch('c6Cond'),
      teamBuff: true,
      states: {
        on: {
          fields: [
            { node: c6_electro_critRate_ },
            { node: c6_stellarconduct_critDMG_ },
            {
              text: stg('duration'),
              value: dm.constellation6.duration,
              unit: 's',
            },
          ],
        },
      },
    }),
  ]),
}
export default new CharacterSheet(sheet, data)
