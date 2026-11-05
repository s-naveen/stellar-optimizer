import { CustomNumberInput } from '@genshin-optimizer/common/ui'
import { clamp } from '@genshin-optimizer/common/util'
import { Box, Slider, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useEffect, useId, useState } from 'react'

/**
 * A filter range on one line: a plain label, the minimum, a slider and the maximum. Dragging
 * only updates the inputs; the range is committed when the drag ends (or an input is confirmed).
 */
export function RangeFilterRow({
  label,
  low,
  high,
  min,
  max,
  marks = false,
  setLow,
  setHigh,
  setBoth,
  disabled = false,
}: {
  label: ReactNode
  low: number
  high: number
  min: number
  max: number
  marks?: boolean
  setLow: (low: number) => void
  setHigh: (high: number) => void
  setBoth: (low: number, high: number) => void
  disabled?: boolean
}) {
  const labelId = useId()
  const [sliderLow, setSliderLow] = useState(low)
  const [sliderHigh, setSliderHigh] = useState(high)
  useEffect(() => setSliderLow(low), [low])
  useEffect(() => setSliderHigh(high), [high])

  const inputSx = {
    flex: '0 0 auto',
    width: `${String(max).length + 2.5}ch`,
    height: 32,
    borderRadius: '8px',
    fontSize: '0.875rem',
    fontVariantNumeric: 'tabular-nums',
  }
  return (
    <Box
      role="group"
      aria-labelledby={labelId}
      sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minHeight: 32 }}
    >
      <Typography
        id={labelId}
        component="span"
        sx={{
          flex: '0 0 auto',
          minWidth: '3.5em',
          fontSize: '0.8125rem',
          color: disabled ? 'text.disabled' : 'text.secondary',
        }}
      >
        {label}
      </Typography>
      <CustomNumberInput
        value={sliderLow}
        onChange={(val) => setLow(clamp(val ?? min, min, high))}
        sx={inputSx}
        inputProps={{
          'aria-label': 'Minimum',
          min,
          max,
          sx: { textAlign: 'center', p: 0 },
        }}
        disabled={disabled}
      />
      <Slider
        size="small"
        sx={{ flex: '1 1 auto', minWidth: 64, mx: 1 }}
        getAriaLabel={(index) => (index ? 'Maximum' : 'Minimum')}
        value={[sliderLow, sliderHigh]}
        onChange={(_e, value) => {
          if (!Array.isArray(value)) return
          setSliderLow(value[0])
          setSliderHigh(value[1])
        }}
        onChangeCommitted={(_e, value) =>
          Array.isArray(value) && setBoth(value[0], value[1])
        }
        valueLabelDisplay="auto"
        min={min}
        max={max}
        step={1}
        marks={marks}
        disabled={disabled}
      />
      <CustomNumberInput
        value={sliderHigh}
        onChange={(val) => setHigh(clamp(val ?? max, low, max))}
        sx={inputSx}
        inputProps={{
          'aria-label': 'Maximum',
          min,
          max,
          sx: { textAlign: 'center', p: 0 },
        }}
        disabled={disabled}
      />
    </Box>
  )
}
