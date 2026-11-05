import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import { prod, subscript } from '@genshin-optimizer/pando/engine'
import { destIsActive } from '../common/conds'
import {
  allListConditionals,
  own,
  ownBuff,
  percent,
  register,
  teamBuff,
} from '../util'
import { entriesForWeapon } from './util'

// 7.3 beta weapon
const key: WeaponKey = 'TorrentsOfSpring'
const atk_arr = [-1, 0.16, 0.2, 0.24, 0.28, 0.32]
const stellarconduct_dmg_arr = [-1, 0.2, 0.25, 0.3, 0.35, 0.4]

const {
  weapon: { refinement },
} = own
// "Royal Decree"; "complete" = its order is Complete (doubles both effects)
const { royalDecree } = allListConditionals(key, ['decree', 'complete'])

export default register(
  key,
  entriesForWeapon(key),
  ownBuff.premod.atk_.add(percent(subscript(refinement, atk_arr))),
  ownBuff.premod.atk_.add(
    prod(
      royalDecree.map({ decree: 0, complete: 1 }),
      percent(subscript(refinement, atk_arr))
    )
  ),
  // WR equal(activeCharKey, target.charKey): Stellar-Conduct DMG of the active character only
  teamBuff.premod.dmg_.stellarconduct.add(
    prod(
      destIsActive,
      royalDecree.map({ decree: 1, complete: 2 }),
      percent(subscript(refinement, stellarconduct_dmg_arr))
    )
  )
)
