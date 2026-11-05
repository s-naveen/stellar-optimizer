import type { SolidToggleButtonGroupProps } from '@genshin-optimizer/common/ui'
import {
  filterToggleValue,
  SolidToggleButtonGroup,
  ToggleButtonCount,
} from '@genshin-optimizer/common/ui'
import { handleMultiSelect } from '@genshin-optimizer/common/util'
import type { RarityKey } from '@genshin-optimizer/gi/consts'
import { allRarityKeys } from '@genshin-optimizer/gi/consts'
import StarRoundedIcon from '@mui/icons-material/StarRounded'
import { Box, Chip, ToggleButton, useMediaQuery, useTheme } from '@mui/material'
import type { ReactNode } from 'react'

type WeaponRarityToggleProps = Omit<
  SolidToggleButtonGroupProps,
  'onChange' | 'value'
> & {
  onChange: (value: RarityKey[]) => void
  value: RarityKey[]
  totals: Record<RarityKey, ReactNode>
}
const rarityHandler = handleMultiSelect([...allRarityKeys])
export function WeaponRarityToggle({
  value,
  totals,
  onChange,
  quiet,
  ...props
}: WeaponRarityToggleProps) {
  const theme = useTheme()
  const xs = !useMediaQuery(theme.breakpoints.up('sm'))
  return (
    <SolidToggleButtonGroup
      exclusive
      value={quiet ? filterToggleValue(value, allRarityKeys) : value}
      quiet={quiet}
      {...props}
    >
      {allRarityKeys.map((star) => (
        <ToggleButton
          key={star}
          value={star}
          sx={
            quiet
              ? undefined
              : {
                  p: xs ? 1 : undefined,
                  minWidth: xs ? 0 : '6em',
                  display: 'flex',
                  gap: xs ? 0 : 1,
                }
          }
          onClick={() => onChange(rarityHandler(value, star))}
        >
          {quiet ? (
            <>
              <QuietStars stars={star} />
              <ToggleButtonCount>{totals[star]}</ToggleButtonCount>
            </>
          ) : (
            <Box display="flex">
              <strong>{star}</strong>
              <StarRoundedIcon />
              <Chip label={totals[star]} size="small" />
            </Box>
          )}
        </ToggleButton>
      ))}
    </SolidToggleButtonGroup>
  )
}

/** "5★" for a quiet rarity toggle. */
export function QuietStars({ stars }: { stars: number }) {
  return (
    <Box
      component="span"
      sx={{ display: 'inline-flex', alignItems: 'center', fontWeight: 600 }}
    >
      {stars}
      <StarRoundedIcon sx={{ fontSize: '1.1em', ml: '1px' }} />
    </Box>
  )
}
