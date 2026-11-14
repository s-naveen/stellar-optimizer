import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KqmResult, KqmTeamOption } from '@genshin-optimizer/gi/ui'
import { kqmSetsId, kqmTopTeams } from '@genshin-optimizer/gi/ui'
import { alpha, Box, Button, ButtonBase, Typography } from '@mui/material'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatGain, formatRate } from './format'
import { KqmGearIcons } from './KqmBuildView'
import { MemberAvatar } from './MemberAvatar'
import { FieldLabel, focusSx, numSx, quickSx, tokens } from './ui'

/** Rows shown at first, and at most */
const SHOWN = 5
const MAX = 10

const gearId = (
  b: KqmTeamOption['builds'][CharacterKey] | undefined
): string =>
  b ? `${b.weapon.key}@${b.weapon.refinement}|${kqmSetsId(b.sets)}` : ''

/**
 * The run's team, then the best teams that change one member's weapon or sets, at a glance:
 * each member's weapon and sets, the team's DPS, and how far it is from the best. Picking one
 * shows that team (as picking its equipment in the inspector).
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
  const [more, setMore] = useState(false)
  const options = useMemo(() => kqmTopTeams(result, MAX), [result])
  if (options.length < 2) return null
  const best = options[0].total
  const members = result.optimized
  const current = options.findIndex((o) =>
    members.every((ck) => gearId(o.builds[ck]) === gearId(view.builds[ck]))
  )
  const shown = more ? options : options.slice(0, SHOWN)
  const unit = rotationTime
    ? t('teamOpt.kqm.teamDps', 'team DPS')
    : t('teamOpt.kqm.teamDmg', 'team DMG')
  return (
    <Box
      component="section"
      aria-label={t('teamOpt.kqm.topTeams', 'Top teams')}
      sx={{ mb: 2 }}
    >
      <FieldLabel
        tip={t(
          'teamOpt.kqm.topTeamsTip',
          'The best team, then the best teams that change one member’s weapon or artifact sets. Pick one to see it.'
        )}
        sx={{ mb: 0.75 }}
      >
        {t('teamOpt.kqm.topTeams', 'Top teams')}
      </FieldLabel>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          border: `1px solid ${tokens.hairlineStrong}`,
          borderRadius: tokens.radius.inset,
          overflow: 'hidden',
        }}
      >
        {shown.map((option, i) => {
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
                gridTemplateColumns: '28px minmax(0, 1fr) auto',
                alignItems: 'center',
                columnGap: 1.25,
                px: 1.25,
                py: 0.75,
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
                  columnGap: 1,
                  rowGap: 0.5,
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
                        gap: 0.5,
                        p: 0.25,
                        pr: 0.5,
                        borderRadius: tokens.radius.inset,
                        // (the member this team changes, against the best one)
                        ...(changed && {
                          bgcolor: alpha(theme.palette.primary.main, 0.14),
                          boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.55)}`,
                        }),
                        opacity: option.changed && !changed ? 0.75 : 1,
                      })}
                    >
                      <MemberAvatar characterKey={ck} size={20} />
                      <KqmGearIcons characterKey={ck} build={build} size={24} />
                    </Box>
                  )
                })}
              </Box>
              <Box sx={{ textAlign: 'right', ...numSx }}>
                <Typography
                  sx={{ fontSize: 14, fontWeight: 650, lineHeight: 1.3 }}
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
                    {formatGain(option.total / best - 1)}
                  </Typography>
                )}
              </Box>
            </ButtonBase>
          )
        })}
      </Box>
      {options.length > SHOWN && (
        <Button
          size="small"
          onClick={() => setMore((m) => !m)}
          aria-expanded={more}
          sx={{ mt: 0.5, color: 'text.secondary', textTransform: 'none' }}
        >
          {more
            ? t('teamOpt.kqm.topTeamsFewer', 'Show fewer')
            : t('teamOpt.kqm.topTeamsMore', {
                defaultValue: 'Show {{count}} more',
                count: options.length - SHOWN,
              })}
        </Button>
      )}
    </Box>
  )
}
