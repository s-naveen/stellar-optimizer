import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  constant,
  equal,
  infoMut,
  input,
  prod,
  subscript,
} from '@genshin-optimizer/gi/wr'
import { customDmgNode } from '../../../Characters/dataUtil'
import { cond, st, trans } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

// 7.3 beta weapon; the passive is only in CHS in the dump (断剑重铸, translated "Reforged Blade")
const key: WeaponKey = 'BlazingLionfang'
const [, trm] = trans('weapon', key)

const atk_arr = [-1, 0.2, 0.25, 0.3, 0.35, 0.4]
const dmg_arr = [-1, 2.8, 3.5, 4.2, 4.9, 5.6]

// Reforged Blade: after 5s off-field (in total); lost after 10s on-field (in total)
const [condReforgedPath, condReforged] = cond(key, 'reforgedBlade')
const reforged_atk_ = equal(
  condReforged,
  'on',
  subscript(input.weapon.refinement, atk_arr)
)
// while Reforged Blade is active: switching in during combat deals AoE DMG (once every 14s)
const switchInDmg = equal(
  input.weapon.key,
  key,
  equal(
    condReforged,
    'on',
    customDmgNode(
      prod(
        subscript(input.weapon.refinement, dmg_arr, { unit: '%' }),
        input.total.atk
      ),
      'elemental',
      { hit: { ele: constant('physical') } }
    )
  )
)

const data = dataObjForWeaponSheet(
  key,
  { premod: { atk_: reforged_atk_ } },
  { switchInDmg }
)

const sheet: IWeaponSheet = {
  document: [
    {
      value: condReforged,
      path: condReforgedPath,
      header: headerTemplate(key, st('conditional')),
      name: trm('reforgedBlade'),
      states: {
        on: {
          fields: [
            { node: infoMut(reforged_atk_, { path: 'atk_' }) },
            { node: infoMut(switchInDmg, { name: trm('switchInDmg') }) },
            { text: st('cd'), value: 14, unit: 's' },
          ],
        },
      },
    },
  ],
}
export default new WeaponSheet(sheet, data)
