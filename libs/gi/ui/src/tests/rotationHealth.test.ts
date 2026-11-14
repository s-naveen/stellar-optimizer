import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { Health } from '../util/teamOpt/rotation/health'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type {
  KitModel,
  RotationCalculation,
} from '../util/teamOpt/rotation/types'

it('stops thresholded drains, caps heals, and reports effective change separately from overheal', () => {
  const health = new Health(() => 20000)
  expect(health.drain('Furina', 0.49, 0.5).ratio).toBeCloseTo(0.49)
  expect(health.drain('Furina', 0.03, 0.5).ratio).toBeCloseTo(0.03)
  expect(health.ratio('Furina')).toBeCloseTo(0.48)
  expect(health.drain('Furina', 0.03, 0.5).amount).toBe(0)
  expect(health.heal('Furina', 15000)).toEqual({
    amount: 10400,
    ratio: 0.52,
    overheal: 4600,
  })
  expect(health.ratio('Furina')).toBe(1)
})

it('preserves absolute HP when Max HP grows and clamps it when Max HP falls', () => {
  let maximum = 20000
  const health = new Health(() => maximum)
  health.drain('Furina', 0.25)
  maximum = 30000
  expect(health.ratio('Furina')).toBe(0.5)
  maximum = 10000
  expect(health.ratio('Furina')).toBe(1)
  expect(() => new Health(() => Number.NaN).ratio('Furina')).toThrow(
    'positive, finite Max HP'
  )
})

const calculate: RotationCalculation = (_character, path) => {
  if (path.join('.') === 'total.hp') return 20000
  if (path[0] === 'total') return 0
  return 3000
}

it('applies Prototype Amber healing to each recipient’s HP on their own hitlag-paused clock', () => {
  for (const [refinement, amount] of [
    [1, 800],
    [5, 1200],
  ] as const) {
    const heals: { member: CharacterKey; t: number; amount: number }[] = []
    const healer: KitModel = {
      characterKey: 'Vodyanitsa',
      element: 'hydro',
      source: 'test',
      onStart(c) {
        c.at(0, (at) => {
          for (const member of at.members) at.drainHp(member, 0.6)
        })
      },
      onHpChange(c, _s, change) {
        if (change.kind === 'heal')
          heals.push({
            member: change.characterKey,
            t: c.now,
            amount: change.amount,
          })
      },
      act: () => ({ frames: 1 }),
    }
    const melee: KitModel = {
      characterKey: 'Skirk',
      element: 'cryo',
      source: 'test',
      act(c) {
        c.hit(106, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 8,
          label: 'Pause before first heal',
        })
        c.hit(226, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 4,
          label: 'Pause again',
        })
        return { frames: 1 }
      },
    }
    const team: CharacterKey[] = ['Vodyanitsa', 'Skirk']
    const sim = simulateRotation({
      rotation: parseRotation(
        'Vodyanitsa Q -> Skirk E W7',
        team.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: team,
      constellations: {},
      elements: { Vodyanitsa: 'hydro', Skirk: 'cryo' },
      repeats: 1,
      keep: 'all',
      calculate,
      kits: { Vodyanitsa: healer, Skirk: melee },
      gear: { Vodyanitsa: { weapon: 'PrototypeAmber', refinement } },
    })
    expect(sim.warnings).toEqual([])
    expect(
      heals.filter((h) => h.member === 'Vodyanitsa').map((h) => h.t)
    ).toEqual([120, 240, 360])
    expect(heals.filter((h) => h.member === 'Skirk').map((h) => h.t)).toEqual([
      128, 252, 372,
    ])
    expect(heals.map((h) => h.amount)).toEqual(Array(6).fill(amount))
  }
})
const members: CharacterKey[] = ['Furina', 'Bennett', 'Kaeya', 'Lisa']
const run = (text: string) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { Bennett: 6 },
    repeats: 1,
    keep: 'all',
    calculate,
    elements: {
      Furina: 'hydro',
      Bennett: 'pyro',
      Kaeya: 'cryo',
      Lisa: 'electro',
    },
  })

it('counts real HP drains without inventing the matching heal or draining allies below the threshold', () => {
  const sim = run('Furina E Q W30')
  expect(sim.warnings).toEqual([])
  expect(sim.notes.some((n) => n.includes('being healed back'))).toBe(false)
  const fanfare = sim.buffWindows
    .filter((w) => w.path[1] === 'burstFanfare' && w.value)
    .map((w) => Number(w.value))
  expect(Math.max(...fanfare)).toBeGreaterThan(100)
  expect(Math.max(...fanfare)).toBeLessThan(220)
  const salon = sim.hits.filter(
    (h) =>
      h.characterKey === 'Furina' && h.label === 'Surintendante Chevalmarin'
  )
  expect(
    salon.some((h) =>
      h.states?.some(
        (s) => s.path[1] === 'skillHpConsumeStacks' && s.value === '4'
      )
    )
  ).toBe(true)
  expect(
    salon.some((h) =>
      h.states?.some(
        (s) => s.path[1] === 'skillHpConsumeStacks' && s.value === '0'
      )
    )
  ).toBe(true)
})

it('lets Bennett’s conditional healing restore the active character and contribute to Fanfare', () => {
  const sim = run('Furina E Q -> Bennett Q W20')
  expect(sim.warnings).toEqual([])
  expect(sim.hits.some((h) => h.label === 'Inspiration Field (Heal)')).toBe(
    true
  )
  expect(
    sim.hits.some(
      (h) => h.label === 'Tracked HP heal' && h.characterKey === 'Bennett'
    )
  ).toBe(true)
  expect(
    sim.hits.filter(
      (h) => h.label === 'Tracked HP heal' && h.characterKey !== 'Bennett'
    )
  ).toEqual([])
})
