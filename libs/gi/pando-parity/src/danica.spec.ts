/**
 * Danica (7.3 beta, YuanShenResources) — WR ↔ Pando finals + kit checks.
 * Conds: anchor/burstEnhanced/a0StellarRadianceSc/c2Toast (bool), maidForm defense|battle
 * (Pando 1-based), a4Stacks 0–3, c2SelfToast 0–7. C3 burst / C5 skill.
 *
 *   nx test gi-pando-parity -- danica.spec.ts
 */
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
import { danicaFixture } from './fixtures.stellar'

const sp = allStats.char.skillParam.Danica

const disp = (f: ParityFixture) =>
  buildWrTeamSolo(f).getDisplay() as Record<
    string,
    Record<string, { value: number }>
  >

describe('Danica WR ↔ Pando finals', () => {
  test.each([
    [0, {}],
    [0, { anchor: true, radiance: true }],
    [0, { maidForm: 'defense' as const, a4Stacks: 3 }],
    [0, { maidForm: 'defense' as const, a4Stacks: 2, burstEnhanced: true }],
    [0, { maidForm: 'battle' as const, a4Stacks: 3, burstEnhanced: true }],
    [
      6,
      {
        anchor: true,
        maidForm: 'defense' as const,
        a4Stacks: 3,
        burstEnhanced: true,
        radiance: true,
        c2Toast: true,
      },
    ],
    [6, { anchor: true, maidForm: 'battle' as const, c2SelfToast: 7 }],
  ] as const)('C%i aligned finals %j', (c, conds) => {
    const f = danicaFixture(c, conds)
    const pando = buildPando(f)
    assertFinals(buildWrTeamSolo(f), pando)
    assertPandoListingsFinite(pando)
    expect(pandoListingNames(pando)).toEqual(
      expect.arrayContaining([
        'skill',
        'skill_entry',
        'skill_onField',
        'skill_anchor0',
        'burst_hit1',
        'burst_hit5',
        'skill_shield',
      ])
    )
  })
})

describe('Danica kit numbers', () => {
  test('A4: one-time +20% ATK in Defense Maid (no stacking); Battle Maid gives no ATK', () => {
    const base = buildWrTeamSolo(danicaFixture(0))
    const baseAtk = base.get(input.base.atk).value
    for (const stacks of [0, 1, 3]) {
      const d = readWrFinal(buildWrTeamSolo(danicaFixture(0, { maidForm: 'defense', a4Stacks: stacks })), 'atk')
      expect(d - readWrFinal(base, 'atk')).toBeCloseTo(baseAtk * 0.2, 3)
    }
    const battle = buildWrTeamSolo(danicaFixture(0, { maidForm: 'battle', a4Stacks: 3 }))
    expect(readWrFinal(battle, 'atk')).toBeCloseTo(readWrFinal(base, 'atk'), 6)
    expect(battle.get(input.total.atkSPD_).value).toBeCloseTo(0.6, 6) // 20/40/60%
  })

  test('Burst (Defense Maid enhanced): party ATK = min(ratio x Danica premod ATK, cap); C1 x1.8', () => {
    for (const c of [0, 1]) {
      const off = buildWrTeamSolo(danicaFixture(c, { maidForm: 'defense' }))
      const on = buildWrTeamSolo(
        danicaFixture(c, { maidForm: 'defense', burstEnhanced: true })
      )
      const lvl = 9 - 1 // burst talent 9 (C3 not reached)
      const expected =
        (c >= 1 ? 1.8 : 1) *
        Math.min(
          sp.burst[5][lvl] * off.get(input.premod.atk).value,
          sp.burst[6][lvl]
        )
      expect(readWrFinal(on, 'atk') - readWrFinal(off, 'atk')).toBeCloseTo(
        expected,
        3
      )
    }
  })

  test('Burst ATK buff reaches teammates (team pipeline)', () => {
    const mk = (on: boolean) =>
      buildWrTeam([
        danicaFixture(0, { maidForm: 'defense', burstEnhanced: on }),
        {
          members: [
            {
              char: {
                key: 'Mitya',
                level: 90,
                talent: { auto: 9, skill: 9, burst: 9 },
                ascension: 6,
                constellation: 0,
              },
              weapon: {
                key: 'FavoniusCodex',
                level: 90,
                ascension: 6,
                refinement: 1,
                location: 'Mitya',
                lock: false,
              },
            },
          ],
          enemy: { lvl: 90, preRes: 0.1 },
        },
      ])
    const off = mk(false),
      on = mk(true)
    const expected = Math.min(
      sp.burst[5][8] * off.Danica.get(input.premod.atk).value,
      sp.burst[6][8]
    )
    expect(
      readWrFinal(on.Mitya, 'atk') - readWrFinal(off.Mitya, 'atk')
    ).toBeCloseTo(expected, 3)
  })

  test('C6 Elevation 20% + A1 Electro shred on Entry Skill E2 (Stellar-Conduct)', () => {
    const off = disp(danicaFixture(6, {}, 'hit')).skill.entryDmg.value
    const on = disp(danicaFixture(6, { anchor: true }, 'hit')).skill.entryDmg
      .value
    // res 10% -> 0.90 multiplier; with -15% shred -> -5% -> 1.025
    expect(on / off).toBeCloseTo((1.2 * 1.025) / 0.9, 6)
  })

  test('C2 Toast: flat +100% of Danica ATK on Stellar-Conduct DMG', () => {
    const f0 = danicaFixture(2, {}, 'hit'),
      f1 = danicaFixture(2, { c2Toast: true }, 'hit')
    const atk = readWrFinal(buildWrTeamSolo(f0), 'atk')
    const diff = disp(f1).skill.entryDmg.value - disp(f0).skill.entryDmg.value
    expect(diff / (atk * 0.9)).toBeCloseTo(1, 4) // x res multiplier, Stellar DMG ignores DEF
  })

  test('Burst Stellar-Conduct hits only in Radiance', () => {
    expect(disp(danicaFixture(0)).burst.hit1ScDmg.value).toBe(0)
    expect(
      disp(danicaFixture(0, { radiance: true })).burst.hit1ScDmg.value
    ).toBeGreaterThan(0)
  })
})
