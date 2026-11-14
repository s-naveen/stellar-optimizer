import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

function run(
  text: string,
  members: CharacterKey[],
  cons: Partial<Record<CharacterKey, number>> = {}
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: cons,
    repeats: 1,
    keep: 'all',
  })
}

describe('Lynette constellations', () => {
  it('C4: two charges of Enigmatic Feint; the hold is the shortest Pilfering Shadow', () => {
    const c0 = run('Lynette E E W1', ['Lynette'], { Lynette: 0 })
    const c4 = run('Lynette E E W1', ['Lynette'], { Lynette: 4 })
    expect(c4.frames).toBeLessThan(c0.frames - 500)
    const hold = run('Lynette hE W1', ['Lynette'])
    const thrust = hold.hits.find(
      (h) => h.path.join('.') === 'skill.thrustDmg'
    )!
    expect(thrust.t - hold.actions[0].start).toBe(51)
  })
  it('C6: 6 s of Anemo infusion, plunges included', () => {
    const sim = run('Lynette E W1', ['Lynette'], { Lynette: 6 })
    const c6 = sim.buffWindows.find(
      (w) => w.path.join('.') === 'Lynette.c6AfterThrust'
    )!
    expect(c6.end - c6.start).toBe(360)
  })
})
