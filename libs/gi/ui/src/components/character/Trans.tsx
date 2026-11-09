import {
  type CharacterKey,
  charKeyToLocGenderedCharKey,
  type GenderKey,
  type LocationGenderedCharacterKey,
} from '@genshin-optimizer/gi/consts'
import { Translate } from '@genshin-optimizer/gi/i18n'

export function CharacterName({
  characterKey,
  gender = 'F',
}: {
  characterKey: CharacterKey
  gender: GenderKey
}) {
  const cKey = charKeyToLocGenderedCharKey(characterKey, gender)
  return <Translate ns="charNames_gen" key18={cKey} />
}
export function CharacterConstellationName({
  characterKey,
  gender = 'F',
}: {
  characterKey: CharacterKey
  gender: GenderKey
}) {
  let cKey = characterKey as LocationGenderedCharacterKey
  if (characterKey.startsWith('Traveler')) cKey = `Traveler${gender}`
  return <Translate ns={`char_${cKey}_gen`} key18="constellationName" />
}
