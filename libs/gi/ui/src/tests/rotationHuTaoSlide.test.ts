import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'

const play = (text: string) => {
  const members: CharacterKey[] = ['HuTao', 'Xingqiu']
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: {},
    elements: { HuTao: 'pyro', Xingqiu: 'hydro' },
    repeats: 1,
    keep: 'all',
  })
}

/** The frame A1 (Flutter By) starts: when Paramita Papilio ends by itself */
const a1Start = (sim: ReturnType<typeof play>) =>
  sim.buffWindows.find((w) => w.path.join('.') === 'HuTao.FlutterBy')?.start

describe('Hu Tao', () => {
  it('takes back the 1.8 s Paramita extension when a charged attack ends', () => {
    const plain = play('HuTao E W12')
    const slid = play('HuTao E N2 CA N2 CA N2 CA W12')
    expect(a1Start(plain)! - plain.actions[0].start).toBe(554)
    // (her hitlag still extends the stance, as in gcsim)
    const hitlag = slid.hits
      .filter((h) => h.characterKey === 'HuTao' && h.path[0] === '_marker')
      .reduce((sum, h) => sum + (h.animationPause ?? 0), 0)
    expect(hitlag).toBeGreaterThan(0)
    expect(a1Start(slid)! - slid.actions[0].start).toBe(554 + hitlag)
  })

  it('keeps the extension into her burst (Paramita slide)', () => {
    const sim = play('HuTao E W7.8 N1 CA Q W6')
    const end = a1Start(sim)! - sim.actions[0].start
    // the stance would have ended at 554: the slide carries it past the burst's hit
    const burst = sim.hits.find((h) => h.label.startsWith('Spirit Soother'))!
    expect(end).toBeGreaterThan(554)
    expect(
      rotationAttacks(sim)
        .HuTao!.find((a) => a.path[0] === 'burst')!
        .states?.some(
          (s) => s.path[1] === 'GuideToAfterlifeVoyage' && s.value === 'on'
        )
    ).toBe(true)
    expect(burst.t - sim.actions[0].start).toBeLessThan(end + 66)
  })
})
