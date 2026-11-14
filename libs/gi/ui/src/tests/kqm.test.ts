import { SandboxStorage } from '@genshin-optimizer/common/database'
import type {
  ArtifactSetKey,
  CharacterKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  allSubstatKeys,
} from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import {
  ArtCharDatabase,
  initTeamOpt,
  validateTeamOpt,
} from '@genshin-optimizer/gi/db'
import {
  getArtSetStat,
  getCharWeaponType,
  getWeaponStat,
} from '@genshin-optimizer/gi/stats'
import { getMainStatValue } from '@genshin-optimizer/gi/util'
import { precompute } from '@genshin-optimizer/gi/wr'
import { describe, expect, it } from 'vitest'
import type { KqmBuild, KqmResult } from '../'
import {
  calculateEnergyRecharge,
  defaultEnergyCalculator,
  evaluateTeamRotation,
  itemConditionals,
  KQM_ROLLS,
  KQM_SUBSTAT_ROLLS,
  kqmArtData,
  kqmConstellation,
  kqmDefaultExcludedWeapons,
  kqmExcludedWeapons,
  kqmMemberConstellation,
  kqmRefinement,
  kqmRollCaps,
  kqmSets,
  kqmTalentLevel,
  kqmValues,
  kqmWeaponData,
  kqmWeaponGroup,
  kqmWeaponSource,
  kqmWeapons,
  optimizeTeamKqm,
  teamRotationNodes,
} from '../'

const ayaka: CharacterKey = 'KamisatoAyaka'
const shenhe: CharacterKey = 'Shenhe'
const baselineEr = { [ayaka]: 100, [shenhe]: 100 }
const standardCharacters = {
  [ayaka]: { talent: { auto: 10, skill: 10, burst: 10 } },
  [shenhe]: { talent: { auto: 10, skill: 10, burst: 10 } },
}

function setup() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const [key, weapon] of [
    [ayaka, 'MistsplitterReforged'],
    [shenhe, 'CalamityQueller'],
  ] as const) {
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
    database.weapons.new({
      key: weapon,
      level: 90,
      ascension: 6,
      refinement: 1,
      location: key,
      lock: false,
    })
  }
  const ayakaId = database.teamChars.new(ayaka, {
    conditional: { KamisatoAyaka: { afterBurst: 'on' } },
  })
  const shenheId = database.teamChars.new(shenhe, {
    conditional: { Shenhe: { quill: 'quill', burst: 'burst' } },
  })
  const teamId = database.teams.new({
    loadoutData: [
      { teamCharId: ayakaId },
      { teamCharId: shenheId },
    ] as LoadoutDatum[],
  })
  const teamOpt: TeamOpt = {
    ...initTeamOpt(),
    kqm: {
      refinement5: 1,
      refinement4: 5,
      talents: 10,
      energyRecharge: { ...baselineEr },
    },
    attacks: {
      [ayaka]: [
        { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
        { path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' },
      ],
      [shenhe]: [{ path: ['skill', 'press'], hits: 2, hitMode: 'avgHit' }],
    },
  }
  return { database, teamId, ayakaId, shenheId, teamOpt }
}

const run = (database: ArtCharDatabase, teamId: string, teamOpt: TeamOpt) =>
  optimizeTeamKqm({ database, teamId, gender: 'F', teamOpt, maxRounds: 2 })

/** Every build keeps to KQMS: 20 free rolls at most, per-substat caps, its weapon type */
function expectKqms(result: KqmResult) {
  for (const [ck, b] of Object.entries(result.builds) as [
    CharacterKey,
    KqmBuild,
  ][]) {
    const caps = kqmRollCaps(b.mains)
    const total = Object.values(b.rolls).reduce((a, n) => a + (n ?? 0), 0)
    expect(total).toBe(KQM_ROLLS)
    for (const [k, n] of Object.entries(b.rolls) as [SubstatKey, number][])
      expect(n).toBeLessThanOrEqual(caps[k])
    expect(getWeaponStat(b.weapon.key)?.weaponType).toBe(getCharWeaponType(ck))
    const pieces = Object.values(b.sets).reduce((a, n) => a + (n ?? 0), 0)
    expect(pieces).toBeLessThanOrEqual(4)
    for (const k of Object.keys(b.sets))
      expect(getArtSetStat(k as ArtifactSetKey)?.rarities).toContain(5)
  }
}

describe('KQM Standards builds', () => {
  it('counts 2 rolls of every substat, the main stats at +20, and the caps', () => {
    const mains = {
      sands: 'atk_',
      goblet: 'cryo_dmg_',
      circlet: 'critRate_',
    } as const
    const values = kqmValues({
      sets: { BlizzardStrayer: 4 },
      mains,
      rolls: { critDMG_: 10 },
    })
    const roll = (k: SubstatKey) => KQM_SUBSTAT_ROLLS[k]
    expect(roll('enerRech_') * 100).toBeCloseTo(5.51, 10)
    expect(roll('critRate_') * 100).toBeCloseTo(3.31, 10)
    expect(roll('critDMG_') * 100).toBeCloseTo(6.62, 10)
    expect(values['critDMG_']).toBeCloseTo(12 * roll('critDMG_'), 12)
    expect(values['critRate_']).toBeCloseTo(
      2 * roll('critRate_') + getMainStatValue('critRate_', 5, 20),
      12
    )
    expect(values['atk']).toBeCloseTo(
      2 * roll('atk') + getMainStatValue('atk', 5, 20),
      12
    )
    expect(values['hp']).toBeCloseTo(
      2 * roll('hp') + getMainStatValue('hp', 5, 20),
      12
    )
    expect(values['BlizzardStrayer']).toBe(4)
    const caps = kqmRollCaps(mains)
    // one piece has CRIT Rate / ATK% / ATK / HP as its main stat: 8 free rolls at most
    expect(caps.critRate_).toBe(8)
    expect(caps.atk_).toBe(8)
    expect(caps.atk).toBe(8)
    expect(caps.hp).toBe(8)
    expect(caps.critDMG_).toBe(10)
    // the data the team calculation takes is the same build
    const data = kqmArtData({
      sets: { BlizzardStrayer: 4 },
      mains,
      rolls: { critDMG_: 10 },
    })
    expect(Object.keys(data.artSet ?? {})).toEqual(['BlizzardStrayer'])
  })

  it('finds a team build whose rolls are the best for its sets and main stats', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, teamOpt))!
    expect(result).toBeTruthy()
    expectKqms(result)
    expect(result.optimized).toEqual([ayaka, shenhe])
    // the reported damage is the team's with those builds, evaluated the regular way
    const gear = Object.fromEntries(
      Object.entries(result.builds).map(([ck, b]) => [ck, kqmArtData(b!)])
    )
    const weapons = Object.fromEntries(
      Object.entries(result.builds).map(([ck, b]) => [
        ck,
        kqmWeaponData(b!.weapon, ck as CharacterKey),
      ])
    )
    // (the rule-based effects the run counted, as it counted them)
    const extraConditionals = Object.fromEntries(
      [ayaka, shenhe].map((ck) => [
        ck,
        itemConditionals(
          {
            attacks: ck === ayaka ? ['burst', 'skill'] : ['skill'],
            auras: ['cryo'],
            otherElements: 0,
          },
          { weapons: [result.builds[ck]!.weapon.key] }
        ).conditional,
      ])
    )
    const again = evaluateTeamRotation(database, teamId, 'F', {
      arts: gear,
      attacks: teamOpt.attacks,
      weapons,
      extraConditionals,
      characters: standardCharacters,
    })!
    expect(again.total).toBeCloseTo(result.after.total, 0)
    // the rankings' best is the result itself
    for (const ck of [ayaka, shenhe]) {
      const r = result.rankings[ck]!
      expect(r.sets[0].total).toBeCloseTo(result.after.total, 0)
      expect(r.weapons[0].total).toBeCloseTo(result.after.total, 0)
      for (const list of [r.sets, r.weapons])
        for (const o of list.filter((o) => !o.unmet))
          expect(o.total).toBeLessThanOrEqual(result.after.total * (1 + 1e-9))
    }

    // Ayaka's free rolls against every way to place them (her sets, main stats, weapon; Shenhe's build)
    const b = result.builds[ayaka]!
    const nodes = teamRotationNodes(database, teamId, 'F', {
      dyn: ayaka,
      arts: { [shenhe]: gear[shenhe] },
      attacks: teamOpt.attacks,
      weapons,
      extraConditionals,
      characters: standardCharacters,
    })!
    const f = precompute(
      nodes.terms.map((t) => t.node),
      {},
      (r) => r.path[1],
      1
    )
    const total = (rolls: Partial<Record<SubstatKey, number>>) =>
      f([
        { values: kqmValues({ sets: b.sets, mains: b.mains, rolls }) },
      ] as never).reduce((a, x) => a + x, 0)
    const caps = kqmRollCaps(b.mains)
    const subs = (
      ['critRate_', 'critDMG_', 'atk_', 'atk', 'enerRech_'] as SubstatKey[]
    ).filter((k) => caps[k] > 0)
    let best = 0
    const place = (
      i: number,
      left: number,
      rolls: Partial<Record<SubstatKey, number>>
    ) => {
      if (i === subs.length) {
        if (left === 0) best = Math.max(best, total(rolls))
        return
      }
      for (let n = 0; n <= Math.min(left, caps[subs[i]]); n++)
        place(i + 1, left - n, { ...rolls, [subs[i]]: n })
    }
    place(0, KQM_ROLLS, {})
    expect(total(b.rolls)).toBeGreaterThanOrEqual(best * (1 - 1e-9))
    // (only stats she scales with get rolls)
    for (const k of Object.keys(b.rolls)) expect(allSubstatKeys).toContain(k)
  }, 300_000)

  it('keeps each member to its set rules', async () => {
    const { database, teamId, ayakaId, teamOpt } = setup()
    // every 5★ set left out but Blizzard Strayer's 4-piece
    const excluded = Object.fromEntries(
      (allArtifactSetKeys as readonly ArtifactSetKey[])
        .filter(
          (k) =>
            k !== 'BlizzardStrayer' &&
            getArtSetStat(k)?.rarities?.includes(5 as never)
        )
        .map((k) => [k, [2, 4]])
    )
    const optConfigId = database.teamChars.get(ayakaId)!.optConfigId
    database.optConfigs.set(optConfigId, {
      artSetExclusion: { ...excluded, BlizzardStrayer: [2] },
    })
    const result = (await run(database, teamId, teamOpt))!
    expectKqms(result)
    const sets = result.builds[ayaka]!.sets
    // Blizzard's 2 pieces are left out, its 4 allowed; none of the excluded ones appears
    expect(sets['BlizzardStrayer'] === 4 || !sets['BlizzardStrayer']).toBe(true)
    for (const k of Object.keys(sets))
      expect(Object.keys(excluded)).not.toContain(k)
    for (const o of result.rankings[ayaka]!.sets)
      for (const k of Object.keys(o.sets))
        expect(Object.keys(excluded)).not.toContain(k)
  }, 300_000)

  it('meets a member’s requirements', async () => {
    const { database, teamId, ayakaId, teamOpt } = setup()
    const optConfigId = database.teamChars.get(ayakaId)!.optConfigId
    database.optConfigs.set(optConfigId, {
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 180, disabled: false },
        ],
      },
    })
    teamOpt.kqm!.energyRecharge![ayaka] = 180
    const result = (await run(database, teamId, teamOpt))!
    expectKqms(result)
    expect(result.after.unmet[ayaka] ?? []).toEqual([])
    expect(result.energyRecharge[ayaka]!.value).toBeGreaterThanOrEqual(180)
  }, 300_000)

  it('builds every member, whatever Team optimize keeps (KQM is for the whole team)', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, {
      ...teamOpt,
      keep: [shenhe],
    }))!
    expect(Object.keys(result.builds).sort()).toEqual([ayaka, shenhe].sort())
    expect(result.rankings[shenhe]).toBeDefined()
  }, 300_000)

  it('uses only free weapons by default (4★, and the free 5★ Exaiphanes Blade), at their source’s refinement', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, teamOpt))!
    for (const ck of [ayaka, shenhe])
      for (const w of [
        result.builds[ck]!.weapon,
        ...result.rankings[ck]!.weapons.map((o) => o.weapon),
      ]) {
        expect(getWeaponStat(w.key)?.rarity).toBe(
          w.key === 'ExaiphanesBlade' ? 5 : 4
        )
        const source = kqmWeaponSource(w.key)
        expect(['gacha', 'starglitter']).not.toContain(source)
        expect(w.refinement).toBe(
          source === 'bp' || source === 'quest' || source === 'console' ? 1 : 5
        )
      }
    // the table: some known weapons
    expect(kqmWeaponSource('PrototypeRancour')).toBe('craft')
    expect(kqmWeaponSource('TheBlackSword')).toBe('bp')
    expect(kqmWeaponSource('FavoniusSword')).toBe('standard')
    expect(kqmWeaponSource('TheAlleyFlash')).toBe('gacha')
    expect(kqmWeaponSource('BlackcliffLongsword')).toBe('starglitter')
    // the standard wish pool's 4★ (any banner): in by default, at R5; event-wish-only ones out
    expect(kqmRefinement('SacrificialFragments')).toBe(5)
    expect(kqmDefaultExcludedWeapons()).not.toContain('SacrificialFragments')
    expect(kqmWeapons(ayaka).map((w) => w.key)).toContain('SacrificialSword')
    expect(kqmDefaultExcludedWeapons()).toContain('TheAlleyFlash')
    expect(kqmDefaultExcludedWeapons()).toContain('BlackcliffLongsword')
    // (a free copy from a world quest: a reward, R1)
    expect(kqmWeaponSource('MoonweaversDawn')).toBe('quest')
    // a list saved before the standard wish pool was its own: those are on again; one saved
    // since keeps them as it has them
    expect(
      kqmExcludedWeapons({
        refinement5: 1,
        refinement4: 5,
        excludedWeapons: [
          'SacrificialSword',
          'TheAlleyFlash',
          'MoonweaversDawn',
        ],
      })
    ).toEqual(new Set(['TheAlleyFlash']))
    expect(
      kqmExcludedWeapons({
        refinement5: 1,
        refinement4: 5,
        excludedWeapons: ['SacrificialSword', 'TheAlleyFlash'],
        weaponList: 2,
      })
    ).toEqual(new Set(['SacrificialSword', 'TheAlleyFlash']))
    expect(kqmWeaponSource('TheCatch')).toBe('fishing')
    expect(kqmRefinement('TheBlackSword')).toBe(1)
    expect(kqmRefinement('PrototypeRancour')).toBe(5)
    // the free 5★: in by default (a sword user gets it), at R1
    expect(kqmWeaponSource('ExaiphanesBlade')).toBe('quest')
    expect(kqmRefinement('ExaiphanesBlade')).toBe(1)
    expect(kqmDefaultExcludedWeapons()).not.toContain('ExaiphanesBlade')
    expect(kqmWeapons(ayaka).map((w) => w.key)).toContain('ExaiphanesBlade')
    expect(kqmDefaultExcludedWeapons()).toContain('MistsplitterReforged')
    // the standard banner's 5★: their own group, off by default, at its setting (R1)
    expect(kqmWeaponSource('SkywardBlade')).toBe('standard')
    expect(kqmWeaponGroup('SkywardBlade')).toBe('standard5')
    expect(kqmDefaultExcludedWeapons()).toContain('SkywardBlade')
    expect(kqmRefinement('SkywardBlade')).toBe(1)
    expect(
      kqmRefinement('SkywardBlade', {
        refinement5: 1,
        refinement4: 5,
        refinementStandard5: 2,
      })
    ).toBe(2)
    // (an old list had them off with the wish 5★: they stay off)
    expect(
      kqmExcludedWeapons({
        refinement5: 1,
        refinement4: 5,
        excludedWeapons: ['SkywardBlade'],
      })
    ).toEqual(new Set(['SkywardBlade']))
    // the groups turned on and off together, and their refinement settings
    expect(kqmWeaponGroup('TheBlackSword')).toBe('bp')
    expect(kqmWeaponGroup('FavoniusSword')).toBeUndefined()
    expect(kqmWeaponGroup('TheAlleyFlash')).toBe('wish4')
    expect(kqmWeaponGroup('BlackcliffLongsword')).toBe('wish4')
    expect(kqmWeaponGroup('MistsplitterReforged')).toBe('wish5')
    expect(kqmWeaponGroup('ExaiphanesBlade')).toBeUndefined()
    expect(kqmWeaponGroup('PrototypeRancour')).toBeUndefined()
    expect(
      kqmRefinement('TheBlackSword', {
        refinement5: 1,
        refinement4: 5,
        refinementBp: 3,
      })
    ).toBe(3)
    expect(
      kqmRefinement('TheAlleyFlash', { refinement5: 1, refinement4: 3 })
    ).toBe(3)
    // (the standard wish pool's: R5 whatever the event-wish setting)
    expect(
      kqmRefinement('FavoniusSword', { refinement5: 1, refinement4: 3 })
    ).toBe(5)
    expect(
      kqmRefinement('TheBlackSword', {
        refinement5: 1,
        refinement4: 5,
        refinements: { TheBlackSword: 4 },
      })
    ).toBe(4)
    // 5★ allowed again, and Blizzard Strayer left out
    const all = (await run(database, teamId, {
      ...teamOpt,
      kqm: {
        talents: 10,
        energyRecharge: { ...baselineEr },
        refinement5: 1,
        refinement4: 5,
        excludedWeapons: [],
        excludedSets: ['BlizzardStrayer'],
      },
    }))!
    expect(
      all.rankings[ayaka]!.weapons.some(
        (o) => getWeaponStat(o.weapon.key)?.rarity === 5
      )
    ).toBe(true)
    for (const ck of [ayaka, shenhe])
      for (const o of all.rankings[ck]!.sets)
        expect(o.sets['BlizzardStrayer']).toBeUndefined()
  }, 300_000)

  it('counts a member’s effects as KQM mode sets them, over the rules', async () => {
    const { database, teamId, teamOpt } = setup()
    const first = (await run(database, teamId, teamOpt))!
    const assumed = first.assumed[ayaka] ?? []
    if (!assumed.length) return
    // every effect counted by rule for her, turned off in KQM mode
    const passives: Record<string, Record<string, string>> = {}
    for (const { path } of assumed)
      (passives[path[0]] ??= {})[path[path.length - 1]] = ''
    const second = (await run(database, teamId, {
      ...teamOpt,
      kqm: {
        talents: 10,
        energyRecharge: { ...baselineEr },
        refinement5: 1,
        refinement4: 5,
        passives: { [ayaka]: passives },
      },
    }))!
    for (const { path } of second.assumed[ayaka] ?? [])
      expect(passives[path[0]]?.[path[path.length - 1]]).toBeUndefined()
  }, 300_000)

  it('builds at 9/9/9 talents by default (KQM’s guides), 10/10/10 when chosen', async () => {
    const { database, teamId, teamOpt } = setup()
    const { talents: _, ...standard } = teamOpt.kqm!
    const nine = (await run(database, teamId, { ...teamOpt, kqm: standard }))!
    const ten = (await run(database, teamId, {
      ...teamOpt,
      kqm: { ...standard, talents: 10 },
    }))!
    expect(kqmTalentLevel(standard)).toBe(9)
    expect(ten.after.total).toBeGreaterThan(nine.after.total * 1.03)
    // per member too: talents are every member's
    for (const k of [ayaka, shenhe])
      expect(ten.after.members[k]!).toBeGreaterThan(nine.after.members[k]!)
  }, 300_000)

  it('uses C6 for 4★ and C0 for 5★ and the chosen talents (10/10/10) in search, rankings and evaluation without changing saved characters', async () => {
    const { database, teamId, teamOpt } = setup()
    database.chars.set(ayaka, { constellation: 6, level: 40, ascension: 2 })
    const fischl: CharacterKey = 'Fischl'
    database.chars.set(fischl, {
      key: fischl,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: 0,
    })
    database.weapons.new({
      key: 'TheStringless',
      level: 90,
      ascension: 6,
      refinement: 1,
      location: fischl,
      lock: false,
    })
    teamOpt.kqm!.energyRecharge![fischl] = 100
    const fischlId = database.teamChars.new(fischl)
    database.teams.set(teamId, (team) => {
      team.loadoutData[2] = { teamCharId: fischlId } as LoadoutDatum
    })
    teamOpt.attacks[fischl] = [
      { path: ['skill', 'ozDmg'], hits: 10, hitMode: 'avgHit' },
    ]
    const snapshot = JSON.stringify(database.chars.values)
    const result = (await run(database, teamId, teamOpt))!
    expect(result.after.members[fischl]).toBeGreaterThan(0)
    expect(kqmConstellation(ayaka)).toBe(0)
    expect(kqmConstellation(fischl)).toBe(6)
    expect(result.constellations).toEqual({
      [ayaka]: 0,
      [shenhe]: 0,
      [fischl]: 6,
    })
    expect(JSON.stringify(database.chars.values)).toBe(snapshot)
    // The same run with the saved characters already at the standards gives identical output.
    database.chars.set(ayaka, { constellation: 0, level: 90, ascension: 6 })
    database.chars.set(fischl, {
      constellation: 6,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    database.chars.set(ayaka, { talent: { auto: 10, skill: 10, burst: 10 } })
    database.chars.set(shenhe, { talent: { auto: 10, skill: 10, burst: 10 } })
    const standard = (await run(database, teamId, teamOpt))!
    expect(standard.after.total).toBeCloseTo(result.after.total, 5)
    expect(standard.rankings).toEqual(result.rankings)
    // A chosen constellation over the standard one (C3: her burst +3 levels): used for the build,
    // the saved one untouched
    const chosen = (await run(database, teamId, {
      ...teamOpt,
      kqm: { ...teamOpt.kqm!, constellations: { [ayaka]: 3 } },
    }))!
    expect(chosen.constellations[ayaka]).toBe(3)
    expect(chosen.constellations[fischl]).toBe(6)
    expect(chosen.after.members[ayaka]).toBeGreaterThan(
      standard.after.members[ayaka]
    )
    expect(database.chars.get(ayaka)?.constellation).toBe(0)
    expect(
      kqmMemberConstellation(ayaka, { constellations: { [ayaka]: 2 } })
    ).toBe(2)
    expect(kqmMemberConstellation(fischl, undefined)).toBe(6)
    expect(standard.builds).toEqual(result.builds)
    // Team optimize's kept members still get a KQM build, at the KQM constellation
    database.chars.set(ayaka, { constellation: 6 })
    const kept = (await run(database, teamId, { ...teamOpt, keep: [ayaka] }))!
    expect(kept.constellations[ayaka]).toBe(0)
    expect(kept.builds[ayaka]).toBeDefined()
  }, 300_000)

  it('rejects an empty weapon selection instead of silently enabling excluded weapons', async () => {
    const { database, teamId, teamOpt } = setup()
    const excludedWeapons = kqmWeapons(ayaka, undefined, { all: true }).map(
      (w) => w.key
    )
    const settings = {
      ...teamOpt,
      kqm: {
        talents: 10,
        energyRecharge: { ...baselineEr },
        refinement5: 1,
        refinement4: 5,
        excludedWeapons,
        weaponList: 2 as const,
      },
    }
    expect(kqmWeapons(ayaka, settings.kqm)).toEqual([])
    await expect(run(database, teamId, settings)).rejects.toThrow(
      'Select at least one weapon'
    )
  })

  it('supports an explicit no-set-bonus comparison', async () => {
    const { database, teamId, teamOpt } = setup()
    const result = (await run(database, teamId, {
      ...teamOpt,
      kqm: {
        talents: 10,
        energyRecharge: { ...baselineEr },
        refinement5: 1,
        refinement4: 5,
        excludedSets: kqmSets(),
      },
    }))!
    for (const build of Object.values(result.builds))
      expect(build!.sets).toEqual({})
  }, 300_000)

  it('requires ER targets for every member, including kept members', async () => {
    const { database, teamId, teamOpt } = setup()
    for (const value of [
      undefined,
      0,
      99,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      teamOpt.kqm!.energyRecharge = { [ayaka]: 100, [shenhe]: value as number }
      await expect(
        run(database, teamId, { ...teamOpt, keep: [shenhe] })
      ).rejects.toThrow('Enter an ER requirement')
    }
  })

  it('allocates rolls to an explicit ER target and reports impossible targets', async () => {
    const { database, teamId, ayakaId, teamOpt } = setup()
    const configId = database.teamChars.get(ayakaId)!.optConfigId
    database.optConfigs.set(configId, {
      mainStatKeys: {
        sands: ['atk_'],
        goblet: ['cryo_dmg_'],
        circlet: ['critRate_'],
      },
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 999, disabled: false },
        ],
      },
    })
    teamOpt.keep = [shenhe]
    teamOpt.kqm!.excludedWeapons = kqmWeapons(ayaka, undefined, { all: true })
      .map((w) => w.key)
      .filter((key) => key !== 'PrototypeRancour')
    teamOpt.kqm!.weaponList = 2
    const low = (await run(database, teamId, teamOpt))!
    expect(low.energyRecharge[ayaka]!.minimum).toBe(100)
    expect(low.after.unmet[ayaka] ?? []).toEqual([])
    teamOpt.kqm!.energyRecharge![ayaka] = 150
    const high = (await run(database, teamId, teamOpt))!
    expect(high.energyRecharge[ayaka]!.value).toBeGreaterThanOrEqual(150)
    expect(high.builds[ayaka]!.rolls.enerRech_ ?? 0).toBeGreaterThan(
      low.builds[ayaka]!.rolls.enerRech_ ?? 0
    )
    teamOpt.kqm!.energyRecharge![ayaka] = 300
    const impossible = (await run(database, teamId, teamOpt))!
    expect(impossible.energyRecharge[ayaka]!.value).toBeLessThan(300)
    expect(
      impossible.after.shortfalls![ayaka]!.some(
        (s) => s.path.at(-1) === 'enerRech_'
      )
    ).toBe(true)
    // a requirement no build meets does not mark every ranked option: only one the chosen
    // build meets does (here none)
    const ranked = impossible.rankings[ayaka]!
    expect([...ranked.sets, ...ranked.weapons].some((o) => !o.unmet)).toBe(true)
    expect(ranked.sets[0].total).toBeCloseTo(impossible.after.total, 0)
  }, 300_000)

  it('uses calculator ER constraints for the actual weapons without applying manual reductions twice', async () => {
    const { database, teamId, teamOpt } = setup()
    const settings = defaultEnergyCalculator([ayaka, shenhe], 20)
    settings.members[ayaka]!.skillUses = 2
    settings.members[shenhe]!.skillUses = 2
    settings.members[shenhe]!.burstEvery = 0
    settings.members[shenhe]!.favoniusProcs = 1
    teamOpt.kqm!.energySource = 'calculator'
    teamOpt.kqm!.energyCalculator = settings
    teamOpt.kqm!.energyRecharge = calculateEnergyRecharge(
      [ayaka, shenhe],
      settings
    ).targets
    teamOpt.kqm!.weaponEnergy = { FavoniusLance: { [ayaka]: 100 } }
    // (KQM's own weapon choices: the members' own weapons play no part)
    teamOpt.kqm!.excludedWeapons = [
      ...kqmWeapons(ayaka, undefined, { all: true })
        .map((w) => w.key)
        .filter((key) => key !== 'PrototypeRancour'),
      ...kqmWeapons(shenhe, undefined, { all: true })
        .map((w) => w.key)
        .filter((key) => key !== 'FavoniusLance'),
    ]
    teamOpt.kqm!.weaponList = 2
    const result = (await run(database, teamId, teamOpt))!
    expect(result.builds[shenhe]!.weapon.key).toBe('FavoniusLance')
    const expected = calculateEnergyRecharge([ayaka, shenhe], settings, {
      [ayaka]: 'PrototypeRancour',
      [shenhe]: 'FavoniusLance',
    }).targets[ayaka]!
    expect(result.energyRecharge[ayaka]!.minimum).toBeCloseTo(expected, 6)
    expect(result.energyRecharge[ayaka]!.value).toBeGreaterThanOrEqual(expected)
    expect(result.energyRecharge[ayaka]!.minimum).toBeGreaterThan(100)
  }, 300_000)

  it('compares ER sands against ATK sands with ER substats before selecting a main stat', async () => {
    const { database, teamId, ayakaId, teamOpt } = setup()
    const configId = database.teamChars.get(ayakaId)!.optConfigId
    database.optConfigs.set(configId, {
      mainStatKeys: { sands: ['atk_', 'enerRech_'], goblet: [], circlet: [] },
      artSetExclusion: Object.fromEntries(
        kqmSets().map((key) => [key, key === 'BlizzardStrayer' ? [2] : [2, 4]])
      ),
    })
    teamOpt.keep = [shenhe]
    teamOpt.kqm!.energyRecharge![ayaka] = 135
    teamOpt.kqm!.excludedWeapons = kqmWeapons(ayaka, undefined, { all: true })
      .map((w) => w.key)
      .filter((key) => key !== 'PrototypeRancour')
    teamOpt.kqm!.weaponList = 2
    const unrestricted = (await run(database, teamId, teamOpt))!
    database.optConfigs.set(configId, {
      mainStatKeys: { sands: ['atk_'], goblet: [], circlet: [] },
    })
    const atk = (await run(database, teamId, teamOpt))!
    expect(atk.energyRecharge[ayaka]!.value).toBeGreaterThanOrEqual(135)
    expect(unrestricted.after.total).toBeGreaterThanOrEqual(
      atk.after.total * (1 - 1e-9)
    )
    expect(unrestricted.builds[ayaka]!.mains.sands).toBe('atk_')
    expect(unrestricted.builds[ayaka]!.rolls.enerRech_).toBeGreaterThan(0)
  }, 300_000)

  it('keeps valid KQM settings and drops broken ones', () => {
    const kept = validateTeamOpt({
      ...initTeamOpt(),
      kqm: {
        energyRecharge: {
          [ayaka]: 180,
          [shenhe]: 99,
          Nobody: 200,
          Fischl: '200',
          Lisa: Number.POSITIVE_INFINITY,
        },
        refinement5: 2,
        refinement4: 9,
        excludedWeapons: ['WolfsGravestone', 'NotAWeapon'],
        excludedSets: [],
        weaponEnergy: { FavoniusLance: { Shenhe: 20, Nobody: 5 }, Bad: {} },
        passives: { [ayaka]: { BlizzardStrayer: { condition: '' } } },
      },
    })!.kqm!
    expect(kept.energyRecharge).toEqual({ [ayaka]: 180 })
    expect(kept.refinement5).toBe(2)
    expect(kept.refinement4).toBe(5)
    expect(kept.excludedWeapons).toEqual(['WolfsGravestone'])
    // no set left out: the same as none set
    expect(kept.excludedSets).toBeUndefined()
    expect(kept.weaponEnergy).toEqual({ FavoniusLance: { Shenhe: 20 } })
    expect(kept.passives).toEqual({
      [ayaka]: { BlizzardStrayer: { condition: '' } },
    })
    expect(validateTeamOpt({ ...initTeamOpt(), kqm: 'x' })!.kqm).toBeUndefined()
  })
})
