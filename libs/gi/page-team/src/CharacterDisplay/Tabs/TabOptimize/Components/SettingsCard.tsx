import { CardThemed, InfoTooltip } from '@genshin-optimizer/common/ui'
import TuneIcon from '@mui/icons-material/Tune'
import type { ButtonProps } from '@mui/material'
import {
  Box,
  Button,
  CardContent,
  FormControlLabel,
  Switch,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'

/**
 * A settings card of the Optimize tab: a title row (optional info tooltip, a quiet summary such as
 * "472 of 661", and one action), then the body. Same look as the Artifact sets summary card.
 */
export function SettingsCard({
  title,
  info,
  summary,
  action,
  children,
}: {
  title: ReactNode
  info?: ReactNode
  summary?: ReactNode
  action?: ReactNode
  children?: ReactNode
}) {
  return (
    <CardThemed bgt="light">
      <CardContent sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <Box
          sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: 30 }}
        >
          <Typography sx={{ fontWeight: 600 }}>{title}</Typography>
          {info && <InfoTooltip title={info} />}
          <Box sx={{ flexGrow: 1 }} />
          {summary && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}
            >
              {summary}
            </Typography>
          )}
          {action}
        </Box>
        {children}
      </CardContent>
    </CardThemed>
  )
}

/** The card's action: a small outlined button (Edit by default). */
export function SettingsCardButton(props: ButtonProps) {
  return (
    <Button
      size="small"
      variant="outlined"
      color="inherit"
      startIcon={<TuneIcon />}
      {...props}
    />
  )
}

/** Label / value rows: muted labels on the left, values on the right. */
export function SummaryList({ children }: { children: ReactNode }) {
  return (
    <Box
      component="dl"
      sx={{
        m: 0,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        columnGap: 2,
        rowGap: 0.5,
        '& dt': { color: 'text.secondary' },
        '& dd': { m: 0, textAlign: 'right' },
      }}
    >
      {children}
    </Box>
  )
}

export function SummaryRow({
  label,
  value,
}: {
  label: ReactNode
  value: ReactNode
}) {
  return (
    <>
      <Typography component="dt" variant="body2">
        {label}
      </Typography>
      <Typography component="dd" variant="body2">
        {value}
      </Typography>
    </>
  )
}

/**
 * Text for a "current/total" count string (as the filters build them; just "total" when all are
 * in), e.g. "158 of 284 allowed" / "All 78 allowed".
 */
export function countOf(
  totalStr: string,
  ofText: (cur: string, tot: string) => string,
  allText: (tot: string) => string
) {
  const [cur, tot] = totalStr.split('/')
  return tot === undefined ? allText(cur) : ofText(cur, tot)
}

/** One on/off option: label and a quiet hint on the left, then an optional extra (count, button). */
export function SwitchRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
  extra,
}: {
  label: ReactNode
  hint?: ReactNode
  checked: boolean
  onChange: () => void
  disabled?: boolean
  extra?: ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <FormControlLabel
        sx={{ m: 0, flexGrow: 1, gap: 0.5, alignItems: 'center' }}
        disabled={disabled}
        control={<Switch size="small" checked={checked} onChange={onChange} />}
        label={
          <Box>
            <Typography variant="body2">{label}</Typography>
            {hint && (
              <Typography variant="caption" color="text.secondary">
                {hint}
              </Typography>
            )}
          </Box>
        }
      />
      {extra}
    </Box>
  )
}
