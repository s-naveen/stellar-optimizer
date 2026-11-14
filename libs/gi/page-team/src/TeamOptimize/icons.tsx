/**
 * Outline icons for the Team optimize and KQM Theorycrafting tabs, from Lucide
 * (https://lucide.dev, lucide-static 0.563.0).
 *
 * ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of
 * Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without
 * fee is hereby granted, provided that the above copyright notice and this permission notice appear
 * in all copies. THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES.
 */
import { SvgIcon, type SvgIconProps } from '@mui/material'

/** Lucide's stroke look on MUI's SvgIcon (sized and coloured like any MUI icon) */
const strokeSx = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const

/** Team optimize: a gauge (tuning the team's performance) */
export function TeamOptimizeIcon({ sx, ...props }: SvgIconProps) {
  return (
    <SvgIcon
      viewBox="0 0 24 24"
      sx={[strokeSx, ...(Array.isArray(sx) ? sx : [sx])]}
      {...props}
    >
      <path d="m12 14 4-4" />
      <path d="M3.34 19a10 10 0 1 1 17.32 0" />
    </SvgIcon>
  )
}

/** KQM Theorycrafting: a conical flask (theorycrafting: testing builds) */
export function TheorycraftIcon({ sx, ...props }: SvgIconProps) {
  return (
    <SvgIcon
      viewBox="0 0 24 24"
      sx={[strokeSx, ...(Array.isArray(sx) ? sx : [sx])]}
      {...props}
    >
      <path d="M14 2v6a2 2 0 0 0 .245.96l5.51 10.08A2 2 0 0 1 18 22H6a2 2 0 0 1-1.755-2.96l5.51-10.08A2 2 0 0 0 10 8V2" />
      <path d="M6.453 15h11.094" />
      <path d="M8.5 2h7" />
    </SvgIcon>
  )
}
