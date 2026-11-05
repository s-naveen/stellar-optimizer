import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import { prod, subscript } from '@genshin-optimizer/pando/engine'
import {
  allBoolConditionals,
  allNumConditionals,
  own,
  ownBuff,
  percent,
  register,
} from '../util'
import { entriesForWeapon } from './util'

// 7.2 beta weapon. The CRIT DMG passive comes from the generated refinementBonus (entriesForWeapon).
const key: WeaponKey = 'StarsealedEdict'
const eleMas_arr = [-1, 48, 60, 72, 84, 96]
const stack_eleMas_arr = [-1, 24, 30, 36, 42, 48]
const stack_stellarconduct_critDMG_arr = [-1, 0.12, 0.15, 0.18, 0.21, 0.24]

const {
  weapon: { refinement },
} = own
// lockStellarRadianceSc: WR reads the wielder's flags.radiance === 'sc' (see WintersHeavyHeart)
const { crystalCompounding, lockStellarRadianceSc } = allBoolConditionals(key)
const { lawOfCombustion } = allNumConditionals(key, true, 0, 3)

export default register(
  key,
  entriesForWeapon(key),
  ownBuff.premod.eleMas.add(
    crystalCompounding.ifOn(subscript(refinement, eleMas_arr))
  ),
  ownBuff.premod.eleMas.add(
    crystalCompounding.ifOn(
      prod(lawOfCombustion, subscript(refinement, stack_eleMas_arr))
    )
  ),
  ownBuff.premod.critDMG_.stellarconduct.add(
    crystalCompounding.ifOn(
      lockStellarRadianceSc.ifOn(
        prod(
          lawOfCombustion,
          percent(subscript(refinement, stack_stellarconduct_critDMG_arr))
        )
      )
    )
  )
)
