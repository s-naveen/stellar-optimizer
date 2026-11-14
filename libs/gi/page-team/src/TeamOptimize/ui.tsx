/**
 * The Team Optimize and KQM tabs' building blocks: one look for both (see DESIGN.md next to this
 * file). Surfaces: `panel` cards on the ink page, `panelDark` insets inside them, `panelRaised` for
 * what floats or is selected. Gold marks the one main action, a selection, an edited value and focus;
 * element hues mark character data. Labels are sentence case; details live in ⓘ tooltips.
 */
import { InfoTooltipInline } from '@genshin-optimizer/common/ui'
import { giTokens } from '@genshin-optimizer/gi/theme'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import {
  alpha,
  Box,
  ButtonBase,
  Collapse,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import { type ReactNode, Suspense } from 'react'

/* ---------- tokens ---------- */

export const tokens = {
  radius: { panel: 3, inset: 2, control: 1.5, pill: 999 },
  /** padding inside a panel (theme spacing): phones, then larger screens */
  pad: { xs: 1.5, sm: 2 },
  hairline: giTokens.hairline,
  hairlineStrong: giTokens.hairlineStrong,
  panel: giTokens.panel,
  inset: giTokens.panelDark,
  raised: giTokens.panelRaised,
  hover: giTokens.panelHover,
  gold: giTokens.gold,
  ease: 'cubic-bezier(.2,.7,.2,1)',
} as const

/** A hairline border */
export const hairline = `1px solid ${giTokens.hairline}`
/** Numbers that line up in columns */
export const numSx = { fontVariantNumeric: 'tabular-nums' } as const
/** Quick colour changes on hover and press (none with reduced motion) */
export const quickSx = {
  transition:
    'color .12s, background-color .12s, border-color .12s, box-shadow .12s',
  '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
} as const
/** The keyboard focus ring */
export const focusSx = {
  '&.Mui-focusVisible, &:focus-visible': {
    outline: `2px solid ${giTokens.gold}`,
    outlineOffset: 2,
  },
} as const
/** A selected item: a gold ring and tint */
export const selectedSx = (theme: Theme) => ({
  bgcolor: alpha(theme.palette.primary.main, 0.1),
  boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.55)}`,
})
/** A list row's hover */
export const rowHoverSx = {
  ...quickSx,
  '&:hover': { bgcolor: alpha(giTokens.parchment, 0.035) },
} as const
/** An inset surface inside a panel (editors, tables, timelines) */
export const insetSx = {
  bgcolor: giTokens.panelDark,
  borderRadius: tokens.radius.inset,
  border: hairline,
} as const

/** The type scale */
export const type = {
  /** A section of the page (Rotation, Team builds) */
  section: { fontSize: 17, fontWeight: 650, letterSpacing: '-0.01em' },
  /** A panel's or dialog's title */
  title: { fontSize: 15, fontWeight: 650, letterSpacing: '-0.005em' },
  body: { fontSize: 14 },
  /** Labels and meta lines, secondary */
  label: { fontSize: 12.5, fontWeight: 500, color: 'text.secondary' },
  /** A headline number (team DPS) */
  figure: {
    fontSize: 26,
    fontWeight: 650,
    letterSpacing: '-0.02em',
    lineHeight: 1.15,
    ...numSx,
  },
  /** A number in a tile */
  stat: {
    fontSize: 18,
    fontWeight: 650,
    letterSpacing: '-0.01em',
    lineHeight: 1.25,
    ...numSx,
  },
} as const

/* ---------- surfaces ---------- */

/** A card on the page: optional header (title, ⓘ, actions), then its content */
export function Panel({
  title,
  info,
  actions,
  children,
  sx,
  dense,
  id,
  component,
}: {
  title?: ReactNode
  info?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  sx?: SxProps<Theme>
  /** Less padding (a panel inside a dialog) */
  dense?: boolean
  id?: string
  component?: React.ElementType
}) {
  return (
    <Box
      id={id}
      component={component ?? 'section'}
      sx={[
        {
          bgcolor: tokens.panel,
          border: hairline,
          borderRadius: tokens.radius.panel,
          p: dense ? { xs: 1.25, sm: 1.5 } : tokens.pad,
          minWidth: 0,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {(title || actions) && (
        <PanelHeader title={title} info={info} actions={actions} />
      )}
      {children}
    </Box>
  )
}

/** A title (with its ⓘ) on the left, actions on the right */
export function PanelHeader({
  title,
  info,
  actions,
  sx,
}: {
  title?: ReactNode
  info?: ReactNode
  actions?: ReactNode
  sx?: SxProps<Theme>
}) {
  return (
    <Box
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
          minHeight: 32,
          mb: 1.25,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {title && (
        <Typography
          component="h3"
          sx={{
            ...type.title,
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
          }}
        >
          {title}
          {info && <InfoTooltipInline title={info} />}
        </Typography>
      )}
      {actions && (
        <Box
          sx={{
            ml: 'auto',
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            flexWrap: 'wrap',
          }}
        >
          {actions}
        </Box>
      )}
    </Box>
  )
}

/* ---------- text ---------- */

/** A sentence-case label; with `tip`, a dotted underline and the explanation on hover */
export function FieldLabel({
  children,
  tip,
  sx,
}: {
  children: ReactNode
  tip?: ReactNode
  sx?: SxProps<Theme>
}) {
  const label = (
    <Typography
      component="span"
      sx={[
        {
          ...type.label,
          display: 'inline-block',
          ...(tip && {
            cursor: 'help',
            textDecoration: 'underline dotted',
            textUnderlineOffset: 3,
            textDecorationColor: alpha(giTokens.parchment, 0.35),
          }),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Typography>
  )
  return tip ? (
    <Tooltip arrow title={tip}>
      {label}
    </Tooltip>
  ) : (
    label
  )
}

/** A labelled number: label above, value below (accent: gold) */
export function StatTile({
  label,
  value,
  unit,
  tip,
  accent,
  sx,
}: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  tip?: ReactNode
  accent?: boolean
  sx?: SxProps<Theme>
}) {
  return (
    <Box sx={[{ minWidth: 0 }, ...(Array.isArray(sx) ? sx : [sx])]}>
      <FieldLabel tip={tip}>{label}</FieldLabel>
      <Typography
        sx={{ ...type.stat, color: accent ? 'primary.main' : 'text.primary' }}
      >
        {value}
        {unit && (
          <Box
            component="span"
            sx={{ fontSize: 13, fontWeight: 500, ml: 0.5, opacity: 0.8 }}
          >
            {unit}
          </Box>
        )}
      </Typography>
    </Box>
  )
}

/* ---------- controls ---------- */

/** A toggle chip: an option that is on or off (selected: gold ring) */
export function Pill({
  selected,
  onClick,
  icon,
  children,
  disabled,
  tip,
  sx,
  ...aria
}: {
  selected?: boolean
  onClick?: () => void
  icon?: ReactNode
  children?: ReactNode
  disabled?: boolean
  tip?: ReactNode
  sx?: SxProps<Theme>
  'aria-label'?: string
}) {
  const pill = (
    <ButtonBase
      onClick={onClick}
      disabled={disabled}
      aria-pressed={selected}
      {...aria}
      sx={[
        (theme) => ({
          gap: 0.75,
          px: 1.25,
          minHeight: 30,
          borderRadius: tokens.radius.pill,
          fontSize: 13,
          fontWeight: 600,
          color: selected ? 'text.primary' : 'text.secondary',
          border: `1px solid ${selected ? 'transparent' : giTokens.hairlineStrong}`,
          ...(selected && selectedSx(theme)),
          ...quickSx,
          ...focusSx,
          '&:hover': {
            color: 'text.primary',
            bgcolor: selected
              ? alpha(theme.palette.primary.main, 0.14)
              : alpha(giTokens.parchment, 0.05),
          },
          '&.Mui-disabled': { opacity: 0.45 },
        }),
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {icon}
      {children}
    </ButtonBase>
  )
  return tip ? (
    <Tooltip arrow title={tip}>
      <span style={{ display: 'inline-flex' }}>{pill}</span>
    </Tooltip>
  ) : (
    pill
  )
}

/** One of a few exclusive options, side by side on a track */
export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  size = 'medium',
  fullWidth,
  'aria-label': ariaLabel,
}: {
  value: T | undefined
  options: { value: T; label: ReactNode; tip?: ReactNode; disabled?: boolean }[]
  onChange: (value: T) => void
  size?: 'small' | 'medium'
  fullWidth?: boolean
  'aria-label'?: string
}) {
  return (
    <Box
      role="radiogroup"
      aria-label={ariaLabel}
      sx={{
        display: fullWidth ? 'grid' : 'inline-grid',
        gridAutoFlow: 'column',
        gridAutoColumns: fullWidth ? 'minmax(0, 1fr)' : 'auto',
        p: 0.375,
        gap: 0.25,
        borderRadius: tokens.radius.control,
        bgcolor: alpha(giTokens.parchment, 0.05),
      }}
    >
      {options.map((o) => {
        const active = o.value === value
        const button = (
          <ButtonBase
            key={String(o.value)}
            role="radio"
            aria-checked={active}
            disabled={o.disabled}
            onClick={() => onChange(o.value)}
            sx={{
              px: size === 'small' ? 1 : 1.5,
              minHeight: size === 'small' ? 26 : 30,
              borderRadius: 1.25,
              fontSize: size === 'small' ? 12.5 : 13,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              color: active ? 'text.primary' : 'text.secondary',
              bgcolor: active ? giTokens.panelRaised : 'transparent',
              boxShadow: active
                ? `0 1px 2px ${alpha('#000', 0.45)}, inset 0 0 0 1px ${giTokens.hairlineStrong}`
                : 'none',
              ...quickSx,
              ...focusSx,
              '&:hover': { color: 'text.primary' },
              '&.Mui-disabled': { opacity: 0.4 },
            }}
          >
            {o.label}
          </ButtonBase>
        )
        return o.tip ? (
          <Tooltip key={String(o.value)} arrow title={o.tip}>
            <span style={{ display: 'grid' }}>{button}</span>
          </Tooltip>
        ) : (
          button
        )
      })}
    </Box>
  )
}

/** A section that opens and closes: a chevron, its label and an optional count */
export function Disclosure({
  label,
  count,
  open,
  onToggle,
  children,
  info,
  sx,
}: {
  label: ReactNode
  count?: ReactNode
  open: boolean
  onToggle: () => void
  children?: ReactNode
  info?: ReactNode
  sx?: SxProps<Theme>
}) {
  return (
    <Box sx={sx}>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <ButtonBase
          onClick={onToggle}
          aria-expanded={open}
          sx={{
            gap: 0.5,
            py: 0.5,
            pr: 1,
            borderRadius: 1,
            fontSize: 13.5,
            fontWeight: 600,
            color: open ? 'text.primary' : 'text.secondary',
            ...quickSx,
            ...focusSx,
            '&:hover': { color: 'text.primary' },
          }}
        >
          <ExpandMoreIcon
            sx={{
              fontSize: 18,
              transition: `transform .18s ${tokens.ease}`,
              transform: open ? 'none' : 'rotate(-90deg)',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          />
          {label}
          {count !== undefined && count !== null && count !== false && (
            <Box
              component="span"
              sx={(theme) => ({
                ml: 0.5,
                px: 0.75,
                borderRadius: 1,
                fontSize: 12,
                lineHeight: 1.7,
                color: 'primary.main',
                bgcolor: alpha(theme.palette.primary.main, 0.12),
                ...numSx,
              })}
            >
              {count}
            </Box>
          )}
        </ButtonBase>
        {info && <InfoTooltipInline title={info} />}
      </Box>
      <Collapse in={open} timeout={180} unmountOnExit>
        {/* (its own Suspense: content that loads lazily must not remount the measuring Collapse,
            which loops into "Maximum update depth exceeded") */}
        <Box sx={{ pt: 1 }}>
          <Suspense fallback={<Skeleton variant="rounded" height={40} />}>
            {children}
          </Suspense>
        </Box>
      </Collapse>
    </Box>
  )
}

/** An empty place, in one muted line (the explanation in its ⓘ) */
export function EmptyLine({
  children,
  info,
  action,
  sx,
}: {
  children: ReactNode
  info?: ReactNode
  action?: ReactNode
  sx?: SxProps<Theme>
}) {
  return (
    <Box
      sx={[
        {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.75,
          minHeight: 40,
          px: 1.5,
          borderRadius: tokens.radius.inset,
          border: `1px dashed ${giTokens.hairlineStrong}`,
          color: 'text.secondary',
          fontSize: 13.5,
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
      {info && <InfoTooltipInline title={info} />}
      {action}
    </Box>
  )
}

/** A thin vertical divider between groups in a row */
export function VDivider() {
  return (
    <Box
      aria-hidden
      sx={{
        width: '1px',
        alignSelf: 'stretch',
        my: 0.5,
        bgcolor: giTokens.hairlineStrong,
      }}
    />
  )
}

/**
 * A small "Beta" tag after a feature's name (new, still being refined): a quiet gold outline,
 * filled gold when its tab is the open one. Its tooltip says what it means.
 */
export function BetaBadge({
  label,
  tip,
  sx,
}: {
  label: string
  tip?: ReactNode
  sx?: SxProps<Theme>
}) {
  const badge = (
    <Box
      component="span"
      sx={[
        {
          display: 'inline-flex',
          alignItems: 'center',
          height: 18,
          px: 0.75,
          ml: 0.875,
          borderRadius: tokens.radius.pill,
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.03em',
          lineHeight: 1,
          textTransform: 'none',
          whiteSpace: 'nowrap',
          color: giTokens.goldLight,
          bgcolor: alpha(giTokens.gold, 0.1),
          boxShadow: `inset 0 0 0 1px ${alpha(giTokens.gold, 0.38)}`,
          transition: 'background-color .15s, color .15s, box-shadow .15s',
          '.Mui-selected &': {
            color: giTokens.ink,
            bgcolor: giTokens.gold,
            boxShadow: 'none',
          },
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {label}
    </Box>
  )
  return tip ? (
    <Tooltip arrow title={tip}>
      {badge}
    </Tooltip>
  ) : (
    badge
  )
}
