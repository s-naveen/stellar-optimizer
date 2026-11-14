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

describe('Eula kit', () => {
  it("resets Icetide Vortex's cooldown on the burst and its Lightfall Sword lands at 600 frames", () => {
    const sim = playOnce('Eula hE Q E N4 W8', ['Eula'], 0)
    const [, q, e] = sim.actions.map((a) => a.start)
    // no wait for the 10 s hold cooldown: the burst reset it
    expect(e - q).toBe(123)
    // the sword's status and explosion are on world time (Eula's hitlag does not delay them)
    expect(hitFrames(sim, 'Lightfall Sword')).toEqual([q + 600])
  })
  it("gains a Grimheart stack from the burst even with none up (A4's text)", () => {
    const sim = playOnce('Eula Q hE W1', ['Eula'], 0)
    expect(hitFrames(sim, 'Icewhirl Brand (1)').length).toBe(1)
  })
})
