import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const run = (
  text: string,
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>> = {}
) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(
      members.map((m) => [m, kitModels[m]!.element])
    ) as never,
    constellations,
    repeats: 1,
    keep: 'all',
  })
it("Shenhe's burst DoT keeps the stats from just before the field's first A1 tick", () => {
  const sim = run('Shenhe Q W20', ['Shenhe'], { Shenhe: 2 })
  const dot = sim.hits.filter((h) => h.label.endsWith('(DoT)'))
  expect(dot).toHaveLength(18)
  expect(dot.every((h) => h.statSnapshots?.every((s) => s.t === 46))).toBe(true)
  // the field's buffs last until 0.6 s after its last 18-frame check
  const field = sim.buffWindows.find((w) => w.path[1] === 'asc1')!
  expect(field.start).toBe(47)
  expect(field.end).toBe(47 + 18 * Math.floor(1079 / 18) + 36)
})
