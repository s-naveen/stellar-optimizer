import { objPathValue } from '@genshin-optimizer/common/util'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { getDisplayHeader, resolveInfo } from '@genshin-optimizer/gi/ui'
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import { Box, Tooltip, Typography } from '@mui/material'
import { useMemo } from 'react'

/** The attack at `path` of a member's display, and what it is called */
export function useAttackInfo(data: UIData | undefined, path: string[]) {
  const database = useDatabase()
  return useMemo(() => {
    if (!data) return undefined
    const node = objPathValue(data.getDisplay(), path) as CalcResult | undefined
    if (!node?.info) return undefined
    const { name, textSuffix, variant, subVariant } = resolveInfo(node.info)
    const header = getDisplayHeader(data, path[0], database)
    return {
      node,
      name,
      textSuffix,
      variant,
      // (for the color only: a Stellar hit takes no amp or additive reaction)
      element: hitColorKey(variant, subVariant),
      header,
    }
  }, [data, path, database])
}

/**
 * The palette color a hit is shown in: its element, or for a Stellar or Lunar hit that reaction's
 * own hue (the game's damage numbers: a pale tint of the element, so they stand apart from plain
 * Electro or Cryo hits). A Stellar hit marked Cryo by its sheet takes the Cryo Stellar hue.
 */
function hitColorKey(variant: string | undefined, subVariant?: string) {
  switch (variant) {
    case 'stellarconduct':
    case 'stellarswirl':
      return subVariant === 'cryo' ? 'stellarcryo' : variant
    default:
      return variant
  }
}

const hitColors = [
  'anemo',
  'geo',
  'electro',
  'hydro',
  'pyro',
  'cryo',
  'dendro',
  'physical',
  'stellarconduct',
  'stellarcryo',
  'stellarswirl',
  'lunarcharged',
  'lunarbloom',
  'lunarcrystallize',
] as const
/** The palette color of a hit (see `hitColorKey`), if it has one */
export function variantColor(variant: string | undefined) {
  return variant && (hitColors as readonly string[]).includes(variant)
    ? `${variant}.main`
    : 'text.primary'
}

/** An attack's name (colored by its element) over where it comes from (the talent) */
export function AttackName({
  data,
  path,
  dense = false,
  oneLine = false,
}: {
  data: UIData | undefined
  path: string[]
  /** No talent icon */
  dense?: boolean
  /** Only the attack's name (the talent it comes from is in a tooltip) */
  oneLine?: boolean
}) {
  const info = useAttackInfo(data, path)
  if (!info)
    return (
      <Typography variant="body2" color="text.secondary" noWrap>
        {path.join(' · ')}
      </Typography>
    )
  const { name, textSuffix, element, header } = info
  if (oneLine)
    return (
      <Tooltip title={header?.title ?? ''} placement="top-start">
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}
        >
          {header?.icon && (
            <Box
              aria-hidden
              sx={{
                display: 'grid',
                placeItems: 'center',
                flexShrink: 0,
                width: 22,
                height: 22,
                '& img': { width: 22, height: 'auto' },
                '& .MuiSvgIcon-root': { fontSize: 18 },
              }}
            >
              {header.icon}
            </Box>
          )}
          <Typography
            variant="body2"
            noWrap
            sx={{ fontWeight: 600, color: variantColor(element), minWidth: 0 }}
          >
            {name}
            {textSuffix && <span> {textSuffix}</span>}
          </Typography>
        </Box>
      </Tooltip>
    )
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
      {!dense && header?.icon && (
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
            width: 28,
            height: 28,
            '& img': { width: 28, height: 'auto' },
            '& .MuiSvgIcon-root': { fontSize: 22 },
          }}
        >
          {header.icon}
        </Box>
      )}
      <Box sx={{ minWidth: 0 }}>
        <Typography
          variant="body2"
          noWrap
          sx={{ fontWeight: 600, color: variantColor(element) }}
        >
          {name}
          {textSuffix && <span> {textSuffix}</span>}
        </Typography>
        {header?.title && (
          <Typography
            variant="caption"
            component="div"
            color="text.secondary"
            noWrap
            sx={{ lineHeight: 1.3 }}
          >
            {header.title}
          </Typography>
        )}
      </Box>
    </Box>
  )
}
