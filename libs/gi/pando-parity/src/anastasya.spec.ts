/**
 * Anastasya (7.3 beta, YuanShenResources) — WR ↔ Pando finals + kit checks.
 * Conds: blessing love|honor, a0StellarRadianceSc on|ss, accolades on|loveSeal|honorSeal
 * (Pando 1-based), burstActive (bool). C3 burst / C5 skill.
 * Accolades numbers checked against community datamine notes:
 *   "12/12/12/12; Sealed Ana: 16/16/16/0"; Honor: Ana 48%. C1: the x3 applies ONLY to the part
 *   shared from Anastasya (user + community confirmed) -> teammates 12 + 4x3 = 24%, Ana keeps 12%.
 *
 *   nx test gi-pando-parity -- anastasya.spec.ts
 */
import { input, percent } from '@genshin-optimizer/gi/wr'
import type { Data } from '@genshin-optimizer/gi/wr'
import { computeUIData } from '@genshin-optimizer/gi/uidata'
import { expect } from 'vitest'
import { danicaFixture } from './fixtures.stellar'
import {
  assertFinals,
  assertPandoListingsFinite,
  buildPando,
  buildWrLayers,
  buildWrTeam,
  buildWrTeamSolo,
  type ParityFixture,
  pandoListingNames,
  readWrFinal,
} from './harness'

type Conds = {
  blessing?: 'love' | 'honor'
  radiance?: 'on' | 'ss'
  accolades?: 'on' | 'loveSeal' | 'honorSeal'
  burstActive?: boolean
}
const fx = (c: number, conds: Conds = {}): ParityFixture => {
  const wr: Record<string, string | number> = {}
  const pandoConditionals: NonNullable<ParityFixture['pandoConditionals']> = []
  const push = (name: string, value: number) =>
    pandoConditionals.push({
      sheet: 'Anastasya',
      src: '0',
      dst: null,
      name,
      value,
    })
  if (conds.blessing) {
    wr.blessing = conds.blessing
    push('blessing', conds.blessing === 'love' ? 1 : 2)
  }
  if (conds.radiance) {
    wr.a0StellarRadianceSc = conds.radiance
    push('a0StellarRadianceSc', conds.radiance === 'on' ? 1 : 2)
  }
  if (conds.accolades) {
    wr.accolades = conds.accolades
    push(
      'accolades',
      ['on', 'loveSeal', 'honorSeal'].indexOf(conds.accolades) + 1
    )
  }
  if (conds.burstActive) {
    wr.burstActive = 'on'
    push('burstActive', 1)
  }
  return {
    members: [
      {
        char: {
          key: 'Anastasya',
          level: 90,
          talent: { auto: 9, skill: 9, burst: 9 },
          ascension: 6,
          constellation: c,
        },
        weapon: {
          key: 'AmosBow',
          level: 90,
          ascension: 6,
          refinement: 1,
          location: 'Anastasya',
          lock: false,
        },
      },
    ],
    enemy: { lvl: 90, preRes: 0.1 },
    hitMode: 'avgHit',
    wrConditionals: { Anastasya: wr },
    pandoConditionals,
  }
}
const cd = (f: ParityFixture) => readWrFinal(buildWrTeamSolo(f), 'critDMG_')

describe('Anastasya WR ↔ Pando finals', () => {
  test.each([
    [0, {}],
    [0, { accolades: 'on' as const, blessing: 'love' as const }],
    [0, { accolades: 'loveSeal' as const }],
    [0, { accolades: 'honorSeal' as const, blessing: 'honor' as const }],
    [1, { accolades: 'loveSeal' as const }],
    [
      6,
      {
        accolades: 'honorSeal' as const,
        blessing: 'honor' as const,
        radiance: 'ss' as const,
      },
    ],
    [
      6,
      {
        accolades: 'on' as const,
        blessing: 'love' as const,
        burstActive: true,
        radiance: 'on' as const,
      },
    ],
  ] as const)('C%i aligned finals %j', (c, conds) => {
    const f = fx(c, conds)
    const pando = buildPando(f)
    assertFinals(buildWrTeamSolo(f), pando)
    assertPandoListingsFinite(pando)
    expect(pandoListingNames(pando)).toEqual(
      expect.arrayContaining([
        'skill_tap',
        'skill_hold',
        'skill_crown',
        'skill_honor0',
        'burst_love',
        'burst_doom1',
      ])
    )
  })
})

describe('Anastasya kit numbers', () => {
  test('A1 Accolades on Anastasya: 12% / Sealed 0% (C1 12%) / Honor 48% (C4 x1.3)', () => {
    const b0 = cd(fx(0))
    expect(cd(fx(0, { accolades: 'on' })) - b0).toBeCloseTo(0.12, 6)
    expect(cd(fx(0, { accolades: 'loveSeal' })) - b0).toBeCloseTo(0, 6)
    expect(cd(fx(0, { accolades: 'honorSeal' })) - b0).toBeCloseTo(0.48, 6)
    const b1 = cd(fx(1))
    expect(cd(fx(1, { accolades: 'loveSeal' })) - b1).toBeCloseTo(0.12, 6)
    const b6 = cd(fx(6))
    expect(cd(fx(6, { accolades: 'honorSeal' })) - b6).toBeCloseTo(
      0.48 * 1.3,
      6
    )
  })

  // Community table (credits Kuroo), party = Anastasya + 1 Cryo ally + 2 non-Cryo allies.
  // [critDMG, atk_, EM] increase per member; C4 = C1 x 1.3.
  const TABLE = {
    on: { Anastasya: [0.12, 0.15, 0], Ganyu: [0.12, 0.15, 0], Danica: [0.12, 0, 60], Mitya: [0.12, 0, 60] },
    loveSeal: { Anastasya: [0.12, 0.15, 0], Ganyu: [0.24, 0.3, 0], Danica: [0.24, 0.15, 60], Mitya: [0.24, 0.15, 60] },
    honorSeal: { Anastasya: [0.48, 0.3, 120], Ganyu: [0.12, 0.15, 0], Danica: [0.12, 0, 60], Mitya: [0.12, 0, 60] },
  } as const
  const ally = (key: string, weapon: string): ParityFixture => ({
    members: [{ char: { key: key as never, level: 90, talent: { auto: 9, skill: 9, burst: 9 }, ascension: 6, constellation: 0 }, weapon: { key: weapon as never, level: 90, ascension: 6, refinement: 1, location: key as never, lock: false } }],
    enemy: { lvl: 90, preRes: 0.1 },
  })
  const party = (c: number, acc?: Conds['accolades']) =>
    buildWrTeam([fx(c, { accolades: acc }), ally('Ganyu', 'AmosBow'), danicaFixture(0), ally('Mitya', 'FavoniusCodex')])
  test.each([1, 4] as const)('Accolades table at C%i matches community table', (c) => {
    const base = party(c)
    const mult = c >= 4 ? 1.3 : 1
    for (const [acc, row] of Object.entries(TABLE)) {
      const t = party(c, acc as Conds['accolades'])
      for (const [k, [cd, atk, em]] of Object.entries(row)) {
        const d = (n: typeof input.premod.critDMG_) => t[k].get(n).value - base[k].get(n).value
        expect(d(input.premod.critDMG_), `${acc} ${k} CRIT DMG`).toBeCloseTo(cd * mult, 6)
        expect(d(input.premod.atk_), `${acc} ${k} ATK`).toBeCloseTo(atk * mult, 6)
        expect(d(input.premod.eleMas), `${acc} ${k} EM`).toBeCloseTo(em * mult, 6)
      }
    }
  })

  test('C0 Accolades: 12% / Ana Sealed 16% for allies (no x3) / Honor 48% for Ana', () => {
    const base = party(0)
    const cd = (acc: Conds['accolades'], k: string) => party(0, acc)[k].get(input.premod.critDMG_).value - base[k].get(input.premod.critDMG_).value
    expect(cd('on', 'Mitya')).toBeCloseTo(0.12, 6)
    expect(cd('loveSeal', 'Mitya')).toBeCloseTo(0.16, 6)
    expect(cd('loveSeal', 'Anastasya')).toBeCloseTo(0, 6)
    expect(cd('honorSeal', 'Anastasya')).toBeCloseTo(0.48, 6)
    expect(cd('honorSeal', 'Mitya')).toBeCloseTo(0, 6)
    expect(party(0, 'on').Mitya.get(input.premod.eleMas).value).toBeCloseTo(base.Mitya.get(input.premod.eleMas).value, 6)
  })

  test('C1 Accolades ATK +15% for Cryo (Anastasya herself)', () => {
    const w = buildWrTeamSolo(fx(1))
    const on = buildWrTeamSolo(fx(1, { accolades: 'on' }))
    expect(readWrFinal(on, 'atk') - readWrFinal(w, 'atk')).toBeCloseTo(
      0.15 * w.get(input.base.atk).value,
      3
    )
  })

  test('Radiance decides Stellar-Conduct vs Stellar Swirl listings', () => {
    const d = (r?: Conds['radiance']) =>
      buildWrTeamSolo(fx(0, { radiance: r })).getDisplay() as Record<
        string,
        Record<string, { value: number }>
      >
    const none = d(),
      sc = d('on'),
      ss = d('ss')
    expect(none.skill.crownSc.value).toBe(0) // skill crown Stellar hit needs Radiance
    expect(sc.skill.crownSc.value).toBeGreaterThan(0)
    expect(ss.skill.crownSs.value).toBeGreaterThan(0)
    expect(none.burst.triumphSc.value).toBeGreaterThan(0) // burst hits default to Stellar-Conduct
    expect(ss.burst.triumphSc.value).toBe(0)
    expect(ss.burst.triumphSs.value).toBeGreaterThan(0)
  })
})

describe('Stellar Swirl reaction multiplier hook (Anastasya A4)', () => {
  test('stellarswirl_mult_ scales Stellar Swirl reaction + vortex DMG; other reactions unaffected', () => {
    const f: ParityFixture = {
      members: [
        {
          char: {
            key: 'Sucrose',
            level: 90,
            talent: { auto: 1, skill: 1, burst: 1 },
            ascension: 6,
            constellation: 0,
          },
          weapon: {
            key: 'FavoniusCodex',
            level: 90,
            ascension: 6,
            refinement: 1,
            location: 'Sucrose',
            lock: false,
          },
        },
      ],
      enemy: { lvl: 90, preRes: 0.1 },
      hitMode: 'hit',
    }
    const layers = buildWrLayers(f)
    const plain = computeUIData(layers)
    const boosted = computeUIData([
      { premod: { stellarswirl_mult_: percent(0.15) } } as Data,
      ...layers,
    ])
    const r = (u: typeof plain) =>
      u.getDisplay().reaction as Record<string, { value: number }>
    expect(
      r(boosted).stellarswirl.value / r(plain).stellarswirl.value
    ).toBeCloseTo(1.15, 6)
    expect(
      r(boosted).stellarswirl_vortex1.value /
        r(plain).stellarswirl_vortex1.value
    ).toBeCloseTo(1.15, 6)
    expect(r(boosted).cryoSwirl.value).toBeCloseTo(r(plain).cryoSwirl.value, 6)
    expect(r(boosted).superconduct.value).toBeCloseTo(
      r(plain).superconduct.value,
      6
    )
  })

  test('Anastasya A4 is applied to the team (asc 4+)', () => {
    const t = buildWrTeam([danicaFixture(0), fx(0)])
    expect(t.Danica.get(input.total.stellarswirl_mult_).value).toBeCloseTo(
      0.15,
      6
    )
  })
})
