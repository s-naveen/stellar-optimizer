/**
 * 7.2/7.3 beta weapons and artifact sets: WR ↔ Pando number checks, plus WR checks that the
 * Stellar CRIT bonuses reach Stellar hits.
 *
 * Effects are compared as the change they make (effect on − off) in each engine: a Pando read with
 * an element/reaction tag also includes the general stat (e.g. 5% CRIT Rate), WR keeps it apart.
 *
 *   cd libs/gi/pando-parity && CI=true npx vitest run src/beta73-items.spec.ts
 */
import type { ArtifactSetKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import { own } from '@genshin-optimizer/gi/formula'
import { input } from '@genshin-optimizer/gi/wr'
import {
  artSetPieces,
  assertFinals,
  buildPando,
  buildWrSolo,
  buildWrTeamSolo,
  type PandoConditionalSpec,
  type ParityFixture,
  readPandoArtSet,
  readWrArtSet,
  type WrConditionalBag,
} from './harness'
import { relDiff } from './relDiff'

const REL_TOL = 1e-4

type WrUi = ReturnType<typeof buildWrSolo>
type PandoCalc = ReturnType<typeof buildPando>
type WrNode = Parameters<WrUi['get']>[0]
type PandoNode = Parameters<PandoCalc['compute']>[0]

function base(
  charKey: string,
  weaponKey: WeaponKey,
  refinement: 1 | 2 | 3 | 4 | 5 = 1,
  extra: Partial<ParityFixture> = {}
): ParityFixture {
  return {
    members: [
      {
        char: {
          key: charKey as never,
          level: 90,
          talent: { auto: 9, skill: 9, burst: 9 },
          ascension: 6,
          constellation: 0,
        },
        weapon: {
          key: weaponKey,
          level: 90,
          ascension: 6,
          refinement,
          location: charKey as never,
          lock: false,
        },
      },
    ],
    enemy: { lvl: 90, preRes: 0.1 },
    hitMode: 'avgHit',
    ...extra,
  }
}

function conds(
  sheet: string,
  wr: Record<string, string>,
  pando: Record<string, number>
): Pick<ParityFixture, 'wrConditionals' | 'pandoConditionals'> {
  return {
    wrConditionals: { [sheet]: wr } as WrConditionalBag,
    pandoConditionals: Object.entries(pando).map(
      ([name, value]): PandoConditionalSpec => ({
        sheet,
        src: '0',
        dst: null,
        name,
        value,
      })
    ),
  }
}

type Built = { wr: WrUi; pando: PandoCalc }
function build(fixture: ParityFixture, wrTeam = false): Built {
  const built = {
    wr: wrTeam ? buildWrTeamSolo(fixture) : buildWrSolo(fixture),
    pando: buildPando(fixture),
  }
  assertFinals(built.wr, built.pando)
  return built
}

/** The change `on` makes over `off`, in both engines, equals `expected`. */
function expectDelta(
  off: Built,
  on: Built,
  wrNode: WrNode,
  pandoNode: PandoNode,
  expected: number,
  label: string
) {
  const wr =
    (on.wr.get(wrNode).value as number) - (off.wr.get(wrNode).value as number)
  const pando =
    (on.pando.compute(pandoNode).val as number) -
    (off.pando.compute(pandoNode).val as number)
  expect(wr, `WR ${label}`).toBeCloseTo(expected, 6)
  expect(Math.abs(wr - pando), `${label} wr=${wr} pando=${pando}`).toBeLessThan(
    REL_TOL
  )
}

describe('TorrentsOfSpring', () => {
  test.each([1, 5] as const)('R%i base ATK and Royal Decree states', (r) => {
    const atk = [0, 0.16, 0.2, 0.24, 0.28, 0.32][r]!
    const stellar = [0, 0.2, 0.25, 0.3, 0.35, 0.4][r]!
    // the Stellar-Conduct bonus is a teamBuff for the active character (the wielder here)
    const reference = build(base('Noelle', 'FavoniusGreatsword'), true)
    const off = build(base('Noelle', 'TorrentsOfSpring', r), true)
    // base ATK% (on top of the weapon's own ATK% substat, which assertFinals covers)
    const offAtk = off.wr.get(input.total.atk_).value as number
    const substat = (off.wr.get(input.weapon.sub).value as number) ?? 0
    expect(offAtk - substat).toBeCloseTo(atk, 6)
    expect(reference.wr.get(input.total.stellarconduct_dmg_).value).toBe(0)
    for (const [state, value, extraAtk, sc] of [
      ['decree', 1, 0, stellar],
      ['complete', 2, atk, 2 * stellar],
    ] as const) {
      const on = build(
        base(
          'Noelle',
          'TorrentsOfSpring',
          r,
          conds(
            'TorrentsOfSpring',
            { royalDecree: state },
            { royalDecree: value }
          )
        ),
        true
      )
      expectDelta(
        off,
        on,
        input.total.atk_,
        own.premod.atk_,
        extraAtk,
        `${state} atk_`
      )
      expectDelta(
        off,
        on,
        input.total.stellarconduct_dmg_,
        own.premod.dmg_.stellarconduct,
        sc,
        `${state} stellarconduct_dmg_`
      )
    }
  })
})

describe('StarsealedEdict', () => {
  test('CRIT DMG passive (refinement bonus) R1/R5', () => {
    for (const [r, passive] of [
      [1, 0.24],
      [5, 0.48],
    ] as const) {
      const { wr } = build(base('Noelle', 'StarsealedEdict', r))
      const substat = wr.get(input.weapon.sub).value as number
      expect(
        (wr.get(input.total.critDMG_).value as number) - 0.5 - substat
      ).toBeCloseTo(passive, 6)
    }
  })

  test('Crystal Compounding EM and Law of Combustion stacks (no Radiance)', () => {
    const off = build(base('Noelle', 'StarsealedEdict'))
    for (const [stacks, em] of [
      [0, 48],
      [3, 48 + 72],
    ] as const) {
      const on = build(
        base(
          'Noelle',
          'StarsealedEdict',
          1,
          conds(
            'StarsealedEdict',
            {
              crystalCompounding: 'on',
              ...(stacks ? { lawOfCombustion: String(stacks) } : {}),
            },
            {
              crystalCompounding: 1,
              ...(stacks ? { lawOfCombustion: stacks } : {}),
            }
          )
        )
      )
      expectDelta(
        off,
        on,
        input.total.eleMas,
        own.final.eleMas,
        em,
        `${stacks} stacks EM`
      )
      // no Radiance on Noelle: no Stellar-Conduct CRIT DMG in either engine
      expectDelta(
        off,
        on,
        input.total.stellarconduct_critDMG_,
        own.premod.critDMG_.stellarconduct,
        0,
        `${stacks} stacks stellarconduct_critDMG_`
      )
    }
  })

  test('stacks give Stellar-Conduct CRIT DMG only in Radiance: Stellar-Conduct (Mitya)', () => {
    const weaponConds = { crystalCompounding: 'on', lawOfCombustion: '3' }
    const radianceWr = {
      // WR: the wielder's own Radiance (flags.radiance = 'sc', set by Mitya's A0 cond)
      StarsealedEdict: weaponConds,
      Mitya: { a0StellarRadianceSc: 'on' },
    } as WrConditionalBag
    const pandoOn = conds(
      'StarsealedEdict',
      {},
      { crystalCompounding: 1, lawOfCombustion: 3, lockStellarRadianceSc: 1 }
    ).pandoConditionals!
    // Mitya's own A0 Radiance changes other stats, so compare against Radiance without the weapon conds
    const wrRef = buildWrSolo(
      base('Mitya', 'StarsealedEdict', 1, {
        wrConditionals: {
          Mitya: { a0StellarRadianceSc: 'on' },
        } as WrConditionalBag,
      })
    )
    const wrOn = buildWrSolo(
      base('Mitya', 'StarsealedEdict', 1, { wrConditionals: radianceWr })
    )
    const pRef = buildPando(base('Mitya', 'StarsealedEdict'))
    const pOn = buildPando(
      base('Mitya', 'StarsealedEdict', 1, { pandoConditionals: pandoOn })
    )
    const wrDelta =
      (wrOn.get(input.total.stellarconduct_critDMG_).value as number) -
      (wrRef.get(input.total.stellarconduct_critDMG_).value as number)
    const pDelta =
      (pOn.compute(own.premod.critDMG_.stellarconduct).val as number) -
      (pRef.compute(own.premod.critDMG_.stellarconduct).val as number)
    expect(wrDelta).toBeCloseTo(3 * 0.12, 6)
    expect(relDiff(wrDelta, pDelta)).toBeLessThan(REL_TOL)
    // without Radiance the stacks only give EM
    const noRadiance = buildWrSolo(
      base('Mitya', 'StarsealedEdict', 1, {
        wrConditionals: { StarsealedEdict: weaponConds } as WrConditionalBag,
      })
    )
    expect(noRadiance.get(input.total.stellarconduct_critDMG_).value).toBe(0)
  })
})

describe('Silverdawn', () => {
  test.each([1, 5] as const)("R%i White Crown's Bequest", (r) => {
    const v = [0, 0.4, 0.52, 0.64, 0.76, 0.88][r]!
    const off = build(base('Noelle', 'Silverdawn', r))
    const on = build(
      base(
        'Noelle',
        'Silverdawn',
        r,
        conds(
          'Silverdawn',
          { whiteCrownsBequest: 'on' },
          { whiteCrownsBequest: 1 }
        )
      )
    )
    expectDelta(off, on, input.total.atk_, own.premod.atk_, v, 'atk_')
    for (const k of ['stellarconduct', 'stellarswirl'] as const)
      expectDelta(
        off,
        on,
        input.total[`${k}_critDMG_`],
        own.premod.critDMG_[k],
        v,
        `${k}_critDMG_`
      )
    // only Stellar hits: no general CRIT DMG
    expectDelta(
      off,
      on,
      input.total.critDMG_,
      own.final.critDMG_,
      0,
      'critDMG_'
    )
  })
})

function withArts(
  charKey: string,
  key: ArtifactSetKey,
  n: number,
  extra: Partial<ParityFixture> = {}
): ParityFixture {
  const fixture = base(charKey, 'FavoniusGreatsword', 1, extra)
  const member = fixture.members[0]!
  return { ...fixture, members: [{ ...member, arts: artSetPieces(key, n) }] }
}

describe('LegacyOfTheFirstChronicle', () => {
  const key = 'LegacyOfTheFirstChronicle'
  const on = conds(key, { undyingRadiance: 'on' }, { undyingRadiance: 1 })

  test('0/2/4pc counts + finals (cond off), 2pc ATK', () => {
    const none = build(withArts('Noelle', key, 0))
    for (const n of [0, 2, 4]) {
      const b = build(withArts('Noelle', key, n))
      expect(readWrArtSet(b.wr, key)).toBe(n)
      expect(readPandoArtSet(b.pando, key)).toBe(n)
      expectDelta(
        none,
        b,
        input.total.atk_,
        own.premod.atk_,
        n >= 2 ? 0.18 : 0,
        `${n}pc atk_`
      )
    }
  })

  test('4pc Undying Radiance: Cryo CRIT Rate; Stellar extra only for Cryo wearers', () => {
    for (const [charKey, stellar] of [
      ['Noelle', 0], // Geo wearer: Stellar hits are not Cryo DMG
      ['Ganyu', 0.2], // Cryo wearer
    ] as const) {
      const off = build(withArts(charKey, key, 4))
      const b = build(withArts(charKey, key, 4, on))
      expectDelta(
        off,
        b,
        input.total.cryo_critRate_,
        own.premod.critRate_.cryo,
        0.2,
        `${charKey} cryo_critRate_`
      )
      for (const k of ['stellarconduct', 'stellarswirl'] as const)
        expectDelta(
          off,
          b,
          input.total[`${k}_critRate_`],
          own.premod.critRate_[k],
          stellar,
          `${charKey} ${k}_critRate_`
        )
      // no general CRIT Rate from the set
      expectDelta(
        off,
        b,
        input.total.critRate_,
        own.final.critRate_,
        0,
        `${charKey} critRate_`
      )
    }
  })

  test('WR: 40% reaches a Cryo Stellar hit, 20% a plain Cryo hit (Anastasya)', () => {
    const offUi = buildWrSolo(withArts('Anastasya', key, 4))
    const onUi = buildWrSolo(
      withArts('Anastasya', key, 4, {
        wrConditionals: {
          [key]: { undyingRadiance: 'on' },
        } as WrConditionalBag,
      })
    )
    const v = (ui: WrUi, node: WrNode) => ui.get(node).value as number
    // a Cryo Stellar hit sums general + reaction + Cryo CRIT Rate (wr/reaction/special.ts)
    const stellarCrit = (ui: WrUi) =>
      v(ui, input.total.critRate_) +
      v(ui, input.total.stellarconduct_critRate_) +
      v(ui, input.total.cryo_critRate_)
    expect(stellarCrit(onUi) - stellarCrit(offUi)).toBeCloseTo(0.4, 6)
    // a plain Cryo hit only gets the Cryo part
    expect(
      v(onUi, input.total.cryo_critRate_) - v(offUi, input.total.cryo_critRate_)
    ).toBeCloseTo(0.2, 6)
  })
})

describe('PreludeOfTheKingfisherCanopy', () => {
  const key = 'PreludeOfTheKingfisherCanopy'
  test('0/2/4pc counts + finals, 2pc ER, 4pc Skill/Burst DMG', () => {
    const none = build(withArts('Noelle', key, 0))
    for (const n of [0, 2, 4]) {
      const b = build(withArts('Noelle', key, n)) // finals include enerRech_
      expect(readWrArtSet(b.wr, key)).toBe(n)
      expect(readPandoArtSet(b.pando, key)).toBe(n)
      expectDelta(
        none,
        b,
        input.total.enerRech_,
        own.final.enerRech_,
        n >= 2 ? 0.2 : 0,
        `${n}pc ER`
      )
      for (const move of ['skill', 'burst'] as const)
        expectDelta(
          none,
          b,
          input.total[`${move}_dmg_`],
          own.premod.dmg_[move],
          n >= 4 ? 0.25 : 0,
          `${n}pc ${move}_dmg_`
        )
    }
  })
})

describe('BlazingLionfang', () => {
  test.each([
    1, 5,
  ] as const)('R%i Reforged Blade: ATK% and switch-in DMG', (r) => {
    const atk = [0, 0.2, 0.25, 0.3, 0.35, 0.4][r]!
    const off = build(base('Noelle', 'BlazingLionfang', r))
    const on = build(
      base(
        'Noelle',
        'BlazingLionfang',
        r,
        conds('BlazingLionfang', { reforgedBlade: 'on' }, { reforgedBlade: 1 })
      )
    )
    expectDelta(off, on, input.total.atk_, own.premod.atk_, atk, 'atk_')

    // the switch-in DMG exists only while Reforged Blade is active, the same in both engines
    const wrDmg = (b: Built) =>
      (
        b.wr.getDisplay() as Record<
          string,
          Record<string, { value: number }> | undefined
        >
      )['weapon:BlazingLionfang']?.['switchInDmg']?.value ?? 0
    const pandoDmg = (b: Built) => {
      const read = b.pando
        .listFormulas(own.listing.formulas)
        .find((x) => x.tag.name === 'switchInDmg')
      return read ? (b.pando.compute(read).val as number) : 0
    }
    expect(wrDmg(off)).toBe(0)
    expect(pandoDmg(off)).toBe(0)
    expect(wrDmg(on)).toBeGreaterThan(0)
    expect(relDiff(wrDmg(on), pandoDmg(on))).toBeLessThan(REL_TOL)
  })
})
