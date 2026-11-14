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
it("Xiao's charges recharge one after another (C1: a third)", () => {
  const starts = (text: string, cons: number) =>
    run(text, ['Xiao'], { Xiao: cons })
      .actions.filter((a) => a.text === 'E')
      .map((a) => a.start)
  const c0 = starts('Xiao E E E W1', 0)
  expect(c0[1]).toBe(24)
  expect(c0[2]).toBe(600)
  const c1 = starts('Xiao E E E E W1', 1)
  expect(c1.slice(0, 3)).toEqual([0, 24, 48])
  expect(c1[3]).toBe(600)
})

it("Xiao's burst waits for its cooldown, and ends when he leaves the field", () => {
  const twice = run('Xiao Q Q W1', ['Xiao']).actions.filter(
    (a) => a.text === 'Q'
  )
  expect(twice[1].start - twice[0].start).toBe(1080 + 29)
  const sim = run('Xiao Q W2 -> Faruzan W1', ['Xiao', 'Faruzan'])
  const swapAt =
    sim.actions.find((a) => a.characterKey === 'Faruzan')?.start ?? 0
  const inBurst = sim.buffWindows.filter(
    (w) => w.path[1] === 'inBurst' && w.value === 'inBurst'
  )
  expect(inBurst).toHaveLength(1)
  expect(inBurst[0].end).toBeLessThanOrEqual(swapAt || 200)
})

it("Xiao's A4 stacks share one 7 s duration, refreshed by each use", () => {
  const sim = run('Xiao E E W6 E W8', ['Xiao'], { Xiao: 1 })
  const a4 = sim.buffWindows.filter((w) => w.path[1] === 'a4SkillStack')
  expect(a4.map((w) => w.value)).toEqual(['1', '2', '3', ''])
  // the third use (W6 later) refreshes all of them: the stacks end 420 frames after it
  expect(a4[3].start - a4[2].start).toBe(420)
})
