import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type RotationReactions,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

/** A Frozen reaction (by a teammate) at each of these frames (after the first hit, at 11) */
const freezes = (frames: number[]): RotationReactions => {
  let done = false
  return {
    onHit(ctx) {
      if (done) return
      done = true
      for (const t of frames)
        ctx.hit(t - ctx.now, {
          characterKey: 'Furina',
          path: ['_reaction', 'frozen'],
          tag: 'other',
          element: 'cryo',
          label: 'frozen',
        })
    },
  }
}
const run = (text: string, cons: number, reactions: RotationReactions) => {
  const members: CharacterKey[] = ['Skirk', 'Furina']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Skirk: 'cryo', Furina: 'hydro' },
    constellations: { Skirk: cons },
    repeats: 1,
    keep: 'all',
    reactions,
  })
}
const extinction = (sim: ReturnType<typeof run>) =>
  sim.hits
    .filter((h) => h.characterKey === 'Skirk' && h.tag === 'normal')
    .map(
      (h) =>
        h.states?.find((s) => s.path[1] === 'burstVoidAbsorb')?.value ?? '-'
    )

describe('Skirk', () => {
  it('absorbs the Void Rifts with Havoc: Extinction (A1) for its 10 Normal Attack hits', () => {
    // two rifts before the flash (a third Frozen inside the 2.5 s ICD makes none)
    const sim = run('Skirk N1 W4 E Q N5 N5 W1', 0, freezes([20, 80, 200]))
    expect(sim.warnings).toEqual([])
    const values = extinction(sim)
    // the N1 before the flash is not covered; then 10 hits with 2 rifts' bonus
    expect(values[0]).toBe('-')
    expect(values.slice(1, 11)).toEqual(Array(10).fill('2'))
    expect(values.slice(11).every((v) => v === '-')).toBe(true)
  })

  it('summons a C1 blade per absorbed rift, and C6 stacks for Ruin and the flash N3 / N5', () => {
    const sim = run('Skirk N1 W4 E Q N5 N5 W1', 6, freezes([20, 200]))
    expect(sim.hits.filter((h) => h.label === 'Far to Fall (C1)')).toHaveLength(
      2
    )
    // 2 stacks: the first flash N3 and N5 each spend one (3 coordinated hits)
    const sever = sim.hits.filter(
      (h) => h.label === 'Havoc: Sever (Normal, C6)'
    )
    expect(sever).toHaveLength(6)
    // Havoc: Ruin spends all of them at once
    const ruin = run('Skirk N1 W4 Q W3', 6, freezes([20, 200]))
    expect(
      ruin.hits.filter((h) => h.label === 'Havoc: Sever (Burst, C6)')
    ).toHaveLength(0)
    const held = run('Skirk N1 W4 hE W1 Q W3', 6, freezes([20, 200]))
    expect(
      held.hits.filter((h) => h.label === 'Havoc: Sever (Burst, C6)')
    ).toHaveLength(2)
  })

  it('casts Havoc: Ruin below 50 Subtlety (bursts ignore their cost) and notes it', () => {
    const sim = run('Skirk Q W3 Q', 0, { onHit() {} })
    expect(sim.warnings).toEqual([])
    expect(sim.notes.some((n) => n.includes('below 50'))).toBe(true)
  })
})
