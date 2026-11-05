import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useId } from 'react'

/**
 * Lays out `FilterGroup`s in one column, in two once the filters themselves are 760px wide, and
 * (with `xwideAreas`) in four once they are 1600px wide, e.g. on a full-width page on a large
 * screen. It follows the room the filters get (a page or a modal), not the window. Areas are CSS
 * `grid-template-areas` naming each group's `area`, e.g. `'"main" "inventory"'`.
 */
export function FilterGrid({
  narrowAreas,
  wideAreas,
  xwideAreas,
  children,
}: {
  narrowAreas: string
  wideAreas: string
  /** four columns from 1600px; without it the two-column layout is kept */
  xwideAreas?: string
  children: ReactNode
}) {
  return (
    <Box sx={{ containerType: 'inline-size' }}>
      <Box
        sx={{
          display: 'grid',
          gap: 3,
          gridTemplateColumns: 'minmax(0, 1fr)',
          gridTemplateAreas: narrowAreas,
          '@container (min-width: 760px)': {
            columnGap: 4,
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            gridTemplateAreas: wideAreas,
          },
          ...(xwideAreas && {
            '@container (min-width: 1600px)': {
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gridTemplateAreas: xwideAreas,
            },
          }),
        }}
      >
        {children}
      </Box>
    </Box>
  )
}

/** A labelled group of filters: a small caption (with an optional control on the right), then its rows. */
export function FilterGroup({
  area,
  title,
  action,
  children,
}: {
  /** its name in the `FilterGrid`'s areas */
  area: string
  title: ReactNode
  action?: ReactNode
  children: ReactNode
}) {
  const titleId = useId()
  return (
    <Box
      component="section"
      aria-labelledby={titleId}
      sx={{
        gridArea: area,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 1,
          minHeight: 26,
          mb: -0.5,
        }}
      >
        <Typography
          id={titleId}
          component="h2"
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'text.secondary',
          }}
        >
          {title}
        </Typography>
        {action}
      </Box>
      {children}
    </Box>
  )
}
