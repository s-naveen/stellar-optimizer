import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import FilterListIcon from '@mui/icons-material/FilterList'
import ReplayIcon from '@mui/icons-material/Replay'
import {
  Box,
  Button,
  CardContent,
  Collapse,
  Divider,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useCallback, useId, useState } from 'react'
import { CardThemed } from './Card'
import { SqBadge } from './SqBadge'

/**
 * A page's filter panel that stays one row tall until opened: a "Filters" toggle with how many
 * filters are active, a summary on the right (e.g. "605 / 1157") and Reset. The panel is only
 * rendered while open, and the open state is remembered in localStorage under `storageKey`
 * (deliberately not in the database: its display settings are part of GOOD exports).
 */
export function CollapsibleFilterCard({
  title,
  activeLabel,
  summary,
  resetLabel,
  onReset,
  resetDisabled = false,
  storageKey,
  children,
}: {
  title: ReactNode
  /** e.g. "2 active"; omit when no filter is active */
  activeLabel?: ReactNode
  summary?: ReactNode
  resetLabel: ReactNode
  onReset: () => void
  resetDisabled?: boolean
  storageKey: string
  children: ReactNode
}) {
  const panelId = useId()
  const [open, setOpen] = useState(
    () => localStorage.getItem(storageKey) === 'true'
  )
  const toggleOpen = useCallback(() => {
    const next = !open
    localStorage.setItem(storageKey, String(next))
    setOpen(next)
  }, [open, storageKey])

  return (
    <CardThemed>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          px: 1,
          py: 0.75,
        }}
      >
        <Button
          variant="text"
          color="inherit"
          onClick={toggleOpen}
          aria-expanded={open}
          aria-controls={panelId}
          startIcon={<FilterListIcon />}
          endIcon={
            <ExpandMoreIcon
              sx={{
                transform: open ? 'rotate(180deg)' : undefined,
                transition: (theme) =>
                  theme.transitions.create('transform', {
                    duration: theme.transitions.duration.shortest,
                  }),
              }}
            />
          }
        >
          {title}
          {activeLabel && (
            <SqBadge sx={{ ml: 1 }} color="primary">
              {activeLabel}
            </SqBadge>
          )}
        </Button>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          {summary && <Typography color="text.secondary">{summary}</Typography>}
          <Button
            size="small"
            variant="text"
            color="error"
            disabled={resetDisabled}
            onClick={onReset}
            startIcon={<ReplayIcon />}
          >
            {resetLabel}
          </Button>
        </Box>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Divider />
        <CardContent id={panelId}>{children}</CardContent>
      </Collapse>
    </CardThemed>
  )
}
