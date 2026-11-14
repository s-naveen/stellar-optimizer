/*
 * Lunar-Crystallize lives in reactions.ts (gcsim's reactable, with the other reactions); these are
 * the names the kits use.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { reactionEnablers } from './reactions'

export { HARMONY_MARK, MOONDRIFT_MARK, REACTION_MARK } from './reactions'

/** Members that turn Hydro Crystallize into Lunar-Crystallize */
export const lunarCrystallizeEnablers: CharacterKey[] =
  reactionEnablers.lunarCrystallize
