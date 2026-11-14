import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type RotationReactions,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const none: RotationReactions = { onHit() {} }
const run = (
  text: string,
  cons: number,
  reactions: RotationReactions = none
) => {
  const members: CharacterKey[] = ['Durin', 'Bennett']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Durin: 'pyro', Bennett: 'pyro' },
    constellations: { Durin: cons },
    repeats: 1,
    keep: 'all',
    reactions,
  })
}
const c1 = (sim: ReturnType<typeof run>, key: CharacterKey) =>
  sim.hits.filter(
    (h) =>
      h.characterKey === key &&
      h.states?.some((s) => s.path.join('.') === 'Durin.c1Stacks')
  )

describe('Durin', () => {
  it('C1 (Dark): his Burst DMG spends 2 of his 20 stacks per hit, from the first strike', () => {
    const sim = run('Durin E N1 Q W25', 1)
    const covered = c1(sim, 'Durin')
    expect(covered).toHaveLength(10)
    expect(covered[0].label).toBe('As the Stars Smolder')
  })

  it('C1 (White): the other active member’s attacks spend their own stacks', () => {
    const sim = run('Durin Q -> Bennett N5 N5 N5 N5 N5 E', 1)
    expect(c1(sim, 'Durin')).toHaveLength(0)
    // 20 stacks for Bennett's 26 normal and skill hits
    expect(c1(sim, 'Bennett')).toHaveLength(20)
    // C4: 30% of the consumptions spend nothing
    const c4 = run('Durin Q -> Bennett N5 N5 N5 N5 N5 E', 4)
    expect(c1(c4, 'Bennett').length).toBeGreaterThan(20)
  })

  it('C2: a Vaporize in either form buffs Pyro and Hydro DMG', () => {
    // a Vaporize at the first Dragon of Dark Decay hit
    const vaporize = (): RotationReactions => {
      let fired = false
      return {
        onHit(ctx, hit) {
          if (fired || hit.label !== 'Dragon of Dark Decay') return
          fired = true
          ctx.hit(0, {
            characterKey: 'Bennett',
            path: ['_reaction', 'vaporize'],
            tag: 'other',
            element: 'pyro',
            label: 'vaporize',
          })
        },
      }
    }
    const windows = (cons: number) =>
      run('Durin E N1 Q W25', cons, vaporize()).buffWindows.filter((w) =>
        ['c2Hydro', 'c2AfterBurst'].includes(w.path[1])
      )
    expect(windows(1)).toHaveLength(0)
    expect(windows(2).map((w) => w.end - w.start)).toEqual([360, 360])
  })
})
