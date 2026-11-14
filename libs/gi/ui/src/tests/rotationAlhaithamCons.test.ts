import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, kitModels[m]!.element])
    ) as never,
    constellations,
    repeats: 1,
    keep: 'all',
  })
const state = (
  hit: { states?: { path: string[]; value: string }[] },
  path: string
) => hit.states?.find((s) => s.path.join('.') === path)?.value ?? ''

it('Alhaitham C2 counts up to 4 Debate stacks', () => {
  const sim = run('Alhaitham E N3 CA W1', ['Alhaitham'], { Alhaitham: 2 })
  const stacks = sim.buffWindows.filter((w) => w.path[1] === 'debateStacks')
  expect(stacks.length).toBeGreaterThanOrEqual(3)
  expect(stacks.every((w) => w.max === 4)).toBe(true)
})

it('Alhaitham C1 cuts the Skill cooldown by 1.2 s per Projection Attack (1 s ICD)', () => {
  const second = (cons: number) =>
    run('Alhaitham E N3 CA N3 CA N3 CA N3 CA E W1', ['Alhaitham'], {
      Alhaitham: cons,
    }).actions.filter((a) => a.text === 'E')[1].start
  expect(second(1)).toBeLessThan(second(0))
})

it("Alhaitham's infusion is decided when each hit lands (a mirror made mid-string counts)", () => {
  const sim = run('Alhaitham Q N4 N4 CA W1', ['Alhaitham'])
  const physical = sim.hits.filter(
    (h) =>
      h.tag !== 'other' &&
      h.characterKey === 'Alhaitham' &&
      h.element === 'physical'
  )
  const dendro = sim.hits.filter(
    (h) => (h.tag === 'normal' || h.tag === 'charged') && h.element === 'dendro'
  )
  // the burst's mirrors arrive 184 frames in, on his clock
  expect(physical.length).toBeGreaterThan(0)
  expect(dendro.length).toBeGreaterThan(0)
  expect(Math.max(...physical.map((h) => h.t))).toBeLessThan(
    Math.min(...dendro.map((h) => h.t))
  )
})

it('Alhaitham C4: his Dendro DMG runs 15 s from the new mirrors, not from the cast', () => {
  const sim = run('Alhaitham Q N4 N4 W11 E W1', ['Alhaitham'], { Alhaitham: 4 })
  const e = sim.hits.find((h) => h.tag === 'skill' && h.path[1] === 'rushDmg')!
  // 15 s from the cast (and its hitlag) have passed, but not 15 s from the mirrors 184 frames in
  expect(e.t).toBeGreaterThan(940)
  expect(state(e, 'Alhaitham.mirrorsConsumed')).toBe('0')
})
