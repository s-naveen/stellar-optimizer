import type { Theme } from '@mui/material'
import { alpha } from '@mui/material'

/**
 * A quiet, field-like chooser button (the look of the select fields on the Talents tab): used for
 * the loadout/build choosers in the tab bar and the member choosers in Team Settings.
 */
export function fieldButtonSx(theme: Theme) {
  const { text } = theme.palette
  return {
    minWidth: 0,
    minHeight: 36,
    px: 1.25,
    borderRadius: 2,
    justifyContent: 'flex-start',
    textAlign: 'left',
    fontWeight: 600,
    color: text.primary,
    backgroundColor: alpha(text.primary, 0.04),
    border: `1px solid ${alpha(text.primary, 0.16)}`,
    boxShadow: 'none',
    '& .MuiButton-startIcon': { color: text.secondary, mr: 1 },
    '& .MuiButton-endIcon': { ml: 'auto', pl: 1, color: text.secondary },
    '& .MuiButton-endIcon .MuiSvgIcon-root': { fontSize: 18 },
    '&:hover': {
      backgroundColor: alpha(text.primary, 0.07),
      borderColor: alpha(text.primary, 0.3),
      boxShadow: 'none',
    },
  }
}

/** One line of text that ends in an ellipsis instead of wrapping (inside a chooser). */
export const ellipsisSx = {
  minWidth: 0,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
} as const
