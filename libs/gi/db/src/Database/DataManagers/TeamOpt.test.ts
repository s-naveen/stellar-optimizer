import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { IGOOD } from '@genshin-optimizer/gi/good'
import { ArtCharDatabase } from '../ArtCharDatabase'
import type { IGO } from '../exim'
import van from '../Van_2025-07-16_19-59-13.json'
import type { TeamOpt } from './TeamOpt'
import { initTeamOpt, validateTeamOpt } from './TeamOpt'

/** A team's fields (`id` is the cache's), as before Team Optimize */
const teamKeys = [
  'conditional',
  'description',
  'enemyOverride',
  'id',
  'lastEdit',
  'loadoutData',
  'name',
]
const good = () => structuredClone(van) as unknown as IGOOD & IGO

describe('team.teamOpt (Team Optimize settings)', () => {
  it('is not added to teams without it (GOOD import)', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.importGOOD(good(), false, false, false)
    expect(database.teams.values.length).toBe(van.teams.length)
    for (const team of database.teams.values)
      expect(Object.keys(team).sort()).toEqual(teamKeys)
    // nor to what is stored
    for (const key of database.teams.keys)
      expect(JSON.stringify(database.storage.get(key))).not.toContain('teamOpt')
  })

  it('drops values that are not settings, without adding the field', () => {
    const database = new ArtCharDatabase(1, new SandboxStorage())
    for (const teamOpt of ['x', 3, true, null, [], undefined]) {
      const id = database.teams.new({ teamOpt } as never)
      expect(Object.keys(database.teams.get(id)!).sort()).toEqual(teamKeys)
    }
  })

  it('cleans up settings', () => {
    expect(
      validateTeamOpt({
        attacks: {
          KamisatoAyaka: [
            { path: ['skill', 'press'], hits: 'x', onField: 'Nobody' },
            {
              path: ['burst', 'cutting'],
              hits: 19,
              hitMode: 'nope',
              reaction: 'melt',
              limits: [
                { owner: 'Shenhe', path: ['Shenhe', 'quill'], hits: 7 },
                { owner: 'Nobody', path: ['x'], hits: 1 },
                { owner: 'team', path: [], hits: 1 },
              ],
              states: [
                { owner: 'Shenhe', path: ['Shenhe', 'asc1'], value: 'field' },
                { owner: 'Nobody', path: ['x'], value: 'on' },
                { owner: 'team', path: ['reaction', 'x'], value: '' },
              ],
              onField: 'Shenhe',
            },
            { hits: 2 },
          ],
          NotAChar: [{ path: ['a'], hits: 1 }],
        },
        keep: ['Shenhe', 'NotAChar'],
        onField: 'NotAChar',
        rotationTime: 21.5,
        bonusStats: {
          team: { atk_: 20, critRate_: 'x', nope: 3 },
          KamisatoAyaka: { normal_dmg_: 15 },
          NotAChar: { atk: 100 },
          Shenhe: {},
        },
        levelLow: 99,
        levelHigh: -5,
        // per weapon, per member (an older single number per weapon is dropped)
        weaponEnergy: {
          weapon_1: { Shenhe: 20, NotAChar: 5, KamisatoAyaka: -3 },
          weapon_2: 30,
          weapon_3: { Shenhe: 900, KamisatoAyaka: 'x' },
          weapon_4: {},
        },
        junk: true,
      })
    ).toEqual({
      ...initTeamOpt(),
      attacks: {
        KamisatoAyaka: [
          { path: ['skill', 'press'], hits: 1, hitMode: 'avgHit' },
          {
            path: ['burst', 'cutting'],
            hits: 19,
            hitMode: 'avgHit',
            reaction: 'melt',
            limits: [{ owner: 'Shenhe', path: ['Shenhe', 'quill'], hits: 7 }],
            states: [
              { owner: 'Shenhe', path: ['Shenhe', 'asc1'], value: 'field' },
            ],
            onField: 'Shenhe',
          },
        ],
      },
      keep: ['Shenhe'],
      levelLow: 0,
      levelHigh: 20,
      weaponEnergy: { weapon_1: { Shenhe: 20 }, weapon_3: { Shenhe: 500 } },
      bonusStats: { team: { atk_: 20 }, KamisatoAyaka: { normal_dmg_: 15 } },
      rotationTime: 21.5,
    })
  })

  it('preserves snapshot and reaction contributor context, including explicitly inactive buffs', () => {
    const settings = initTeamOpt()
    settings.attacks = {
      KamisatoAyaka: [
        {
          path: ['reaction', 'stellarswirl'],
          hits: 1,
          hitMode: 'avgHit',
          reactionContributors: ['KamisatoAyaka', 'Shenhe'],
          talentMultiplier: 1.237,
          reactionContributorStates: {
            Shenhe: [{ owner: 'Shenhe', path: ['Shenhe', 'quill'], value: '' }],
          },
          statSnapshots: [
            {
              stat: 'atk_',
              characterKey: 'Shenhe',
              recipient: 'KamisatoAyaka',
              path: ['premod', 'atk_'],
              onField: 'KamisatoAyaka',
              states: [
                {
                  owner: 'Shenhe',
                  path: ['NoblesseOblige', 'set4'],
                  value: '',
                },
              ],
            },
          ],
        },
      ],
    }
    const database = new ArtCharDatabase(1, new SandboxStorage())
    const id = database.teams.new({ teamOpt: settings })
    expect(database.teams.get(id)!.teamOpt!.attacks).toEqual(settings.attacks)
    const restored = new ArtCharDatabase(1, new SandboxStorage())
    restored.importGOOD(database.exportGOOD(), false, false, false)
    expect(restored.teams.values[0].teamOpt!.attacks).toEqual(settings.attacks)
  })

  it('keeps KQM constellations of 0 to 6 for known characters only', () => {
    const kqm = validateTeamOpt({
      kqm: {
        refinement5: 1,
        refinement4: 5,
        constellations: { Ayaka: 9, KamisatoAyaka: 2, Fischl: 0, Nope: 1 },
      },
    })?.kqm
    expect(kqm?.constellations).toEqual({ KamisatoAyaka: 2, Fischl: 0 })
    expect(
      validateTeamOpt({
        kqm: { refinement5: 1, refinement4: 5, constellations: { Fischl: 7 } },
      })?.kqm?.constellations
    ).toBeUndefined()
  })
  it('keeps a Battle Pass weapon refinement of R1 to R5 only', () => {
    const kqm = (refinementBp: unknown) =>
      validateTeamOpt({ kqm: { refinement5: 1, refinement4: 5, refinementBp } })
        ?.kqm
    expect(kqm(3)?.refinementBp).toBe(3)
    for (const bad of [0, 6, 2.5, 'R3', undefined])
      expect(kqm(bad)?.refinementBp).toBeUndefined()
    expect(kqm(9)?.refinement4).toBe(5)
  })
  it('drops rotation times that are not durations', () => {
    for (const rotationTime of [-3, 0, 'x', Number.NaN, 9999])
      expect(validateTeamOpt({ rotationTime })?.rotationTime).toBeUndefined()
    expect(validateTeamOpt({ rotationTime: 20 })?.rotationTime).toBe(20)
  })

  it('round-trips through a GOOD export and import', () => {
    const first = new ArtCharDatabase(1, new SandboxStorage())
    first.importGOOD(good(), false, false, false)
    const [teamId] = first.teams.keys
    first.teams.set(teamId, (team) => {
      team.teamOpt = {
        ...initTeamOpt(),
        attacks: {
          KamisatoAyaka: [
            {
              path: ['burst', 'cutting'],
              hits: 19,
              hitMode: 'avgHit',
              limits: [{ owner: 'Shenhe', path: ['Shenhe', 'quill'], hits: 7 }],
            },
          ],
        },
        keep: ['Shenhe'],
      }
    })
    const exported = first.exportGOOD()
    const second = new ArtCharDatabase(1, new SandboxStorage())
    second.importGOOD(
      structuredClone(exported) as IGOOD & IGO,
      false,
      false,
      false
    )
    const again = second.exportGOOD()
    expect(again.teams).toEqual(exported.teams)
    expect(
      (again.teams as { teamOpt?: unknown }[]).filter((t) => t.teamOpt).length
    ).toBe(1)
  })

  it('preserves calculator assumptions and ER targets through export and import', () => {
    const first = new ArtCharDatabase(1, new SandboxStorage())
    first.importGOOD(good(), false, false, false)
    const [id] = first.teams.keys
    const member = {
      fieldTime: 50,
      burstEvery: 2,
      skillMode: 0,
      skillUses: 1.5,
      secondaryMode: 0,
      secondaryUses: 0,
      funnelShare: 100,
      favoniusProcs: 1,
      weaponEnergyTriggers: 2,
      flatEnergy: -15,
    }
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      kqm: {
        refinement5: 1,
        refinement4: 5,
        energyRecharge: { KamisatoAyaka: 180, Shenhe: 160 },
        energySource: 'calculator',
        energyCalculator: {
          rotationTime: 20,
          clearTime: 90,
          enemyParticles: 9,
          rng: 'safe',
          electroInterval: 5.5,
          members: {
            KamisatoAyaka: { ...member, catchBy: 'Shenhe' },
            Shenhe: { ...member },
          },
        },
      },
    }
    first.teams.set(id, { teamOpt })
    expect(first.teams.get(id)!.teamOpt).toEqual(teamOpt)
    const second = new ArtCharDatabase(1, new SandboxStorage())
    second.importGOOD(first.exportGOOD() as IGOOD & IGO, false, false, false)
    expect(second.teams.get(id)!.teamOpt).toEqual(teamOpt)
  })

  it('round-trips every setting through a GOOD export and import', () => {
    const teamOpt: TeamOpt = {
      ...initTeamOpt(),
      attacks: {
        KamisatoAyaka: [
          {
            path: ['burst', 'cutting'],
            hits: 19,
            hitMode: 'avgHit',
            reaction: 'melt',
            limits: [{ owner: 'Shenhe', path: ['Shenhe', 'quill'], hits: 7 }],
            states: [
              { owner: 'Shenhe', path: ['Shenhe', 'asc1'], value: 'field' },
            ],
            onField: 'Shenhe',
            bonusStats: { burst_dmg_: 30, atk: 100 },
          },
          { path: ['skill', 'press'], hits: 2.5, hitMode: 'critHit' },
        ],
      },
      keep: ['Shenhe'],
      useOtherChars: true,
      useExcludedArts: true,
      levelLow: 16,
      levelHigh: 20,
      assumeMaxMain: true,
      optimizeWeapons: true,
      excludedWeapons: ['weapon_9'],
      weaponEnergy: { weapon_1: { Shenhe: 20, KamisatoAyaka: 12.5 } },
      onField: 'Shenhe',
      bonusStats: { team: { atk_: 20 }, Shenhe: { eleMas: 100 } },
      rotationTime: 21.5,
      topN: 3,
      kqm: {
        refinement5: 1,
        refinement4: 5,
        energyRecharge: { KamisatoAyaka: 180, Shenhe: 160 },
      },
    }
    const first = new ArtCharDatabase(1, new SandboxStorage())
    first.importGOOD(good(), false, false, false)
    const [teamId] = first.teams.keys
    first.teams.set(teamId, { teamOpt })
    // nothing is dropped on the way in
    expect(first.teams.get(teamId)!.teamOpt).toEqual(teamOpt)
    const exported = first.exportGOOD()
    const second = new ArtCharDatabase(1, new SandboxStorage())
    second.importGOOD(
      structuredClone(exported) as IGOOD & IGO,
      false,
      false,
      false
    )
    const again = second.exportGOOD()
    expect(again.teams).toEqual(exported.teams)
    const roundTripped = (again.teams as { teamOpt?: TeamOpt }[]).find(
      (t) => t.teamOpt
    )?.teamOpt
    expect(roundTripped).toEqual(teamOpt)
  })

  it('keeps a team build count of 2 to 5 only (absent: 1, never stored)', () => {
    for (const [topN, kept] of [
      [3, 3],
      [5, 5],
      [1, undefined],
      [6, undefined],
      [2.5, undefined],
      ['3', undefined],
    ] as const)
      expect(validateTeamOpt({ ...initTeamOpt(), topN })?.topN).toBe(kept)
    expect('topN' in validateTeamOpt(initTeamOpt())!).toBe(false)
  })

  it('loads a save from before the newer settings', () => {
    const old = good()
    // a team saved before per-member energy, on-field, buff states, extra buffs and DPS
    ;(old.teams as unknown as Record<string, unknown>[])[0].teamOpt = {
      attacks: {
        KamisatoAyaka: [
          { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
        ],
      },
      keep: [],
      useOtherChars: false,
      useExcludedArts: false,
      levelLow: 20,
      levelHigh: 20,
      assumeMaxMain: false,
      optimizeWeapons: true,
      excludedWeapons: [],
      weaponEnergy: { weapon_1: 30 },
    }
    const database = new ArtCharDatabase(1, new SandboxStorage())
    database.importGOOD(old, false, false, false)
    const loaded = database.teams.values.find((t) => t.teamOpt)!.teamOpt!
    expect(loaded).toEqual({
      ...initTeamOpt(),
      attacks: {
        KamisatoAyaka: [
          { path: ['burst', 'cutting'], hits: 19, hitMode: 'avgHit' },
        ],
      },
      optimizeWeapons: true,
    })
    // and none of the newer settings is made up
    for (const key of ['onField', 'bonusStats', 'rotationTime'] as const)
      expect(key in loaded).toBe(false)
  })
})
