/**
 * Mitya WR ↔ Pando finals + kit sanity checks (7.2 beta data from YuanShenResources).
 *
 * List `detectionCore` 'steady'|'overloaded' (Pando 1-based). Num `gradientBeacons` 0–5, `a4Stacks` 0–4.
 * C3 skill / C5 auto. WR side uses buildWrTeamSolo so Mitya's own teamBuff (EM/CRIT DMG) applies,
 * matching the real UI and Pando.
 *
 *   nx test gi-pando-parity -- mitya.spec.ts
 */
import { expect } from 'vitest'
import {
  assertFinals,
  assertPandoListingsFinite,
  buildPando,
  buildWrTeamSolo,
  type ParityFixture,
  pandoListingNames,
  readPandoFinal,
  readWrFinal,
} from './harness'

const fixtureAt = (constellation: number): ParityFixture => ({
  members: [
    {
      char: {
        key: 'Mitya',
        level: 90,
        talent: { auto: 9, skill: 9, burst: 9 },
        ascension: 6,
        constellation,
      },
      weapon: {
        key: 'SacrificialFragments',
        level: 90,
        ascension: 6,
        refinement: 1,
        location: 'Mitya',
        lock: false,
      },
    },
  ],
  enemy: { lvl: 90, preRes: 0.1 },
  hitMode: 'avgHit',
})

type MityaConds = {
  detectionCore?: 'steady' | 'overloaded'
  gradientBeacons?: number
  a4Stacks?: number
}

function withConds(c: number, conds: MityaConds): ParityFixture {
  const wr: Record<string, string | number> = {}
  const pandoConditionals: NonNullable<ParityFixture['pandoConditionals']> = []
  const push = (name: string, value: number) =>
    pandoConditionals.push({ sheet: 'Mitya', src: '0', dst: null, name, value })
  if (conds.detectionCore) {
    wr.detectionCore = conds.detectionCore
    push('detectionCore', conds.detectionCore === 'steady' ? 1 : 2)
  }
  if (conds.gradientBeacons) {
    wr.gradientBeacons = String(conds.gradientBeacons)
    push('gradientBeacons', conds.gradientBeacons)
  }
  if (conds.a4Stacks) {
    wr.a4Stacks = String(conds.a4Stacks)
    push('a4Stacks', conds.a4Stacks)
  }
  return { ...fixtureAt(c), wrConditionals: { Mitya: wr }, pandoConditionals }
}

const EXPECTED_LISTINGS = [
  'a0_stellarconduct_baseDmg_',
  'burst',
  'charged',
  'charged_gradientDmg',
  'charged_gradientStellarDmg',
  'normal_0',
  'normal_1',
  'normal_2',
  'plunging_dmg',
  'plunging_high',
  'plunging_low',
  'skill_hold',
  'skill_steadyConsume',
  'skill_steadyCore',
  'skill_steadyDetonate',
  'skill_tap',
]

describe('Mitya WR ↔ Pando finals', () => {
  test.each([
    [0, {}],
    [0, { detectionCore: 'steady' as const, gradientBeacons: 3 }],
    [0, { detectionCore: 'overloaded' as const, a4Stacks: 4 }],
    [6, {}],
    [6, { detectionCore: 'steady' as const, gradientBeacons: 5, a4Stacks: 4 }],
    [6, { detectionCore: 'overloaded' as const, gradientBeacons: 2 }],
  ] as const)('C%i aligned finals %j', (c, conds) => {
    const fixture = withConds(c, conds)
    const wr = buildWrTeamSolo(fixture)
    const pando = buildPando(fixture)
    assertFinals(wr, pando)
    assertPandoListingsFinite(pando)
    expect(pandoListingNames(pando)).toEqual(
      expect.arrayContaining(EXPECTED_LISTINGS)
    )
  })
})

describe('Mitya kit numbers', () => {
  const em = (f: ParityFixture) => readWrFinal(buildWrTeamSolo(f), 'eleMas')
  const pem = (f: ParityFixture) => readPandoFinal(buildPando(f), 'eleMas')

  test('A1: Steady State core grants 30 EM per Gradient Beacon (C0, max 3)', () => {
    const base = em(withConds(0, {}))
    expect(em(withConds(0, { detectionCore: 'steady', gradientBeacons: 3 }))).toBeCloseTo(base + 90)
    // Overloaded core does not grant A1 EM
    expect(em(withConds(0, { detectionCore: 'overloaded', gradientBeacons: 3 }))).toBeCloseTo(base)
  })

  test('C2: Steady +123 EM (party), Overloaded +234 EM (active); C1 core CRIT DMG +40%', () => {
    const base = em(withConds(6, {}))
    expect(em(withConds(6, { detectionCore: 'steady', gradientBeacons: 5 }))).toBeCloseTo(base + 150 + 123)
    expect(pem(withConds(6, { detectionCore: 'steady', gradientBeacons: 5 }))).toBeCloseTo(base + 150 + 123)
    expect(em(withConds(6, { detectionCore: 'overloaded' }))).toBeCloseTo(base + 234)
    const cd0 = readWrFinal(buildWrTeamSolo(withConds(6, {})), 'critDMG_')
    const cd1 = readWrFinal(buildWrTeamSolo(withConds(6, { detectionCore: 'steady' })), 'critDMG_')
    expect(cd1 - cd0).toBeCloseTo(0.4)
  })

  test('A4: +5% CRIT Rate per stack, 4 stacks', () => {
    const r0 = readWrFinal(buildWrTeamSolo(withConds(0, {})), 'critRate_')
    const r4 = readWrFinal(buildWrTeamSolo(withConds(0, { a4Stacks: 4 })), 'critRate_')
    expect(r4 - r0).toBeCloseTo(0.2)
  })

  test('WR display exposes finite DMG for every talent hit', () => {
    const wr = buildWrTeamSolo(withConds(6, { detectionCore: 'steady', gradientBeacons: 5 }))
    const disp = wr.getDisplay() as Record<string, Record<string, { value: number }>>
    const vals = Object.entries(disp)
      .filter(([sec]) => !['reaction', 'weapon', 'artifact', 'basic', 'custom'].includes(sec))
      .flatMap(([sec, nodes]) => Object.entries(nodes).map(([k, n]) => [`${sec}.${k}`, n] as const))
    expect(vals.length).toBeGreaterThan(10)
    for (const [k, n] of vals) expect(Number.isFinite(n.value), k).toBe(true)
  })
})
