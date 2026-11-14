import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import CloseIcon from '@mui/icons-material/Close'
import type { SxProps, Theme } from '@mui/material'
import { alpha, Box, ButtonBase, IconButton, Switch } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { focusSx, hairline, quickSx, tokens, type } from './ui'

/*
 * The run dialog's small shared pieces (its option tiles, its dialogs' title bar). They are local
 * to the run dialog's files; they could move to ui.tsx if other parts want them.
 */

/** A tile's surface: an inset with a hairline, a quick hover */
export const tileSx = (theme: Theme) => ({
  display: 'flex',
  alignItems: 'center',
  gap: 1,
  minWidth: 0,
  minHeight: 44,
  pl: 1.5,
  pr: 0.75,
  borderRadius: tokens.radius.inset,
  bgcolor: tokens.inset,
  border: hairline,
  textAlign: 'left' as const,
  ...quickSx,
  '&:hover': {
    borderColor: tokens.hairlineStrong,
    bgcolor: alpha(theme.palette.text.primary, 0.03),
  },
})

/** A dialog over another one (already dimmed): a light backdrop, not a second dark one */
export const stackedBackdrop = {
  backdrop: { sx: { backgroundColor: 'rgba(6, 7, 10, 0.3)' } },
} as const
/** A dialog over another one floats: a shadow sets it apart from the one under it */
export const floatSx = {
  boxShadow: '0 24px 64px rgba(0, 0, 0, 0.6), 0 2px 8px rgba(0, 0, 0, 0.4)',
} as const

/**
 * An on/off option as a tile: its name, its switch, and (when on) a button of its own. The whole
 * tile toggles it; its name is brighter when on.
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
      sx={[
        tileSx,
        {
          cursor: disabled ? 'default' : 'pointer',
          opacity: disabled ? 0.55 : 1,
          // the switch's keyboard focus rings the whole tile
          '&:has(.Mui-focusVisible)': {
            outline: `2px solid ${tokens.gold}`,
            outlineOffset: 2,
          },
        },
        !!disabled && { '&:hover': { borderColor: tokens.hairline } },
      ]}
    >
      <Box
        component="span"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          fontSize: 13.5,
          fontWeight: 600,
          lineHeight: 1.3,
          color: checked ? 'text.primary' : 'text.secondary',
          ...quickSx,
        }}
      >
        {label}
      </Box>
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

/**
 * A tile's own small button: what it opens (a count, "Edit"), with a chevron. `as="span"` when
 * the whole tile is the button.
 */
export function TileAction({
  children,
  onClick,
  disabled,
  tone,
  as,
  'aria-label': ariaLabel,
}: {
  children: ReactNode
  onClick?: (e: React.MouseEvent) => void
  disabled?: boolean
  /** Something left out (excluded artifacts): the count in the warning colour */
  tone?: 'warning'
  as?: 'span'
  'aria-label'?: string
}) {
  const sx: SxProps<Theme> = (theme) => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 0.25,
    flexShrink: 0,
    height: 28,
    pl: 1,
    pr: 0.5,
    borderRadius: tokens.radius.control,
    fontSize: 12.5,
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
    whiteSpace: 'nowrap',
    color: tone === 'warning' ? 'warning.main' : 'text.secondary',
    border: `1px solid ${tokens.hairlineStrong}`,
    ...quickSx,
    ...focusSx,
    // (hovered itself, or its tile when the tile is the button)
    '&:hover, .MuiButtonBase-root:hover > &': {
      color: tone === 'warning' ? 'warning.light' : 'text.primary',
      borderColor: alpha(theme.palette.text.primary, 0.3),
    },
    '&.Mui-disabled': { opacity: 0.5 },
  })
  const content = (
    <>
      {children}
      <ChevronRightIcon sx={{ fontSize: 16 }} />
    </>
  )
  if (as === 'span')
    return (
      <Box component="span" sx={sx}>
        {content}
      </Box>
    )
  return (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      aria-haspopup="dialog"
      sx={sx}
    >
      {content}
    </ButtonBase>
  )
}

/** A dialog's title bar: its title (and ⓘ), actions, close */
export function DialogHead({
  title,
  info,
  actions,
  onClose,
}: {
  title: ReactNode
  info?: ReactNode
  actions?: ReactNode
  onClose: () => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        px: { xs: 1.5, sm: 2.5 },
        py: 1.25,
        minHeight: 60,
        borderBottom: hairline,
      }}
    >
      <Box
        component="h2"
        sx={{
          ...type.section,
          m: 0,
          flexGrow: 1,
          minWidth: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          '& .MuiSvgIcon-root': { fontSize: 17, color: 'text.secondary' },
        }}
      >
        {title}
        {info && <InfoTooltipInline title={info} />}
      </Box>
      {actions}
      <IconButton
        onClick={onClose}
        aria-label={t('teamOpt.editor.close', 'Close')}
        sx={{ mr: -1 }}
      >
        <CloseIcon />
      </IconButton>
    </Box>
  )
}
