import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  type RotationReactions,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const KEY: CharacterKey = 'YumemizukiMizuki'
/** Every Mizuki Anemo hit swirls Pyro (a reaction mark, then the Swirl's DMG 1 frame later) */
const swirling: RotationReactions = {
  onHit(ctx, hit) {
    if (
      hit.characterKey !== KEY ||
      hit.element !== 'anemo' ||
      hit.path[0].startsWith('_') ||
      hit.path[0] === 'reaction'
    )
      return
    ctx.hit(0, {
      characterKey: KEY,
      path: ['_reaction', 'pyroSwirl'],
      tag: 'other',
      element: 'pyro',
      label: 'pyroSwirl',
    })
    ctx.hit(1, {
      characterKey: KEY,
      path: ['reaction', 'pyroSwirl'],
      tag: 'other',
      element: 'pyro',
      label: 'Swirl (Pyro)',
    })
  },
}
const run = (
  text: string,
  cons: number,
  reactions: RotationReactions = { onHit() {} }
) =>
  simulateRotation({
    rotation: parseRotation(text, [{ characterKey: KEY, name: KEY }]),
    members: [KEY],
    elements: { [KEY]: 'anemo' },
    constellations: { [KEY]: cons },
    repeats: 1,
    keep: 'all',
    reactions,
  })

describe('Yumemizuki Mizuki', () => {
  it('holds a normal attack until the Dreamdrifter ends', () => {
    const sim = run('YumemizukiMizuki E N1', 0)
    expect(sim.warnings).toEqual([])
    expect(sim.actions.find((a) => a.text === 'N1')?.start).toBe(300)
    // its clouds: from 18 frames, every 44, each landing 30 later
    const clouds = sim.hits.filter((h) => h.path.join('.') === 'skill.contDmg')
    expect(clouds.slice(0, 3).map((h) => h.t)).toEqual([48, 92, 136])
  })

  it('extends the Dreamdrifter twice on Swirls (A1) and enhances the next cloud (Revelation)', () => {
    const sim = run('YumemizukiMizuki E N1', 0, swirling)
    // 300 + 2 × 150
    expect(sim.actions.find((a) => a.text === 'N1')?.start).toBe(600)
    const enhanced = sim.hits.filter(
      (h) => h.path.join('.') === 'lockedPassive.skillContDmg'
    )
    // one per 2.5 s (the swirl ICD of Revelation)
    expect(enhanced.length).toBeGreaterThanOrEqual(3)
    expect(enhanced.length).toBeLessThanOrEqual(4)
  })

  it('spends C1’s Twenty-Three Nights’ Awaiting on one Swirl per application', () => {
    const sim = run('YumemizukiMizuki E W12', 1, swirling)
    const extra = sim.hits.filter((h) => h.label === 'Mizuki C1')
    // applications at 4, 214 and 424 (the Dreamdrifter lasts 600 frames): the first cloud
    // Swirl in each (clouds land at 48 + 44k, their Swirl 1 frame later), the extra hit 3 later.
    // The skill's own Swirl at 3 is before the first application.
    expect(extra.map((h) => h.t)).toEqual([52, 228, 448])
    const covered = sim.buffWindows.filter(
      (w) => w.path[1] === 'c1Awaiting' && w.value === 'on'
    )
    expect(covered.every((w) => w.end - w.start <= 180)).toBe(true)
  })

  it('picks up each snack 0.3 s after it spawns', () => {
    const sim = run('YumemizukiMizuki Q W14', 0)
    const shock = sim.hits.filter((h) => h.label === 'Munen Shockwave')
    expect(shock.map((h) => h.t)).toEqual(
      Array.from({ length: 8 }, (_, k) => 93 + 90 * (k + 1) + 18)
    )
  })
})
