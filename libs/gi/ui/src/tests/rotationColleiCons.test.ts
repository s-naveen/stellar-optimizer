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
it("Collei's A1 Sprout needs a Dendro reaction while the ring is out (C2: always)", () => {
  const sprouts = (members: CharacterKey[], text: string, cons = 0) =>
    run(text, members, { Collei: cons }).hits.filter((h) =>
      h.label.startsWith('Floral Sidewinder')
    ).length
  expect(sprouts(['Collei'], 'Collei E W8')).toBe(0)
  expect(sprouts(['Collei'], 'Collei E W8', 2)).toBe(2)
  // Oz's Electro, then Floral Brush quickens it while the ring is out
  expect(
    sprouts(['Fischl', 'Collei'], 'Fischl E -> Collei E W8')
  ).toBeGreaterThan(0)
})

it("Collei's A4: her Dendro reactions in the Zone extend Trump-Card Kitty by up to 3 s", () => {
  const leaps = (members: CharacterKey[], text: string) =>
    run(text, members).hits.filter((h) => h.label === 'Trump-Card Kitty (Leap)')
      .length
  expect(leaps(['Collei'], 'Collei Q W10')).toBe(12)
  const extended = leaps(
    ['Fischl', 'Collei'],
    'Fischl E -> Collei Q N4 N4 N4 W10'
  )
  expect(extended).toBeGreaterThan(12)
  expect(extended).toBeLessThanOrEqual(18)
})
