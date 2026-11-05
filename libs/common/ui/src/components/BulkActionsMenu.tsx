import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import {
  Button,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Menu,
  MenuItem,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { SqBadge } from './SqBadge'

export type BulkAction = {
  key: string
  icon: ReactNode
  label: ReactNode
  /** How many items the action would change; the action is disabled at 0. */
  count: number
  run: () => void
  /** Destructive actions are shown in the error colour. */
  danger?: boolean
}

/**
 * One "Bulk actions ▾" button for actions that apply to every item matching the page's current
 * filters (lock all, delete all…), instead of a row of full-width buttons.
 */
export function BulkActionsMenu({
  label,
  hint,
  actions,
  disabled = false,
}: {
  label: ReactNode
  /** Says what the actions apply to, e.g. "Applies to the 605 artifacts that match your filters." */
  hint?: ReactNode
  actions: BulkAction[]
  disabled?: boolean
}) {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null)
  return (
    <>
      <Button
        variant="outlined"
        color="inherit"
        endIcon={<ArrowDropDownIcon />}
        onClick={(e) => setAnchorEl(e.currentTarget)}
        aria-haspopup="menu"
        aria-expanded={!!anchorEl}
        disabled={disabled}
      >
        {label}
      </Button>
      <Menu
        anchorEl={anchorEl}
        open={!!anchorEl}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        {hint && (
          // A subheader, so keyboard navigation skips it
          <ListSubheader
            disableSticky
            sx={{
              maxWidth: 300,
              pt: 0.5,
              pb: 1,
              lineHeight: 1.5,
              fontSize: '0.75rem',
              fontWeight: 400,
              whiteSpace: 'normal',
              color: 'text.secondary',
              bgcolor: 'transparent',
            }}
          >
            {hint}
          </ListSubheader>
        )}
        {actions.map(({ key, icon, label, count, run, danger }) => (
          <MenuItem
            key={key}
            disabled={!count}
            onClick={() => {
              setAnchorEl(null)
              run()
            }}
            sx={danger ? { color: 'error.main' } : undefined}
          >
            <ListItemIcon sx={{ color: 'inherit' }}>{icon}</ListItemIcon>
            <ListItemText>{label}</ListItemText>
            <SqBadge sx={{ ml: 2 }} color="secondary">
              {count}
            </SqBadge>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}
