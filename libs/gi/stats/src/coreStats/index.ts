import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocCharKey } from '@genshin-optimizer/gi/consts'
import { coreStats } from './data'

export type { CoreStats } from './derive'
export { coreStats }

/** Same as `getCharStat(ck).weaponType`, using only the small core stats. */
export function getCharWeaponType(ck: CharacterKey) {
  return coreStats.char.data[charKeyToLocCharKey(ck)].weaponType
}
