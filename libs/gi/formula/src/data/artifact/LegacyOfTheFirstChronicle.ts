import {
  type ArtifactSetKey,
  allStellarReactionKeys,
} from '@genshin-optimizer/gi/consts'
import { cmpEq, cmpGE } from '@genshin-optimizer/pando/engine'
import { allBoolConditionals, own, ownBuff, percent } from '../util'
import { artCount, registerArt } from './util'

// 7.3 beta set (肇史之遗); the English name is a provisional translation.
const key: ArtifactSetKey = 'LegacyOfTheFirstChronicle',
  count = artCount(key)
const {
  char: { ele: charEle },
} = own
// Undying Radiance (holding a Starspark)
const { undyingRadiance } = allBoolConditionals(key)
const set4_critRate_ = cmpGE(count, 4, undyingRadiance.ifOn(percent(0.2)))

export default registerArt(
  key,
  ownBuff.premod.atk_.add(cmpGE(count, 2, percent(0.18))),
  ownBuff.premod.critRate_.cryo.add(set4_critRate_),
  // the extra 20% for Stellar Glimmer DMG: Cryo wearers only, as in WR
  allStellarReactionKeys.map((k) =>
    ownBuff.premod.critRate_[k].add(cmpEq(charEle, 'cryo', set4_critRate_))
  )
)
