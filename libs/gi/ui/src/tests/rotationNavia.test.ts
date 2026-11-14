import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

/** Plays a rotation once (every member at `cons`) and keeps everything */
function playOnce(text: string, members: CharacterKey[], cons: number) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, getCharEle(m)])
    ) as never,
    constellations: Object.fromEntries(members.map((m) => [m, cons])),
    repeats: 1,
    keep: 'all',
  })
}

/** Frames of the hits with a given label */
const hitFrames = (sim: ReturnType<typeof simulateRotation>, label: string) =>
  sim.hits.filter((h) => h.label === label).map((h) => h.t)

describe('Navia kit', () => {
  it("recovers Crystalshot's two charges one after the other (gcsim's charge queue)", () => {
    const sim = playOnce('Navia E E E W1', ['Navia'], 0)
    expect(sim.actions.map((a) => a.start)).toEqual([0, 40, 551])
  })
  it("fires a held Crystalshot at gcsim's shortest hold (41 frames)", () => {
    const sim = playOnce('Navia hE W2', ['Navia'], 0)
    expect(hitFrames(sim, 'Rosula Shardshot (5 shots)')).toEqual([50])
    expect(hitFrames(sim, 'Surging Blade')).toEqual([105])
  })
})
