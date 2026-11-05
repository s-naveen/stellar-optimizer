import { objKeyValMap } from '@genshin-optimizer/common/util'
import {
  allStellarReactionKeys,
  type WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { equal, input, subscript } from '@genshin-optimizer/gi/wr'
import { cond, st, stg, trans } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

// 7.3 beta weapon
const key: WeaponKey = 'Silverdawn'
const [, trm] = trans('weapon', key)

const atk_arr = [-1, 0.4, 0.52, 0.64, 0.76, 0.88]
const stellar_critDMG_arr = [-1, 0.4, 0.52, 0.64, 0.76, 0.88]

// "White Crown's Bequest": 6s after using an Elemental Skill or Burst, +3s per Stellar Glimmer
// reaction (up to 8 times). The Energy regeneration has no stat effect and is not modelled.
const [condBequestPath, condBequest] = cond(key, 'whiteCrownsBequest')
const atk_ = equal(
  condBequest,
  'on',
  subscript(input.weapon.refinement, atk_arr)
)
// Stellar Glimmer = Stellar-Conduct and Stellar Swirl
const stellar_critDMG_obj = objKeyValMap(allStellarReactionKeys, (k) => [
  `${k}_critDMG_`,
  equal(
    condBequest,
    'on',
    subscript(input.weapon.refinement, stellar_critDMG_arr, { unit: '%' })
  ),
])

const data = dataObjForWeaponSheet(key, {
  premod: {
    atk_,
    ...stellar_critDMG_obj,
  },
})

const sheet: IWeaponSheet = {
  document: [
    {
      value: condBequest,
      path: condBequestPath,
      header: headerTemplate(key, st('conditional')),
      name: trm('whiteCrownsBequest'),
      states: {
        on: {
          fields: [
            { node: atk_ },
            ...Object.values(stellar_critDMG_obj).map((node) => ({ node })),
            { text: stg('duration'), value: 6, unit: 's' },
          ],
        },
      },
    },
  ],
}
export default new WeaponSheet(sheet, data)
