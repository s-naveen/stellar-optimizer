import { artSubstatRollData } from '@genshin-optimizer/gi/consts'
import type { BuildTc } from '@genshin-optimizer/gi/db'
import { getSubstatValue } from '@genshin-optimizer/gi/util'

/** How many substat rolls the theorycraft build's artifacts hold at their levels */
export function tcRollCapacity({ artifact: { slots } }: BuildTc) {
  return Object.values(slots).reduce(
    (total, { level, rarity }) =>
      total + artSubstatRollData[rarity].high + Math.floor(level / 4),
    0
  )
}

/** How many rolls (of the build's roll size) its substats amount to */
export function tcRollsUsed({
  artifact: {
    substats: { stats, rarity, type },
  },
}: BuildTc) {
  return Object.entries(stats).reduce(
    (total, [key, value]) =>
      total + value / getSubstatValue(key as keyof typeof stats, rarity, type),
    0
  )
}
