/**
 * Valeriy (7.3 beta, YuanShenResources) — WR ↔ Pando finals + kit checks.
 * Conds: offensiveDirective / a0StellarRadianceSc / c2Skill / c2Excess / c6Hit (bool),
 * a4Momentum 40–130 (Impact Momentum consumed; capped at 100, C4 130). C3 auto / C5 skill.
 *
 *   cd libs/gi/pando-parity && CI=true npx vitest run src/valeriy.spec.ts
 */
import { own } from '@genshin-optimizer/gi/formula'
import { allStats } from '@genshin-optimizer/gi/stats'
import { input } from '@genshin-optimizer/gi/wr'
import { expect } from 'vitest'
import {
  assertFinals,
  assertPandoListingsFinite,
  buildPando,
  buildWrTeam,
  buildWrTeamSolo,
  type ParityFixture,
  pandoListingNames,
  readWrFinal,
} from './harness'
import { relDiff } from './relDiff'

const sp = allStats.char.skillParam.Valeriy
const LVL = 9 - 1 // talents at 9 (C3/C5 not reached unless noted)

type Conds = {
  directive?: boolean
  radiance?: boolean
  momentum?: number
  c2Skill?: boolean
  c2Excess?: boolean
  c6Hit?: boolean
}

const valeriyFixture = (
  c: number,
  conds: Conds = {},
  hitMode: ParityFixture['hitMode'] = 'avgHit'
): ParityFixture => {
  const wr: Record<string, string | number> = {}
  const pandoConditionals: NonNullable<ParityFixture['pandoConditionals']> = []
  const push = (name: string, value: number) =>
    pandoConditionals.push({
      sheet: 'Valeriy',
      src: '0',
      dst: null,
      name,
      value,
    })
  const bool = (k: keyof Conds, name: string) => {
    if (conds[k]) {
      wr[name] = 'on'
      push(name, 1)
    }
  }
  bool('directive', 'offensiveDirective')
  bool('radiance', 'a0StellarRadianceSc')
  bool('c2Skill', 'c2Skill')
  bool('c2Excess', 'c2Excess')
  bool('c6Hit', 'c6Hit')
  if (conds.momentum) {
    wr.a4Momentum = String(conds.momentum)
    push('a4Momentum', conds.momentum)
  }
  return {
    members: [
      {
        char: {
          key: 'Valeriy',
          level: 90,
          talent: { auto: 9, skill: 9, burst: 9 },
          ascension: 6,
          constellation: c,
        },
        weapon: {
          key: 'FavoniusSword',
          level: 90,
          ascension: 6,
          refinement: 1,
          location: 'Valeriy',
          lock: false,
        },
      },
    ],
    enemy: { lvl: 90, preRes: 0.1 },
    hitMode,
    wrConditionals: { Valeriy: wr },
    pandoConditionals,
  }
}

const disp = (f: ParityFixture) =>
  buildWrTeamSolo(f).getDisplay() as Record<
    string,
    Record<string, { value: number }>
  >
const pandoFormula = (f: ParityFixture, name: string) => {
  const calc = buildPando(f)
  const read = calc
    .listFormulas(own.listing.formulas)
    .find((x) => x.tag.name === name)
  return read ? (calc.compute(read).val as number) : undefined
}

describe('Valeriy WR ↔ Pando finals', () => {
  test.each([
    [0, {}],
    [0, { directive: true }],
    [0, { directive: true, radiance: true, momentum: 100 }],
    [4, { directive: true, momentum: 130 }],
    [2, { c2Skill: true, c2Excess: true }],
    [6, { directive: true, radiance: true, c6Hit: true, momentum: 70 }],
  ] as const)('C%i aligned finals %j', (c, conds) => {
    const f = valeriyFixture(c, conds)
    const pando = buildPando(f)
    assertFinals(buildWrTeamSolo(f), pando)
    assertPandoListingsFinite(pando)
    expect(pandoListingNames(pando)).toEqual(
      expect.arrayContaining([
        'normal_0',
        'normal_2',
        'charged',
        'charged_mortar',
        'skill',
        'skill_shield',
        'skill_electroShield',
        'burst',
        'burst_shell',
      ])
    )
  })
})

describe('Valeriy kit numbers', () => {
  const atkOf = (f: ParityFixture) => readWrFinal(buildWrTeamSolo(f), 'atk')

  test('Offensive Directive outside Radiance: flat Electro DMG = (NA ratio + A4 0.3%/point) x ATK', () => {
    for (const momentum of [0, 40, 100]) {
      const f = valeriyFixture(0, { directive: true, momentum })
      const expected = (sp.auto[6][LVL] + 0.003 * momentum) * atkOf(f)
      const wr = buildWrTeamSolo(f)
      expect(wr.get(input.total.electro_dmgInc).value).toBeCloseTo(expected, 4)
      expect(wr.get(input.total.stellarconduct_dmgInc).value).toBe(0)
    }
  })

  test('Offensive Directive in Radiance: flat Stellar-Conduct DMG = (NA ratio + A4 0.9%/point) x ATK', () => {
    const f = valeriyFixture(0, {
      directive: true,
      radiance: true,
      momentum: 80,
    })
    const wr = buildWrTeamSolo(f)
    expect(wr.get(input.total.stellarconduct_dmgInc).value).toBeCloseTo(
      (sp.auto[7][LVL] + 0.009 * 80) * atkOf(f),
      4
    )
    expect(wr.get(input.total.electro_dmgInc).value).toBe(0)
  })

  test('Impact Momentum is capped at 100 (C4: 130)', () => {
    const c0 = buildWrTeamSolo(
      valeriyFixture(0, { directive: true, momentum: 130 })
    )
    const c0at100 = buildWrTeamSolo(
      valeriyFixture(0, { directive: true, momentum: 100 })
    )
    expect(c0.get(input.total.electro_dmgInc).value).toBeCloseTo(
      c0at100.get(input.total.electro_dmgInc).value,
      6
    )
    // C4 includes C3: Normal Attack level 9 + 3
    const f4 = valeriyFixture(4, { directive: true, momentum: 130 })
    expect(
      buildWrTeamSolo(f4).get(input.total.electro_dmgInc).value
    ).toBeCloseTo((sp.auto[6][LVL + 3] + 0.003 * 130) * atkOf(f4), 4)
  })

  test('the flat Electro increase lands on Electro hits only, the same in both engines', () => {
    const off = valeriyFixture(0, {}, 'hit')
    const on = valeriyFixture(0, { directive: true, momentum: 100 }, 'hit')
    for (const [section, key, pandoName, electro] of [
      ['skill', 'dmg', 'skill', true],
      ['charged', 'mortarDmg', 'charged_mortar', true],
      ['burst', 'shellDmg', 'burst_shell', true],
      ['normal', '0', 'normal_0', false],
    ] as const) {
      const wrDelta =
        disp(on)[section][key].value - disp(off)[section][key].value
      const pDelta =
        (pandoFormula(on, pandoName) ?? Number.NaN) -
        (pandoFormula(off, pandoName) ?? Number.NaN)
      if (electro) expect(wrDelta, `${pandoName} WR`).toBeGreaterThan(0)
      else expect(wrDelta, `${pandoName} WR`).toBeCloseTo(0, 6)
      expect(
        relDiff(wrDelta, pDelta) < 1e-4 || Math.abs(wrDelta - pDelta) < 1e-6,
        `${pandoName} wr=${wrDelta} pando=${pDelta}`
      ).toBe(true)
    }
  })

  test('Offensive Directive is for the active character only; C2 EM for the whole party', () => {
    const mate = {
      members: [
        {
          char: {
            key: 'Fischl' as const,
            level: 90,
            talent: { auto: 9, skill: 9, burst: 9 },
            ascension: 6,
            constellation: 0,
          },
          weapon: {
            key: 'FavoniusWarbow' as const,
            level: 90,
            ascension: 6,
            refinement: 1,
            location: 'Fischl' as const,
            lock: false,
          },
        },
      ],
      enemy: { lvl: 90, preRes: 0.1 },
    } as ParityFixture
    const team = buildWrTeam([
      valeriyFixture(2, { directive: true, c2Skill: true }),
      mate,
    ])
    // Valeriy is the active character (index 0)
    expect(team.Fischl.get(input.total.electro_dmgInc).value).toBe(0)
    expect(team.Valeriy.get(input.total.electro_dmgInc).value).toBeGreaterThan(
      0
    )
    const base = buildWrTeam([valeriyFixture(2), mate])
    expect(
      readWrFinal(team.Fischl, 'eleMas') - readWrFinal(base.Fischl, 'eleMas')
    ).toBeCloseTo(100, 6)
  })

  test('C2 excess Impact Momentum: shield +160% ATK', () => {
    const off = valeriyFixture(2)
    const on = valeriyFixture(2, { c2Excess: true })
    const atk = atkOf(off)
    const diff = disp(on).skill.shield.value - disp(off).skill.shield.value
    expect(diff / atk).toBeCloseTo(1.6, 4)
  })

  test('C6: Mortar / Thunderburst Shell DMG +100%, Electro CRIT Rate +10%, Stellar-Conduct CRIT DMG +40%', () => {
    const c5 = disp(valeriyFixture(5, {}, 'hit'))
    const c6 = disp(valeriyFixture(6, {}, 'hit'))
    // C6 adds +100% DMG bonus on those hits only (no other DMG% on a FavoniusSword Valeriy)
    expect(c6.charged.mortarDmg.value / c5.charged.mortarDmg.value).toBeCloseTo(
      (1 + 1) / 1,
      4
    )
    expect(c6.skill.dmg.value).toBeCloseTo(c5.skill.dmg.value, 6)
    const on = buildWrTeamSolo(valeriyFixture(6, { c6Hit: true }))
    const off = buildWrTeamSolo(valeriyFixture(6))
    expect(
      on.get(input.total.electro_critRate_).value -
        off.get(input.total.electro_critRate_).value
    ).toBeCloseTo(0.1, 6)
    expect(
      on.get(input.total.stellarconduct_critDMG_).value -
        off.get(input.total.stellarconduct_critDMG_).value
    ).toBeCloseTo(0.4, 6)
  })
})
