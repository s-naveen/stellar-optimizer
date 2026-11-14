import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Columbina', 'Flins']
/** A teammate whose hits are Lunar-Charged reactions every 30 frames from frame 100 */
const lunar: KitModel = {
  characterKey: 'Flins',
  element: 'electro',
  source: 'test',
  act(ctx) {
    for (let t = 100; t < 900; t += 30)
      ctx.hit(t, {
        path: ['_reaction', 'lunarCharged'],
        tag: 'other',
        element: 'electro',
        label: 'Lunar reaction',
      })
    return { frames: 1 }
  },
}
const run = (text: string, constellation = 0) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: { Columbina: 'hydro', Flins: 'electro' },
    constellations: { Columbina: constellation },
    repeats: 1,
    keep: 'all',
    kits: { Columbina: kitModels.Columbina, Flins: lunar },
  })

describe('Columbina (gcsim frames and Gravity)', () => {
  it('adds the 2-frame windup to an N1 that restarts the string', () => {
    const sim = run('Columbina N3 N1 W1')
    expect(sim.hits.filter((h) => h.tag === 'normal').map((h) => h.t)).toEqual([
      23, 44, 85, 143,
    ])
  })

  it('accrues Gravity in 3-frame calls: 60 after 120 calls from the first Lunar event', () => {
    const sim = run('Columbina E -> Flins E W15')
    const first =
      sim.actions.find((a) => a.characterKey === 'Flins')!.start + 100
    const ticks = sim.hits
      .filter((h) => h.label.startsWith('Gravity Interference'))
      .map((h) => h.t)
    // the reaction names the type before its call (gcsim's hook): 0.5 per call, the 120th
    // reaches 60; the Lunar-Charged hit lands 43 frames after the tick
    expect(ticks[0]).toBe(first + 119 * 3 + 43)
  })
})
