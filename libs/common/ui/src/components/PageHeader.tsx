import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * Top of a page: what the page is (title + optional count) and the page's actions on the right
 * (the main one solid, e.g. `sx={giCtaSx}`, the rest tonal/outlined).
 * Sits directly on the page background, above the page's filter/tool card.
 */
export function PageHeader({
  title,
  count,
  actions,
}: {
  title: ReactNode
  count?: ReactNode
  actions?: ReactNode
}) {
  return (
    <Box
      component="header"
      sx={{
        display: 'flex',
        flexDirection: { xs: 'column', sm: 'row' },
        alignItems: { xs: 'stretch', sm: 'center' },
        gap: { xs: 1.5, sm: 3 },
        pt: { xs: 1.5, md: 3 },
        pb: { xs: 0.5, md: 1 },
        px: { xs: 0.5, md: 0.5 },
      }}
    >
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Typography
          variant="h4"
          component="h1"
          sx={{
            fontSize: { xs: '1.5rem', md: '1.875rem' },
            lineHeight: 1.2,
            display: 'flex',
            alignItems: 'baseline',
            gap: 1.25,
          }}
        >
          {title}
          {count !== undefined && (
            <Box
              component="span"
              sx={{
                color: 'text.secondary',
                fontWeight: 500,
                fontSize: '0.55em',
                letterSpacing: 0,
              }}
            >
              {count}
            </Box>
          )}
        </Typography>
      </Box>
      {actions && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            flexWrap: 'wrap',
            alignItems: 'center',
            flexShrink: 0,
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  )
}
