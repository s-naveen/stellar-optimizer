import {
  allStellarReactionKeys,
  type WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { subscript } from '@genshin-optimizer/pando/engine'
import { allBoolConditionals, own, ownBuff, percent, register } from '../util'
import { entriesForWeapon } from './util'

// 7.3 beta weapon
const key: WeaponKey = 'Silverdawn'
const atk_arr = [-1, 0.4, 0.52, 0.64, 0.76, 0.88]
const stellar_critDMG_arr = [-1, 0.4, 0.52, 0.64, 0.76, 0.88]

const {
  weapon: { refinement },
} = own
const { whiteCrownsBequest } = allBoolConditionals(key)

export default register(
  key,
  entriesForWeapon(key),
  ownBuff.premod.atk_.add(
    whiteCrownsBequest.ifOn(percent(subscript(refinement, atk_arr)))
  ),
  // Stellar Glimmer = Stellar-Conduct and Stellar Swirl
  allStellarReactionKeys.map((k) =>
    ownBuff.premod.critDMG_[k].add(
      whiteCrownsBequest.ifOn(
        percent(subscript(refinement, stellar_critDMG_arr))
      )
    )
  )
)
