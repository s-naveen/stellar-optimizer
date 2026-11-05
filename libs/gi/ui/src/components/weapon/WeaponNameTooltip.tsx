import { BootstrapTooltip, ImgIcon } from '@genshin-optimizer/common/ui'
import { imgAssets } from '@genshin-optimizer/gi/assets'
import type { WeaponKey } from '@genshin-optimizer/gi/consts'
import { getWeaponStat } from '@genshin-optimizer/gi/stats'
import { Box, Skeleton, Typography } from '@mui/material'
import type { ReactElement, ReactNode } from 'react'
import { Suspense } from 'react'
import { WeaponName } from './WeaponTrans'

type Data = {
  weaponKey: WeaponKey
  addlText?: ReactNode
  children: ReactElement
}
export function WeaponNameTooltip({ weaponKey, addlText, children }: Data) {
  const title = (
    <Suspense fallback={<Skeleton variant="text" width={120} />}>
      <Box
        sx={{
          maxWidth: 260,
          py: 0.25,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <ImgIcon
            src={imgAssets.weaponTypes[getWeaponStat(weaponKey).weaponType]}
            size={1.25}
          />
          <Typography
            sx={{ fontSize: '0.875rem', fontWeight: 600, lineHeight: 1.3 }}
          >
            <WeaponName weaponKey={weaponKey} />
          </Typography>
        </Box>
        {addlText && (
          // e.g. the main and secondary stat: quieter than the name
          <Box
            sx={{
              color: 'text.secondary',
              '& .MuiTypography-root': {
                fontSize: '0.8125rem',
                fontVariantNumeric: 'tabular-nums',
              },
            }}
          >
            {addlText}
          </Box>
        )}
      </Box>
    </Suspense>
  )
  return (
    <BootstrapTooltip placement="top" title={title} disableInteractive>
      {children}
    </BootstrapTooltip>
  )
}
