import type { Palette, PaletteColor } from '@mui/material'
import { alpha, styled, ToggleButton } from '@mui/material'
import { quietToggleStyles } from './SolidToggleButtonGroup'

type SolidColoredToggleButtonPartial = {
  baseColor?: keyof Palette
  selectedColor?: keyof Palette
  /** The compact filter style of `SolidToggleButtonGroup`'s `quiet` (selected colour defaults to `primary`). */
  quiet?: boolean
}

export const SolidColoredToggleButton = styled(ToggleButton, {
  shouldForwardProp: (prop) =>
    prop !== 'baseColor' && prop !== 'selectedColor' && prop !== 'quiet',
})<SolidColoredToggleButtonPartial>(
  ({ theme, baseColor = 'secondary', selectedColor, quiet = false }) => {
    if (quiet)
      return quietToggleStyles(
        theme,
        theme.palette[selectedColor ?? 'primary'] as PaletteColor
      )
    const basePalette = theme.palette[baseColor] as PaletteColor
    const selectedPalette = theme.palette[
      selectedColor ?? 'success'
    ] as PaletteColor
    // tonal, like SolidToggleButtonGroup
    return {
      '&': {
        backgroundColor: alpha(basePalette.main, 0.22),
        color: theme.palette.text.secondary,
      },
      '&:hover': {
        backgroundColor: alpha(basePalette.main, 0.4),
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
    }
  }
)
