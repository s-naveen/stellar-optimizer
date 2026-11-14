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

describe('Diluc kit', () => {
  it("lands Dawn's ticks only where the phoenix's path reaches the target", () => {
    const sim = playOnce('Diluc Q W5', ['Diluc'], 0)
    expect(hitFrames(sim, 'Dawn (slash)')).toEqual([101])
    // (the default target: 2.4 m away, radius 2)
    expect(hitFrames(sim, 'Dawn (DoT)')).toEqual([112, 124, 136, 148])
    expect(hitFrames(sim, 'Dawn (explosion)')).toEqual([])
  })
  it('C6: Searing Onslaught does not interrupt the normal combo', () => {
    const sim = playOnce('Diluc N1 E N1 W1', ['Diluc'], 6)
    expect(
      sim.hits.filter((h) => h.tag === 'normal').map((h) => h.path[1])
    ).toEqual(['0', '1'])
  })
})
