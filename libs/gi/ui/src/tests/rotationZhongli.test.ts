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

describe('Zhongli kit', () => {
  it('replaces the newest stele at the maximum, and steles do not resonate with each other', () => {
    const sim = playOnce('Zhongli E W1 E W1 E W4', ['Zhongli'], 1)
    expect(hitFrames(sim, 'Stone Stele')).toEqual([24, 286, 548])
    // one tick per standing stele: the first (24) keeps ticking, the second (286) was replaced
    expect(hitFrames(sim, 'Stone Stele (tick)')).toEqual([
      144, 264, 384, 406, 504, 526, 624, 668, 744,
    ])
    expect(hitFrames(sim, 'Stone Stele (resonance)')).toEqual([])
  })
})
