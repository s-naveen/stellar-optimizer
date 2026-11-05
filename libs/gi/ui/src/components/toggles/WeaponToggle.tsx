import type { SolidToggleButtonGroupProps } from '@genshin-optimizer/common/ui'
import {
  filterToggleValue,
  ImgIcon,
  SolidToggleButtonGroup,
  ToggleButtonCount,
} from '@genshin-optimizer/common/ui'
import { handleMultiSelect } from '@genshin-optimizer/common/util'
import { imgAssets } from '@genshin-optimizer/gi/assets'
import type { WeaponTypeKey } from '@genshin-optimizer/gi/consts'
import { allWeaponTypeKeys } from '@genshin-optimizer/gi/consts'
import { Chip, ToggleButton, useMediaQuery, useTheme } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type WeaponToggleProps = Omit<
  SolidToggleButtonGroupProps,
  'onChange' | 'value'
> & {
  onChange: (value: WeaponTypeKey[]) => void
  value: WeaponTypeKey[]
  totals: Record<WeaponTypeKey, ReactNode>
}

const weaponTypeHandler = handleMultiSelect([...allWeaponTypeKeys])
export function WeaponToggle({
  value,
  totals,
  onChange,
  quiet,
  ...props
}: WeaponToggleProps) {
  const theme = useTheme()
  const xs = !useMediaQuery(theme.breakpoints.up('sm'))
  return (
    <SolidToggleButtonGroup
      exclusive
      value={quiet ? filterToggleValue(value, allWeaponTypeKeys) : value}
      quiet={quiet}
      {...props}
    >
      {allWeaponTypeKeys.map((wt) => (
        <ToggleButton
          key={wt}
          value={wt}
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
          onClick={() => onChange(weaponTypeHandler(value, wt))}
        >
          {quiet ? (
            <>
              <QuietWeaponTypeIcon weaponType={wt} />
              <ToggleButtonCount>{totals[wt]}</ToggleButtonCount>
            </>
          ) : (
            <>
              <ImgIcon src={imgAssets.weaponTypes?.[wt]} size={2} sideMargin />
              <Chip label={totals[wt]} size="small" />
            </>
          )}
        </ToggleButton>
      ))}
    </SolidToggleButtonGroup>
  )
}

/** The quiet toggle shows only the icon, so it carries the weapon type's name (alt and hover title). */
function QuietWeaponTypeIcon({ weaponType }: { weaponType: WeaponTypeKey }) {
  const { t } = useTranslation('page_weapon')
  const name = t(`weaponType.${weaponType}`)
  return (
    <ImgIcon
      src={imgAssets.weaponTypes?.[weaponType]}
      size={1.5}
      alt={name}
      title={name}
    />
  )
}
