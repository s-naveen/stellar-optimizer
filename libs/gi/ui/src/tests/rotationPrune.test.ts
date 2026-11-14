import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { ArtCharDatabase, type TeamOptAttack } from '@genshin-optimizer/gi/db'
import { attackHitData } from '../util/teamOpt/objective'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type RotationReactions,
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const run = (
  text: string,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) => {
  const members: CharacterKey[] = extra.members ?? ['Prune', 'Mona']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: {
      Prune: 'anemo',
      Mona: 'hydro',
      Sucrose: 'anemo',
      Venti: 'anemo',
    },
    constellations: { Prune: 6 },
    repeats: 1,
    keep: 'all',
    ...extra,
  })
}
const reactions: RotationReactions = {
  onHit(c, h) {
    if (h.characterKey === 'Prune' && h.label === 'Ring-A-Ding-Ding!')
      c.hit(0, {
        path: ['_reaction', 'hydroSwirl'],
        tag: 'other',
        element: 'hydro',
        reactionSource: { path: h.path, label: h.label },
        label: 'hydroSwirl',
      })
    if (h.characterKey === 'Sucrose' && h.label === 'Probe 0')
      c.hit(0, {
        path: ['_reaction', 'hydroSwirl'],
        tag: 'other',
        element: 'hydro',
        label: 'hydroSwirl',
      })
  },
}
it('triggers Fischl C6 from Prune’s actual normal starts and delays, including consecutive grouped strings', () => {
  const sim = run('Fischl E -> Prune N3 N3 W1', {
    members: ['Fischl', 'Prune'],
    elements: { Fischl: 'electro', Prune: 'anemo' },
    constellations: { Fischl: 6, Prune: 6 },
    reactions: { onHit() {} },
  })
  const start = sim.actions[1].start
  expect(
    sim.hits
      .filter((h) => h.label === 'Evernight Raven (C6)')
      .map((h) => h.t - start)
    // (the last from the normal state lasting through the wait, as kqmsim: 322)
  ).toEqual([19, 48, 103, 172, 201, 256, 322])
})
it('opens conversion only from the initial skill’s Swirl and deals converted damage with its hitlag', () => {
  const sim = run('Prune E E Q W2', { reactions })
  expect(sim.warnings).toEqual([])
  expect(sim.actions.map((a) => a.start)).toEqual([0, 30, 104])
  const hit = sim.hits.find(
    (h) => h.label === 'Clang Clang! Witch-tribution Comes!'
  )!
  expect(hit.t).toBe(60)
  expect(hit.element).toBe('hydro')
  expect(hit.path).toEqual(['skill', 'clanghydroDmg'])
  const ricochet = sim.hits.find((h) => h.path[0] === 'constellation4')!
  expect(ricochet.t).toBe(123)
  expect(ricochet.tag).toBe('skill')
  expect(ricochet.path).toEqual(['constellation4', 'hydroDmg'])
})
it('waits for the actual skill cooldown when its initial hit did not Swirl', () => {
  const sim = run('Prune E E W1', { reactions: { onHit() {} } })
  expect(sim.actions.map((a) => a.start)).toEqual([0, 925])
  expect(sim.hits.some((h) => h.label.includes('Clang'))).toBe(false)
})
it('retains the conversion window after swapping and extends it on Prune’s clock', () => {
  const mona: KitModel = {
    characterKey: 'Mona',
    element: 'hydro',
    source: 'test',
    act: () => ({ frames: 1 }),
  }
  const sim = run('Prune E -> Mona E -> Prune E W1', {
    reactions,
    kits: { Prune: kitModels.Prune, Mona: mona },
  })
  expect(sim.hits.filter((h) => h.label.includes('Clang'))).toHaveLength(1)
  expect(sim.actions[2].start).toBeLessThan(390)
})
it('grants the Hexerei Swirl ATK bonus only to its triggerer and polls C6 after swaps', () => {
  const probe = (key: 'Sucrose' | 'Venti'): KitModel => ({
    characterKey: key,
    element: 'anemo',
    source: 'test',
    act(c) {
      for (const t of [0, 40])
        c.hit(t, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'anemo',
          label: `Probe ${t}`,
        })
      return { frames: 50 }
    },
  })
  const sim = run('Prune E E -> Sucrose E -> Venti E W2', {
    members: ['Prune', 'Sucrose', 'Venti'],
    reactions,
    kits: {
      Prune: kitModels.Prune,
      Sucrose: probe('Sucrose'),
      Venti: probe('Venti'),
    },
  })
  const hex = sim.buffWindows.filter(
    (w) => w.path[1] === 'hexRecipient' && w.value === 'on'
  )
  expect(hex.length).toBeGreaterThan(0)
  expect(hex.every((w) => w.recipient === 'Sucrose')).toBe(true)
  const attacks = rotationAttacks(sim)
  const sucrose = attacks.Sucrose!.find((a) => a.description === 'Probe 40')!
  const venti = attacks.Venti!.find((a) => a.description === 'Probe 40')!
  const value = (a: typeof sucrose, name: string) =>
    a.states?.find((s) => s.owner === 'Prune' && s.path[1] === name)?.value
  expect(value(sucrose, 'hexRecipient')).toBe('on')
  expect(value(venti, 'hexRecipient') ?? '').toBe('')
  expect(value(venti, 'c6Recipient')).toBe('on')
})
it('applies the double-Anemo cooldown reduction to delayed abilities and charge recovery', () => {
  const probe: KitModel = {
    characterKey: 'Sucrose',
    element: 'anemo',
    source: 'test',
    charges: () => ({ skill: 2 }),
    act: () => ({
      frames: 10,
      cooldown: { key: 'skill', frames: 100, delay: 10 },
    }),
  }
  const sim = run('Sucrose E E E', {
    members: ['Sucrose', 'Prune'],
    kits: { Sucrose: probe, Prune: kitModels.Prune },
  })
  expect(sim.actions.map((a) => a.start)).toEqual([0, 10, 105])
})

it('retains Prune’s A4 source context while letting candidate source stats change the captured buff', () => {
  const db = new ArtCharDatabase(1, new SandboxStorage({}))
  const loadoutData = (['Prune', 'Mona'] as const).map((key) => {
    db.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      constellation: key === 'Prune' ? 6 : 0,
      talent: { auto: 10, skill: 10, burst: 10 },
    })
    db.weapons.new({
      key: 'FavoniusCodex',
      level: 90,
      ascension: 6,
      refinement: 5,
      location: key,
      lock: false,
    })
    return { teamCharId: db.teamChars.new(key) }
  })
  const teamId = db.teams.new({ loadoutData })
  const states = (stack: string): NonNullable<TeamOptAttack['states']> => [
    { owner: 'Prune', path: ['Prune', 'timeline'], value: 'on' },
    { owner: 'Prune', path: ['Prune', 'a4Rally'], value: 'on' },
    { owner: 'Prune', path: ['Prune', 'c2Stack'], value: stack },
  ]
  const damage = (stack: string, snapshot: boolean, extraAtk = 1300) =>
    attackHitData(db, teamId, 'F', {
      characterKey: 'Mona',
      bonusStats: { Prune: { atk: extraAtk } },
      attack: {
        path: ['skill', 'dmg'],
        hits: 1,
        hitMode: 'avgHit',
        onField: 'Mona',
        states: states(stack),
        statSnapshots: snapshot
          ? [
              {
                characterKey: 'Prune',
                stat: 'skill_dmg_',
                path: ['display', 'passive2', 'skill_dmg_'],
                onField: 'Prune',
                states: states('0'),
              },
            ]
          : undefined,
      },
    })!.hit!.value
  const baseline = damage('0', false)
  expect(baseline).toBeGreaterThan(0)
  expect(damage('6', false)).toBeGreaterThan(baseline)
  expect(damage('6', true)).toBeCloseTo(baseline, 6)
  expect(damage('6', true, 1400)).toBeCloseTo(damage('0', false, 1400), 6)
  expect(damage('6', true, 1400)).toBeGreaterThan(baseline)
})

it('keeps Mona’s phantom and Oz attacks on their captured ATK context', () => {
  const sim = run('Mona E -> Fischl E -> Prune Q W8', {
    members: ['Mona', 'Fischl', 'Prune'],
    elements: { Mona: 'hydro', Fischl: 'electro', Prune: 'anemo' },
    constellations: { Prune: 6, Fischl: 6 },
  })
  const mona = sim.hits.filter(
    (h) => h.characterKey === 'Mona' && h.tag === 'skill'
  )
  expect(mona.length).toBeGreaterThan(0)
  expect(
    mona.every((h) =>
      h.statSnapshots?.some(
        (s) => s.stat === 'atk' && s.t === 0 && s.onField === 'Mona'
      )
    )
  ).toBe(true)
  const oz = sim.hits.filter((h) => h.label === 'Oz')
  expect(oz.length).toBeGreaterThan(0)
  expect(
    oz.every(
      (h) =>
        h.statSnapshots?.some(
          (s) => s.stat === 'atk' && s.t === 73 && s.onField === 'Fischl'
        ) && h.statSnapshots?.some((s) => s.stat === 'critDMG_' && s.t === 73)
    )
  ).toBe(true)
})
