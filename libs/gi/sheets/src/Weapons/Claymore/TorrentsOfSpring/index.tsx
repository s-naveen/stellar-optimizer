import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import {
  equal,
  infoMut,
  input,
  lookup,
  naught,
  prod,
  subscript,
  sum,
  target,
} from '@genshin-optimizer/gi/wr'
import { cond, st, stg, trans } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

// 7.3 beta weapon
const key: WeaponKey = 'TorrentsOfSpring'
const [, trm] = trans('weapon', key)

const atk_arr = [-1, 0.16, 0.2, 0.24, 0.28, 0.32]
const stellarconduct_dmg_arr = [-1, 0.2, 0.25, 0.3, 0.35, 0.4]

const base_atk_ = subscript(input.weapon.refinement, atk_arr)

// "Royal Decree" (15s, after the wielder's Electro attacks hit; also works off-field); its order is
// "Complete" once the wielder's Stellar-Conduct attacks hit, which doubles both effects.
const [condDecreePath, condDecree] = cond(key, 'royalDecree')
const complete_atk_ = equal(
  condDecree,
  'complete',
  subscript(input.weapon.refinement, atk_arr)
)
const decree_stellarconduct_dmg_disp = lookup(
  condDecree,
  {
    decree: subscript(input.weapon.refinement, stellarconduct_dmg_arr, {
      unit: '%',
    }),
    complete: prod(
      2,
      subscript(input.weapon.refinement, stellarconduct_dmg_arr, {
        unit: '%',
      })
    ),
  },
  naught
)
// Stellar-Conduct DMG dealt by the active (on-field) character, the wielder included
const decree_stellarconduct_dmg_ = equal(
  input.activeCharKey,
  target.charKey,
  decree_stellarconduct_dmg_disp
)

const data = dataObjForWeaponSheet(key, {
  premod: {
    atk_: sum(base_atk_, complete_atk_),
  },
  teamBuff: {
    premod: {
      stellarconduct_dmg_: decree_stellarconduct_dmg_,
    },
  },
})

const sheet: IWeaponSheet = {
  document: [
    {
      header: headerTemplate(key, st('base')),
      fields: [{ node: infoMut(base_atk_, { path: 'atk_' }) }],
    },
    {
      value: condDecree,
      path: condDecreePath,
      teamBuff: true,
      header: headerTemplate(key, st('conditional')),
      name: trm('royalDecree'),
      states: {
        decree: {
          name: trm('decree'),
          fields: [
            {
              node: infoMut(decree_stellarconduct_dmg_disp, {
                path: 'stellarconduct_dmg_',
                isTeamBuff: true,
              }),
            },
            { text: stg('duration'), value: 15, unit: 's' },
          ],
        },
        complete: {
          name: trm('complete'),
          fields: [
            { node: infoMut(complete_atk_, { path: 'atk_' }) },
            {
              node: infoMut(decree_stellarconduct_dmg_disp, {
                path: 'stellarconduct_dmg_',
                isTeamBuff: true,
              }),
            },
            { text: stg('duration'), value: 15, unit: 's' },
          ],
        },
      },
    },
  ],
}
export default new WeaponSheet(sheet, data)
