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

describe('Cryo Traveler constellations', () => {
  it('C2: crystal hits grant the active member EM; C6: Frostglow buffs the party', () => {
    const sim = run('TravelerCryo E W14 Q W2', ['TravelerCryo', 'Bennett'], {
      TravelerCryo: 6,
    })
    expect(
      sim.buffWindows.some(
        (w) =>
          w.path.join('.') === 'TravelerCryo.c2Crystal' &&
          w.recipient === 'TravelerCryo'
      )
    ).toBe(true)
    const c6 = sim.buffWindows.find(
      (w) => w.path.join('.') === 'TravelerCryo.burstFrostglow'
    )!
    expect(Number(c6.value)).toBeGreaterThan(0)
    expect(c6.end - c6.start).toBe(900)
  })
})
