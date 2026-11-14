import { objKeyValMap } from '@genshin-optimizer/common/util'
import {
  type ArtifactSetKey,
  allStellarReactionKeys,
} from '@genshin-optimizer/gi/consts'
import type { Data } from '@genshin-optimizer/gi/wr'
import { equal, greaterEq, input, percent } from '@genshin-optimizer/gi/wr'
import { cond, trans } from '../../SheetUtil'
import { ArtifactSheet, setHeaderTemplate } from '../ArtifactSheet'
import { dataObjForArtifactSheet } from '../dataUtil'
import type { SetEffectSheet } from '../IArtifactSheet'

// 7.3 beta set (肇史之遗), officially "Epochal Advent" (the key keeps the provisional name).
const key: ArtifactSetKey = 'LegacyOfTheFirstChronicle'
const setHeader = setHeaderTemplate(key)
const [, trm] = trans('artifact', key)

const set2_atk_ = greaterEq(input.artSet[key], 2, percent(0.18))

// 4pc: while holding a Starspark (Undying Radiance), CRIT Rate of Cryo DMG +20%, and +20% more when
// that Cryo DMG is Stellar Glimmer (Stellar-Conduct / Stellar Swirl) reaction DMG. Works off-field:
// confirmed in game (2026-11-14), although the 7.2.51 beta text dropped the line saying so.
const [condRadiancePath, condRadiance] = cond(key, 'undyingRadiance')
const set4_cryo_critRate_ = greaterEq(
  input.artSet[key],
  4,
  equal(condRadiance, 'on', percent(0.2))
)
// Stellar reaction CRIT Rate also reaches the wearer's non-Cryo Stellar hits (e.g. Electro
// Stellar-Conduct), so the extra 20% is only given to Cryo wearers, whose Stellar hits are Cryo.
const set4_stellar_critRate_obj = objKeyValMap(allStellarReactionKeys, (k) => [
  `${k}_critRate_`,
  greaterEq(
    input.artSet[key],
    4,
    equal(condRadiance, 'on', equal(input.charEle, 'cryo', percent(0.2)))
  ),
])

export const data: Data = dataObjForArtifactSheet(key, {
  premod: {
    atk_: set2_atk_,
    cryo_critRate_: set4_cryo_critRate_,
    ...set4_stellar_critRate_obj,
  },
})

const sheet: SetEffectSheet = {
  2: { document: [{ header: setHeader(2), fields: [{ node: set2_atk_ }] }] },
  4: {
    document: [
      {
        header: setHeader(4),
        value: condRadiance,
        path: condRadiancePath,
        name: trm('condName'),
        states: {
          on: {
            fields: [
              { node: set4_cryo_critRate_ },
              ...Object.values(set4_stellar_critRate_obj).map((node) => ({
                node,
              })),
            ],
          },
        },
      },
    ],
  },
}
export default new ArtifactSheet(sheet, data)
