import { SandboxStorage } from '@genshin-optimizer/common/database'
import { objPathValue } from '@genshin-optimizer/common/util'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  CharacterKey,
  MainStatKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import type {
  ICachedArtifact,
  LoadoutDatum,
  TeamOpt,
  TeamOptAttack,
} from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import type { NumNode, OptNode } from '@genshin-optimizer/gi/wr'
import {
  constant,
  input,
  optimize,
  precompute,
  sum,
  uiInput,
} from '@genshin-optimizer/gi/wr'
import type { TeamOptResult, TeamOptSolver } from '../'
import {
  attackHitData,
  attackSegments,
  clearTeamOptSolveMemo,
  evaluateTeamRotation,
  getTeamDataCalc,
  hitFormulaParts,
  meetsSetRules,
  optimizeTeam,
  partTerms,
  statGains,
  teamOptArtValues,
  teamOptBonusStats,
  teamOptMembers,
  teamOptUIData,
  teamOptWeaponCandidates,
  teamRotationHits,
  teamRotationNodes,
  teamSensitivity,
} from '../'

const ayaka: CharacterKey = 'KamisatoAyaka'
const shenhe: CharacterKey = 'Shenhe'
const quill = { owner: shenhe, path: ['Shenhe', 'quill'] }

type ArtSpec = {
  set: ArtifactSetKey
  main: Partial<Record<ArtifactSlotKey, MainStatKey>>
  subs: Partial<Record<SubstatKey, number>>
}
const mains: Record<ArtifactSlotKey, MainStatKey> = {
  flower: 'hp',
  plume: 'atk',
  sands: 'atk_',
  goblet: 'cryo_dmg_',
  circlet: 'critDMG_',
}
/** Crit pieces (Ayaka's), ATK% pieces (Shenhe's quills scale with her ATK), and weak ones */
const specs: Record<'crit' | 'atk' | 'weak', ArtSpec> = {
  crit: {
    set: 'BlizzardStrayer',
    main: {},
    subs: { critRate_: 10.5, critDMG_: 21, atk_: 5.8 },
  },
  atk: {
    set: 'NoblesseOblige',
    main: { goblet: 'atk_', circlet: 'atk_' },
    subs: { atk_: 15.7, atk: 33, enerRech_: 6.5 },
  },
  weak: {
    set: 'GladiatorsFinale',
    main: { sands: 'def_', goblet: 'def_', circlet: 'hp_' },
    subs: { def: 23, hp: 299 },
  },
}
const fillers = [
  { key: 'eleMas' as SubstatKey, value: 23 },
  { key: 'def_' as SubstatKey, value: 7.3 },
  { key: 'hp_' as SubstatKey, value: 5.8 },
  { key: 'hp' as SubstatKey, value: 299 },
]

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
  // the pieces start swapped: Ayaka wears the ATK% ones, Shenhe the crit ones
  const ids: Record<keyof typeof specs, Record<ArtifactSlotKey, string>> = {
    crit: {} as Record<ArtifactSlotKey, string>,
    atk: {} as Record<ArtifactSlotKey, string>,
    weak: {} as Record<ArtifactSlotKey, string>,
  }
  const location = { crit: shenhe, atk: ayaka, weak: '' } as const
  for (const kind of ['crit', 'atk', 'weak'] as const)
    for (const slotKey of allArtifactSlotKeys) {
      const { set, main, subs } = specs[kind]
      const mainStatKey = main[slotKey] ?? mains[slotKey]
      // a substat cannot be the main stat: a filler takes its place (4 substats, valid rolls)
      const substats = Object.entries(subs)
        .filter(([key]) => key !== mainStatKey)
        .map(([key, value]) => ({ key: key as SubstatKey, value }))
      for (const filler of fillers)
        if (
          substats.length < 4 &&
          filler.key !== mainStatKey &&
          !substats.some((s) => s.key === filler.key)
        )
          substats.push({ ...filler })
      ids[kind][slotKey] = database.arts.new({
        setKey: set,
        slotKey,
        level: 20,
        rarity: 5,
        mainStatKey,
        location: location[kind],
        lock: false,
        substats,
      })
      expect(database.arts.get(ids[kind][slotKey])).toBeTruthy()
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
  return { database, teamId, ayakaId, shenheId, ids }
}

const attack = (
  path: string[],
  hits: number,
  limits?: TeamOptAttack['limits']
): TeamOptAttack => ({
  path,
  hits,
  hitMode: 'avgHit',
  ...(limits ? { limits } : {}),
})

/** The value the app shows for `path` of `characterKey`, computed the regular way */
function displayed(
  database: ArtCharDatabase,
  teamId: string,
  characterKey: CharacterKey,
  path: string[]
) {
  const teamData = getTeamDataCalc(database, teamId, 'F', '')!
  const uiData = teamData[characterKey]!.target
  const node = objPathValue(uiData.data[0].display ?? {}, path) as NumNode
  return uiData.get(node).value
}

function evalAt(nodes: OptNode[], arts: ICachedArtifact[]): number[] {
  const compute = precompute(nodes, {}, (r) => r.path[1], arts.length)
  return compute(arts.map((a) => ({ values: teamOptArtValues(a, 0) })) as never)
}

describe('attackSegments', () => {
  it('splits an attack by the hits its limited buffs cover', () => {
    expect(attackSegments(attack(['burst', 'cutting'], 19))).toEqual([
      { hits: 19, excluded: [] },
    ])
    expect(
      attackSegments(attack(['burst', 'cutting'], 19, [{ ...quill, hits: 7 }]))
    ).toEqual([
      { hits: 7, excluded: [] },
      { hits: 12, excluded: [quill] },
    ])
    // off for the whole attack, and limits beyond the attack's hits
    expect(
      attackSegments(attack(['skill', 'press'], 2, [{ ...quill, hits: 0 }]))
    ).toEqual([{ hits: 2, excluded: [quill] }])
    expect(
      attackSegments(attack(['skill', 'press'], 2, [{ ...quill, hits: 5 }]))
    ).toEqual([{ hits: 2, excluded: [] }])
    // two limits: the first hits get both, then only the longer one
    const other = { owner: ayaka, path: ['KamisatoAyaka', 'afterBurst'] }
    expect(
      attackSegments(
        attack(['normal', '0'], 10, [
          { ...quill, hits: 3 },
          { ...other, hits: 6 },
        ])
      )
    ).toEqual([
      { hits: 3, excluded: [] },
      { hits: 3, excluded: [quill] },
      { hits: 4, excluded: [quill, other] },
    ])
    expect(attackSegments(attack(['normal', '0'], 0))).toEqual([])
  })
})

describe('team rotation', () => {
  it('counts each attack as the app computes it', () => {
    const { database, teamId } = setup()
    const attacks: TeamOpt['attacks'] = {
      [ayaka]: [
        attack(['skill', 'press'], 2),
        attack(['burst', 'cutting'], 19),
      ],
      [shenhe]: [attack(['skill', 'press'], 1)],
    }
    const result = evaluateTeamRotation(database, teamId, 'F', {
      arts: {},
      attacks,
    })!
    const skill = displayed(database, teamId, ayaka, ['skill', 'press'])
    const cutting = displayed(database, teamId, ayaka, ['burst', 'cutting'])
    const shenheSkill = displayed(database, teamId, shenhe, ['skill', 'press'])
    expect(skill).toBeGreaterThan(0)
    expect(result.attacks[ayaka]![0]).toBeCloseTo(2 * skill, 6)
    expect(result.attacks[ayaka]![1]).toBeCloseTo(19 * cutting, 6)
    expect(result.members[shenhe]).toBeCloseTo(shenheSkill, 6)
    expect(result.total).toBeCloseTo(2 * skill + 19 * cutting + shenheSkill, 6)
  })

  it('applies a limited buff to the first hits only', () => {
    const { database, teamId } = setup()
    const total = (limits?: TeamOptAttack['limits']) =>
      evaluateTeamRotation(database, teamId, 'F', {
        arts: {},
        attacks: { [ayaka]: [attack(['burst', 'cutting'], 19, limits)] },
      })!.total
    const all = total()
    const none = total([{ ...quill, hits: 0 }])
    const seven = total([{ ...quill, hits: 7 }])
    // the quills add Shenhe's ATK-based flat DMG to Cryo hits
    expect(all).toBeGreaterThan(none * 1.05)
    expect(seven).toBeCloseTo((7 / 19) * all + (12 / 19) * none, 6)
  })

  it('gives the active character’s buffs to whoever is on the field', () => {
    const { database, teamId, shenheId } = setup()
    // Shenhe's A1: +15% Cryo DMG for the character on the field (in her burst's field)
    database.teamChars.set(shenheId, (tc) => {
      const conditional = tc.conditional as Record<
        string,
        Record<string, string>
      >
      tc.conditional = {
        ...conditional,
        Shenhe: { ...conditional['Shenhe'], asc1: 'field' },
      } as typeof tc.conditional
    })
    const cutting = attack(['burst', 'cutting'], 19)
    const ayakaDmg = (onField?: CharacterKey, attackOnField?: CharacterKey) =>
      evaluateTeamRotation(database, teamId, 'F', {
        arts: {},
        attacks: {
          [ayaka]: [
            attackOnField ? { ...cutting, onField: attackOnField } : cutting,
          ],
        },
        onField,
      })!.members[ayaka]!
    // by default the first member (Ayaka) is on the field
    const onField = ayakaDmg()
    const offField = ayakaDmg(shenhe)
    expect(onField).toBeGreaterThan(offField * 1.05)
    expect(ayakaDmg(undefined, shenhe)).toBeCloseTo(offField, 6)
    expect(ayakaDmg(shenhe, ayaka)).toBeCloseTo(onField, 6)
    // the app's numbers: its active character is the team's first member
    const cuttingShown = () =>
      19 * displayed(database, teamId, ayaka, ['burst', 'cutting'])
    expect(onField).toBeCloseTo(cuttingShown(), 6)
    const { loadoutData } = database.teams.get(teamId)!
    database.teams.set(teamId, {
      loadoutData: [loadoutData[1], loadoutData[0], ...loadoutData.slice(2)],
    })
    expect(offField).toBeCloseTo(cuttingShown(), 6)
  })

  it('puts a buff in another state for one attack', () => {
    const { database, teamId, ayakaId, ids } = setup()
    // Ayaka in Blizzard Strayer, the rotation against Cryo-affected opponents
    const setState = (state: string) =>
      database.teamChars.set(ayakaId, (tc) => {
        tc.conditional = {
          ...tc.conditional,
          BlizzardStrayer: { state },
        } as typeof tc.conditional
      })
    setState('cryo')
    const arts = {
      [ayaka]: Object.values(ids.crit).map((id) => database.arts.get(id)!),
    }
    const dmg = (def: TeamOptAttack) =>
      evaluateTeamRotation(database, teamId, 'F', {
        arts,
        attacks: { [ayaka]: [def] },
      })!.total
    const cutting = attack(['burst', 'cutting'], 19)
    const frozen = { owner: ayaka, path: ['BlizzardStrayer', 'state'] }
    const cryoDmg = dmg(cutting)
    const frozenDmg = dmg({
      ...cutting,
      states: [{ ...frozen, value: 'frozen' }],
    })
    expect(frozenDmg).toBeGreaterThan(cryoDmg * 1.02)
    // a limit still turns it off after the attack's first hits
    const offDmg = dmg({ ...cutting, limits: [{ ...frozen, hits: 0 }] })
    expect(
      dmg({
        ...cutting,
        states: [{ ...frozen, value: 'frozen' }],
        limits: [{ ...frozen, hits: 7 }],
      })
    ).toBeCloseTo((7 / 19) * frozenDmg + (12 / 19) * offDmg, 6)
    // the same as the whole rotation against Frozen opponents
    setState('frozen')
    expect(dmg(cutting)).toBeCloseTo(frozenDmg, 6)
  })

  it('counts extra buffs like the members’ own bonus stats', () => {
    const { database, teamId, shenheId } = setup()
    const attacks = { [ayaka]: [attack(['burst', 'cutting'], 19)] }
    const total = (bonusStats?: TeamOpt['bonusStats']) =>
      evaluateTeamRotation(database, teamId, 'F', {
        arts: {},
        attacks,
        bonusStats: teamOptBonusStats({ bonusStats }, [ayaka, shenhe]),
      })!.total
    const base = total()
    // food for the whole team
    expect(total({ team: { atk_: 20 } })).toBeGreaterThan(base * 1.05)
    // Shenhe's ATK alone still raises Ayaka's hits: her quills scale with it
    const shenheAtk = total({ [shenhe]: { atk: 500 } })
    expect(shenheAtk).toBeGreaterThan(base * 1.02)
    // the same as the bonus stats of Shenhe's own loadout
    database.teamChars.set(shenheId, { bonusStats: { atk: 500 } })
    expect(total()).toBeCloseTo(shenheAtk, 6)
  })

  it('values one change to a member at a time, buffs to others included', () => {
    const { database, teamId, ids } = setup()
    // only Ayaka attacks: Shenhe deals nothing herself, but her ATK makes Ayaka's quill hits
    const attacks = { [ayaka]: [attack(['burst', 'cutting'], 19)] }
    const teamOpt: TeamOpt = { ...initTeamOpt(), attacks }
    const result = {
      builds: { [ayaka]: ids.crit, [shenhe]: ids.atk },
      weapons: {},
    }
    const sensitivity = teamSensitivity(database, teamId, 'F', teamOpt, result)
    const member = (ck: CharacterKey) =>
      sensitivity.members.find((m) => m.characterKey === ck)!
    const base = sensitivity.base!
    const shenheRolls = sensitivity.substats(member(shenhe))
    expect(shenheRolls.atk_! / base - 1).toBeGreaterThan(0.001)
    // her CRIT does nothing for the quills (flat DMG from her ATK)
    expect(shenheRolls.critDMG_! / base - 1).toBeCloseTo(0, 9)
    // a compiled roll is the team computed again with that roll as a bonus stat
    const arts = {
      [ayaka]: Object.values(ids.crit).map((id) => database.arts.get(id)!),
      [shenhe]: Object.values(ids.atk).map((id) => database.arts.get(id)!),
    }
    const ayakaRolls = sensitivity.substats(member(ayaka))
    const full = evaluateTeamRotation(database, teamId, 'F', {
      arts,
      attacks,
      bonusStats: {
        [ayaka]: { critDMG_: sensitivity.rolls.critDMG_ * 100 },
      },
    })!.total
    expect(ayakaRolls.critDMG_! / full - 1).toBeCloseTo(0, 9)
    expect(ayakaRolls.critDMG_! / base - 1).toBeGreaterThan(0.005)
    // one more burst level (9 → 10): as when Ayaka's talent is raised
    const burst = sensitivity.character(member(ayaka), { talent: 'burst' })!
    expect(burst).toBeGreaterThan(base)
    database.chars.set(ayaka, { talent: { auto: 9, skill: 9, burst: 10 } })
    const raised = evaluateTeamRotation(database, teamId, 'F', {
      arts,
      attacks,
    })!.total
    expect(burst / raised - 1).toBeCloseTo(0, 9)
    // at 10 there is no more
    expect(
      teamSensitivity(database, teamId, 'F', teamOpt, result).character(
        member(ayaka),
        { talent: 'burst' }
      )
    ).toBeUndefined()
    // level 80 is a loss, 100 a gain
    expect(sensitivity.character(member(ayaka), { level: 80 })!).toBeLessThan(
      base
    )
    expect(
      sensitivity.character(member(ayaka), { level: 100 })!
    ).toBeGreaterThan(base)
  })

  it('makes the rotation a function of one member’s artifacts, buffs to others included', () => {
    const { database, teamId } = setup()
    const attacks: TeamOpt['attacks'] = {
      [ayaka]: [
        attack(['burst', 'cutting'], 19, [{ ...quill, hits: 7 }]),
        attack(['skill', 'press'], 2),
      ],
      [shenhe]: [attack(['skill', 'press'], 2)],
    }
    const fixed = evaluateTeamRotation(database, teamId, 'F', {
      arts: {},
      attacks,
    })!
    const currentArts = (ck: CharacterKey) =>
      database.arts.values.filter((a) => a.location === ck)
    for (const dyn of [ayaka, shenhe]) {
      const nodes = teamRotationNodes(database, teamId, 'F', {
        dyn,
        arts: {},
        attacks,
      })!
      const objective = sum(...nodes.terms.map((t) => t.node))
      const [value] = evalAt([objective], currentArts(dyn))
      expect(value).toBeCloseTo(fixed.total, 6)
    }
    // Shenhe's quills follow her ATK: Ayaka's damage depends on Shenhe's artifacts
    const nodes = teamRotationNodes(database, teamId, 'F', {
      dyn: shenhe,
      arts: {},
      attacks: { [ayaka]: attacks[ayaka] },
    })!
    const ayakaOnly = sum(...nodes.terms.map((t) => t.node))
    const [withCrit] = evalAt([ayakaOnly], currentArts(shenhe))
    const atkPieces = database.arts.values.filter(
      (a) => a.setKey === 'NoblesseOblige'
    )
    const [withAtk] = evalAt([ayakaOnly], atkPieces)
    expect(withAtk).toBeGreaterThan(withCrit)
  })
})

describe('team optimize', () => {
  /** Every build of `arts` (one per slot), best first, as the solver would rank them */
  const bruteForce: TeamOptSolver = async ({
    arts,
    objective,
    constraints,
    exclusion,
  }) => {
    const bySlot = allArtifactSlotKeys.map((s) =>
      arts.filter((a) => a.slotKey === s)
    )
    const nodes = [objective, ...constraints.map((c) => c.value)]
    let best: { value: number; artifactIds: string[] } | undefined
    const rec = (i: number, picked: ICachedArtifact[]) => {
      if (i === bySlot.length) {
        // (the set rules, as the solver keeps to them)
        if (!meetsSetRules(picked, exclusion)) return
        const [value, ...cons] = evalAt(nodes, picked)
        if (constraints.some((c, j) => !(cons[j] >= c.min))) return
        if (!best || value > best.value)
          best = { value, artifactIds: picked.map((a) => a.id) }
        return
      }
      for (const art of bySlot[i]) rec(i + 1, [...picked, art])
    }
    rec(0, [])
    return best
  }

  it('finds builds no member can improve alone, without sharing artifacts', async () => {
    const { database, teamId } = setup()
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: {
        [ayaka]: [
          attack(['burst', 'cutting'], 19, [{ ...quill, hits: 7 }]),
          attack(['skill', 'press'], 2),
          attack(['normal', '0'], 6, [{ ...quill, hits: 0 }]),
        ],
        [shenhe]: [attack(['skill', 'press'], 2)],
      },
    }
    const steps: string[] = []
    const result = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      solve: bruteForce,
      onStep: ({ round, characterKey }) =>
        steps.push(`${round}:${characterKey}`),
    }))!
    expect(result).toBeTruthy()
    // the biggest damage dealer goes first
    expect(steps[0]).toBe(`1:${ayaka}`)
    expect(result.after.total).toBeGreaterThan(result.before.total)

    const used = Object.values(result.builds).flatMap((b) =>
      Object.values(b ?? {}).filter(Boolean)
    )
    expect(new Set(used).size).toBe(used.length)
    expect(used.length).toBe(10)

    // no member can do better on its own, with the other's build as it is
    const arts = (ck: CharacterKey) =>
      Object.values(result.builds[ck]!).map((id) => database.arts.get(id!)!)
    for (const [ck, other] of [
      [ayaka, shenhe],
      [shenhe, ayaka],
    ] as const) {
      const nodes = teamRotationNodes(database, teamId, 'F', {
        dyn: ck,
        arts: { [other]: arts(other) },
        attacks: teamOpt.attacks,
      })!
      const [objective] = optimize(
        [sum(...nodes.terms.map((t) => t.node), constant(0))],
        {},
        ({ path: [p] }) => p !== 'dyn'
      )
      const taken = new Set(Object.values(result.builds[other]!))
      const pool = database.arts.values.filter((a) => !taken.has(a.id))
      const best = (await bruteForce({
        characterKey: ck,
        arts: pool,
        objective,
        constraints: [],
        exclusion: {},
        mainStatAssumptionLevel: 0,
      }))!
      const [mine] = evalAt([objective], arts(ck))
      expect(mine).toBeCloseTo(best.value, 6)
      expect(mine).toBeCloseTo(result.after.total, 6)
    }
  })

  it('swaps pieces with a member whose artifacts do not matter, keeping its build full', async () => {
    const { database, teamId, ids } = setup()
    // no quills and no attacks for Shenhe: her artifacts change nothing
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: {
        [ayaka]: [attack(['burst', 'cutting'], 19, [{ ...quill, hits: 0 }])],
      },
    }
    const result = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      solve: bruteForce,
    }))!
    const shenheIds = Object.values(result.builds[shenhe]!)
    expect(shenheIds.filter(Boolean).length).toBe(5)
    // she gets what Ayaka gave up, nothing from the unequipped pieces
    const weak = new Set(Object.values(ids.weak))
    expect(shenheIds.some((id) => weak.has(id!))).toBe(false)
    const ayakaIds = new Set(Object.values(result.builds[ayaka]!))
    expect(shenheIds.some((id) => ayakaIds.has(id))).toBe(false)
  })

  it('respects a member’s set rules, also when its current build breaks them', async () => {
    const { database, teamId, ayakaId, ids } = setup()
    // Ayaka wears her best pieces: the 5 Blizzard Strayer ones
    for (const id of Object.values(ids.crit))
      database.arts.set(id, { location: ayaka })
    // ...but her Optimize settings exclude Blizzard Strayer's 4-piece (as the Optimize tab does)
    const optConfigId = database.teamChars.get(ayakaId)!.optConfigId
    database.optConfigs.set(optConfigId, {
      artSetExclusion: { BlizzardStrayer: [4] },
    })
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: {
        [ayaka]: [attack(['burst', 'cutting'], 19)],
        [shenhe]: [attack(['skill', 'press'], 2)],
      },
    }
    const setCount = (result: TeamOptResult, ck: CharacterKey) =>
      Object.values(result.builds[ck] ?? {}).filter(
        (id) => id && database.arts.get(id)?.setKey === 'BlizzardStrayer'
      ).length
    const result = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      solve: bruteForce,
    }))!
    expect(result.optimized).toContain(ayaka)
    expect(setCount(result, ayaka)).toBeLessThan(4)
    // the next best team builds keep to it too
    const more = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt: { ...teamOpt, topN: 3 },
      solve: bruteForce,
      builds: 3,
    }))!
    for (const alternative of more.alternatives ?? [])
      expect(
        setCount({ ...more, builds: alternative.builds }, ayaka)
      ).toBeLessThan(4)
  })

  it('keeps members that are kept, and respects their constraints', async () => {
    const { database, teamId, shenheId } = setup()
    // Shenhe must keep 15% ER or more: only the ATK% pieces have ER
    const optConfigId = database.teamChars.get(shenheId)!.optConfigId
    database.optConfigs.set(optConfigId, {
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 125, disabled: false },
        ],
      },
    })
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: {
        [ayaka]: [attack(['burst', 'cutting'], 19)],
        [shenhe]: [attack(['skill', 'press'], 2)],
      },
    }
    const result = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      solve: bruteForce,
    }))!
    const shenheArts = Object.values(result.builds[shenhe]!).map(
      (id) => database.arts.get(id!)!
    )
    const er = shenheArts.reduce(
      (er, a) =>
        er +
        (a.substats.find((s) => s.key === 'enerRech_')?.accurateValue ?? 0),
      100
    )
    expect(er).toBeGreaterThanOrEqual(125)
    expect(result.after.unmet[shenhe]).toBeUndefined()

    const kept = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt: { ...teamOpt, keep: [shenhe] },
      solve: bruteForce,
    }))!
    expect(kept.optimized).toEqual([ayaka])
    const shenheNow = database.arts.values
      .filter((a) => a.location === shenhe)
      .map((a) => a.id)
      .sort()
    expect(Object.values(kept.builds[shenhe]!).filter(Boolean).sort()).toEqual(
      shenheNow
    )
  })

  it('chooses weapons too, from the ones allowed', async () => {
    const { database, teamId } = setup()
    // Ayaka starts with a Dull Blade; her Mistsplitter lies unequipped
    const mistsplitter = database.weapons.values.find(
      (w) => w.key === 'MistsplitterReforged'
    )!
    database.weapons.set(mistsplitter.id, { location: '' })
    const dullBlade = database.weapons.new({
      key: 'DullBlade',
      level: 1,
      ascension: 0,
      refinement: 1,
      location: ayaka,
      lock: false,
    })
    expect(database.chars.get(ayaka)!.equippedWeapon).toBe(dullBlade)
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: { [ayaka]: [attack(['burst', 'cutting'], 19)] },
    }
    const run = (o: Partial<TeamOpt>) =>
      optimizeTeam({
        database,
        teamId,
        gender: 'F',
        teamOpt: { ...teamOpt, ...o },
        solve: bruteForce,
      }) as Promise<TeamOptResult>
    const without = await run({})
    expect(without.weapons[ayaka]).toBe(dullBlade)
    const withWeapons = await run({ optimizeWeapons: true })
    expect(withWeapons.weapons[ayaka]).toBe(mistsplitter.id)
    expect(withWeapons.after.total).toBeGreaterThan(without.after.total * 1.2)
    // Shenhe wields a polearm: never a sword
    expect(withWeapons.weapons[shenhe]).toBe(
      database.chars.get(shenhe)!.equippedWeapon
    )
    const excluded = await run({
      optimizeWeapons: true,
      excludedWeapons: [mistsplitter.id],
    })
    expect(excluded.weapons[ayaka]).toBe(dullBlade)
    expect(excluded.untickedWeapons).toBeUndefined()

    // Her own weapon left out: a ticked one replaces it, even one that deals less
    database.weapons.set(mistsplitter.id, { location: ayaka })
    database.weapons.set(dullBlade, { location: '' })
    expect(database.chars.get(ayaka)!.equippedWeapon).toBe(mistsplitter.id)
    const replaced = await run({
      optimizeWeapons: true,
      excludedWeapons: [mistsplitter.id],
    })
    expect(replaced.weapons[ayaka]).toBe(dullBlade)
    expect(replaced.untickedWeapons).toBeUndefined()
    const allTicked = await run({ optimizeWeapons: true })
    expect(allTicked.weapons[ayaka]).toBe(mistsplitter.id)
    expect(replaced.after.total).toBeLessThan(allTicked.after.total)
    // with no sword ticked she keeps hers (she must wield one), and the result says so
    const noneTicked = await run({
      optimizeWeapons: true,
      excludedWeapons: [mistsplitter.id, dullBlade],
    })
    expect(noneTicked.weapons[ayaka]).toBe(mistsplitter.id)
    expect(noneTicked.untickedWeapons).toEqual([ayaka])
  })

  it('replaces a weapon left out even when the team ends below its own builds, and says why', async () => {
    const { database, teamId } = setup()
    // Ayaka already wears her best build with her Mistsplitter; a Dull Blade lies unequipped
    const mistsplitter = database.weapons.values.find(
      (w) => w.key === 'MistsplitterReforged'
    )!
    database.weapons.set(mistsplitter.id, { location: ayaka })
    const dullBlade = database.weapons.new({
      key: 'DullBlade',
      level: 1,
      ascension: 0,
      refinement: 1,
      location: '',
      lock: false,
    })
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: { [ayaka]: [attack(['burst', 'cutting'], 19)] },
    }
    const run = (o: Partial<TeamOpt>) =>
      optimizeTeam({
        database,
        teamId,
        gender: 'F',
        teamOpt: { ...teamOpt, ...o },
        solve: bruteForce,
      }) as Promise<TeamOptResult>
    const best = await run({ optimizeWeapons: true })
    expect(best.weapons[ayaka]).toBe(mistsplitter.id)
    for (const id of Object.values(best.builds[ayaka]!))
      if (id) database.arts.set(id, { location: ayaka })
    // her Mistsplitter not ticked: the Dull Blade, though below her own build (not kept as it is)
    const leftOut = await run({
      optimizeWeapons: true,
      excludedWeapons: [mistsplitter.id],
    })
    expect(leftOut.weapons[ayaka]).toBe(dullBlade)
    expect(leftOut.after.total).toBeLessThan(leftOut.before.total)
    expect(leftOut.untickedWeapons).toBeUndefined()
    expect(leftOut.startUntickedWeapons).toEqual([ayaka])
    // with her weapon ticked, her own build stands
    const ticked = await run({ optimizeWeapons: true })
    expect(ticked.weapons[ayaka]).toBe(mistsplitter.id)
    expect(ticked.startUntickedWeapons).toBeUndefined()
  })

  it('gives a member whose requirement no build meets the closest build, and the weapon that deals the most', async () => {
    const { database, teamId, ayakaId } = setup()
    // Ayaka holds a Dull Blade; her Mistsplitter lies unequipped
    const mistsplitter = database.weapons.values.find(
      (w) => w.key === 'MistsplitterReforged'
    )!
    database.weapons.set(mistsplitter.id, { location: '' })
    const dullBlade = database.weapons.new({
      key: 'DullBlade',
      level: 1,
      ascension: 0,
      refinement: 1,
      location: ayaka,
      lock: false,
    })
    // 200% Energy Recharge: out of reach (only the ATK% pieces have some)
    const optConfigId = database.teamChars.get(ayakaId)!.optConfigId
    database.optConfigs.set(optConfigId, {
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 200, disabled: false },
        ],
      },
    })
    const result = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt: {
        ...initTeamOpt(),
        optimizeWeapons: true,
        attacks: { [ayaka]: [attack(['burst', 'cutting'], 19)] },
      },
      solve: bruteForce,
    }))!
    // not the weapon it held: neither gives Energy Recharge, so the one that deals the most
    expect(result.weapons[ayaka]).toBe(mistsplitter.id)
    expect(result.weapons[ayaka]).not.toBe(dullBlade)
    // the most Energy Recharge any build has (each slot's best piece), and the result says how
    // far that is from what it needs
    const er = (id: string) =>
      (database.arts.get(id)!.substats.find((sub) => sub.key === 'enerRech_')
        ?.accurateValue ?? 0) / 100
    const most =
      1 +
      allArtifactSlotKeys.reduce(
        (sum, slotKey) =>
          sum +
          Math.max(
            ...database.arts.values
              .filter((a) => a.slotKey === slotKey)
              .map((a) => er(a.id))
          ),
        0
      )
    expect(
      1 +
        Object.values(result.builds[ayaka]!).reduce(
          (sum, id) => sum + er(id!),
          0
        )
    ).toBeCloseTo(most, 6)
    expect(result.after.unmet[ayaka]).toEqual([0])
    const shortfalls = result.after.shortfalls?.[ayaka]
    expect(shortfalls).toHaveLength(1)
    expect(shortfalls![0].path).toEqual(['basic', 'enerRech_'])
    expect(shortfalls![0].min).toBeCloseTo(2, 9)
    expect(shortfalls![0].value).toBeCloseTo(most, 6)
    // and the run settles: the build stays from one round to the next
    expect(result.rounds).toBeLessThan(4)
  })

  it('of weapons worth the same, tries the strongest first', () => {
    const { database, teamId } = setup()
    // Shenhe's polearms: her own, then two that give her nothing more than a third would
    const member = teamOptMembers(database, teamId).find(
      (m) => m.characterKey === shenhe
    )!
    const current = database.chars.get(shenhe)!.equippedWeapon
    const make = (key: 'BeginnersProtector' | 'FavoniusLance', level: number) =>
      database.weapons.new({
        key,
        level,
        ascension: level > 80 ? 6 : 0,
        refinement: 1,
        location: '',
        lock: false,
      })
    const oneStar = make('BeginnersProtector', 1)
    const fourStar = make('FavoniusLance', 90)
    const candidates = teamOptWeaponCandidates(
      database,
      member,
      current,
      initTeamOpt(),
      new Set([ayaka, shenhe]),
      new Set()
    ).map((w) => w.id)
    expect(candidates[0]).toBe(current)
    expect(candidates.indexOf(fourStar)).toBeLessThan(
      candidates.indexOf(oneStar)
    )
  })

  it('reuses the solves already done: a second run on the same team solves nothing again', async () => {
    clearTeamOptSolveMemo()
    const { database, teamId } = setup()
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: { [ayaka]: [attack(['burst', 'cutting'], 19)] },
    }
    let calls = 0
    const counting: TeamOptSolver = (input) => {
      calls++
      return bruteForce(input)
    }
    const run = () =>
      optimizeTeam({ database, teamId, gender: 'F', teamOpt, solve: counting })
    const first = (await run())!
    expect(calls).toBeGreaterThan(0)
    calls = 0
    const second = (await run())!
    expect(calls).toBe(0)
    expect(second.builds).toEqual(first.builds)
    expect(second.after.total).toBeCloseTo(first.after.total, 6)
    // an artifact changes: the problems it is in are solved again
    const piece = database.arts.values.find((a) => a.location === '')!
    database.arts.set(piece.id, { level: 16 })
    calls = 0
    await run()
    expect(calls).toBeGreaterThan(0)
  })

  it('finds the next best team builds: one member changes at a time, best first', async () => {
    clearTeamOptSolveMemo()
    const { database, teamId } = setup()
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: {
        [ayaka]: [
          attack(['burst', 'cutting'], 19, [{ ...quill, hits: 7 }]),
          attack(['skill', 'press'], 2),
        ],
        [shenhe]: [attack(['skill', 'press'], 2)],
      },
    }
    /** The brute force, with the next builds too (`topN`) */
    const topBuilds: TeamOptSolver = async ({
      arts,
      objective,
      constraints,
      topN = 1,
    }) => {
      const bySlot = allArtifactSlotKeys.map((s) =>
        arts.filter((a) => a.slotKey === s)
      )
      const nodes = [objective, ...constraints.map((c) => c.value)]
      const all: { value: number; artifactIds: string[] }[] = []
      const rec = (i: number, picked: ICachedArtifact[]) => {
        if (i === bySlot.length) {
          const [value, ...cons] = evalAt(nodes, picked)
          if (constraints.every((c, j) => cons[j] >= c.min))
            all.push({ value, artifactIds: picked.map((a) => a.id) })
          return
        }
        for (const art of bySlot[i]) rec(i + 1, [...picked, art])
      }
      rec(0, [])
      all.sort((a, b) => b.value - a.value)
      const [best, ...more] = all.slice(0, topN)
      return best && { ...best, ...(more.length ? { more } : {}) }
    }
    const run = (builds: number) =>
      optimizeTeam({
        database,
        teamId,
        gender: 'F',
        teamOpt,
        solve: topBuilds,
        builds,
      })
    const one = (await run(1))!
    expect(one.alternatives).toBeUndefined()
    const three = (await run(3))!
    // the best build does not change
    expect(three.builds).toEqual(one.builds)
    const alternatives = three.alternatives!
    expect(alternatives).toHaveLength(2)
    expect(alternatives[0].after.total).toBeGreaterThanOrEqual(
      alternatives[1].after.total
    )
    for (const { builds, after, changed } of alternatives) {
      // no better than the best (no member can improve it alone)
      expect(after.total).toBeLessThanOrEqual(three.after.total * (1 + 1e-12))
      // one member's artifacts change, and no artifact goes to two members
      const differ = Object.keys(three.builds).filter(
        (ck) =>
          JSON.stringify(builds[ck as CharacterKey]) !==
          JSON.stringify(three.builds[ck as CharacterKey])
      )
      expect(differ).toEqual([changed])
      const used = Object.values(builds).flatMap((b) =>
        Object.values(b ?? {}).filter(Boolean)
      )
      expect(new Set(used).size).toBe(used.length)
    }
  })

  it('tries one of each set of identical weapon copies, the one that moves least', () => {
    const { database, teamId } = setup()
    const member = teamOptMembers(database, teamId).find(
      (m) => m.characterKey === ayaka
    )!
    const copy = (location: '' | CharacterKey, refinement = 1) =>
      database.weapons.new({
        key: 'DullBlade',
        level: 1,
        ascension: 0,
        refinement,
        location,
        lock: false,
      })
    database.chars.set('Keqing', {
      key: 'Keqing',
      level: 90,
      ascension: 6,
      talent: { auto: 1, skill: 1, burst: 1 },
      constellation: 0,
    })
    const onKeqing = copy('Keqing')
    const free = copy('')
    copy('')
    const r5 = copy('', 5)
    const teamOpt = { ...initTeamOpt(), optimizeWeapons: true }
    const candidates = teamOptWeaponCandidates(
      database,
      member,
      member.weaponId,
      teamOpt,
      new Set([ayaka, shenhe]),
      new Set()
    )
    const blades = candidates.filter((w) => w.key === 'DullBlade')
    // the R1 copies are one weapon (an unequipped one, rather than Keqing's), the R5 another
    expect(blades.map((w) => w.id).sort()).toEqual([free, r5].sort())
    expect(blades.some((w) => w.id === onKeqing)).toBe(false)
    // an energy setting on a copy makes it a weapon of its own
    const withEnergy = teamOptWeaponCandidates(
      database,
      member,
      member.weaponId,
      { ...teamOpt, weaponEnergy: { [onKeqing]: { [shenhe]: 10 } } },
      new Set([ayaka, shenhe]),
      new Set()
    )
    expect(withEnergy.filter((w) => w.key === 'DullBlade')).toHaveLength(3)
  })

  it('lists each attack’s hits with the damage the rotation counts for them', () => {
    const { database, teamId } = setup()
    const attacks: TeamOpt['attacks'] = {
      [ayaka]: [
        attack(['burst', 'cutting'], 19),
        // Shenhe's quills for its first 3 hits only
        attack(['skill', 'press'], 5, [
          { owner: shenhe, path: ['Shenhe', 'quill'], hits: 3 },
        ]),
      ],
    }
    const evaluation = evaluateTeamRotation(database, teamId, 'F', {
      arts: {},
      attacks,
    })!
    const hits = teamRotationHits(database, teamId, 'F', { attacks })!
    const runs = hits[ayaka]!
    expect(runs.map((r) => r.map((run) => run.hits))).toEqual([[19], [3, 2]])
    runs.forEach((attackRuns, i) =>
      expect(
        attackRuns.reduce((total, run) => total + run.hits * run.hit!.value, 0)
      ).toBeCloseTo(evaluation.attacks[ayaka]![i], 6)
    )
    // the hits without the quills deal less, and their formula is there to show
    expect(runs[1][1].hit!.value).toBeLessThan(runs[1][0].hit!.value)
    expect(runs[1][1].excluded).toEqual([
      { owner: shenhe, path: ['Shenhe', 'quill'] },
    ])
    expect(runs[0][0].hit!.meta).toBeTruthy()
  })

  it('shows one hit’s stats, and exactly what a buff gives the attacker', () => {
    const { database, teamId } = setup()
    const cutting = attack(['burst', 'cutting'], 19)
    const quillOff = attack(['burst', 'cutting'], 19, [{ ...quill, hits: 0 }])
    const on = attackHitData(database, teamId, 'F', {
      attack: cutting,
      characterKey: ayaka,
    })!
    const off = attackHitData(database, teamId, 'F', {
      attack: quillOff,
      characterKey: ayaka,
    })!
    // the hit is the rotation's: its damage per hit as evaluateTeamRotation counts it
    const evaluation = evaluateTeamRotation(database, teamId, 'F', {
      arts: {},
      attacks: { [ayaka]: [{ ...cutting, hits: 1 }] },
    })!
    expect(on.hit!.value).toBeCloseTo(evaluation.total, 6)
    expect(off.hit!.value).toBeLessThan(on.hit!.value)
    // its formula's parts: Ayaka's own Total ATK among them, at its value
    const { parts, multipliers } = hitFormulaParts(on.hit!)
    const atk = parts.find((p) => p.info.path === 'atk')
    // and the talent's multiplier, which has no name
    expect(multipliers.length).toBeGreaterThan(0)
    expect(atk?.value).toBeCloseTo(on.target.get(uiInput.total.atk).value, 6)
    // the quills give her something, and only what changed is listed
    const gains = statGains(on.target, off.target)
    expect(gains.length).toBeGreaterThan(0)
    expect(gains.every((g) => g.value !== 0)).toBe(true)
    expect(statGains(on.target, on.target)).toEqual([])
    // each part's terms add up to it (a capped value aside), and say where they come from
    for (const part of parts) {
      const terms = partTerms(part)
      if (!terms.length) continue
      const sum = terms.reduce((total, term) => total + term.value, 0)
      if (part.info.path === 'critRate_')
        expect(part.value).toBeLessThanOrEqual(sum + 1e-9)
      else expect(sum).toBeCloseTo(part.value, 6)
    }
    // the enemy's RES: its base, and Shenhe's burst lowering it
    const res = parts.find((p) => p.info.path === 'cryo_enemyRes_')!
    const resTerms = partTerms(res)
    expect(resTerms.map((t) => t.value)).toEqual(
      expect.arrayContaining([expect.closeTo(0.1, 6)])
    )
    expect(resTerms.some((t) => t.info.source === shenhe && t.value < 0)).toBe(
      true
    )
  })

  it('gives each member’s final stats with a result’s builds, and with the equipped ones', async () => {
    const { database, teamId } = setup()
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: { [ayaka]: [attack(['burst', 'cutting'], 19)] },
    }
    const result = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      solve: bruteForce,
    }))!
    const now = teamOptUIData(database, teamId, 'F', teamOpt)!
    const after = teamOptUIData(database, teamId, 'F', teamOpt, result)!
    const value = (
      data: { get: (n: NumNode) => { value: number } },
      n: NumNode
    ) => data.get(n).value
    // Ayaka starts in the ATK% pieces: the result gives her the crit ones
    expect(value(after[ayaka]!, input.total.critRate_)).toBeGreaterThan(
      value(now[ayaka]!, input.total.critRate_)
    )
    // with nothing changed, both are the same
    const same = teamOptUIData(database, teamId, 'F', teamOpt, {
      builds: Object.fromEntries(
        [ayaka, shenhe].map((key) => [
          key,
          Object.fromEntries(
            database.arts.values
              .filter((a) => a.location === key)
              .map((a) => [a.slotKey, a.id])
          ),
        ])
      ),
      weapons: {},
    })!
    for (const key of ['atk', 'critRate_', 'critDMG_', 'enerRech_'] as const)
      expect(value(same[ayaka]!, input.total[key])).toBeCloseTo(
        value(now[ayaka]!, input.total[key]),
        6
      )
  })

  it('tries a ticked weapon wherever it is, also on a character outside the team', async () => {
    const { database, teamId } = setup()
    const mistsplitter = database.weapons.values.find(
      (w) => w.key === 'MistsplitterReforged'
    )!
    // Keqing, outside the team, holds the Mistsplitter; Ayaka a Dull Blade
    database.chars.set('Keqing', {
      key: 'Keqing',
      level: 90,
      ascension: 6,
      talent: { auto: 1, skill: 1, burst: 1 },
      constellation: 0,
    })
    database.weapons.set(mistsplitter.id, { location: 'Keqing' })
    const dullBlade = database.weapons.new({
      key: 'DullBlade',
      level: 1,
      ascension: 0,
      refinement: 1,
      location: ayaka,
      lock: false,
    })
    expect(database.chars.get(ayaka)!.equippedWeapon).toBe(dullBlade)
    expect(database.weapons.get(mistsplitter.id)!.location).toBe('Keqing')
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      optimizeWeapons: true,
      // "Take from characters outside the team" is about artifacts: the chooser's ticks rule
      useOtherChars: false,
      excludedWeapons: [dullBlade],
      attacks: { [ayaka]: [attack(['burst', 'cutting'], 19)] },
    }
    const result = (await optimizeTeam({
      database,
      teamId,
      gender: 'F',
      teamOpt,
      solve: bruteForce,
    }))!
    expect(result.weapons[ayaka]).toBe(mistsplitter.id)
    expect(result.untickedWeapons).toBeUndefined()
  })

  it('lowers the Energy Recharge requirement of whoever wields an energy weapon', async () => {
    const { database, teamId, shenheId } = setup()
    const favonius = database.weapons.new({
      key: 'FavoniusLance',
      level: 90,
      ascension: 6,
      refinement: 5,
      location: '',
      lock: false,
    })
    // 250% Energy Recharge: out of reach with these artifacts, whatever the weapon
    database.optConfigs.set(database.teamChars.get(shenheId)!.optConfigId, {
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 250, disabled: false },
        ],
      },
    })
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      optimizeWeapons: true,
      attacks: {
        [ayaka]: [attack(['burst', 'cutting'], 19)],
        [shenhe]: [attack(['skill', 'press'], 2)],
      },
    }
    const run = (o: Partial<TeamOpt>) =>
      optimizeTeam({
        database,
        teamId,
        gender: 'F',
        teamOpt: { ...teamOpt, ...o },
        solve: bruteForce,
      }) as Promise<TeamOptResult>
    const without = await run({})
    expect(without.after.unmet[shenhe]?.length).toBe(1)
    // the Favonius Lance is worth 200% Energy Recharge to Shenhe: only with it is her
    // requirement met
    const relieved = await run({
      weaponEnergy: { [favonius]: { [shenhe]: 200 } },
    })
    expect(relieved.weapons[shenhe]).toBe(favonius)
    expect(relieved.after.unmet[shenhe]).toBeUndefined()
  })

  it('weighs what an energy weapon saves the rest of the team', async () => {
    const { database, teamId, ayakaId } = setup()
    const calamity = database.chars.get(shenhe)!.equippedWeapon
    const favonius = database.weapons.new({
      key: 'FavoniusLance',
      level: 90,
      ascension: 6,
      refinement: 5,
      location: '',
      lock: false,
    })
    // Ayaka needs 126% Energy Recharge: 4 of the ATK% pieces (6.5% each), instead of crit ones
    database.optConfigs.set(database.teamChars.get(ayakaId)!.optConfigId, {
      statFilters: {
        [JSON.stringify(['basic', 'enerRech_'])]: [
          { value: 126, disabled: false },
        ],
      },
    })
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      optimizeWeapons: true,
      attacks: {
        [ayaka]: [attack(['burst', 'cutting'], 19)],
        [shenhe]: [attack(['skill', 'press'], 2)],
      },
    }
    const run = (o: Partial<TeamOpt>) =>
      optimizeTeam({
        database,
        teamId,
        gender: 'F',
        teamOpt: { ...teamOpt, ...o },
        solve: bruteForce,
      }) as Promise<TeamOptResult>
    const ayakaEr = (result: TeamOptResult) =>
      Object.values(result.builds[ayaka]!)
        .map((id) => database.arts.get(id!)!)
        .filter((art) => art.setKey === 'NoblesseOblige').length
    // Shenhe's own hits and quills are bigger with her Calamity Queller
    const without = await run({})
    expect(without.weapons[shenhe]).toBe(calamity)
    expect(ayakaEr(without)).toBeGreaterThanOrEqual(4)
    expect(without.after.unmet[ayaka]).toBeUndefined()
    expect(without.energy?.[ayaka]).toBeUndefined()
    // Shenhe's Favonius Lance gives Ayaka the energy of 26% Energy Recharge: Ayaka keeps her crit
    // pieces, which is worth more to the team than the Calamity Queller is
    const weaponEnergy = { [favonius]: { [ayaka]: 26 } }
    const relieved = await run({ weaponEnergy })
    expect(relieved.weapons[shenhe]).toBe(favonius)
    expect(ayakaEr(relieved)).toBe(0)
    expect(relieved.after.unmet[ayaka]).toBeUndefined()
    expect(relieved.after.total).toBeGreaterThan(without.after.total)
    expect(relieved.energy?.[ayaka]).toEqual({
      relief: 26,
      weaponIds: [favonius],
    })

    // Wielding it already, Shenhe keeps it: without it Ayaka would need her ATK% pieces again
    database.weapons.set(favonius, { location: shenhe })
    expect(database.chars.get(shenhe)!.equippedWeapon).toBe(favonius)
    const kept = await run({ weaponEnergy })
    expect(kept.weapons[shenhe]).toBe(favonius)
    expect(ayakaEr(kept)).toBe(0)
    expect(kept.after.unmet[ayaka]).toBeUndefined()
    expect(kept.after.total).toBeGreaterThan(without.after.total)
  })
})
