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
it("Mika's A4 gives one Detector stack, after the active member's first hit under Eagleplume and Soulwind", () => {
  const sim = run('Mika Q E N5 N5 W1', ['Mika'], { Mika: 0 })
  const arrow = sim.hits.find((h) => h.label === 'Flowfrost Arrow')!
  const stacks = sim.buffWindows.filter((w) => w.path[1] === 'a1DetectorStacks')
  expect(stacks).toHaveLength(1)
  expect(stacks[0].start).toBe(arrow.t + 1)
})

it("Mika's Soulwind ATK SPD stops for normals that start after it ends on her clock", () => {
  const strings = run('Mika E N5 N5 N5 N5 N5 N5 W1', ['Mika']).actions.filter(
    (a) => a.text === 'N5'
  )
  // gcsim: 175 frames under Soulwind (talent 10), longer once it lapses mid-string
  expect(strings[0].frames).toBe(175)
  expect(strings[4].frames).toBeGreaterThan(175)
})

it("Mika's skill arrow pauses her: a wait starts at 19 + 4 frames", () => {
  const sim = run('Mika E W1', ['Mika'])
  expect(sim.waits![0].start).toBe(23)
})
