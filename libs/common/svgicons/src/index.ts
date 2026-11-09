import type { SvgIconProps } from '@mui/material'

export * from './icons/AnvilIcon'
export * from './icons/DiscordIcon'

export const iconInlineProps: SvgIconProps = {
  fontSize: 'inherit',
  sx: {
    verticalAlign: '-10%',
  },
} as const
