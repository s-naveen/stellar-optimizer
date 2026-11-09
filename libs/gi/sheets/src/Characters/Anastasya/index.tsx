import { objKeyValMap } from '@genshin-optimizer/common/util'
import {
  allStellarReactionKeys,
  type CharacterKey,
} from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import {
  compareEq,
  constant,
  equal,
  equalStr,
  greaterEq,
  infoMut,
  input,
  lookup,
  min,
  naught,
  one,
  percent,
  prod,
  stellarDmgNode,
  subscript,
  sum,
  tally,
  target,
  unequal,
} from '@genshin-optimizer/gi/wr'
import type { NumNode } from '@genshin-optimizer/gi/wr'
import { cond, st, stg } from '../../SheetUtil'
import { CharacterSheet } from '../CharacterSheet'
import { charTemplates } from '../charTemplates'
import {
  dataObjForCharacterSheet,
  dmgNode,
  hitEle,
  plungingDmgNodes,
} from '../dataUtil'
import type { TalentSheet } from '../ICharacterSheet'

const key: CharacterKey = 'Anastasya'
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
      skillParam_gen.auto[a++], // 4 (x3)
      skillParam_gen.auto[a++], // 5
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
    crownDmg: skillParam_gen.skill[s++], // x2 per attack
    crownSc: skillParam_gen.skill[s++],
    crownSs: skillParam_gen.skill[s++],
    honorHitArr: [
      skillParam_gen.skill[s++], // 1
      skillParam_gen.skill[s++], // 2 (x2)
      skillParam_gen.skill[s++], // 3
      skillParam_gen.skill[s++], // 4 (x3)
      skillParam_gen.skill[s++], // 5 (x3)
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
    doom1Dmg: skillParam_gen.burst[b++], // x5
    doomSgArr: [0, 1, 2].map(() => ({
      sc: skillParam_gen.burst[b++],
      ss: skillParam_gen.burst[b++],
    })),
    loveDuration: skillParam_gen.burst[b++][0],
    honorDuration: skillParam_gen.burst[b++][0],
    cd: skillParam_gen.burst[b++][0],
    enerCost: skillParam_gen.burst[b++][0],
  },
  passive1: {
    critDMG_: skillParam_gen.passive1[0][0],
    duration: skillParam_gen.passive1[1][0],
    linger: skillParam_gen.passive1[2][0],
  },
  passive2: {
    stellarswirl_mult_: skillParam_gen.passive2[1][0],
  },
  passive3: {
    ssDuration: skillParam_gen.passive3![0][0],
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
  constellation4: {
    accoladesInc: skillParam_gen.constellation4[0],
  },
  constellation6: {
    triumphMult: skillParam_gen.constellation6[2],
    love_specialDmg_: skillParam_gen.constellation6[3],
    doomMult: skillParam_gen.constellation6[4],
    honor_specialDmg_: skillParam_gen.constellation6[5],
  },
} as const

const PARTY_SIZE = 4

/* ---------- Conditionals ---------- */
const [condBlessingPath, condBlessing] = cond(key, 'blessing') // love | honor
const love = equal(condBlessing, 'love', 1)
const honor = equal(condBlessing, 'honor', 1)
const [condBurstPath, condBurst] = cond(key, 'burstActive')
const burstActive = equal(condBurst, 'on', 1)
// Radiance: Stellar-Conduct ('on') or Radiance: Stellar Swirl ('ss')
const [condRadiancePath, condRadiance] = cond(key, 'a0StellarRadianceSc')
const radianceSc = equal(condRadiance, 'on', 1)
const radianceSs = equal(condRadiance, 'ss', 1)
// Accolades (A1): normal / Anastasya Sealed (Love burst) / teammates Sealed (Honor burst)
const [condAccoladesPath, condAccolades] = cond(key, 'accolades')

/* ---------- A1 Accolades ---------- */
const c1On = greaterEq(input.constellation, 1, 1)
const isSelf = compareEq(target.charKey, input.charKey, 1, 0)
// Number of "Accolades" units (1 unit = the base 12% CRIT DMG / C1 15% ATK or 60 EM).
const others = PARTY_SIZE - 1
// C1 x3 applies only to the share split off Anastasya while she is Sealed (user-confirmed).
const c1SealedShare = compareEq(c1On, 1, dm.constellation1.sealedMult, 1)
// Units held by Anastasya herself
const mkSelfUnits = () =>
  lookup(
    condAccolades,
    {
      on: constant(1),
      // Sealed (Love): her unit is split among the others; with C1 she keeps hers.
      loveSeal: c1On,
      // Teammates Sealed (Honor): she receives all of their units.
      honorSeal: constant(1 + others),
    },
    naught
  )
// Units held by each teammate
const mkOthersUnits = () =>
  lookup(
    condAccolades,
    {
      on: constant(1),
      // Own unit + 1/3 of Anastasya's (x3 at C1): 12% -> 16% (C1: 24%)
      loveSeal: sum(1, prod(1 / others, c1SealedShare)),
      // Sealed themselves: they lose theirs, with C1 they keep it.
      honorSeal: c1On,
    },
    naught
  )
const accoladesUnits = compareEq(isSelf, 1, mkSelfUnits(), mkOthersUnits())
const accoladesMult = prod(
  accoladesUnits,
  sum(
    one,
    greaterEq(input.constellation, 4, percent(dm.constellation4.accoladesInc))
  )
)
const a1_critDMG_ = greaterEq(
  input.asc,
  1,
  prod(accoladesMult, percent(dm.passive1.critDMG_)),
  { path: 'critDMG_', isTeamBuff: true }
)
/* C1: each Accolades copy carries the bonus type of the character it came from:
 * Cryo copy -> +15% ATK, non-Cryo copy -> +60 EM (CRIT DMG is the same for every copy).
 * - Nobody Sealed: everyone holds their own copy.
 * - Love (Anastasya Sealed): her Cryo copy is split among the 3 allies and the shared part is
 *   x3 -> each ally gains one full Cryo copy; she keeps her own.
 * - Honor (allies Sealed): Anastasya receives every ally's copy (by the ally's element);
 *   Sealed allies keep their own.
 * Matches the community table (credits Kuroo) incl. C4 x1.3. Assumes a 4-member party. */
const mkC4Mult = () =>
  sum(
    one,
    greaterEq(input.constellation, 4, percent(dm.constellation4.accoladesInc))
  )
const cryoAllies = sum(tally.cryo, -1) // Cryo party members other than Anastasya
const nonCryoAllies = sum(PARTY_SIZE - 1, prod(-1, cryoAllies))
const mkAtkCopies = (self: NumNode, tCryo: NumNode) =>
  lookup(
    condAccolades,
    {
      on: tCryo,
      loveSeal: compareEq(self, 1, constant(1), sum(tCryo, 1)),
      honorSeal: compareEq(self, 1, sum(1, cryoAllies), tCryo),
    },
    naught
  )
const mkEmCopies = (self: NumNode, tCryo: NumNode) =>
  lookup(
    condAccolades,
    {
      on: sum(1, prod(-1, tCryo)),
      loveSeal: compareEq(self, 1, constant(0), sum(1, prod(-1, tCryo))),
      honorSeal: compareEq(self, 1, nonCryoAllies, sum(1, prod(-1, tCryo))),
    },
    naught
  )
const targetCryo = equal(target.charEle, 'cryo', 1)
const mkC1 = (copies: NumNode, base: NumNode | number) =>
  greaterEq(
    input.asc,
    1,
    greaterEq(input.constellation, 1, prod(copies, mkC4Mult(), base))
  )
const c1_atk_ = infoMut(
  mkC1(mkAtkCopies(isSelf, targetCryo), percent(dm.constellation1.cryo_atk_)),
  { path: 'atk_', isTeamBuff: true }
)
const c1_eleMas = infoMut(
  mkC1(mkEmCopies(isSelf, targetCryo), dm.constellation1.eleMas),
  { path: 'eleMas', isTeamBuff: true }
)

// Display-only lines (not target dependent) so Anastasya's card shows what everyone gets.
const mkAccDisp = (
  units: NumNode,
  base: NumNode | number,
  minC: number,
  name: ReturnType<typeof ct.ch>
) =>
  infoMut(
    greaterEq(
      input.asc,
      1,
      greaterEq(input.constellation, minC, prod(units, mkC4Mult(), base))
    ),
    { name, isTeamBuff: true }
  )
const ONE = constant(1),
  ZERO = constant(0)
const accDispFields = () => [
  {
    node: infoMut(
      mkAccDisp(
        mkSelfUnits(),
        percent(dm.passive1.critDMG_),
        0,
        ct.ch('dispCdSelf')
      ),
      { unit: '%' }
    ),
  },
  {
    node: infoMut(
      mkAccDisp(
        mkOthersUnits(),
        percent(dm.passive1.critDMG_),
        0,
        ct.ch('dispCdOthers')
      ),
      { unit: '%' }
    ),
  },
  {
    node: infoMut(
      mkAccDisp(
        mkAtkCopies(ONE, ONE),
        percent(dm.constellation1.cryo_atk_),
        1,
        ct.ch('dispAtkSelf')
      ),
      { unit: '%' }
    ),
  },
  {
    node: mkAccDisp(
      mkEmCopies(ONE, ONE),
      dm.constellation1.eleMas,
      1,
      ct.ch('dispEmSelf')
    ),
  },
  {
    node: infoMut(
      mkAccDisp(
        mkAtkCopies(ZERO, ONE),
        percent(dm.constellation1.cryo_atk_),
        1,
        ct.ch('dispAtkCryo')
      ),
      { unit: '%' }
    ),
  },
  {
    node: infoMut(
      mkAccDisp(
        mkAtkCopies(ZERO, ZERO),
        percent(dm.constellation1.cryo_atk_),
        1,
        ct.ch('dispAtkNonCryo')
      ),
      { unit: '%' }
    ),
  },
  {
    node: mkAccDisp(
      mkEmCopies(ZERO, ZERO),
      dm.constellation1.eleMas,
      1,
      ct.ch('dispEmOthers')
    ),
  },
]

/* ---------- A4 / A0 ---------- */
const a4_stellarswirl_mult_ = greaterEq(
  input.asc,
  4,
  percent(dm.passive2.stellarswirl_mult_),
  { path: 'stellarswirl_mult_', isTeamBuff: true }
)
// Factories: each use gets its own node so display info (labels/units) never collides.
const mkA0 = () =>
  min(
    prod(percent(dm.passive3.baseDmgPer100Atk), input.total.atk, 1 / 100),
    percent(dm.passive3.maxBaseDmg)
  )
const a0_stellarconduct_baseDmg_ = mkA0()
const a0_stellarswirl_baseDmg_ = mkA0()

/* ---------- Burst (Love) team Stellar Glimmer DMG ---------- */
const mkLove = () =>
  equal(
    love,
    1,
    equal(
      burstActive,
      1,
      subscript(input.total.burstIndex, dm.burst.love_stellar_dmg_, {
        unit: '%',
      })
    )
  )

/* ---------- Constellations ---------- */
const mkC2Love = () =>
  greaterEq(
    input.constellation,
    2,
    equal(love, 1, percent(dm.constellation2.stellar_critDMG_))
  )
const c2Honor_mult = sum(
  one,
  greaterEq(
    input.constellation,
    2,
    equal(honor, 1, percent(dm.constellation2.honorMult - 1))
  )
)
const mkC2Special = () =>
  greaterEq(
    input.constellation,
    2,
    percent(dm.constellation2.stellar_specialDmg_)
  )
const mkC6LoveSpecial = () =>
  greaterEq(
    input.constellation,
    6,
    equal(love, 1, percent(dm.constellation6.love_specialDmg_))
  )
const mkC6HonorSpecial = () =>
  greaterEq(
    input.constellation,
    6,
    equal(honor, 1, percent(dm.constellation6.honor_specialDmg_))
  )
const teamStellarObj = (
  mk: () => NumNode,
  suffix: '_dmg_' | '_critDMG_' | '_specialDmg_'
) => objKeyValMap(allStellarReactionKeys, (k) => [`${k}${suffix}`, mk()])
const mkTeamSpecial = () => sum(mkC2Special(), mkC6LoveSpecial())

/* ---------- Damage ---------- */
// Stellar Glimmer hit: Stellar-Conduct or Stellar Swirl variant
const sg = (
  variant: 'stellarconduct' | 'stellarswirl',
  arr: number[],
  talent: 'skill' | 'burst',
  specialMultiplier?: NumNode
) =>
  stellarDmgNode(
    subscript(input.total[`${talent}Index`], arr, { unit: '%' }),
    'atk',
    variant,
    'cryo',
    undefined,
    specialMultiplier
  )
// Hits that are Stellar Glimmer only while in a Radiance state
const radianceOnly = (
  sc: number[],
  ss: number[],
  talent: 'skill' | 'burst',
  mult?: NumNode
) => ({
  sc: equal(radianceSc, 1, sg('stellarconduct', sc, talent, mult)),
  ss: equal(radianceSs, 1, sg('stellarswirl', ss, talent, mult)),
})
// Burst hits: Stellar-Conduct by default, Stellar Swirl while in Radiance: Stellar Swirl
const burstStellar = (sc: number[], ss: number[], mult?: NumNode) => ({
  sc: equal(radianceSs, 0, sg('stellarconduct', sc, 'burst', mult)),
  ss: equal(radianceSs, 1, sg('stellarswirl', ss, 'burst', mult)),
})

const honorMult = c2Honor_mult
const c6TriumphMult = constant(dm.constellation6.triumphMult)
const c6DoomMult = constant(dm.constellation6.doomMult)

const dmgFormulas = {
  normal: Object.fromEntries(
    dm.normal.hitArr.map((arr, i) => [i, dmgNode('atk', arr, 'normal')])
  ),
  charged: {
    aimed: dmgNode('atk', dm.charged.aimed, 'charged'),
    fullyCharged: dmgNode(
      'atk',
      dm.charged.fullyCharged,
      'charged',
      hitEle.cryo
    ),
  },
  plunging: plungingDmgNodes('atk', dm.plunging),
  skill: {
    tapDmg: dmgNode('atk', dm.skill.tapDmg, 'skill'),
    holdDmg: dmgNode('atk', dm.skill.holdDmg, 'skill'),
    crownDmg: dmgNode('atk', dm.skill.crownDmg, 'skill'),
    ...(() => {
      const r = radianceOnly(dm.skill.crownSc, dm.skill.crownSs, 'skill')
      return { crownSc: r.sc, crownSs: r.ss }
    })(),
    ...Object.fromEntries(
      dm.skill.honorHitArr.flatMap((arr, i) => {
        const r = radianceOnly(
          dm.skill.honorSgArr[i].sc,
          dm.skill.honorSgArr[i].ss,
          'skill',
          honorMult
        )
        return [
          [
            `honor${i}`,
            dmgNode('atk', arr, 'normal', hitEle.cryo, honorMult, 'skill'),
          ],
          [`honor${i}Sc`, r.sc],
          [`honor${i}Ss`, r.ss],
        ]
      })
    ),
  },
  burst: {
    loveDmg: dmgNode('atk', dm.burst.loveDmg, 'burst'),
    ...(() => {
      const crown = burstStellar(dm.burst.crownSc, dm.burst.crownSs)
      const triumph = burstStellar(dm.burst.triumphSc, dm.burst.triumphSs)
      const evernight = burstStellar(
        dm.burst.evernightSc,
        dm.burst.evernightSs,
        honorMult
      )
      return {
        crownSc: crown.sc,
        crownSs: crown.ss,
        triumphSc: triumph.sc,
        triumphSs: triumph.ss,
        evernightSc: evernight.sc,
        evernightSs: evernight.ss,
      }
    })(),
    doom1Dmg: dmgNode(
      'atk',
      dm.burst.doom1Dmg,
      'skill',
      hitEle.cryo,
      honorMult,
      'burst'
    ),
    ...Object.fromEntries(
      dm.burst.doomSgArr.flatMap(({ sc, ss }, i) => {
        const r = burstStellar(sc, ss, honorMult)
        return [
          [`doom${i}Sc`, r.sc],
          [`doom${i}Ss`, r.ss],
        ]
      })
    ),
  },
  passive3: {
    a0_stellarconduct_baseDmg_,
    a0_stellarswirl_baseDmg_,
  },
  constellation6: {
    ...(() => {
      const t = burstStellar(
        dm.burst.triumphSc,
        dm.burst.triumphSs,
        c6TriumphMult
      )
      const d = burstStellar(
        dm.burst.doomSgArr[2].sc,
        dm.burst.doomSgArr[2].ss,
        prod(c6DoomMult, honorMult)
      )
      return {
        triumphSc: greaterEq(input.constellation, 6, equal(love, 1, t.sc)),
        triumphSs: greaterEq(input.constellation, 6, equal(love, 1, t.ss)),
        doom3Sc: greaterEq(input.constellation, 6, equal(honor, 1, d.sc)),
        doom3Ss: greaterEq(input.constellation, 6, equal(honor, 1, d.ss)),
      }
    })(),
  },
}

const burstC3 = greaterEq(input.constellation, 3, 3)
const skillC5 = greaterEq(input.constellation, 5, 3)

export const data = dataObjForCharacterSheet(key, dmgFormulas, {
  premod: {
    burstBoost: burstC3,
    skillBoost: skillC5,
    ...teamStellarObj(mkC6HonorSpecial, '_specialDmg_'),
  },
  teamBuff: {
    premod: {
      critDMG_: a1_critDMG_,
      atk_: c1_atk_,
      eleMas: c1_eleMas,
      stellarswirl_mult_: a4_stellarswirl_mult_,
      stellarconduct_baseDmg_: mkA0(),
      stellarswirl_baseDmg_: mkA0(),
      ...teamStellarObj(mkLove, '_dmg_'),
      ...teamStellarObj(mkC2Love, '_critDMG_'),
      ...teamStellarObj(mkTeamSpecial, '_specialDmg_'),
    },
  },
  flags: {
    radiance: compareEq(
      condRadiance,
      'on',
      'sc',
      equalStr(condRadiance, 'ss', 'ss')
    ),
  },
})

const stellarFields = (
  sc: NumNode,
  ss: NumNode,
  scName: ReturnType<typeof ct.ch>,
  ssName: ReturnType<typeof ct.ch>
) => [
  { node: infoMut(sc, { name: scName }) },
  { node: infoMut(ss, { name: ssName }) },
]

const sheet: TalentSheet = {
  auto: ct.talentTem('auto', [
    { text: ct.chg('auto.fields.normal') },
    {
      fields: dm.normal.hitArr.map((_, i) => ({
        node: infoMut(dmgFormulas.normal[i], {
          name: ct.chg(`auto.skillParams.${i}`),
          multi: i === 2 ? 2 : i === 3 ? 3 : undefined,
        }),
      })),
    },
    { text: ct.chg('auto.fields.charged') },
    {
      fields: [
        {
          node: infoMut(dmgFormulas.charged.aimed, {
            name: ct.chg('auto.skillParams.5'),
          }),
        },
        {
          node: infoMut(dmgFormulas.charged.fullyCharged, {
            name: ct.chg('auto.skillParams.6'),
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
          node: infoMut(dmgFormulas.skill.crownDmg, {
            name: ct.chg('skill.skillParams.2'),
            multi: 2,
          }),
        },
        ...stellarFields(
          dmgFormulas.skill.crownSc,
          dmgFormulas.skill.crownSs,
          ct.ch('crownSc'),
          ct.ch('crownSs')
        ),
        ...dm.skill.honorHitArr.flatMap((_, i) => {
          const f = dmgFormulas.skill as Record<string, NumNode>
          return [
            {
              node: infoMut(f[`honor${i}`], {
                name: ct.chg(`skill.skillParams.${4 + i}`),
                multi: i === 1 ? 2 : i >= 3 ? 3 : undefined,
              }),
            },
            ...stellarFields(
              f[`honor${i}Sc`],
              f[`honor${i}Ss`],
              ct.ch(`honorSc.${i}`),
              ct.ch(`honorSs.${i}`)
            ),
          ]
        }),
        {
          text: ct.chg('skill.skillParams.14'),
          value: dm.skill.crownDuration,
          unit: 's',
        },
        {
          text: ct.chg('skill.skillParams.15'),
          value: dm.skill.honorDuration,
          unit: 's',
        },
        { text: stg('cd'), value: dm.skill.cd, unit: 's' },
      ],
    },
    ct.condTem('skill', {
      path: condBlessingPath,
      value: condBlessing,
      name: ct.ch('blessingCond'),
      teamBuff: true,
      states: {
        love: {
          name: ct.ch('love'),
          fields: [
            {
              node: infoMut(mkC2Love(), {
                path: 'stellarconduct_critDMG_',
              }),
            },
          ],
        },
        honor: { name: ct.ch('honor'), fields: [] },
      },
    }),
    ct.condTem('passive1', {
      path: condAccoladesPath,
      value: condAccolades,
      name: ct.ch('accoladesCond'),
      teamBuff: true,
      states: {
        on: {
          name: ct.ch('accoladesNormal'),
          fields: [
            ...accDispFields(),
            { text: stg('duration'), value: dm.passive1.duration, unit: 's' },
          ],
        },
        loveSeal: {
          name: ct.ch('accoladesLoveSeal'),
          fields: accDispFields(),
        },
        honorSeal: {
          name: ct.ch('accoladesHonorSeal'),
          fields: accDispFields(),
        },
      },
    }),
  ]),

  burst: ct.talentTem('burst', [
    {
      fields: [
        {
          node: infoMut(dmgFormulas.burst.loveDmg, {
            name: ct.chg('burst.skillParams.0'),
          }),
        },
        ...stellarFields(
          dmgFormulas.burst.crownSc,
          dmgFormulas.burst.crownSs,
          ct.ch('burstCrownSc'),
          ct.ch('burstCrownSs')
        ),
        ...stellarFields(
          dmgFormulas.burst.triumphSc,
          dmgFormulas.burst.triumphSs,
          ct.ch('triumphSc'),
          ct.ch('triumphSs')
        ),
        ...stellarFields(
          dmgFormulas.burst.evernightSc,
          dmgFormulas.burst.evernightSs,
          ct.ch('evernightSc'),
          ct.ch('evernightSs')
        ),
        {
          node: infoMut(dmgFormulas.burst.doom1Dmg, {
            name: ct.chg('burst.skillParams.5'),
            multi: 5,
          }),
        },
        ...[0, 1, 2].flatMap((i) => {
          const f = dmgFormulas.burst as Record<string, NumNode>
          return stellarFields(
            f[`doom${i}Sc`],
            f[`doom${i}Ss`],
            ct.ch(`doomSc.${i}`),
            ct.ch(`doomSs.${i}`)
          )
        }),
        {
          text: ct.chg('burst.skillParams.9'),
          value: dm.burst.loveDuration,
          unit: 's',
        },
        {
          text: ct.chg('burst.skillParams.10'),
          value: dm.burst.honorDuration,
          unit: 's',
        },
        { text: stg('cd'), value: dm.burst.cd, unit: 's' },
        { text: stg('energyCost'), value: dm.burst.enerCost },
      ],
    },
    ct.condTem('burst', {
      path: condBurstPath,
      value: condBurst,
      name: ct.ch('burstCond'),
      teamBuff: true,
      canShow: love,
      states: {
        on: {
          fields: [
            {
              node: infoMut(mkLove(), {
                path: 'stellarconduct_dmg_',
                isTeamBuff: true,
              }),
            },
            {
              node: infoMut(mkLove(), {
                path: 'stellarswirl_dmg_',
                isTeamBuff: true,
              }),
            },
            { text: stg('duration'), value: dm.burst.loveDuration, unit: 's' },
          ],
        },
      },
    }),
  ]),

  passive1: ct.talentTem('passive1', [
    ct.headerTem('passive1', {
      teamBuff: true,
      canShow: unequal(condAccolades, undefined, 1),
      fields: [
        ...accDispFields().slice(0, 2),
        { text: stg('duration'), value: dm.passive1.duration, unit: 's' },
      ],
    }),
    { fields: [{ text: ct.ch('accoladesHint') }] },
  ]),
  passive2: ct.talentTem('passive2', [
    ct.headerTem('passive2', {
      teamBuff: true,
      fields: [{ node: a4_stellarswirl_mult_ }],
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
        {
          node: infoMut(a0_stellarswirl_baseDmg_, {
            path: 'stellarswirl_baseDmg_',
            isTeamBuff: true,
          }),
        },
      ],
    }),
    ct.condTem('passive3', {
      path: condRadiancePath,
      value: condRadiance,
      name: st('elementalReaction.stellar.radiance'),
      teamBuff: true,
      states: {
        on: {
          name: st('elementalReaction.polestar.inside'),
          fields: [{ text: st('elementalReaction.stellar.gainRadianceSc') }],
        },
        ss: {
          name: st('elementalReaction.team.stellarswirl'),
          fields: [
            { text: st('elementalReaction.stellar.gainRadianceSs') },
            { text: stg('duration'), value: dm.passive3.ssDuration, unit: 's' },
          ],
        },
      },
    }),
  ]),
  passive: ct.talentTem('passive'),
  constellation1: ct.talentTem('constellation1', [
    ct.headerTem('constellation1', {
      teamBuff: true,
      canShow: unequal(condAccolades, undefined, 1),
      fields: accDispFields().slice(2),
    }),
    { fields: [{ text: ct.ch('c1Hint') }] },
  ]),
  constellation2: ct.talentTem('constellation2', [
    {
      fields: [
        {
          node: infoMut(mkC2Love(), {
            path: 'stellarconduct_critDMG_',
            isTeamBuff: true,
          }),
        },
        {
          node: infoMut(mkC2Special(), {
            path: 'stellarconduct_specialDmg_',
            isTeamBuff: true,
          }),
        },
      ],
    },
  ]),
  constellation3: ct.talentTem('constellation3', [
    { fields: [{ node: burstC3 }] },
  ]),
  constellation4: ct.talentTem('constellation4', [
    { fields: [{ text: ct.ch('c4Hint') }] },
  ]),
  constellation5: ct.talentTem('constellation5', [
    { fields: [{ node: skillC5 }] },
  ]),
  constellation6: ct.talentTem('constellation6', [
    {
      fields: [
        ...stellarFields(
          dmgFormulas.constellation6.triumphSc,
          dmgFormulas.constellation6.triumphSs,
          ct.ch('c6TriumphSc'),
          ct.ch('c6TriumphSs')
        ),
        ...stellarFields(
          dmgFormulas.constellation6.doom3Sc,
          dmgFormulas.constellation6.doom3Ss,
          ct.ch('c6DoomSc'),
          ct.ch('c6DoomSs')
        ),
        {
          node: infoMut(mkC6LoveSpecial(), {
            path: 'stellarconduct_specialDmg_',
            isTeamBuff: true,
          }),
        },
        {
          node: infoMut(mkC6HonorSpecial(), {
            path: 'stellarconduct_specialDmg_',
          }),
        },
      ],
    },
  ]),
}

export default new CharacterSheet(sheet, data)
