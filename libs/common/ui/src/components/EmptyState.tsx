import { Box, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * What to show where a list would be when it has nothing in it yet: what the list is for,
 * and the action that fills it.
 */
export function EmptyState({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        textAlign: 'center',
        gap: 1,
        px: 3,
        py: { xs: 4, md: 6 },
        borderRadius: 2.5,
        border: '1px dashed rgba(160, 180, 255, 0.18)',
      }}
    >
      {icon && (
        <Box
          aria-hidden
          sx={{
            display: 'grid',
            placeItems: 'center',
            width: 56,
            height: 56,
            mb: 1,
            borderRadius: '50%',
            bgcolor: 'rgba(255, 255, 255, 0.05)',
            color: 'text.secondary',
            '& .MuiSvgIcon-root': { fontSize: 28 },
          }}
        >
          {icon}
        </Box>
      )}
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      {description && (
        <Typography color="text.secondary" sx={{ maxWidth: '60ch' }}>
          {description}
        </Typography>
      )}
      {actions && (
        <Box
          sx={{
            display: 'flex',
            gap: 1,
            mt: 1.5,
            flexWrap: 'wrap',
            justifyContent: 'center',
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  )
}
