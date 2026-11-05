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
} from '@genshin-optimizer/gi/wr'
import { cond, st, stg } from '../../SheetUtil'
import { CharacterSheet } from '../CharacterSheet'
import { charTemplates } from '../charTemplates'
import {
  dataObjForCharacterSheet,
  dmgNode,
  hitEle,
  plungingDmgNodes,
  shieldElement,
  shieldNodeTalent,
} from '../dataUtil'
import type { TalentSheet } from '../ICharacterSheet'

const key: CharacterKey = 'Danica'
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
      skillParam_gen.auto[a++], // 3 (x2)
      skillParam_gen.auto[a++], // 4
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
    entryDmg: skillParam_gen.skill[s++], // Entry Skill E2, Stellar-Conduct (ATK)
    onFieldDmg: skillParam_gen.skill[s++], // On-Field Skill E2, Stellar-Conduct (ATK)
    coordDmg: skillParam_gen.skill[s++],
    shieldAtk_: skillParam_gen.skill[s++],
    shieldFlat: skillParam_gen.skill[s++],
    anchorHitArr: [
      skillParam_gen.skill[s++], // 1
      skillParam_gen.skill[s++], // 2
      skillParam_gen.skill[s++], // 3 (x2)
      skillParam_gen.skill[s++], // 4
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
  passive2: {
    atk_: skillParam_gen.passive2[0][0],
    atkSPD_: 0.2, // A4 ATK SPD is only in the description text (20%)
  },
  passive3: {
    baseDmgPer100Atk: skillParam_gen.passive3![0][0],
    maxBaseDmg: skillParam_gen.passive3![1][0],
  },
  constellation1: {
    energy: skillParam_gen.constellation1[0],
    cd: skillParam_gen.constellation1[1],
    defenseInc: skillParam_gen.constellation1[2],
    battleInc: skillParam_gen.constellation1[3],
  },
  constellation2: {
    stacks: skillParam_gen.constellation2[0],
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

/* ---------- Conditionals ---------- */
const [condAnchorPath, condAnchor] = cond(key, 'anchor')
const anchorOn = equal(condAnchor, 'on', 1)
const [condMaidPath, condMaid] = cond(key, 'maidForm') // defense | battle
const [condBurstEnhPath, condBurstEnh] = cond(key, 'burstEnhanced')
const [condA4StacksPath, condA4Stacks] = cond(key, 'a4Stacks')
const a4StacksArr = range(1, 3)
const a4Stacks = lookup(
  condA4Stacks,
  objKeyMap(a4StacksArr, (n) => constant(n)),
  naught
)
const [condRadiancePath, condRadiance] = cond(key, 'a0StellarRadianceSc')
const radianceOn = equal(condRadiance, 'on', 1)
const [condC2ToastPath, condC2Toast] = cond(key, 'c2Toast')
const [condC2SelfToastPath, condC2SelfToast] = cond(key, 'c2SelfToast')
const c2SelfToastArr = range(1, 7)

const inDefense = equal(condMaid, 'defense', 1)
const inBattle = equal(condMaid, 'battle', 1)
const burstEnhanced = equal(condBurstEnh, 'on', 1)

/* ---------- Buffs ---------- */
// A1: Anchor shreds Electro RES; in Radiance additionally Electro + Cryo
const a1_electro_enemyRes_ = greaterEq(
  input.asc,
  1,
  equal(
    anchorOn,
    1,
    sum(
      percent(-dm.passive1.electro_enemyRes_),
      equal(radianceOn, 1, percent(-dm.passive1.radElectro_enemyRes_))
    )
  )
)
const a1_cryo_enemyRes_ = greaterEq(
  input.asc,
  1,
  equal(
    anchorOn,
    1,
    equal(radianceOn, 1, percent(-dm.passive1.radCryo_enemyRes_))
  )
)

// A4: Defense Maid -> ATK per Entry Skill E2; Battle Maid -> ATK SPD per On-Field Skill E2
const a4_atk_ = greaterEq(
  input.asc,
  4,
  // One-time +20% ATK in Defense Maid (community datamine: does not stack)
  equal(inDefense, 1, percent(dm.passive2.atk_))
)
const a4_atkSPD_ = greaterEq(
  input.asc,
  4,
  equal(inBattle, 1, prod(a4Stacks, percent(dm.passive2.atkSPD_)))
)

// A0 (Stellar passive): Base Stellar-Conduct DMG from Danica's ATK
const a0_stellarconduct_baseDmg_ = min(
  prod(percent(dm.passive3.baseDmgPer100Atk), input.total.atk, 1 / 100),
  percent(dm.passive3.maxBaseDmg)
)

// Burst enhancement (cast in Radiance: Stellar-Conduct while in a Maid Form)
const c1DefenseMult = sum(
  percent(1),
  greaterEq(input.constellation, 1, percent(dm.constellation1.defenseInc))
)
const c1BattleMult = sum(
  percent(1),
  greaterEq(input.constellation, 1, percent(dm.constellation1.battleInc))
)
// Defense Maid: party ATK = ratio x Danica's ATK (pre-team-buff), capped. Applied at `total`
// to avoid a feedback loop with Danica's own ATK.
const burstDefense_atkDisp = infoMut(
  equal(
    inDefense,
    1,
    equal(
      burstEnhanced,
      1,
      prod(
        c1DefenseMult,
        min(
          prod(
            subscript(input.total.burstIndex, dm.burst.atkRatio, { unit: '%' }),
            input.premod.atk
          ),
          subscript(input.total.burstIndex, dm.burst.maxAtk)
        )
      )
    )
  ),
  { path: 'atk', isTeamBuff: true }
)
// Battle Maid: On-Field Skill E2 DMG increase
const burstBattle_onField_dmg_ = infoMut(
  equal(
    inBattle,
    1,
    equal(
      burstEnhanced,
      1,
      prod(
        c1BattleMult,
        subscript(input.total.burstIndex, dm.burst.onFieldDmg_, {
          unit: '%',
        })
      )
    )
  ),
  { path: 'stellarconduct_dmg_' }
)

// C2 "Toast": party Stellar-Conduct DMG +100% of Danica's ATK per stack consumed
const c2Toast_dmgIncDisp = greaterEq(
  input.constellation,
  2,
  equal(
    condC2Toast,
    'on',
    prod(percent(dm.constellation2.allyAtkMult), input.total.atk)
  ),
  { path: 'stellarconduct_dmgInc', isTeamBuff: true }
)
// C2: Battle Maid, Danica consumes all her stacks (150% ATK each) on her Stellar-Conduct hit
const c2SelfToast_dmgInc = greaterEq(
  input.constellation,
  2,
  equal(
    inBattle,
    1,
    lookup(
      condC2SelfToast,
      objKeyMap(c2SelfToastArr, (n) =>
        prod(percent(dm.constellation2.selfAtkMult * n), input.total.atk)
      ),
      naught
    )
  ),
  { path: 'stellarconduct_dmgInc' }
)

// C6: Anchor -> party Stellar-Conduct DMG Elevated (擢升) 20%
const c6_stellarconduct_specialDmg_ = greaterEq(
  input.constellation,
  6,
  equal(anchorOn, 1, percent(dm.constellation6.stellarconduct_specialDmg_)),
  { path: 'stellarconduct_specialDmg_', isTeamBuff: true }
)
// C6: Defense Maid -> active character Stellar-Conduct DMG +10% per 1000 ATK (max 40%)
const c6Defense_dmg_Disp = greaterEq(
  input.constellation,
  6,
  equal(
    inDefense,
    1,
    min(
      prod(
        percent(dm.constellation6.defenseDmg_),
        input.total.atk,
        1 / dm.constellation6.defenseAtkStep
      ),
      percent(dm.constellation6.defenseMaxDmg_)
    )
  ),
  { path: 'stellarconduct_dmg_', isTeamBuff: true }
)
const c6Defense_dmg_ = equal(
  input.activeCharKey,
  target.charKey,
  c6Defense_dmg_Disp
)
// C6: Battle Maid -> On-Field Skill E2 CRIT Rate / CRIT DMG per 500 ATK
const c6Battle_critRate_ = greaterEq(
  input.constellation,
  6,
  equal(
    inBattle,
    1,
    min(
      prod(
        percent(dm.constellation6.battleCritRate_),
        input.total.atk,
        1 / dm.constellation6.battleAtkStep
      ),
      percent(dm.constellation6.battleMaxCritRate_)
    )
  ),
  { path: 'critRate_' }
)
const c6Battle_critDMG_ = greaterEq(
  input.constellation,
  6,
  equal(
    inBattle,
    1,
    min(
      prod(
        percent(dm.constellation6.battleCritDMG_),
        input.total.atk,
        1 / dm.constellation6.battleAtkStep
      ),
      percent(dm.constellation6.battleMaxCritDMG_)
    )
  ),
  { path: 'critDMG_' }
)

/* ---------- Damage ---------- */
const scTalent = (
  lvlMultiplier: number[],
  talentType: 'skill' | 'burst',
  additional = {}
) =>
  stellarDmgNode(
    subscript(input.total[`${talentType}Index`], lvlMultiplier, { unit: '%' }),
    'atk',
    'stellarconduct',
    'electro',
    additional
  )

const onFieldAddl = {
  premod: {
    stellarconduct_dmg_: burstBattle_onField_dmg_,
    stellarconduct_dmgInc: c2SelfToast_dmgInc,
    critRate_: c6Battle_critRate_,
    critDMG_: c6Battle_critDMG_,
  },
}

const dmgFormulas = {
  normal: Object.fromEntries(
    dm.normal.hitArr.map((arr, i) => [i, dmgNode('atk', arr, 'normal')])
  ),
  charged: {
    spinningDmg: dmgNode('atk', dm.charged.spinningDmg, 'charged'),
    finalDmg: dmgNode('atk', dm.charged.finalDmg, 'charged'),
  },
  plunging: plungingDmgNodes('atk', dm.plunging),
  skill: {
    dmg: dmgNode('atk', dm.skill.dmg, 'skill'),
    coordDmg: dmgNode('atk', dm.skill.coordDmg, 'skill'),
    ...Object.fromEntries(
      dm.skill.anchorHitArr.map((arr, i) => [
        `anchor${i}`,
        dmgNode('atk', arr, 'normal', hitEle.electro, undefined, 'skill'),
      ])
    ),
    entryDmg: scTalent(dm.skill.entryDmg, 'skill'),
    onFieldDmg: scTalent(dm.skill.onFieldDmg, 'skill', onFieldAddl),
    shield: shieldNodeTalent(
      'atk',
      dm.skill.shieldAtk_,
      dm.skill.shieldFlat,
      'skill'
    ),
    electroShield: shieldElement(
      'electro',
      shieldNodeTalent('atk', dm.skill.shieldAtk_, dm.skill.shieldFlat, 'skill')
    ),
  },
  burst: {
    hit1Dmg: dmgNode('atk', dm.burst.hit1Dmg, 'burst'),
    hit1ScDmg: equal(radianceOn, 1, scTalent(dm.burst.hit1ScDmg, 'burst')),
    hit234Dmg: dmgNode('atk', dm.burst.hit234Dmg, 'burst'),
    hit5Dmg: dmgNode('atk', dm.burst.hit5Dmg, 'burst'),
    hit5ScDmg: equal(radianceOn, 1, scTalent(dm.burst.hit5ScDmg, 'burst')),
  },
  passive3: {
    a0_stellarconduct_baseDmg_,
  },
}

const burstC3 = greaterEq(input.constellation, 3, 3)
const skillC5 = greaterEq(input.constellation, 5, 3)

export const data = dataObjForCharacterSheet(key, dmgFormulas, {
  premod: {
    burstBoost: burstC3,
    skillBoost: skillC5,
    atk_: a4_atk_,
    atkSPD_: a4_atkSPD_,
  },
  teamBuff: {
    premod: {
      electro_enemyRes_: a1_electro_enemyRes_,
      cryo_enemyRes_: a1_cryo_enemyRes_,
      stellarconduct_baseDmg_: a0_stellarconduct_baseDmg_,
      stellarconduct_dmgInc: c2Toast_dmgIncDisp,
      stellarconduct_specialDmg_: c6_stellarconduct_specialDmg_,
      stellarconduct_dmg_: c6Defense_dmg_,
    },
    total: {
      atk: burstDefense_atkDisp,
    },
  },
  flags: {
    radiance: equalStr(condRadiance, 'on', 'sc'),
  },
})

const sheet: TalentSheet = {
  auto: ct.talentTem('auto', [
    { text: ct.chg('auto.fields.normal') },
    {
      fields: dm.normal.hitArr.map((_, i) => ({
        node: infoMut(dmgFormulas.normal[i], {
          name: ct.chg(`auto.skillParams.${i}`),
          multi: i === 2 ? 2 : undefined,
        }),
      })),
    },
    { text: ct.chg('auto.fields.charged') },
    {
      fields: [
        {
          node: infoMut(dmgFormulas.charged.spinningDmg, {
            name: ct.chg('auto.skillParams.4'),
          }),
        },
        {
          node: infoMut(dmgFormulas.charged.finalDmg, {
            name: ct.chg('auto.skillParams.5'),
          }),
        },
        {
          text: ct.chg('auto.skillParams.6'),
          value: dm.charged.stam,
          unit: '/s',
        },
        {
          text: ct.chg('auto.skillParams.7'),
          value: dm.charged.duration,
          unit: 's',
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
          node: infoMut(dmgFormulas.skill.dmg, {
            name: ct.chg('skill.skillParams.0'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.coordDmg, {
            name: ct.chg('skill.skillParams.3'),
          }),
        },
        ...dm.skill.anchorHitArr.map((_, i) => ({
          node: infoMut(
            (dmgFormulas.skill as Record<string, any>)[`anchor${i}`],
            {
              name: ct.chg(`skill.skillParams.${5 + i}`),
              multi: i === 2 ? 2 : undefined,
            }
          ),
        })),
        {
          node: infoMut(dmgFormulas.skill.entryDmg, {
            name: ct.chg('skill.skillParams.1'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.onFieldDmg, {
            name: ct.chg('skill.skillParams.2'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.shield, {
            name: stg('dmgAbsorption'),
          }),
        },
        {
          node: infoMut(dmgFormulas.skill.electroShield, {
            name: st('dmgAbsorption.electro'),
          }),
        },
        {
          text: ct.chg('skill.skillParams.9'),
          value: dm.skill.anchorDuration,
          unit: 's',
        },
        {
          text: ct.chg('skill.skillParams.10'),
          value: dm.skill.entryCd,
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
      path: condAnchorPath,
      value: condAnchor,
      name: ct.ch('anchorCond'),
      teamBuff: true,
      states: {
        on: {
          fields: [
            {
              node: infoMut(a1_electro_enemyRes_, {
                path: 'electro_enemyRes_',
              }),
            },
            { node: infoMut(a1_cryo_enemyRes_, { path: 'cryo_enemyRes_' }) },
            { node: c6_stellarconduct_specialDmg_ },
            {
              text: ct.chg('skill.skillParams.9'),
              value: dm.skill.anchorDuration,
              unit: 's',
            },
          ],
        },
      },
    }),
    ct.condTem('skill', {
      path: condMaidPath,
      value: condMaid,
      name: ct.ch('maidCond'),
      teamBuff: true,
      states: {
        defense: {
          name: ct.ch('defenseMaid'),
          fields: [{ node: c6Defense_dmg_Disp }],
        },
        battle: {
          name: ct.ch('battleMaid'),
          fields: [
            { node: infoMut(c6Battle_critRate_, { path: 'critRate_' }) },
            { node: infoMut(c6Battle_critDMG_, { path: 'critDMG_' }) },
          ],
        },
      },
    }),
  ]),

  burst: ct.talentTem('burst', [
    {
      fields: [
        {
          node: infoMut(dmgFormulas.burst.hit1Dmg, {
            name: ct.chg('burst.skillParams.0'),
          }),
        },
        {
          node: infoMut(dmgFormulas.burst.hit1ScDmg, {
            name: ct.ch('hit1ScDmg'),
          }),
        },
        {
          node: infoMut(dmgFormulas.burst.hit234Dmg, {
            name: ct.chg('burst.skillParams.1'),
          }),
        },
        {
          node: infoMut(dmgFormulas.burst.hit5Dmg, {
            name: ct.chg('burst.skillParams.2'),
          }),
        },
        {
          node: infoMut(dmgFormulas.burst.hit5ScDmg, {
            name: ct.ch('hit5ScDmg'),
          }),
        },
        {
          text: ct.chg('burst.skillParams.6'),
          value: dm.burst.duration,
          unit: 's',
        },
        { text: stg('cd'), value: dm.burst.cd, unit: 's' },
        { text: stg('energyCost'), value: dm.burst.enerCost },
      ],
    },
    ct.condTem('burst', {
      path: condBurstEnhPath,
      value: condBurstEnh,
      name: ct.ch('burstEnhCond'),
      teamBuff: true,
      canShow: sum(inDefense, inBattle),
      states: {
        on: {
          fields: [
            { node: burstDefense_atkDisp },
            { node: burstBattle_onField_dmg_ },
            {
              text: ct.chg('burst.skillParams.6'),
              value: dm.burst.duration,
              unit: 's',
            },
          ],
        },
      },
    }),
  ]),

  passive1: ct.talentTem('passive1', [
    ct.headerTem('passive1', {
      teamBuff: true,
      canShow: anchorOn,
      fields: [
        { node: infoMut(a1_electro_enemyRes_, { path: 'electro_enemyRes_' }) },
        { node: infoMut(a1_cryo_enemyRes_, { path: 'cryo_enemyRes_' }) },
      ],
    }),
  ]),
  passive2: ct.talentTem('passive2', [
    ct.headerTem('passive2', {
      canShow: inDefense,
      fields: [{ node: infoMut(a4_atk_, { path: 'atk_' }) }],
    }),
    ct.condTem('passive2', {
      path: condA4StacksPath,
      value: condA4Stacks,
      name: ct.ch('a4Cond'),
      canShow: inBattle,
      states: objKeyMap(a4StacksArr, (n) => ({
        name: st('stack', { count: n }),
        fields: [{ node: infoMut(a4_atkSPD_, { path: 'atkSPD_' }) }],
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
      path: condRadiancePath,
      value: condRadiance,
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
  constellation1: ct.talentTem('constellation1'),
  constellation2: ct.talentTem('constellation2', [
    ct.condTem('constellation2', {
      path: condC2ToastPath,
      value: condC2Toast,
      name: ct.ch('c2ToastCond'),
      teamBuff: true,
      states: { on: { fields: [{ node: c2Toast_dmgIncDisp }] } },
    }),
    ct.condTem('constellation2', {
      path: condC2SelfToastPath,
      value: condC2SelfToast,
      name: ct.ch('c2SelfToastCond'),
      canShow: inBattle,
      states: objKeyMap(c2SelfToastArr, (n) => ({
        name: st('stack', { count: n }),
        fields: [{ node: c2SelfToast_dmgInc }],
      })),
    }),
  ]),
  constellation3: ct.talentTem('constellation3', [
    { fields: [{ node: burstC3 }] },
  ]),
  constellation4: ct.talentTem('constellation4'),
  constellation5: ct.talentTem('constellation5', [
    { fields: [{ node: skillC5 }] },
  ]),
  constellation6: ct.talentTem('constellation6', [
    {
      fields: [
        { node: c6_stellarconduct_specialDmg_ },
        { node: c6Defense_dmg_Disp },
      ],
    },
  ]),
}

export default new CharacterSheet(sheet, data)
