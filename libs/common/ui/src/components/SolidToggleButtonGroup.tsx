import type {
  Palette,
  PaletteColor,
  Theme,
  ToggleButtonGroupProps,
} from '@mui/material'
import { alpha, styled, ToggleButtonGroup } from '@mui/material'

export type SolidToggleButtonGroupProps = SolidToggleButtonGroupPropsPartial &
  ToggleButtonGroupProps
type SolidToggleButtonGroupPropsPartial = {
  baseColor?: keyof Palette
  selectedColor?: keyof Palette
  /**
   * Compact filter style: separate 32px segments with a hairline outline, transparent while off
   * and a tint of `selectedColor` (default `primary`) while on. They wrap when the row runs out of
   * room. Put counts in a `ToggleButtonCount`.
   */
  quiet?: boolean
}

/** One quiet toggle (see `SolidToggleButtonGroup`'s `quiet`); also used by `SolidColoredToggleButton`. */
export function quietToggleStyles(theme: Theme, selected: PaletteColor) {
  const outline = alpha(theme.palette.text.primary, 0.14)
  const selectedOutline = alpha(selected.main, 0.55)
  return {
    minHeight: 32,
    padding: '3px 8px',
    // when a toggle gets narrow its count moves under the label, rather than the label breaking
    flexWrap: 'wrap' as const,
    alignContent: 'center',
    columnGap: 6,
    rowGap: 0,
    whiteSpace: 'nowrap' as const,
    fontSize: '0.8125rem',
    fontWeight: 500,
    lineHeight: 1.35,
    borderRadius: 8,
    border: `1px solid ${outline}`,
    backgroundColor: 'transparent',
    color: theme.palette.text.secondary,
    transition:
      'background-color 0.15s ease, border-color 0.15s ease, color 0.15s ease',
    '&:hover': {
      backgroundColor: alpha(theme.palette.text.primary, 0.06),
      color: theme.palette.text.primary,
    },
    '&.Mui-selected': {
      backgroundColor: alpha(selected.main, 0.16),
      borderColor: selectedOutline,
      color: selected.light ?? selected.main,
    },
    '&.Mui-selected:hover': {
      backgroundColor: alpha(selected.main, 0.24),
    },
    '&.Mui-disabled': {
      borderColor: alpha(theme.palette.text.primary, 0.08),
      color: theme.palette.text.disabled,
    },
    // e.g. the slot fixed while swapping an artifact: still visibly the chosen one
    '&.Mui-selected.Mui-disabled': {
      backgroundColor: alpha(selected.main, 0.1),
      borderColor: alpha(selected.main, 0.3),
      color: alpha(selected.light ?? selected.main, 0.6),
    },
    '&.Mui-focusVisible': {
      outline: `2px solid ${alpha(selected.main, 0.8)}`,
      outlineOffset: 1,
    },
  }
}

/**
 * What a quiet multi-select filter shows as selected. With every option on nothing is filtered,
 * and `handleMultiSelect` makes the next click select only that option, so that state shows as
 * all off: a highlight always means "only these".
 */
export function filterToggleValue<T>(value: T[], all: readonly T[]): T[] {
  return all.every((v) => value.includes(v)) ? [] : value
}

/** A count inside a quiet toggle, e.g. "12/80": small and muted, in the toggle's colour. */
export const ToggleButtonCount = styled('span')({
  fontSize: '0.75rem',
  fontWeight: 400,
  opacity: 0.75,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
})

export const SolidToggleButtonGroup = styled(ToggleButtonGroup, {
  shouldForwardProp: (prop) =>
    prop !== 'baseColor' && prop !== 'selectedColor' && prop !== 'quiet',
})<SolidToggleButtonGroupPropsPartial>(
  ({
    theme,
    baseColor = 'secondary',
    selectedColor,
    quiet = false,
    fullWidth = false,
  }) => {
    if (quiet) {
      const selectedPalette = theme.palette[
        selectedColor ?? 'primary'
      ] as PaletteColor
      return {
        flexWrap: 'wrap',
        gap: theme.spacing(0.75),
        '& .MuiToggleButtonGroup-grouped': {
          ...quietToggleStyles(theme, selectedPalette),
          // MUI joins grouped buttons (shared border, square inner corners); these stand apart
          margin: 0,
          // full width: equal shares of the row, wrapping before a label would be squeezed
          ...(fullWidth && { flex: '1 1 0', width: 'auto' }),
        },
        // MUI also drops the left border between two selected neighbours
        '& .MuiToggleButtonGroup-grouped.Mui-selected + .MuiToggleButtonGroup-grouped.Mui-selected':
          {
            borderLeft: `1px solid ${alpha(selectedPalette.main, 0.55)}`,
          },
      }
    }
    const basePalette = theme.palette[baseColor] as PaletteColor
    const selectedPalette = theme.palette[
      selectedColor ?? 'success'
    ] as PaletteColor
    // tonal: "off" is a faint tint with muted text, "on" a tint of the selected colour with that
    // colour as text and a hairline ring — a row of all-selected filters no longer reads as a wall
    return {
      '& .MuiToggleButtonGroup-grouped': {
        '&': {
          backgroundColor: alpha(basePalette.main, 0.22),
          color: theme.palette.text.secondary,
        },
        '&:hover': {
          backgroundColor: alpha(basePalette.main, 0.4),
          transition: 'background-color 0.15s ease',
        },
        '&.Mui-selected': {
          backgroundColor: alpha(selectedPalette.main, 0.2),
          color: selectedPalette.light ?? selectedPalette.main,
          boxShadow: `inset 0 0 0 1px ${alpha(selectedPalette.main, 0.45)}`,
        },
        '&.Mui-selected:hover': {
          backgroundColor: alpha(selectedPalette.main, 0.3),
        },
        '&.Mui-disabled': {
          backgroundColor: alpha(basePalette.main, 0.12),
          color: theme.palette.text.disabled,
        },
        '&.Mui-selected.Mui-disabled': {
          backgroundColor: alpha(selectedPalette.main, 0.12),
        },
      },
    }
  }
)
