import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const parse = (text: string, members: CharacterKey[]) =>
  parseRotation(
    text,
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )

it('caps Ifa’s C2 Rescue Essentials from team points and clears the bonus after his blessing', () => {
  const members: CharacterKey[] = ['Ifa', 'Ororon']
  const other: KitModel = {
    characterKey: 'Ororon',
    element: 'electro',
    source: 'test',
    nightsoul: () => ({ active: false, points: 90 }),
    act(ctx) {
      ctx.hit(0, {
        path: ['normal', '0'],
        tag: 'normal',
        element: 'physical',
        label: 'Probe',
      })
      return { frames: 1 }
    },
  }
  for (const [cons, cap] of [
    [0, '150'],
    [6, '200'],
  ] as const) {
    const sim = simulateRotation({
      rotation: parse('Ifa E N1 W12 -> Ororon E', members),
      members,
      elements: { Ifa: 'anemo', Ororon: 'electro' },
      constellations: { Ifa: cons },
      repeats: 1,
      kits: { Ifa: kitModels.Ifa, Ororon: other },
    })
    const buffs = sim.buffWindows.filter((w) => w.path[1] === 'a1Essentials')
    expect(buffs.some((w) => w.value === cap)).toBe(true)
    expect(buffs.at(-1)?.value).toBe('')
    expect(sim.hits.find((h) => h.label === 'Tonic Shot (Heal)')?.weight).toBe(
      2
    )
  }
})

it('creates Albedo’s Silver buff after the first blossom, with flat damage on later blossoms', () => {
  const run = (ally: 'Venti' | 'Amber') => {
    const members: CharacterKey[] = ['Albedo', ally]
    const other: KitModel = {
      characterKey: ally,
      element: 'anemo',
      source: 'test',
      act(ctx) {
        // (130 apart: the blossom's 2 s cooldown is still active on its expiry frame, as in gcsim)
        for (const t of [0, 130, 260])
          ctx.hit(t, {
            path: ['normal', '0'],
            tag: 'normal',
            element: 'physical',
            label: 'Probe',
          })
        return { frames: 1 }
      },
    }
    return simulateRotation({
      rotation: parse(`Albedo E -> ${ally} E W6`, members),
      members,
      elements: { Albedo: 'geo', [ally]: 'anemo' },
      constellations: {},
      repeats: 1,
      kits: { Albedo: kitModels.Albedo, [ally]: other },
    })
      .hits.filter((h) => h.label === 'Transient Blossom')
      .map((h) => h.states?.find((s) => s.path[1] === 'a1LockSilver')?.value)
  }
  expect(run('Venti')).toEqual(['', 'on', 'on'])
  expect(run('Amber')).toEqual(['', '', ''])
})

it('triggers Prune’s A1 only from Bell Swirls, and counts Bell, hammer and ricochet hits for C2', () => {
  const members: CharacterKey[] = ['Prune', 'Fischl', 'Mona', 'Albedo']
  const sim = simulateRotation({
    rotation: parse('Prune Q W20', members),
    members,
    elements: {
      Prune: 'anemo',
      Fischl: 'electro',
      Mona: 'hydro',
      Albedo: 'geo',
    },
    constellations: { Prune: 6 },
    repeats: 1,
    reactions: {
      onHit(ctx, hit) {
        if (
          hit.characterKey !== 'Prune' ||
          hit.element !== 'anemo' ||
          hit.tag !== 'burst'
        )
          return
        ctx.hit(0, {
          path: ['_reaction', 'hydroSwirl'],
          tag: 'other',
          element: 'hydro',
          label: 'hydroSwirl',
          reactionSource: { path: hit.path, label: hit.label },
        })
      },
    },
  })
  const bells = sim.hits.filter((h) => h.label === 'Witchlure Bell')
  const hammers = sim.hits.filter(
    (h) => h.label === 'Banehunter Oathhammer (A1)'
  )
  const ricochets = sim.hits.filter(
    (h) => h.label === 'Banehunter Oathhammer Ricochet (C4)'
  )
  expect(bells).toHaveLength(8)
  expect(hammers.map((h, i) => h.t - bells[i].t)).toEqual(Array(8).fill(45))
  expect(ricochets.map((h, i) => h.t - hammers[i].t)).toEqual(Array(8).fill(63))
  const stacks = sim.buffWindows.filter((w) => w.path[1] === 'c2Stack')
  expect(stacks[0].start).toBe(57)
  expect([...new Set(stacks.map((w) => w.value))]).toEqual([
    '0',
    '1',
    '2',
    '3',
    '4',
    '5',
    '6',
  ])
})
