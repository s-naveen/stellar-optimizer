import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type TeamOptAttack } from '@genshin-optimizer/gi/db'
import { attackHitData } from '../util/teamOpt/objective'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { annulusHitChance } from '../util/teamOpt/rotation/kits/common'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const run = (
  text: string,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) => {
  const members: CharacterKey[] = extra.members ?? ['Mona']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Mona: 'hydro', Ganyu: 'cryo', Rosaria: 'cryo', Kaeya: 'cryo' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    ...extra,
  })
}

it('consumes Layla C4 separately for each recipient three frames after a normal or charged hit', () => {
  const probe = (
    characterKey: 'Kaeya' | 'Mona',
    times: number[]
  ): KitModel => ({
    characterKey,
    element: characterKey === 'Kaeya' ? 'cryo' : 'hydro',
    source: 'test',
    onStart(c) {
      for (const t of times)
        c.hit(t, {
          path: ['normal', '0'],
          tag: t === 402 ? 'charged' : 'normal',
          element: 'physical',
          label: `${characterKey} C4 probe`,
        })
    },
    act: () => ({ frames: 1 }),
  })
  const sim = run('Layla E W11', {
    members: ['Layla', 'Kaeya', 'Mona'],
    constellations: { Layla: 6 },
    kits: {
      Layla: kitModels.Layla,
      Kaeya: probe('Kaeya', [400, 402, 404]),
      Mona: probe('Mona', [500, 504]),
    },
    reactions: { onHit() {} },
  })
  const states = (member: CharacterKey) =>
    sim.hits
      .filter((h) => h.label === `${member} C4 probe`)
      .map((h) => h.states?.find((s) => s.path[1] === 'c4Active')?.value)
  expect(states('Kaeya')).toEqual(['on', 'on', ''])
  expect(states('Mona')).toEqual(['on', ''])
})

it('gains two Layla Night Stars from a party skill while the shield is active', () => {
  const probe: KitModel = {
    characterKey: 'Kaeya',
    element: 'cryo',
    source: 'test',
    act: () => ({ frames: 1 }),
  }
  const sim = run('Layla E -> Kaeya E W1 E W6', {
    members: ['Layla', 'Kaeya'],
    constellations: { Layla: 6 },
    kits: { Layla: kitModels.Layla, Kaeya: probe },
    reactions: { onHit() {} },
  })
  const second = sim.actions.filter(
    (a) => a.characterKey === 'Kaeya' && a.text === 'E'
  )[1]
  expect(sim.hits.find((h) => h.label === 'Shooting Star 1')?.t).toBe(
    second.start + 36 + 35
  )
})

it('expires an unused Layla C4 on the recipient clock without letting skill damage consume it', () => {
  const probe: KitModel = {
    characterKey: 'Kaeya',
    element: 'cryo',
    source: 'test',
    onStart(c) {
      c.hit(400, {
        path: ['skill', 'dmg'],
        tag: 'skill',
        element: 'cryo',
        label: 'Skill does not consume',
      })
      c.hit(500, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 10,
        label: 'Recipient pause',
      })
      for (const t of [532, 533])
        c.hit(t, {
          path: ['normal', '0'],
          tag: 'normal',
          element: 'physical',
          label: 'Expiry probe',
        })
    },
    act: () => ({ frames: 1 }),
  }
  const sim = run('Layla E W11', {
    members: ['Layla', 'Kaeya'],
    constellations: { Layla: 6 },
    kits: { Layla: kitModels.Layla, Kaeya: probe },
    reactions: { onHit() {} },
  })
  // First launch grants C4 at 343. Its original expiry is 523, extended by
  // Kaeya's ten paused frames; Layla's clock does not share that pause.
  expect(
    sim.hits
      .filter((h) => h.label === 'Expiry probe')
      .map((h) => h.states?.find((s) => s.path[1] === 'c4Active')?.value)
  ).toEqual(['on', ''])
})

it('targets Ganyu shards once per mark interval and models only collateral hits between them', () => {
  expect(annulusHitChance(2, 2.4, 0.5, 9.5, 2.5)).toBeCloseTo(2 / 9)
  const sim = run('Ganyu Q W17', { members: ['Ganyu'] })
  const hits = sim.hits.filter((h) => h.label === 'Celestial Shower')
  expect(hits).toHaveLength(18)
  expect(hits[0].t).toBe(130)
  expect(
    hits.every((h) =>
      h.statSnapshots?.some((s) => s.stat === 'atk' && s.t === 0)
    )
  ).toBe(true)
})
it('applies Omen during Mona’s intact bubble and keeps Frozen damage from popping it early', () => {
  const sim = run('Mona Q W15', {
    reactions: { onHit() {}, frozenAt: () => true },
  })
  expect(sim.hits.find((h) => h.label === 'Illusory Bubble (Initial)')?.t).toBe(
    107
  )
  expect(
    sim.hits.find((h) => h.label === 'Illusory Bubble (explosion)')?.t
  ).toBe(588)
  const omen = sim.buffWindows.find(
    (w) => w.path[1] === 'Omen' && w.value === 'on'
  )!
  expect(omen.start).toBe(107)
  // (a gcsim status is still active on its expiry frame: the window ends one frame after it)
  expect(omen.end).toBe(888)
})
it('lets a damaging transformative reaction pop an unfrozen bubble, while ignoring markers', () => {
  const original = kitModels.Mona!
  const probe: KitModel = {
    ...original,
    onStart(c) {
      c.hit(120, {
        path: ['_reaction', 'electroCharged'],
        tag: 'other',
        element: 'electro',
        label: 'Marker',
      })
      c.hit(130, {
        path: ['reaction', 'electrocharged'],
        tag: 'other',
        element: 'electro',
        label: 'Electro-Charged',
      })
    },
  }
  const sim = run('Mona Q W7', {
    kits: { Mona: probe },
    reactions: { onHit() {}, frozenAt: () => false },
  })
  expect(
    sim.hits.find((h) => h.label === 'Illusory Bubble (explosion)')?.t
  ).toBe(131)
  expect(
    sim.buffWindows.find((w) => w.path[1] === 'Omen' && w.value === 'on')?.end
  ).toBe(431)
})
it('keeps Rosaria’s lance and DoT snapshot on her character clock after the first burst hitlag', () => {
  const sim = run('Rosaria E Q W14', {
    members: ['Rosaria'],
    constellations: { Rosaria: 6 },
  })
  const q = sim.actions.find((a) => a.text === 'Q')!
  expect(sim.hits.find((h) => h.label === 'Rites of Termination (2)')?.t).toBe(
    q.start + 60
  )
  const dot = sim.hits.filter((h) => h.label === 'Rites of Termination (DoT)')
  expect(dot).toHaveLength(6)
  expect(dot[0].t).toBe(q.start + 180)
  expect(
    dot.every((h) =>
      h.statSnapshots?.some(
        (s) => s.stat === 'critRate_' && s.t === q.start + 60
      )
    )
  ).toBe(true)
  expect(
    sim.hits
      .find((h) => h.label === 'Ravaging Confession (1)')
      ?.states?.find((s) => s.path[1] === 'RosariaA1')?.value
  ).toBe('')
})
it('includes Kaeya’s melee pauses while preserving his normal combo across separate N3 commands', () => {
  const sim = run('Kaeya N3 N3 W1', { members: ['Kaeya'] })
  const hits = sim.hits.filter((h) => h.tag === 'normal')
  expect(hits.map((h) => h.label)).toEqual(['N1', 'N2', 'N3', 'N4', 'N5', 'N1'])
  expect(
    sim.hits.filter((h) => h.path[1] === 'hitlag').map((h) => h.animationPause)
  ).toEqual([6, 6, 8, 8, 10, 6])
})

it('retains Rosaria’s A4 source context and scopes it to eligible shared-reaction contributors', () => {
  const probe: KitModel = {
    characterKey: 'Mona',
    element: 'hydro',
    source: 'test',
    act(c) {
      c.hit(350, {
        path: ['reaction', 'stellarswirl'],
        tag: 'other',
        element: 'anemo',
        contributors: ['Mona', 'Rosaria'],
        label: 'Shared probe',
      })
      return { frames: 1 }
    },
  }
  const sim = run('Rosaria E Q -> Mona E W8', {
    members: ['Rosaria', 'Mona'],
    kits: { Rosaria: kitModels.Rosaria, Mona: probe },
  })
  const q = sim.actions.find((a) => a.text === 'Q')!
  const attack = rotationAttacks(sim).Mona!.find(
    (a) => a.description === 'Shared probe'
  )!
  const snapshots = attack.statSnapshots!.filter(
    (s) => s.characterKey === 'Rosaria'
  )
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0].recipient).toBe('Mona')
  expect(snapshots[0].path).toEqual(['display', 'passive2', 'nodeA4OptTarget'])
  expect(
    snapshots[0].states.some(
      (s) => s.path[1] === 'RosariaA1' && s.value === 'on'
    )
  ).toBe(true)
  expect(
    sim.hits.find((h) => h.label === 'Shared probe')!.statSnapshots![0].t
  ).toBe(q.start)
})

it('applies a captured Rosaria crit buff only to its intended recipient', () => {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const loadoutData = (['Rosaria', 'Mona'] as const).map((key) => {
    db.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    db.weapons.new({
      key: key === 'Rosaria' ? 'FavoniusLance' : 'FavoniusCodex',
      level: 90,
      ascension: 6,
      refinement: 5,
      location: key,
      lock: false,
    })
    return { teamCharId: db.teamChars.new(key) }
  })
  const teamId = db.teams.new({ loadoutData })
  const states = (a1: boolean): NonNullable<TeamOptAttack['states']> => [
    { owner: 'Rosaria', path: ['Rosaria', 'RosariaA4'], value: 'on' },
    { owner: 'Rosaria', path: ['Rosaria', 'RosariaA1'], value: a1 ? 'on' : '' },
  ]
  const damage = (characterKey: 'Mona' | 'Rosaria', snapshot: boolean) =>
    attackHitData(db, teamId, 'F', {
      characterKey,
      attack: {
        path: ['skill', characterKey === 'Mona' ? 'dmg' : 'hit1'],
        hits: 1,
        hitMode: 'avgHit',
        onField: characterKey,
        states: states(false),
        statSnapshots: snapshot
          ? [
              {
                characterKey: 'Rosaria',
                recipient: 'Mona',
                stat: 'critRate_',
                path: ['display', 'passive2', 'nodeA4OptTarget'],
                onField: 'Rosaria',
                states: states(true),
              },
            ]
          : [],
      },
    })!.hit!.value
  expect(damage('Mona', true)).toBeGreaterThan(damage('Mona', false))
  expect(damage('Rosaria', true)).toBeCloseTo(damage('Rosaria', false), 8)
})

it('keeps every Bake-Kurage tick on its cast-time ATK context before Tenacity activates', () => {
  const sim = run('SangonomiyaKokomi E W14', {
    members: ['SangonomiyaKokomi'],
    elements: { SangonomiyaKokomi: 'hydro' },
    gear: { SangonomiyaKokomi: { sets: { TenacityOfTheMillelith: 4 } } },
  })
  const ticks = sim.hits.filter((h) => h.label === 'Bake-Kurage')
  expect(ticks).toHaveLength(7)
  expect(
    ticks.every((h) =>
      h.statSnapshots?.some((s) => s.stat === 'atk' && s.t === 0)
    )
  ).toBe(true)
  const attacks = rotationAttacks(sim).SangonomiyaKokomi!
  expect(
    attacks.every(
      (a) =>
        a.statSnapshots?.[0].states.find(
          (s) => s.path[0] === 'TenacityOfTheMillelith'
        )?.value === ''
    )
  ).toBe(true)
})
