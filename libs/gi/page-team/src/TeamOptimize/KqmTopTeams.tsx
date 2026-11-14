import { CardThemed, ModalWrapper } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KqmResult, KqmTeamOption } from '@genshin-optimizer/gi/ui'
import { kqmSetsId, kqmTopTeams } from '@genshin-optimizer/gi/ui'
import CloseIcon from '@mui/icons-material/Close'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Divider,
  IconButton,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatGain, formatRate } from './format'
import { KqmGearIcons } from './KqmBuildView'
import { MemberAvatar } from './MemberAvatar'
import { FieldLabel, focusSx, numSx, quickSx, tokens, type } from './ui'

/** Rows on the page; all of them (at most `MAX`) in the window */
const SHOWN = 5
const MAX = 50

/** How far a team is from the best: −0.4%; under 0.1%, two decimals (−0.04%) */
function gap(ratio: number) {
  const pct = ratio * 100
  if (Math.abs(pct) >= 0.1 || pct === 0) return formatGain(ratio)
  return `${pct > 0 ? '+' : '−'}${Math.abs(pct).toFixed(2)}%`
}

const gearId = (
  b: KqmTeamOption['builds'][CharacterKey] | undefined
): string =>
  b ? `${b.weapon.key}@${b.weapon.refinement}|${kqmSetsId(b.sets)}` : ''

/**
 * The run's team, then the best teams that change one member's weapon or sets, at a glance:
 * each member's weapon and sets, the team's DPS, and how far it is from the best. The first few
 * here, all of them (top 50) in a window. Picking one shows that team (as picking its equipment
 * in the inspector).
 */
export function KqmTopTeams({
  result,
  view,
  rotationTime,
  disabled,
  onPick,
}: {
  result: KqmResult
  /** The team shown now (with the equipment picked) */
  view: KqmResult
  rotationTime?: number
  disabled?: boolean
  onPick: (option: KqmTeamOption) => void
}) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(false)
  const options = useMemo(() => kqmTopTeams(result, MAX), [result])
  if (options.length < 2) return null
  const members = result.optimized
  const current = options.findIndex((o) =>
    members.every((ck) => gearId(o.builds[ck]) === gearId(view.builds[ck]))
  )
  const title = t('teamOpt.kqm.topTeams', 'Top teams')
  const rows = (count: number, pick: (option: KqmTeamOption) => void) => (
    <TeamRows
      options={options.slice(0, count)}
      members={members}
      current={current}
      rotationTime={rotationTime}
      disabled={disabled}
      onPick={pick}
    />
  )
  return (
    <Box component="section" aria-label={title} sx={{ mt: 3 }}>
      <FieldLabel
        tip={t(
          'teamOpt.kqm.topTeamsTip',
          'The best team, then the best teams that change one member’s weapon or artifact sets. Pick one to see it.'
        )}
        sx={{ mb: 0.75 }}
      >
        {title}
      </FieldLabel>
      {rows(SHOWN, onPick)}
      {options.length > SHOWN && (
        <Button
          size="small"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          sx={{ mt: 0.5, color: 'text.secondary', textTransform: 'none' }}
        >
          {t('teamOpt.kqm.topTeamsAll', {
            defaultValue: 'Show top {{count}}',
            count: options.length,
          })}
        </Button>
      )}
      {open && (
        <ModalWrapper
          open
          onClose={() => setOpen(false)}
          containerProps={{ maxWidth: 'lg' }}
        >
          <CardThemed>
            <Box role="dialog" aria-label={title}>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  px: 2.5,
                  pt: 2,
                  pb: 1.5,
                }}
              >
                <Typography component="h2" sx={{ ...type.title, flexGrow: 1 }}>
                  {t('teamOpt.kqm.topTeamsCount', {
                    defaultValue: 'Top {{count}} teams',
                    count: options.length,
                  })}
                </Typography>
                <IconButton
                  onClick={() => setOpen(false)}
                  aria-label={t('teamOpt.editor.close', 'Close')}
                >
                  <CloseIcon />
                </IconButton>
              </Box>
              <Divider />
              <Box sx={{ p: 2, maxHeight: '75vh', overflowY: 'auto' }}>
                {/* (a team picked here is shown on the page) */}
                {rows(options.length, (option) => {
                  onPick(option)
                  setOpen(false)
                })}
              </Box>
            </Box>
          </CardThemed>
        </ModalWrapper>
      )}
    </Box>
  )
}

/** The teams as rows: the changed member in full and outlined, the others faint */
function TeamRows({
  options,
  members,
  current,
  rotationTime,
  disabled,
  onPick,
}: {
  options: KqmTeamOption[]
  members: CharacterKey[]
  /** The row of the team shown now (−1: none) */
  current: number
  rotationTime?: number
  disabled?: boolean
  onPick: (option: KqmTeamOption) => void
}) {
  const { t } = useTranslation('page_team')
  const theme = useTheme()
  // (icons a size apart: the changed member's weapon and sets readable at a glance)
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const icon = narrow ? 30 : 40
  const best = options[0]?.total ?? 0
  const unit = rotationTime
    ? t('teamOpt.kqm.teamDps', 'team DPS')
    : t('teamOpt.kqm.teamDmg', 'team DMG')
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${tokens.hairlineStrong}`,
        borderRadius: tokens.radius.inset,
        overflow: 'hidden',
      }}
    >
      {options.map((option, i) => {
        const selected = i === current
        const value = formatRate(option.total, rotationTime, true)
        return (
          <ButtonBase
            key={
              option.changed
                ? `${option.changed}|${gearId(option.builds[option.changed])}`
                : 'best'
            }
            aria-pressed={selected}
            aria-label={t('teamOpt.kqm.topTeamLabel', {
              defaultValue: 'Team {{rank}}: {{value}} {{unit}}',
              rank: i + 1,
              value,
              unit,
            })}
            disabled={disabled}
            onClick={() => onPick(option)}
            sx={(theme) => ({
              display: 'grid',
              gridTemplateColumns: '32px minmax(0, 1fr) auto',
              alignItems: 'center',
              columnGap: 1.5,
              px: 1.5,
              py: 1,
              textAlign: 'left',
              borderTop: i ? `1px solid ${tokens.hairline}` : undefined,
              bgcolor: selected
                ? alpha(theme.palette.primary.main, 0.1)
                : 'transparent',
              ...quickSx,
              ...focusSx,
              '&:hover': {
                bgcolor: selected
                  ? alpha(theme.palette.primary.main, 0.14)
                  : alpha(theme.palette.text.primary, 0.035),
              },
              '&.Mui-disabled': { opacity: 0.6 },
            })}
          >
            <Typography
              sx={{
                fontSize: 12.5,
                fontWeight: 600,
                color: selected ? 'primary.main' : 'text.secondary',
                ...numSx,
              }}
            >
              #{i + 1}
            </Typography>
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                columnGap: 1.5,
                rowGap: 0.75,
                minWidth: 0,
              }}
            >
              {members.map((ck) => {
                const build = option.builds[ck]
                if (!build) return null
                const changed = ck === option.changed
                return (
                  <Box
                    key={ck}
                    data-changed={changed || undefined}
                    sx={(theme) => ({
                      display: 'flex',
                      alignItems: 'center',
                      gap: 0.75,
                      p: 0.5,
                      pr: 0.75,
                      borderRadius: tokens.radius.inset,
                      ...quickSx,
                      // the member this team changes, against the best one: in full, outlined;
                      // the others as in the best team, much fainter
                      ...(changed && {
                        bgcolor: alpha(theme.palette.primary.main, 0.14),
                        boxShadow: `inset 0 0 0 1.5px ${alpha(theme.palette.primary.main, 0.7)}`,
                      }),
                      ...(option.changed &&
                        !changed && {
                          opacity: 0.3,
                          filter: 'grayscale(0.6)',
                        }),
                    })}
                  >
                    <MemberAvatar characterKey={ck} size={icon - 8} />
                    <KqmGearIcons characterKey={ck} build={build} size={icon} />
                  </Box>
                )
              })}
            </Box>
            <Box sx={{ textAlign: 'right', ...numSx }}>
              <Typography
                sx={{ fontSize: 15, fontWeight: 650, lineHeight: 1.3 }}
              >
                {value}
              </Typography>
              {i > 0 && (
                <Typography
                  sx={{
                    fontSize: 12,
                    lineHeight: 1.3,
                    color: 'text.secondary',
                  }}
                >
                  {gap(option.total / best - 1)}
                </Typography>
              )}
            </Box>
          </ButtonBase>
        )
      })}
    </Box>
  )
}
