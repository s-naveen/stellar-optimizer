import type { CharacterKey, WeaponKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptEnergyCalculator } from '@genshin-optimizer/gi/db'
import { initTeamOpt, validateTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  energyCalcData,
  energyCalcWeapons,
  energySkillConstellation,
  energyWeaponFlat,
  favoniusCooldown,
  syncEnergyCalculator,
  withFieldTime,
} from '../util/teamOpt/energyCalc'

const keys: CharacterKey[] = ['TravelerCryo', 'Danica', 'Odette', 'Anastasya']

/** The ER target as applied: the required ER rounded up to 0.1% */
const target = (required: number) => Math.ceil(required * 10 - 1e-9) / 10

/** Sets every member's field time (percent), in team order */
function setField(
  settings: TeamOptEnergyCalculator,
  team: CharacterKey[],
  fields: number[]
) {
  team.forEach((key, i) => {
    settings.members[key]!.fieldTime = fields[i]
  })
}

describe('native ER calculator', () => {
  it('reproduces the source workbook fixed-rotation example', () => {
    const settings = defaultEnergyCalculator(keys, 16)
    settings.rng = 'average'
    setField(settings, keys, [50, 20, 20, 10])
    settings.members.TravelerCryo!.flatEnergy = 19
    settings.members.Danica!.favoniusProcs = 1
    settings.members.Odette!.burstEvery = 0
    const result = calculateEnergyRecharge(keys, settings)
    expect(result.errors).toEqual([])
    const expectedEnergy = [36.16, 30.976, 38.176, 38.048]
    const costs = [41, 60, 0, 50]
    keys.forEach((key, i) => {
      expect(result.members[key]!.particleEnergy).toBeCloseTo(
        expectedEnergy[i],
        5
      )
      expect(result.members[key]!.required).toBeCloseTo(
        Math.max(100, (costs[i] / expectedEnergy[i]) * 100),
        5
      )
      expect(result.targets[key]!).toBeGreaterThanOrEqual(
        result.members[key]!.required
      )
    })
  })

  it('matches the live ERC 7.3 sheet: its totals, Favonius share and ER needed', () => {
    // The sheet's own example: 25 bonus energy on Cryo Traveler; it shows 100%, 194%, 100%, 131%.
    const settings = defaultEnergyCalculator(keys, 16)
    settings.rng = 'average'
    setField(settings, keys, [50, 20, 20, 10])
    settings.members.TravelerCryo!.flatEnergy = 25
    settings.members.Danica!.favoniusProcs = 1
    settings.members.Odette!.burstEvery = 0
    const result = calculateEnergyRecharge(keys, settings)
    expect(result.targets).toEqual({
      TravelerCryo: 100,
      Danica: 193.7,
      Odette: 100,
      Anastasya: 131.5,
    })
    // "Energy from Danica" is 6.60 to Traveler (3.00 skill + 3.60 Favonius) and 21.00 to herself
    settings.members.Danica!.favoniusProcs = 0
    const noFav = calculateEnergyRecharge(keys, settings)
    expect(
      result.members.TravelerCryo!.particleEnergy -
        noFav.members.TravelerCryo!.particleEnergy
    ).toBeCloseTo(3.6, 9)
    expect(
      result.members.Danica!.particleEnergy -
        noFav.members.Danica!.particleEnergy
    ).toBeCloseTo(6, 9)
  })

  it('counts Favonius only for candidates that actually use a Favonius weapon', () => {
    const settings = defaultEnergyCalculator(keys, 16)
    settings.members.Danica!.favoniusProcs = 2
    const withFav = calculateEnergyRecharge(keys, settings, {
      Danica: 'FavoniusLance',
    })
    const without = calculateEnergyRecharge(keys, settings, {
      Danica: 'PrototypeStarglitter',
    })
    expect(withFav.members.TravelerCryo!.particleEnergy).toBeGreaterThan(
      without.members.TravelerCryo!.particleEnergy
    )
    expect(withFav.targets.TravelerCryo!).toBeLessThan(
      without.targets.TravelerCryo!
    )
  })

  it('handles particle funneling, fixed energy, burst frequency and disabled bursts', () => {
    const settings = defaultEnergyCalculator(keys)
    settings.members.Danica!.catchBy = 'TravelerCryo'
    const funnel = calculateEnergyRecharge(keys, settings)
    settings.members.Danica!.catchBy = 'Danica'
    const own = calculateEnergyRecharge(keys, settings)
    expect(funnel.members.TravelerCryo!.particleEnergy).toBeGreaterThan(
      own.members.TravelerCryo!.particleEnergy
    )
    settings.members.TravelerCryo!.flatEnergy = 20
    settings.members.Anastasya!.burstEvery = 2
    settings.members.Odette!.burstEvery = 0
    const less = calculateEnergyRecharge(keys, settings)
    expect(less.targets.TravelerCryo!).toBeLessThan(own.targets.TravelerCryo!)
    expect(less.targets.Anastasya!).toBeLessThan(own.targets.Anastasya!)
    expect(less.targets.Odette).toBe(100)
  })

  it('uses conservative particle RNG and C6 turret duration without inventing energy', () => {
    const team: CharacterKey[] = [
      'Fischl',
      'KamisatoAyaka',
      'Shenhe',
      'Sucrose',
    ]
    const settings = defaultEnergyCalculator(team)
    expect(
      energyCalcData.Fischl!.skills[settings.members.Fischl!.skillMode].duration
    ).toBe(12)
    const average = calculateEnergyRecharge(team, settings)
    const worst = calculateEnergyRecharge(team, { ...settings, rng: 'worst' })
    expect(worst.members.KamisatoAyaka!.particleEnergy).toBeLessThan(
      average.members.KamisatoAyaka!.particleEnergy
    )
    for (const member of Object.values(settings.members)) {
      member!.skillUses = 0
      member!.burstEvery = 0
    }
    settings.members.KamisatoAyaka!.burstEvery = 1
    settings.enemyParticles = 0
    expect(
      calculateEnergyRecharge(team, settings).errors.length
    ).toBeGreaterThan(0)
  })

  it('uses the candidate weapon and refinement for flat energy refunds', () => {
    const settings = defaultEnergyCalculator(keys)
    settings.members.TravelerCryo!.weaponEnergyTriggers = 2
    const r1 = calculateEnergyRecharge(
      keys,
      settings,
      { TravelerCryo: 'AmenomaKageuchi' },
      { TravelerCryo: 1 }
    )
    const r5 = calculateEnergyRecharge(
      keys,
      settings,
      { TravelerCryo: 'AmenomaKageuchi' },
      { TravelerCryo: 5 }
    )
    const other = calculateEnergyRecharge(keys, settings, {
      TravelerCryo: 'PrototypeRancour',
    })
    expect(r1.members.TravelerCryo!.flatEnergy).toBe(12)
    expect(r5.members.TravelerCryo!.flatEnergy).toBe(24)
    expect(other.members.TravelerCryo!.flatEnergy).toBe(0)
    expect(r5.targets.TravelerCryo!).toBeLessThan(r1.targets.TravelerCryo!)
  })

  it('validates incomplete input and field-time totals', () => {
    const settings = defaultEnergyCalculator(keys)
    settings.members.TravelerCryo!.fieldTime = 60
    expect(calculateEnergyRecharge(keys, settings).errors).toContain(
      'Field time must add up to 100%.'
    )
    settings.members.TravelerCryo!.fieldTime = 50
    settings.members.Danica!.skillUses = Number.NaN
    expect(
      calculateEnergyRecharge(keys, settings).errors.length
    ).toBeGreaterThan(0)
  })
})

/** Raiden, C6 Fischl, Xingqiu, Bennett: 20 s, average RNG, 9 clear particles per 90 s */
const battery: CharacterKey[] = ['RaidenShogun', 'Fischl', 'Xingqiu', 'Bennett']
function batterySettings() {
  const settings = defaultEnergyCalculator(battery, 20)
  settings.rng = 'average'
  setField(settings, battery, [40, 10, 20, 30])
  return settings
}

describe('ER calculator against hand-worked examples', () => {
  // particles per rotation: Raiden 0.45/s × 20 s; Fischl's Oz 0.67/s × min(12 s × (E + Q), 20 s)
  const raiden = 0.45 * 20
  const oz = 0.67 * Math.min(12 * 2, 20)
  // a particle's share for a member on the field f of the time (party of four)
  const share = (f: number) => 0.6 + 0.4 * f
  const enemy = (f: number) => (9 * 2 * share(f) * 20) / 90

  it('works out a Raiden + Fischl battery member by member', () => {
    const result = calculateEnergyRecharge(battery, batterySettings())
    expect(result.errors).toEqual([])
    const energy = {
      // electro turrets: 3 each, by field time; Xingqiu's 5 and Bennett's 2.25 caught by their owners
      RaidenShogun:
        raiden * 3 * share(0.4) +
        oz * 3 * share(0.4) +
        5 * 0.6 +
        2.25 * 0.6 +
        enemy(0.4),
      Fischl:
        raiden * 3 * share(0.1) +
        oz * 3 * share(0.1) +
        5 * 0.6 +
        2.25 * 0.6 +
        enemy(0.1),
      Xingqiu:
        raiden * share(0.2) + oz * share(0.2) + 5 * 3 + 2.25 * 0.6 + enemy(0.2),
      Bennett:
        raiden * share(0.3) + oz * share(0.3) + 5 * 0.6 + 2.25 * 3 + enemy(0.3),
    }
    expect(energy.RaidenShogun).toBeCloseTo(58.462, 9)
    const cost = { RaidenShogun: 90, Fischl: 60, Xingqiu: 80, Bennett: 60 }
    for (const key of battery) {
      expect(result.members[key]!.particleEnergy).toBeCloseTo(
        energy[key as keyof typeof energy],
        9
      )
      expect(result.targets[key]).toBe(
        target(
          (cost[key as keyof typeof cost] /
            energy[key as keyof typeof energy]) *
            100
        )
      )
    }
    expect(result.targets).toEqual({
      RaidenShogun: 154,
      Fischl: 120.2,
      Xingqiu: 233.3,
      Bennett: 208.7,
    })
  })

  it('moves turret and enemy particles with field time', () => {
    const settings = batterySettings()
    const before = calculateEnergyRecharge(battery, settings)
    const after = calculateEnergyRecharge(
      battery,
      withFieldTime(settings, battery, 'RaidenShogun', 70)
    )
    // Raiden gains 0.3 × 0.4 of every turret and enemy particle; the others share the loss
    expect(
      after.members.RaidenShogun!.particleEnergy -
        before.members.RaidenShogun!.particleEnergy
    ).toBeCloseTo((raiden * 3 + oz * 3 + (9 * 2 * 20) / 90) * 0.4 * 0.3, 9)
    expect(after.targets.RaidenShogun!).toBeLessThan(
      before.targets.RaidenShogun!
    )
    expect(after.targets.Fischl!).toBeGreaterThan(before.targets.Fischl!)
  })

  it('needs a burst every Nth rotation: cost ÷ N, and Fischl summons Oz only on burst rotations', () => {
    const settings = batterySettings()
    const base = calculateEnergyRecharge(battery, settings)
    settings.members.Xingqiu!.burstEvery = 2
    settings.members.Xingqiu!.flatEnergy = 5
    const xq = calculateEnergyRecharge(battery, settings)
    expect(xq.members.Xingqiu!.particleEnergy).toBeCloseTo(
      base.members.Xingqiu!.particleEnergy,
      9
    )
    expect(xq.targets.Xingqiu).toBe(
      target(((80 / 2 - 5) / base.members.Xingqiu!.particleEnergy) * 100)
    )
    settings.members.Fischl!.burstEvery = 2
    const fischl = calculateEnergyRecharge(battery, settings)
    // Oz: 12 s from E + half of 12 s from Q per rotation
    expect(
      base.members.RaidenShogun!.particleEnergy -
        fischl.members.RaidenShogun!.particleEnergy
    ).toBeCloseTo((oz - 0.67 * 18) * 3 * share(0.4), 9)
  })

  it('counts the Oz of Fischl’s burst once, even with a long rotation', () => {
    const team: CharacterKey[] = ['Fischl', 'Xingqiu', 'Bennett', 'Sucrose']
    const settings = defaultEnergyCalculator(team, 30)
    settings.rng = 'average'
    settings.enemyParticles = 0
    setField(settings, team, [25, 25, 25, 25])
    for (const key of team.slice(1)) settings.members[key]!.skillUses = 0
    const result = calculateEnergyRecharge(team, settings)
    // E + Q: 24 s of Oz in a 30 s rotation (the same second skill must not add another Q)
    expect(result.members.Fischl!.particleEnergy).toBeCloseTo(
      0.67 * 24 * 3 * 0.7,
      9
    )
    const c0 = defaultEnergyCalculator(team, 30, team[0], { Fischl: 0 })
    c0.rng = 'average'
    c0.enemyParticles = 0
    setField(c0, team, [25, 25, 25, 25])
    for (const key of team.slice(1)) c0.members[key]!.skillUses = 0
    expect(
      calculateEnergyRecharge(team, c0).members.Fischl!.particleEnergy
    ).toBeCloseTo(0.67 * 20 * 3 * 0.7, 9)
  })

  it('adds Electro resonance particles only in a party of four', () => {
    const settings = batterySettings()
    settings.electroInterval = 5
    const result = calculateEnergyRecharge(battery, settings)
    const base = calculateEnergyRecharge(battery, batterySettings())
    // 20 s / 5 s = 4 Electro particles, shared by field time
    expect(
      result.members.RaidenShogun!.particleEnergy -
        base.members.RaidenShogun!.particleEnergy
    ).toBeCloseTo(4 * 3 * share(0.4), 9)
    expect(
      result.members.Xingqiu!.particleEnergy -
        base.members.Xingqiu!.particleEnergy
    ).toBeCloseTo(4 * 1 * share(0.2), 9)
    const trio = battery.slice(0, 3)
    const three = defaultEnergyCalculator(trio, 20)
    three.electroInterval = 5
    const withoutBennett = calculateEnergyRecharge(trio, three)
    three.electroInterval = 0
    expect(withoutBennett.members.RaidenShogun!.particleEnergy).toBeCloseTo(
      calculateEnergyRecharge(trio, three).members.RaidenShogun!.particleEnergy,
      9
    )
  })

  it('gives off-field members 70% in a party of three and 80% in a party of two', () => {
    for (const [team, offField] of [
      [['Xingqiu', 'Bennett', 'Sucrose'], 0.7],
      [['Xingqiu', 'Bennett'], 0.8],
    ] as const) {
      const settings = defaultEnergyCalculator(team, 20)
      settings.rng = 'average'
      settings.enemyParticles = 0
      const result = calculateEnergyRecharge(team, settings)
      // Xingqiu's 5 Hydro particles, caught by Xingqiu, reach Bennett off the field
      const others = team.length === 3 ? 4 * 0.7 : 0
      expect(result.members.Bennett!.particleEnergy).toBeCloseTo(
        5 * offField + 2.25 * 3 + others,
        9
      )
    }
  })

  it('keeps the 100% floor, burst discounts and Razor’s ER discount', () => {
    const settings = batterySettings()
    settings.members.Bennett!.flatEnergy = 60
    expect(calculateEnergyRecharge(battery, settings).targets.Bennett).toBe(100)
    settings.members.Bennett!.flatEnergy = 59
    const nearly = calculateEnergyRecharge(battery, settings)
    expect(nearly.targets.Bennett).toBe(100)
    expect(nearly.members.Bennett!.required).toBe(100)
    const team: CharacterKey[] = ['Razor', 'Bennett', 'Xingqiu', 'Jean']
    const razor = defaultEnergyCalculator(team, 20)
    razor.rng = 'average'
    const result = calculateEnergyRecharge(team, razor)
    const r = result.members.Razor!
    expect(r.burstCost).toBe(75)
    expect(r.required).toBeCloseTo(
      Math.max(100, (75 / r.particleEnergy - 0.45) * 100),
      9
    )
    expect(result.members.Jean!.burstCost).toBe(64)
  })

  it('counts Dori’s A4 as particle energy per skill use', () => {
    const team: CharacterKey[] = ['Dori', 'Bennett', 'Xingqiu', 'Sucrose']
    const settings = defaultEnergyCalculator(team, 20)
    const one = calculateEnergyRecharge(team, settings)
    settings.members.Dori!.skillUses = 2
    const two = calculateEnergyRecharge(team, settings)
    // the second use: 2 Electro particles caught by Dori (3 each) + 5 from her A4
    expect(
      two.members.Dori!.particleEnergy - one.members.Dori!.particleEnergy
    ).toBeCloseTo(2 * 3 + 5, 9)
  })

  it('applies Sethos’s Charged Attack energy drain (full 20, partial 10)', () => {
    const sethos = energyCalcData.Sethos!.skills
    expect(sethos.find((s) => s.label === 'Full CA')!.flatEnergy).toBe(-20)
    expect(sethos.find((s) => s.label === 'Partial CA')!.flatEnergy).toBe(-10)
    const team: CharacterKey[] = ['Sethos', 'Bennett', 'Xingqiu', 'Sucrose']
    const settings = defaultEnergyCalculator(team, 20)
    settings.members.Sethos!.secondaryMode = 1
    settings.members.Sethos!.secondaryUses = 1
    const r = calculateEnergyRecharge(team, settings).members.Sethos!
    expect(r.flatEnergy).toBe(-20)
    expect(r.required).toBeCloseTo((80 / r.particleEnergy) * 100, 9)
  })
})

describe('ER calculator weapons', () => {
  it('gives the workbook’s flat energy per trigger for each energy weapon and refinement', () => {
    for (const key of [
      'AmenomaKageuchi',
      'KatsuragikiriNagamasa',
      'KitainCrossSpear',
    ] as WeaponKey[])
      expect([1, 2, 3, 4, 5].map((r) => energyWeaponFlat(key, r))).toEqual([
        6, 7.5, 9, 10.5, 12,
      ])
    expect([1, 5].map((r) => energyWeaponFlat('PrototypeAmber', r))).toEqual([
      12, 18,
    ])
    expect(energyWeaponFlat('EverlastingMoonglow', 5)).toBe(0.6)
    expect(energyWeaponFlat('FavoniusSword', 5)).toBe(0)
    expect([1, 2, 3, 4, 5].map(favoniusCooldown)).toEqual([12, 10.5, 9, 7.5, 6])
  })

  // Only Favonius energy: no skills, no enemy particles, no bursts
  const team: CharacterKey[] = ['Bennett', 'Xiangling', 'Xingqiu', 'Sucrose']
  function favSettings(procs: number, catcher?: CharacterKey, keys = team) {
    const settings = defaultEnergyCalculator(keys, 20)
    settings.enemyParticles = 0
    for (const key of keys) {
      settings.members[key]!.skillUses = 0
      settings.members[key]!.burstEvery = 0
    }
    settings.members.Bennett!.favoniusProcs = procs
    if (catcher) settings.members.Bennett!.favoniusCatchBy = catcher
    return settings
  }
  const energyOf = (
    settings: TeamOptEnergyCalculator,
    weapon?: WeaponKey,
    refinement?: number,
    keys = team
  ) => {
    const result = calculateEnergyRecharge(
      keys,
      settings,
      weapon ? { Bennett: weapon } : undefined,
      refinement ? { Bennett: refinement } : undefined
    )
    expect(result.errors).toEqual([])
    return Object.fromEntries(
      keys.map((k) => [k, result.members[k]!.particleEnergy])
    ) as Partial<Record<CharacterKey, number>>
  }

  it('Favonius: 3 clear particles per trigger, 6 Energy for the wielder catching them, 60% for the rest', () => {
    // clear particles: no element bonus for the wielder or its Pyro teammate
    const energy = energyOf(favSettings(2), 'FavoniusSword', 3)
    expect(energy.Bennett).toBeCloseTo(12, 9)
    for (const key of ['Xiangling', 'Xingqiu', 'Sucrose'] as const)
      expect(energy[key]).toBeCloseTo(7.2, 9)
  })

  it('Favonius: particles go to whoever is on the field when it triggers', () => {
    const energy = energyOf(favSettings(2, 'Xiangling'), 'FavoniusSword', 3)
    expect(energy.Xiangling).toBeCloseTo(12, 9)
    expect(energy.Bennett).toBeCloseTo(7.2, 9)
    expect(energy.Sucrose).toBeCloseTo(7.2, 9)
  })

  it('Favonius: nothing without a Favonius weapon; at most one trigger per cooldown', () => {
    expect(energyOf(favSettings(2), 'SacrificialSword', 5).Bennett).toBe(0)
    // R1: once per 12 s, so 3 entered triggers become 20 / 12 in a 20 s rotation
    expect(energyOf(favSettings(3), 'FavoniusSword', 1).Bennett).toBeCloseTo(
      3 * (20 / 12) * 2,
      9
    )
    expect(energyOf(favSettings(3), 'FavoniusSword', 5).Bennett).toBeCloseTo(
      18,
      9
    )
    // without weapons (the workbook's way), the triggers count as entered
    expect(energyOf(favSettings(3)).Bennett).toBeCloseTo(18, 9)
  })

  it('Favonius: off-field share follows the party size', () => {
    for (const [size, offField] of [
      [3, 0.7],
      [2, 0.8],
    ]) {
      const keys = team.slice(0, size)
      expect(
        energyOf(favSettings(2, undefined, keys), 'FavoniusSword', 5, keys)
          .Xiangling
      ).toBeCloseTo(12 * offField, 9)
    }
  })

  it('Favonius lowers the team’s ER targets', () => {
    const settings = batterySettings()
    settings.members.Bennett!.favoniusProcs = 2
    const fav = calculateEnergyRecharge(
      battery,
      settings,
      { Bennett: 'FavoniusSword' },
      { Bennett: 5 }
    )
    const base = calculateEnergyRecharge(battery, batterySettings())
    expect(
      fav.members.Bennett!.particleEnergy - base.members.Bennett!.particleEnergy
    ).toBeCloseTo(12, 9)
    expect(
      fav.members.Xingqiu!.particleEnergy - base.members.Xingqiu!.particleEnergy
    ).toBeCloseTo(7.2, 9)
    expect(fav.targets.Xingqiu).toBe(
      target((80 / (base.members.Xingqiu!.particleEnergy + 7.2)) * 100)
    )
  })

  it('assumes, before KQM picks, the Favonius or energy weapon a member may use', () => {
    const settings = favSettings(2)
    settings.members.Xingqiu!.weaponEnergyTriggers = 1
    const allowed: Partial<
      Record<CharacterKey, { key: WeaponKey; refinement: number }[]>
    > = {
      Bennett: [
        { key: 'TheFlute', refinement: 5 },
        { key: 'FavoniusSword', refinement: 3 },
      ],
      Xingqiu: [
        { key: 'TheFlute', refinement: 5 },
        { key: 'AmenomaKageuchi', refinement: 5 },
      ],
      Xiangling: [{ key: 'FavoniusLance', refinement: 5 }],
    }
    const assumed = energyCalcWeapons(team, settings, (k) => allowed[k] ?? [])
    // Xiangling may use a Favonius but has no triggers: no assumption
    expect(assumed).toEqual({
      weapons: { Bennett: 'FavoniusSword', Xingqiu: 'AmenomaKageuchi' },
      refinements: { Bennett: 3, Xingqiu: 5 },
    })
    const result = calculateEnergyRecharge(
      team,
      settings,
      assumed.weapons,
      assumed.refinements
    )
    expect(result.members.Bennett!.particleEnergy).toBe(12)
    expect(result.members.Xingqiu!.flatEnergy).toBe(12)
    // no Favonius allowed: its triggers count for nothing, as in the KQM run
    const none = energyCalcWeapons(team, settings, () => [
      { key: 'TheFlute', refinement: 5 },
    ])
    expect(none.weapons).toEqual({})
    expect(
      calculateEnergyRecharge(team, settings, none.weapons, none.refinements)
        .members.Bennett!.particleEnergy
    ).toBe(0)
  })
})

describe('ER calculator inputs', () => {
  it('keeps field time at 100% when one member’s changes', () => {
    const settings = defaultEnergyCalculator(keys)
    const next = withFieldTime(settings, keys, 'Danica', 40)
    const fields = keys.map((k) => next.members[k]!.fieldTime)
    // the other 60% shared as before (50 : 16.7 : 16.7)
    expect(fields[0]).toBeCloseTo(36, 9)
    expect(fields[1]).toBe(40)
    expect(fields[2]).toBeCloseTo(12, 9)
    expect(fields[3]).toBeCloseTo(12, 9)
    expect(calculateEnergyRecharge(keys, next).errors).toEqual([])
    const all = withFieldTime(next, keys, 'Odette', 150)
    expect(keys.map((k) => all.members[k]!.fieldTime)).toEqual([0, 0, 100, 0])
    const back = withFieldTime(all, keys, 'Odette', 40)
    expect(keys.map((k) => back.members[k]!.fieldTime)).toEqual([
      20, 20, 40, 20,
    ])
    // a single member is always on the field; a blank field is kept (and reported)
    const solo = defaultEnergyCalculator(['Bennett'])
    expect(
      withFieldTime(solo, ['Bennett'], 'Bennett', 30).members.Bennett!.fieldTime
    ).toBe(100)
    const blank = withFieldTime(settings, keys, 'Danica', Number.NaN)
    expect(blank.members.Danica!.fieldTime).toBeNaN()
    expect(blank.members.Odette!.fieldTime).toBe(
      settings.members.Odette!.fieldTime
    )
  })

  it('leaves members without particle data to a manual target', () => {
    const team: CharacterKey[] = ['Somnia', 'Bennett', 'Xingqiu', 'Sucrose']
    expect(energyCalcData.Somnia).toBeUndefined()
    const result = calculateEnergyRecharge(
      team,
      defaultEnergyCalculator(team, 20)
    )
    expect(result.errors).toContain(
      'Particle data or inputs are missing for Somnia.'
    )
    expect(result.targets).toEqual({})
    // Jahoda (released, from the workbook's data) is covered
    const jahoda: CharacterKey[] = ['Jahoda', 'Bennett', 'Xingqiu', 'Sucrose']
    expect(
      calculateEnergyRecharge(jahoda, defaultEnergyCalculator(jahoda, 20))
        .errors
    ).toEqual([])
  })

  it('brings saved settings up to date with the team', () => {
    const before: CharacterKey[] = ['Bennett', 'Xingqiu', 'Sucrose', 'Fischl']
    const saved = defaultEnergyCalculator(before, 20)
    setField(saved, before, [40, 20, 20, 20])
    saved.members.Bennett!.skillUses = 3
    saved.members.Xingqiu!.catchBy = 'Fischl'
    saved.members.Bennett!.favoniusCatchBy = 'Fischl'
    // Fischl leaves, Xiangling joins
    const now: CharacterKey[] = ['Bennett', 'Xingqiu', 'Sucrose', 'Xiangling']
    expect(calculateEnergyRecharge(now, saved).errors.length).toBeGreaterThan(0)
    const synced = syncEnergyCalculator(now, saved, 20, 'Bennett')
    expect(calculateEnergyRecharge(now, synced).errors).toEqual([])
    expect(Object.keys(synced.members)).toEqual(now)
    expect(synced.members.Bennett!.skillUses).toBe(3)
    expect(synced.members.Xingqiu!.catchBy).toBe('Xingqiu')
    expect(synced.members.Bennett!.favoniusCatchBy).toBe('Bennett')
    // 40 : 20 : 20 kept and Xiangling's starting 16.7 shared out to 100%
    const total = 40 + 20 + 20 + 50 / 3
    expect(synced.members.Bennett!.fieldTime).toBeCloseTo((40 / total) * 100, 9)
    expect(synced.members.Xiangling!.fieldTime).toBeCloseTo(
      (50 / 3 / total) * 100,
      9
    )
    // unchanged team: unchanged settings
    expect(syncEnergyCalculator(before, saved, 20)).toEqual(saved)
    expect(syncEnergyCalculator(now, undefined, 20, 'Bennett')).toEqual(
      defaultEnergyCalculator(now, 20, 'Bennett')
    )
  })

  it('saves settings the team schema keeps as they are', () => {
    const before: CharacterKey[] = ['Fischl', 'TravelerAnemo', 'Sethos']
    const now: CharacterKey[] = ['Fischl', 'TravelerAnemo', 'Sethos', 'Bennett']
    let settings = syncEnergyCalculator(
      now,
      defaultEnergyCalculator(before, 20),
      20,
      'Fischl',
      { Fischl: 0 }
    )
    settings = withFieldTime(settings, now, 'Sethos', 33.3)
    Object.assign(settings.members.Sethos!, {
      secondaryMode: 2,
      secondaryUses: 1.5,
      flatEnergy: -12.5,
      favoniusProcs: 1.25,
      favoniusCatchBy: 'Fischl',
      catchBy: 'Bennett',
      funnelShare: 70,
      weaponEnergyTriggers: 0.5,
      burstEvery: 1.5,
    })
    expect(calculateEnergyRecharge(now, settings).errors).toEqual([])
    const kqm = validateTeamOpt({
      ...initTeamOpt(),
      kqm: {
        refinement5: 1,
        refinement4: 5,
        energySource: 'calculator',
        energyCalculator: settings,
      },
    })?.kqm
    expect(kqm?.energyCalculator).toEqual(settings)
  })

  it('covers every Traveler with its own element', () => {
    for (const traveler of [
      'TravelerAnemo',
      'TravelerGeo',
      'TravelerElectro',
      'TravelerDendro',
      'TravelerHydro',
      'TravelerPyro',
      'TravelerCryo',
    ] as CharacterKey[]) {
      const team: CharacterKey[] = [traveler, 'Bennett', 'Xingqiu', 'Sucrose']
      const settings = defaultEnergyCalculator(team, 20)
      settings.rng = 'average'
      settings.enemyParticles = 0
      const result = calculateEnergyRecharge(team, settings)
      expect(result.errors).toEqual([])
      const skill = energyCalcData[traveler]!.skills[0]
      const value = (element: string) => (traveler.endsWith(element) ? 3 : 1)
      // the Traveler's own particles are worth 3; Bennett's are Pyro, Xingqiu's Hydro, Sucrose's
      // Anemo (worth 3 only to a Traveler of that element), caught off the field
      expect(result.members[traveler]!.particleEnergy).toBeCloseTo(
        skill.particles * 3 +
          2.25 * value('Pyro') * 0.6 +
          5 * value('Hydro') * 0.6 +
          4 * value('Anemo') * 0.6,
        9
      )
    }
  })

  it('follows constellation-dependent skill options', () => {
    expect(energySkillConstellation('Constellation 4')).toBe(4)
    expect(energySkillConstellation('C2 proc')).toBe(2)
    expect(energySkillConstellation('CA and skill')).toBe(0)
    expect(energySkillConstellation('Press')).toBe(0)
    const team: CharacterKey[] = ['Fischl', 'Dehya', 'KukiShinobu', 'Keqing']
    const mode = (s: TeamOptEnergyCalculator, k: CharacterKey) =>
      energyCalcData[k]!.skills[s.members[k]!.skillMode].label
    // KQM's standard: 4★ C6, 5★ C0; "C2 proc" is an extra use, never the default
    const standard = defaultEnergyCalculator(team, 20)
    expect(team.map((k) => mode(standard, k))).toEqual([
      'Constellation 6',
      'Constellation 0',
      'Constellation 4',
      'Press',
    ])
    const custom = defaultEnergyCalculator(team, 20, 'Fischl', {
      Fischl: 0,
      Dehya: 2,
      KukiShinobu: 2,
      Keqing: 6,
    })
    expect(team.map((k) => mode(custom, k))).toEqual([
      'Constellation 0',
      'Constellation 2',
      'Constellation 2',
      'Press',
    ])
    // a saved option the KQM constellation lacks falls back to the constellation's own
    standard.members.Keqing!.secondaryMode = 1
    standard.members.Keqing!.secondaryUses = 2
    const synced = syncEnergyCalculator(team, standard, 20, 'Fischl', {
      Fischl: 0,
      Keqing: 0,
    })
    expect(mode(synced, 'Fischl')).toBe('Constellation 0')
    expect(synced.members.Keqing!.secondaryMode).toBe(0)
    expect(
      syncEnergyCalculator(team, standard, 20, 'Fischl', { Keqing: 2 }).members
        .Keqing!.secondaryMode
    ).toBe(1)
  })
})
