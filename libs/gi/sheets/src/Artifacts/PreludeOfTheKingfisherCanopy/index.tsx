import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import type { Data } from '@genshin-optimizer/gi/wr'
import { greaterEq, input, percent } from '@genshin-optimizer/gi/wr'
import { ArtifactSheet, setHeaderTemplate } from '../ArtifactSheet'
import { dataObjForArtifactSheet } from '../dataUtil'
import type { SetEffectSheet } from '../IArtifactSheet'

// 7.3 beta set (遥天奉翠华引); the English name is a provisional translation.
const key: ArtifactSetKey = 'PreludeOfTheKingfisherCanopy'
const setHeader = setHeaderTemplate(key)

const set2_enerRech_ = greaterEq(input.artSet[key], 2, percent(0.2))
// 4pc as revealed so far: Elemental Skill and Burst DMG +25% ("more effects will be revealed in
// later versions"; the dump's other two parameters, 0.3 and 10, are not described yet).
const set4_skill_dmg_ = greaterEq(input.artSet[key], 4, percent(0.25))
const set4_burst_dmg_ = greaterEq(input.artSet[key], 4, percent(0.25))

export const data: Data = dataObjForArtifactSheet(key, {
  premod: {
    enerRech_: set2_enerRech_,
    skill_dmg_: set4_skill_dmg_,
    burst_dmg_: set4_burst_dmg_,
  },
})

const sheet: SetEffectSheet = {
  2: {
    document: [{ header: setHeader(2), fields: [{ node: set2_enerRech_ }] }],
  },
  4: {
    document: [
      {
        header: setHeader(4),
        fields: [{ node: set4_skill_dmg_ }, { node: set4_burst_dmg_ }],
      },
    ],
  },
}
export default new ArtifactSheet(sheet, data)
