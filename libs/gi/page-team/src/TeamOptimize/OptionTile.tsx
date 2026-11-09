import { alpha, Box, Switch, Typography } from '@mui/material'
import type { ReactNode } from 'react'

/**
 * An on/off option as a tile: its name, its switch, and (when on) a button of its own. The whole
 * tile toggles it; it is tinted when on.
 */
export function OptionTile({
  label,
  checked,
  onChange,
  disabled,
  action,
}: {
  label: ReactNode
  checked: boolean
  onChange: () => void
  disabled?: boolean
  /** A button of its own (e.g. Choose), before the switch */
  action?: ReactNode
}) {
  return (
    <Box
      // (a label: a click anywhere on it toggles the switch, but not one on its own button)
      component="label"
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minWidth: 0,
        minHeight: 48,
        pl: 1.5,
        pr: 0.75,
        borderRadius: 2,
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.6 : 1,
        border: `1px solid ${
          checked
            ? alpha(theme.palette.primary.main, 0.45)
            : alpha(theme.palette.text.primary, 0.1)
        }`,
        backgroundColor: checked
          ? alpha(theme.palette.primary.main, 0.07)
          : alpha(theme.palette.text.primary, 0.02),
        transition: theme.transitions.create(
          ['border-color', 'background-color'],
          { duration: theme.transitions.duration.shorter }
        ),
        '&:hover': disabled
          ? undefined
          : {
              borderColor: checked
                ? alpha(theme.palette.primary.main, 0.7)
                : alpha(theme.palette.text.primary, 0.22),
            },
      })}
    >
      <Typography
        variant="body2"
        sx={{ flexGrow: 1, minWidth: 0, fontWeight: 600, lineHeight: 1.3 }}
      >
        {label}
      </Typography>
      {action}
      <Switch
        size="small"
        checked={checked}
        disabled={disabled}
        onChange={onChange}
      />
    </Box>
  )
}
