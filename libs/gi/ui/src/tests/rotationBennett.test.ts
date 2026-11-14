import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type TeamOptAttack } from '@genshin-optimizer/gi/db'
import { attackHitData } from '../util/teamOpt/objective'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

it('grants Bennett’s buff and C6 infusion on field ticks, then retains the recipient’s buff after swapping', () => {
  const members: CharacterKey[] = ['Bennett', 'Keqing']
  const probe: KitModel = {
    characterKey: 'Keqing',
    element: 'electro',
    source: 'test',
    act(c) {
      for (const t of [0, 20, 40, 100, 300, 500])
        c.hit(t, {
          path: ['normal', '0'],
          tag: 'normal',
          element: 'physical',
          label: `Probe ${t}`,
        })
      return { frames: 1 }
    },
  }
  const sim = simulateRotation({
    rotation: parseRotation(
      'Bennett Q -> Keqing E W4 -> Bennett W10',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Bennett: 'pyro', Keqing: 'electro' },
    constellations: { Bennett: 6 },
    kits: { Bennett: kitModels.Bennett, Keqing: probe },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {} },
  })
  const hits = sim.hits.filter((h) => h.label.startsWith('Probe'))
  expect(hits.map((h) => h.element)).toEqual([
    'physical',
    'physical',
    'pyro',
    'pyro',
    'physical',
    'physical',
  ])
  const attacks = rotationAttacks(sim).Keqing!
  const buff = (name: string) =>
    attacks
      .find((a) => a.description === name)
      ?.states?.find((s) => s.path[1] === 'fieldRecipient')?.value
  expect(buff('Probe 0') ?? '').toBe('')
  expect(buff('Probe 40')).toBe('on')
  expect(buff('Probe 300')).toBe('on') // Keqing's last field tick lingers off field
  expect(buff('Probe 500') ?? '').toBe('')
})

it('snapshots Venti’s burst at frame 104 and retains the captured context on both elements', () => {
  const members: CharacterKey[] = ['Bennett', 'Venti']
  const sim = simulateRotation({
    rotation: parseRotation(
      'Bennett Q -> Venti Q -> Bennett W12',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Bennett: 'pyro', Venti: 'anemo' },
    constellations: { Bennett: 6 },
    repeats: 1,
    keep: 'all',
    reactions: { onHit() {}, absorbAt: () => 'pyro' },
  })
  const start = sim.actions[1].start
  const ticks = sim.hits.filter(
    (h) => h.characterKey === 'Venti' && h.tag === 'burst'
  )
  expect(ticks.some((h) => h.element === 'pyro')).toBe(true)
  expect(
    ticks.every((h) =>
      h.statSnapshots?.some(
        (s) => s.stat === 'atk' && s.t === start + 104 && s.onField === 'Venti'
      )
    )
  ).toBe(true)
})

it('does not activate Venti’s Hexerei bonus from a delayed skill Swirl before the burst field exists', () => {
  const members: CharacterKey[] = ['Venti', 'Varka', 'Bennett']
  const sim = simulateRotation({
    rotation: parseRotation(
      'Venti E Q W4',
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Venti: 'anemo', Varka: 'anemo', Bennett: 'pyro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    reactions: {
      onHit(c, h) {
        if (h.characterKey === 'Venti' && ['skill', 'burst'].includes(h.tag))
          c.hit(0, {
            path: ['_reaction', 'pyroSwirl'],
            tag: 'other',
            element: 'pyro',
            label: 'Swirl probe',
          })
      },
    },
  })
  const fieldStart = sim.actions[1].start + 93
  const windows = sim.buffWindows.filter(
    (w) => w.path[1] === 'hexSwirlRecipient'
  )
  expect(windows.length).toBeGreaterThan(0)
  expect(windows.every((w) => w.start >= fieldStart)).toBe(true)
})

it('composes a captured total ATK with Nicole’s earlier captured buff without applying a later source change twice', () => {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const loadoutData = (['Nicole', 'Venti'] as const).map((key) => {
    db.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      constellation: 0,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    db.weapons.new({
      key: key === 'Nicole' ? 'FavoniusCodex' : 'FavoniusWarbow',
      level: 90,
      ascension: 6,
      refinement: 5,
      location: key,
      lock: false,
    })
    return { teamCharId: db.teamChars.new(key) }
  })
  const teamId = db.teams.new({ loadoutData })
  const states = (a4: boolean): NonNullable<TeamOptAttack['states']> => [
    { owner: 'Nicole', path: ['Nicole', 'skillGraceActive'], value: 'on' },
    {
      owner: 'Nicole',
      path: ['Nicole', 'a4NicoleGuidance'],
      value: a4 ? 'on' : '',
    },
  ]
  const damage = (a4: boolean) =>
    attackHitData(db, teamId, 'F', {
      characterKey: 'Venti',
      attack: {
        path: ['burst', 'base'],
        hits: 1,
        hitMode: 'avgHit',
        onField: 'Venti',
        states: states(a4),
        statSnapshots: [
          {
            stat: 'atk',
            path: ['total', 'atk'],
            onField: 'Venti',
            states: states(true),
          },
          {
            characterKey: 'Nicole',
            stat: 'atk',
            path: ['display', 'skill', 'skillGraceActive_atk'],
            onField: 'Nicole',
            states: states(false),
          },
        ],
      },
    })!.hit!.value
  expect(damage(true)).toBeGreaterThan(0)
  expect(damage(false)).toBeCloseTo(damage(true), 6)
})
