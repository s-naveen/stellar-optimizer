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

it("Faruzan's A4 adds Hurricane Guard to an Anemo hit at most once every 0.8 s", () => {
  const sim = run('Faruzan Q E CA N4 N4 W1', ['Faruzan'])
  const guarded = sim.hits
    .filter((h) => state(h, 'Faruzan.a4Active') === 'on')
    .map((h) => h.t)
  expect(guarded.length).toBeGreaterThan(1)
  for (let i = 1; i < guarded.length; i++)
    expect(guarded[i] - guarded[i - 1]).toBeGreaterThanOrEqual(49)
})

it("Faruzan's Whirlwind Pulses shred only from the spot that reaches the enemy", () => {
  const sim = run('Faruzan Q W14', ['Faruzan'])
  const shreds = sim.buffWindows.filter((w) => w.path[1] === 'burstHit')
  // the burst hit, and every third pulse (1.5 ahead): 43 + 377 and 43 + 737
  expect(shreds.map((w) => w.start).sort((a, b) => a - b)).toEqual([
    54, 420, 780,
  ])
})

it('Faruzan A1: the Hurricane Arrow vortex shreds Anemo RES', () => {
  const sim = run('Faruzan E CA W5', ['Faruzan'])
  const vortex = sim.hits.find((h) => h.label === 'Pressurized Collapse')!
  const shred = sim.buffWindows.find((w) => w.path[1] === 'burstHit')!
  expect(shred.start).toBe(vortex.t)
  expect(state(vortex, 'Faruzan.burstHit')).toBe('')
})
