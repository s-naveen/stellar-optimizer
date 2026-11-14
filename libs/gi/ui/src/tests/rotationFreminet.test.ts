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

describe('Freminet kit (gcsim frames)', () => {
  it('keeps the normal combo across a wait, with its hitlag', () => {
    const sim = playOnce('Freminet N1 W1 N1', ['Freminet'], 0)
    // the wait starts at N1's hit (its earliest cancel); the next attack is N2
    expect(sim.actions.map((a) => a.start)).toEqual([0, 86])
    expect(
      sim.hits.filter((h) => h.tag === 'normal').map((h) => h.path)
    ).toEqual([
      ['normal', '0'],
      ['normal', '1'],
    ])
  })
  it("lengthens Upward Thrust's cancels by its hitlag", () => {
    const sim = playOnce('Freminet E W1', ['Freminet'], 0)
    expect(sim.waits?.[0]?.start).toBe(36)
  })
  it('detonates a Level 4 Shattering Pressure with a normal attack in Subnautical Hunter', () => {
    const sim = playOnce('Freminet Q E N2 N1', ['Freminet'], 0)
    expect(hitFrames(sim, 'Pers Time Frost')).toEqual([135, 171])
    expect(hitFrames(sim, 'Shattering Pressure (Physical Lv 4)')).toEqual([217])
  })
})
