import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import { cmpGE, prod, subscript } from '@genshin-optimizer/pando/engine'
import {
  allBoolConditionals,
  customDmg,
  own,
  ownBuff,
  percent,
  register,
} from '../util'
import { entriesForWeapon } from './util'

// 7.3 beta weapon (passive only in CHS in the dump: 断剑重铸 "Reforged Blade")
const key: WeaponKey = 'BlazingLionfang'
const atk_arr = [-1, 0.2, 0.25, 0.3, 0.35, 0.4]
const dmg_arr = [-1, 2.8, 3.5, 4.2, 4.9, 5.6]

const {
  weapon: { refinement },
  final,
} = own
// WR cond(key, 'reforgedBlade') `'on'`
const { reforgedBlade } = allBoolConditionals(key)

export default register(
  key,
  entriesForWeapon(key),
  ownBuff.premod.atk_.add(
    reforgedBlade.ifOn(percent(subscript(refinement, atk_arr)))
  ),
  // switch-in AoE DMG while Reforged Blade is active (WR customDmgNode 'elemental', physical)
  customDmg(
    'switchInDmg',
    'physical',
    'elemental',
    prod(percent(subscript(refinement, dmg_arr)), final.atk),
    { cond: cmpGE(reforgedBlade.ifOn(1), 1, 'infer', '') }
  )
)
