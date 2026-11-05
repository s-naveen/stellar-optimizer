import type {
  MainStatKey,
  StellarReactionKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import { input } from '../formula'
import type { Data, NumNode } from '../type'
import { infoMut, one, prod, sum } from '../utils'
import { transMulti1 } from './multi'
import { specialReactionDmgNode } from './special'

export type StellarVariants = {
  stellarconduct: 'electro' | 'cryo'
  stellarswirl: 'anemo' | 'cryo'
}
export function stellarDmgNode<Variant extends StellarReactionKey>(
  multiplier: NumNode,
  base: 'reaction' | MainStatKey | SubstatKey,
  variant: Variant,
  eleVariant: StellarVariants[Variant],
  additional: Data = {},
  specialMultiplier?: NumNode
) {
  const node = specialReactionDmgNode(
    multiplier,
    base,
    variant,
    additional,
    stellarDmgMultiplier(base, variant),
    specialMultiplier,
    eleVariant
  )
  if (eleVariant === 'cryo') {
    return infoMut(node, { subVariant: 'cryo' })
  } else return node
}

function stellarDmgMultiplier(
  base: 'reaction' | MainStatKey | SubstatKey,
  variant: StellarReactionKey
) {
  // Stellar Swirl's base reaction multiplier can be increased (e.g. Anastasya A4: +15%).
  // `stellarswirl_mult_` is 0 unless a sheet sets it, so other reactions are unaffected.
  if (base === 'reaction')
    return variant === 'stellarswirl'
      ? prod(transMulti1, sum(one, input.total.stellarswirl_mult_))
      : transMulti1
  switch (variant) {
    case 'stellarconduct':
      return sum(one, input.total[`${variant}_mult_`])
    case 'stellarswirl':
      return sum(one, input.total[`${variant}_mult_`])
  }
}
