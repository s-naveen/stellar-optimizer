import type { ArtifactSetKey } from '@genshin-optimizer/gi/consts'
import { cmpGE } from '@genshin-optimizer/pando/engine'
import { ownBuff, percent } from '../util'
import { artCount, registerArt } from './util'

// 7.3 beta set (遥天奉翠华引); the English name is a provisional translation.
// 4pc as revealed so far ("more effects will be revealed in later versions").
const key: ArtifactSetKey = 'PreludeOfTheKingfisherCanopy',
  count = artCount(key)

export default registerArt(
  key,
  ownBuff.premod.enerRech_.add(cmpGE(count, 2, percent(0.2))),
  ownBuff.premod.dmg_.skill.add(cmpGE(count, 4, percent(0.25))),
  ownBuff.premod.dmg_.burst.add(cmpGE(count, 4, percent(0.25)))
)
