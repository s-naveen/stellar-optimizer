import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOptAttack } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, validateTeamOpt } from '@genshin-optimizer/gi/db'
import { describe, expect, it } from 'vitest'
import { evaluateTeamRotation } from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

function baizhu() {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  db.chars.set('Baizhu', {
    key: 'Baizhu',
    level: 90,
    ascension: 6,
    constellation: 0,
    talent: { auto: 9, skill: 9, burst: 9 },
  })
  const teamCharId = db.teamChars.new('Baizhu', {})
  const buildTcId = db.buildTcs.new({
    characterKey: 'Baizhu',
    character: {
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 9, skill: 9, burst: 9 },
    },
    weapon: { key: 'PrototypeAmber', level: 90, ascension: 6, refinement: 1 },
    artifact: {
      slots: {},
      substats: { type: 'max', stats: {}, rarity: 5 },
      sets: { OceanHuedClam: 4 },
    },
  } as never)
  const teamId = db.teams.new({
    loadoutData: [{ teamCharId, buildType: 'tc', buildTcId }] as LoadoutDatum[],
  } as never)
  return { db, teamId, buildTcId }
}

it('gains Pale Flame only from eligible skill damage, shares the gain cooldown and expires refreshed stacks on the wearer clock', () => {
  const kit: KitModel = {
    characterKey: 'Razor',
    element: 'electro',
    source: 'test',
    act(c) {
      for (const t of [0, 10, 18, 500])
        c.hit(t, {
          path: ['skill', 'press'],
          tag: 'skill',
          element: 'electro',
          label: `Skill ${t}`,
        })
      c.hit(300, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 10,
        label: 'Pause',
      })
      for (const t of [1, 11, 19, 447, 448, 501])
        c.hit(t, {
          path: ['normal', '0'],
          tag: 'normal',
          element: 'physical',
          label: `Normal ${t}`,
        })
      return { frames: 600 }
    },
  }
  const sim = simulateRotation({
    rotation: parseRotation('Razor E', [
      { characterKey: 'Razor', name: 'Razor' },
    ]),
    members: ['Razor'],
    constellations: {},
    elements: { Razor: 'electro' },
    kits: { Razor: kit },
    gear: { Razor: { sets: { PaleFlame: 4 } } },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })
  const attacks = rotationAttacks(sim, () => '2').Razor!
  const stacks = (label: string) =>
    attacks
      .find((a) => a.description === label)
      ?.states?.find((s) => s.path[0] === 'PaleFlame')?.value ?? ''
  expect(stacks('Skill 0')).toBe('')
  expect(stacks('Skill 18')).toBe('1')
  expect([1, 11, 19, 447, 448, 501].map((t) => stacks(`Normal ${t}`))).toEqual([
    '1',
    '1',
    '',
    '',
    '',
    '1',
  ])
  expect(
    attacks.find((a) => a.description === 'Normal 19')?.limits
  ).toBeUndefined() // two stacks match saved defaults
  expect(
    attacks.find((a) => a.description === 'Normal 448')?.limits
  ).toContainEqual({ owner: 'Razor', path: ['PaleFlame', 'stacks'], hits: 0 })
})
const foam = (count: number): TeamOptAttack => ({
  path: ['artifact:OceanHuedClam', 'heal'],
  hits: 1,
  hitMode: 'avgHit',
  healing: [{ path: ['skill', 'heal'], count }],
})
const damage = (db: ArtCharDatabase, teamId: string, attack: TeamOptAttack) =>
  evaluateTeamRotation(db, teamId, 'F', {
    arts: {},
    attacks: { Baizhu: [attack] },
  })!.total

describe('Sea-Dyed Foam', () => {
  it('persists healing contributions and rejects malformed amounts', () => {
    expect(
      validateTeamOpt({ attacks: { Baizhu: [foam(4)] } })?.attacks.Baizhu?.[0]
        .healing
    ).toEqual(foam(4).healing)
    for (const count of [0, -1, Number.POSITIVE_INFINITY, Number.NaN])
      expect(
        validateTeamOpt({ attacks: { Baizhu: [foam(count)] } })?.attacks
          .Baizhu?.[0].healing
      ).toBeUndefined()
  })

  it('keeps a healing-based Clam rotation through a GOOD export and import', () => {
    const { db, teamId } = baizhu()
    db.teams.set(teamId, {
      teamOpt: {
        ...validateTeamOpt({}),
        attacks: { Baizhu: [foam(4)] },
      } as never,
    })
    const next = new ArtCharDatabase(2, new SandboxStorage({}))
    next.importGOOD(db.exportGOOD(), false, false, false)
    expect(
      next.teams.get(teamId)?.teamOpt?.attacks.Baizhu?.[0].healing
    ).toEqual(foam(4).healing)
    expect(
      damage(next, teamId, next.teams.get(teamId)!.teamOpt!.attacks.Baizhu![0])
    ).toBeCloseTo(damage(db, teamId, foam(4)), 8)
  })

  it('scales with healing stats, caps accumulated healing, and deals no damage without four Clam pieces', () => {
    const { db, teamId, buildTcId } = baizhu()
    const low = damage(db, teamId, foam(1))
    expect(low).toBeGreaterThan(0)
    db.buildTcs.set(buildTcId, (tc) => {
      tc.artifact.substats.stats = { hp: 30000 }
    })
    const high = damage(db, teamId, foam(1))
    expect(high).toBeGreaterThan(low)
    const capped = damage(db, teamId, foam(100))
    expect(capped).toBeCloseTo(27000 * 0.9, 5) // the default enemy has 10% Physical RES
    db.buildTcs.set(buildTcId, (tc) => {
      tc.artifact.sets = {}
    })
    expect(damage(db, teamId, foam(100))).toBe(0)
  })

  it('includes healing contributions in rotation grouping and does not merge different bubbles', () => {
    const heal = foam(1).healing!
    const sim = {
      hits: [1, 2].map((count) => ({
        t: count,
        characterKey: 'Baizhu' as const,
        path: foam(1).path,
        tag: 'other' as const,
        element: 'physical' as const,
        label: 'Sea-Dyed Foam',
        healing: [{ ...heal[0], count }],
      })),
      frames: 100,
      start: 0,
      buffWindows: [],
      countedBuffs: [],
      actions: [],
      notes: [],
      warnings: [],
      unsupported: [],
    }
    expect(
      rotationAttacks(sim).Baizhu?.map((a) => a.healing?.[0].count)
    ).toEqual([1, 2])
  })

  it('collects Baizhu heals into bubbles with a three-second duration and 3.5-second cooldown', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Baizhu E Q W10', [
        { characterKey: 'Baizhu', name: 'Baizhu' },
      ]),
      members: ['Baizhu'],
      constellations: {},
      elements: { Baizhu: 'dendro' },
      repeats: 1,
      gear: { Baizhu: { sets: { OceanHuedClam: 4 } } },
    })
    const bubbles = sim.hits.filter((h) => h.label === 'Sea-Dyed Foam')
    expect(bubbles.length).toBeGreaterThan(1)
    expect(bubbles[0].t).toBe(160 + 180 + 1)
    expect(bubbles.every((h) => h.healing?.length)).toBe(true)
    expect(bubbles.slice(1).every((h, i) => h.t - bubbles[i].t >= 210)).toBe(
      true
    )
  })
})

describe('rotation gear activation', () => {
  it('activates Desert Pavilion only after charged damage and expires it after fifteen seconds', () => {
    const kit: KitModel = {
      characterKey: 'Varka',
      element: 'anemo',
      source: 'test',
      act(c) {
        for (const t of [0, 10, 20, 920])
          c.hit(t, {
            path: t === 10 ? ['charged', 'dmg1'] : ['normal', 'na1'],
            tag: t === 10 ? 'charged' : 'normal',
            element: 'physical',
            label: `Probe ${t}`,
          })
        return { frames: 1000 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation('Varka E', [
        { characterKey: 'Varka', name: 'Varka' },
      ]),
      members: ['Varka'],
      elements: { Varka: 'anemo' },
      constellations: {},
      repeats: 1,
      kits: { Varka: kit },
      gear: { Varka: { sets: { DesertPavilionChronicle: 4 } } },
    })
    const attacks = rotationAttacks(sim).Varka!
    const state = (name: string) =>
      attacks
        .find((a) => a.description === name)
        ?.states?.find((s) => s.path[0] === 'DesertPavilionChronicle')?.value
    expect(state('Probe 0') ?? '').toBe('')
    expect(state('Probe 10') ?? '').toBe('')
    expect(state('Probe 20')).toBe('on')
    expect(state('Probe 920') ?? '').toBe('')
  })
  it('refreshes the whole Marechaussee stack duration after HP changes', () => {
    const party = ['Neuvillette'] as const
    const kit: KitModel = {
      characterKey: 'Neuvillette',
      element: 'hydro',
      source: 'test',
      act(ctx) {
        for (const t of [0, 100, 200, 450, 800])
          ctx.hit(t, {
            path: ['_marker', 'hpChange'],
            tag: 'other',
            element: 'hydro',
            label: 'HP',
          })
        return { frames: 1200 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation(
        'Neuvillette E',
        party.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: [...party],
      constellations: {},
      elements: { Neuvillette: 'hydro' },
      repeats: 1,
      kits: { Neuvillette: kit },
      gear: { Neuvillette: { sets: { MarechausseeHunter: 4 } } },
    })
    const windows = sim.buffWindows.filter(
      (w) => w.path[0] === 'MarechausseeHunter'
    )
    expect(windows.map((w) => [w.start, w.end, w.value])).toEqual([
      [0, 300, '1'],
      [100, 400, '2'],
      [200, 500, '3'],
      [450, 750, '3'],
      [800, 1100, '1'],
    ])
  })

  it('starts Reverie at full strength, decays without Burning, and recovers while off field', () => {
    const members: CharacterKey[] = ['Emilie', 'Amber']
    const kit: KitModel = {
      characterKey: 'Emilie',
      element: 'dendro',
      source: 'test',
      act(ctx) {
        ctx.hit(800, {
          path: ['normal', '0'],
          tag: 'normal',
          element: 'dendro',
          applies: true,
          label: 'Dendro',
        })
        ctx.hit(810, {
          characterKey: 'Amber',
          path: ['normal', '0'],
          tag: 'normal',
          element: 'pyro',
          applies: true,
          label: 'Burning',
        })
        return { frames: 1 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation(
        'Emilie E -> Amber W18',
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      constellations: {},
      elements: { Emilie: 'dendro', Amber: 'pyro' },
      repeats: 1,
      kits: {
        Emilie: kit,
        Amber: { ...kit, characterKey: 'Amber', act: () => ({ frames: 1 }) },
      },
      gear: { Emilie: { sets: { UnfinishedReverie: 4 } } },
    })
    const stacks = sim.buffWindows.filter(
      (w) => w.path[0] === 'UnfinishedReverie'
    )
    expect(stacks.slice(0, 6).map((w) => [w.start, w.value])).toEqual([
      [0, '5'],
      [360, '4'],
      [450, '3'],
      [540, '2'],
      [630, '1'],
      [720, ''],
    ])
    expect(stacks.some((w) => w.start >= 810 && w.value === '1')).toBe(true)
    expect(stacks.some((w) => w.start >= 900 && Number(w.value) >= 2)).toBe(
      true
    )
  })

  it('models Sacrificial refinement and on-field eligibility deterministically', () => {
    const kit: KitModel = {
      characterKey: 'Mona',
      element: 'hydro',
      source: 'test',
      act(ctx) {
        for (const delay of [10, 20, 30])
          ctx.hit(delay, {
            path: ['skill', 'dot'],
            tag: 'skill',
            element: 'hydro',
            label: 'Skill',
          })
        return { frames: 40, cooldown: { key: 'skill', frames: 600 } }
      },
    }
    const config = {
      rotation: parseRotation('Mona E E', [
        { characterKey: 'Mona' as const, name: 'Mona' },
      ]),
      members: ['Mona' as const],
      constellations: {},
      elements: { Mona: 'hydro' as const },
      repeats: 1,
      kits: { Mona: kit },
      gear: { Mona: { weapon: 'SacrificialFragments', refinement: 3 } },
    }
    const sim = simulateRotation(config)
    expect(sim.actions.map((a) => a.start)).toEqual([0, 40])
    expect(sim.notes.some((n) => n.includes('actual random procs'))).toBe(true)
    expect(simulateRotation(config)).toEqual(sim)
  })
})

describe('Hakushin Ring', () => {
  it('expires after six seconds and overrides a saved always-on conditional', () => {
    const kit: KitModel = {
      characterKey: 'Nahida',
      element: 'dendro',
      source: 'test',
      act(ctx) {
        ctx.hit(0, {
          path: ['_reaction', 'quicken'],
          tag: 'other',
          element: 'dendro',
          label: 'Quicken',
        })
        for (const t of [20, 400])
          ctx.hit(t, {
            path: ['skill', 'press'],
            tag: 'skill',
            element: 'dendro',
            label: 'Skill',
          })
        return { frames: 500 }
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation('Nahida E', [
        { characterKey: 'Nahida', name: 'Nahida' },
      ]),
      members: ['Nahida'],
      constellations: {},
      elements: { Nahida: 'dendro' },
      repeats: 1,
      kits: { Nahida: kit },
      reactions: { onHit() {} },
      gear: { Nahida: { weapon: 'HakushinRing', refinement: 5 } },
    })
    const attacks = rotationAttacks(sim, () => 'dendro').Nahida!
    expect(attacks).toHaveLength(2)
    expect(attacks[0].limits).toBeUndefined()
    expect(attacks[1].limits).toContainEqual({
      owner: 'Nahida',
      path: ['HakushinRing', 'SakuraSaiguu'],
      hits: 0,
    })
  })
})
