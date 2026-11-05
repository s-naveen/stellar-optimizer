import { objKeyMap, range } from '@genshin-optimizer/common/util'
import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import { allStats } from '@genshin-optimizer/gi/stats'
import {
  equal,
  infoMut,
  input,
  lookup,
  naught,
  prod,
  subscript,
  sum,
} from '@genshin-optimizer/gi/wr'
import { cond, st, stg, trans } from '../../../SheetUtil'
import type { IWeaponSheet } from '../../IWeaponSheet'
import { dataObjForWeaponSheet } from '../../util'
import { headerTemplate, WeaponSheet } from '../../WeaponSheet'

// 7.2 beta weapon
const key: WeaponKey = 'StarsealedEdict'
const [, trm] = trans('weapon', key)
const data_gen = allStats.weapon.data[key]

const critDMG_arr = data_gen.refinementBonus.critDMG_
if (!critDMG_arr)
  throw new Error(`data_gen.refinementBonus.critDMG_ for ${key} was undefined`)
const eleMas_arr = [-1, 48, 60, 72, 84, 96]
const stack_eleMas_arr = [-1, 24, 30, 36, 42, 48]
const stack_stellarconduct_critDMG_arr = [-1, 0.12, 0.15, 0.18, 0.21, 0.24]

const critDMG_ = equal(
  input.weapon.key,
  key,
  subscript(input.weapon.refinement, critDMG_arr)
)

// "Crystal Compounding": 20s after using an Elemental Skill
const [condCompoundingPath, condCompounding] = cond(key, 'crystalCompounding')
const compounding_eleMas = equal(
  condCompounding,
  'on',
  subscript(input.weapon.refinement, eleMas_arr)
)

// "Law of Combustion": a stack whenever a nearby party member triggers an Elemental Reaction during
// Crystal Compounding (max 3, they end with it)
const [condStacksPath, condStacks] = cond(key, 'lawOfCombustion')
const stacksArr = range(1, 3)
const stacks_eleMas = equal(
  condCompounding,
  'on',
  lookup(
    condStacks,
    objKeyMap(stacksArr, (stack) =>
      prod(stack, subscript(input.weapon.refinement, stack_eleMas_arr))
    ),
    naught
  )
)
// In Radiance: Stellar-Conduct (the wielder's state, set on their character sheet) each stack also
// raises the wielder's Stellar-Conduct CRIT DMG
const stacks_stellarconduct_critDMG_ = equal(
  condCompounding,
  'on',
  equal(
    input.flags.radiance,
    'sc',
    lookup(
      condStacks,
      objKeyMap(stacksArr, (stack) =>
        prod(
          stack,
          subscript(input.weapon.refinement, stack_stellarconduct_critDMG_arr, {
            unit: '%',
          })
        )
      ),
      naught
    )
  )
)

const data = dataObjForWeaponSheet(key, {
  premod: {
    critDMG_,
    eleMas: sum(compounding_eleMas, stacks_eleMas),
    stellarconduct_critDMG_: stacks_stellarconduct_critDMG_,
  },
})

const sheet: IWeaponSheet = {
  document: [
    {
      header: headerTemplate(key, st('base')),
      fields: [{ node: critDMG_ }],
    },
    {
      value: condCompounding,
      path: condCompoundingPath,
      header: headerTemplate(key, st('conditional')),
      name: trm('crystalCompounding'),
      states: {
        on: {
          fields: [
            { node: infoMut(compounding_eleMas, { path: 'eleMas' }) },
            { text: stg('duration'), value: 20, unit: 's' },
          ],
        },
      },
    },
    {
      value: condStacks,
      path: condStacksPath,
      header: headerTemplate(key, st('stacks')),
      name: trm('lawOfCombustion'),
      canShow: equal(condCompounding, 'on', 1),
      states: objKeyMap(stacksArr, (stack) => ({
        name: st('stack', { count: stack }),
        fields: [
          { node: infoMut(stacks_eleMas, { path: 'eleMas' }) },
          {
            node: infoMut(stacks_stellarconduct_critDMG_, {
              path: 'stellarconduct_critDMG_',
            }),
          },
        ],
      })),
    },
  ],
}
export default new WeaponSheet(sheet, data)
