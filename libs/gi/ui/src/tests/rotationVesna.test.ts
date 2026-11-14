import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { normalString, withHitlag } from '../util/teamOpt/rotation/kits/common'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const run = (
  text: string,
  extra: Partial<Parameters<typeof simulateRotation>[0]> = {}
) => {
  const members: CharacterKey[] = extra.members ?? ['Vesna']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Vesna: 'anemo', Mona: 'hydro' },
    constellations: {},
    repeats: 1,
    keep: 'all',
    ...extra,
  })
}

it('advances Windborne levels using Sword Essence and ends Armed after three maximum-level uses', () => {
  const sim = run('Vesna E E E Q E N6 E N6 E N1 W1')
  expect(sim.warnings).toEqual([])
  expect(
    sim.hits.filter((h) => h.label === 'Windborne Blade Lv. 1')
  ).toHaveLength(1)
  expect(
    sim.hits.filter((h) => h.label === 'Windborne Blade Lv. 2')
  ).toHaveLength(1)
  expect(
    sim.hits.filter((h) => h.label === 'Windborne Blade Lv. 2 Spirit Blade')
  ).toHaveLength(1)
  expect(
    sim.hits.filter((h) => h.label === 'Windborne Blade Lv. 3 Spirit Blade')
  ).toHaveLength(12)
  expect(
    sim.hits.filter(
      (h) => h.label === 'Windborne Blade Lv. 3 Spirit Blade Final'
    )
  ).toHaveLength(3)
  expect(sim.hits.filter((h) => h.tag === 'normal').at(-1)?.element).toBe(
    'physical'
  )
  expect(
    sim.hits
      .find((h) => h.label === 'Burst')
      ?.states?.find((s) => s.path[1] === 'a1Stacks')?.value
  ).toBe('4')
})

it('keeps normal hits on world time while hitlag pauses animation and character tasks', () => {
  const sim = run('Vesna E N3 W1')
  const third = sim.hits.filter((h) => h.label === 'Normal 3')
  expect(third.map((h) => h.t - third[0].t)).toEqual([0, 11])
  expect(sim.hits.filter((h) => h.label === 'Wind Pinion')).toHaveLength(3)
  expect(
    sim.hits
      .filter((h) => h.tag === 'normal')
      .every((h) => h.element === 'anemo')
  ).toBe(true)
})

it('uses Swirl radiance independently when Conduct radiance is also present', () => {
  const sim = run('Vesna E E E Q E W2', {
    reactions: {
      onHit() {},
      radianceAt: () => 'conduct',
      stellarSwirlAt: () => true,
    },
  })
  const spirits = sim.hits.filter((h) => /Spirit Blade|^Burst/.test(h.label))
  expect(spirits.length).toBeGreaterThan(5)
  expect(
    spirits.every((h) => h.tag === 'directStellarSwirl' && !h.applies)
  ).toBe(true)
  expect(spirits.every((h) => h.path[1].includes('Stellarswirl'))).toBe(true)
})

it('chooses the Spirit Blade variant when the delayed character task executes', () => {
  const sim = run('Vesna E E E W2', {
    reactions: { onHit() {}, stellarSwirlAt: (t) => t >= 80 },
  })
  expect(sim.hits.find((h) => h.label === 'Windborne Blade Lv. 2')?.t).toBe(69)
  expect(
    sim.hits.find(
      (h) => h.label === 'Windborne Blade Lv. 2 Spirit Blade (Stellar Swirl)'
    )?.t
  ).toBe(99)
})

it('clears A1 on swap and expires stacks on the character clock', () => {
  const mona: KitModel = {
    characterKey: 'Mona',
    element: 'hydro',
    source: 'test',
    act: () => ({ frames: 1 }),
  }
  const swapped = run('Vesna E E -> Mona E -> Vesna Q W3', {
    members: ['Vesna', 'Mona'],
    kits: { Vesna: kitModels.Vesna, Mona: mona },
  })
  expect(
    swapped.hits
      .find((h) => h.label === 'Burst')
      ?.states?.find((s) => s.path[1] === 'a1Stacks')?.value
  ).toBe('1')
  const expired = run('Vesna E E N1 W22')
  const windows = expired.buffWindows.filter(
    (w) => w.owner === 'Vesna' && w.path[1] === 'a1Stacks' && w.value === '1'
  )
  expect(windows.at(-1)?.end).toBe(27 + 1201 + 7)
})

it('counts overlapping world-time hitlag once while allowing a wait on the initial hitmark', () => {
  const spec = { hitmarks: [10, 13], hitlag: [6, 6], worldTimeHits: true }
  expect(
    withHitlag({ frames: 30, framesInto: { normal: 10, wait: 10 } }, spec)
  ).toEqual({ frames: 39, framesInto: { normal: 19, wait: 10 } })
  const marks: number[] = []
  normalString(
    [{ ...spec, toNormal: 20, toCharged: 20, toAbil: 13, frames: 30 }],
    1,
    (_i, t) => marks.push(t)
  )
  expect(marks).toEqual([10, 13])
  const probe: KitModel = {
    characterKey: 'Vesna',
    element: 'anemo',
    source: 'test',
    act(c) {
      c.atCharacter('Vesna', 20, (at) => at.note(`character task ${at.now}`))
      for (const t of [10, 13])
        c.hit(t, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 6,
          label: 'Pause',
        })
      return { frames: 1 }
    },
  }
  const sim = run('Vesna E W1', { kits: { Vesna: probe } })
  expect(sim.notes).toContain('character task 29')
  expect(
    sim.hits.filter((h) => h.path[1] === 'hitlag').map((h) => h.animationPause)
  ).toEqual([6, 3])
})
