import { characterAsset } from '@genshin-optimizer/gi/assets'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'

export function iconAsset(cKey: CharacterKey, gender: GenderKey) {
  return characterAsset(cKey, 'icon', gender) || ''
}
