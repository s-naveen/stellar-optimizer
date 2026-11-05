/**
 * Team check: Danica + Anastasya + Mitya through the WR team pipeline.
 * Base Stellar-Conduct DMG bonuses stack (user-confirmed), each with its own 14% cap.
 *
 *   nx test gi-pando-parity -- stellar-team.spec.ts
 */
import { input } from '@genshin-optimizer/gi/wr'
import { expect } from 'vitest'
import { danicaFixture } from './fixtures.stellar'
import { buildWrTeam, type ParityFixture, readWrFinal } from './harness'

const member = (
  key: string,
  weapon: string,
  c = 0,
  wrConds: Record<string, string> = {}
): ParityFixture => ({
  members: [
    {
      char: {
        key: key as never,
        level: 90,
        talent: { auto: 9, skill: 9, burst: 9 },
        ascension: 6,
        constellation: c,
      },
      weapon: {
        key: weapon as never,
        level: 90,
        ascension: 6,
        refinement: 1,
        location: key as never,
        lock: false,
      },
    },
  ],
  enemy: { lvl: 90, preRes: 0.1 },
  hitMode: 'avgHit',
  wrConditionals: { [key]: wrConds },
})

describe('Danica + Anastasya + Mitya team', () => {
  const team = buildWrTeam([
    danicaFixture(0, {
      anchor: true,
      maidForm: 'defense',
      burstEnhanced: true,
      radiance: true,
    }),
    member('Anastasya', 'AmosBow', 0, {
      accolades: 'on',
      blessing: 'love',
      burstActive: 'on',
      a0StellarRadianceSc: 'on',
    }),
    member('Mitya', 'FavoniusCodex', 0, {
      detectionCore: 'steady',
      gradientBeacons: '3',
      a0StellarRadianceSc: 'on',
    }),
  ])

  test('Base Stellar-Conduct DMG from all three stacks (each capped at 14%)', () => {
    const atk = (k: string) => readWrFinal(team[k], 'atk')
    const em = readWrFinal(team.Mitya, 'eleMas')
    const expected =
      Math.min((atk('Danica') * 0.007) / 100, 0.14) +
      Math.min((atk('Anastasya') * 0.007) / 100, 0.14) +
      Math.min(em * 0.00028, 0.14)
    for (const k of ['Danica', 'Anastasya', 'Mitya'])
      expect(
        team[k].get(input.total.stellarconduct_baseDmg_).value
      ).toBeCloseTo(expected, 6)
  })

  test('Cross-buffs land: Accolades CRIT DMG, Danica ATK, Mitya A1 EM, Love Stellar Glimmer DMG', () => {
    expect(team.Mitya.get(input.premod.critDMG_).value).toBeGreaterThan(
      0.5 + 0.12 - 1e-9
    )
    expect(team.Danica.get(input.total.eleMas).value).toBeGreaterThanOrEqual(90) // Mitya A1 (3 beacons)
    expect(
      team.Mitya.get(input.total.stellarconduct_dmg_).value
    ).toBeGreaterThan(0) // Anastasya Love burst
  })

  test('Every displayed DMG/value for all three is finite', () => {
    for (const k of ['Danica', 'Anastasya', 'Mitya']) {
      const disp = team[k].getDisplay() as Record<
        string,
        Record<string, { value: number }>
      >
      for (const [sec, nodes] of Object.entries(disp))
        for (const [name, n] of Object.entries(nodes))
          expect(Number.isFinite(n.value), `${k} ${sec}.${name}`).toBe(true)
    }
  })
})
