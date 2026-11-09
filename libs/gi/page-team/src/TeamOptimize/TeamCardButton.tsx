import type { TeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import type { TeamCardData, TeamOptResult } from '@genshin-optimizer/gi/ui'
import {
  CardImageDialog,
  makeBuildCardData,
  renderTeamCard,
  rollColorsOf,
  rvKeysOf,
  safeName,
  TEAM_CARD_HEIGHT,
  TEAM_CARD_WIDTH,
  teamOptMembers,
  teamOptUIData,
} from '@genshin-optimizer/gi/ui'
import ImageOutlinedIcon from '@mui/icons-material/ImageOutlined'
import { Button, useTheme } from '@mui/material'
import type { TFunction } from 'i18next'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDamage, formatRate } from './format'

/**
 * "Team card": one picture of a Team Optimize result: its damage figures, then every member's
 * build side by side (each with the character's own stats, and its share of the damage)
 */
export function TeamCardButton(props: TeamCardProps) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button
        variant="outlined"
        color="neutral400"
        startIcon={<ImageOutlinedIcon />}
        onClick={() => setOpen(true)}
      >
        {t('teamOpt.card.button', 'Team card')}
      </Button>
      {open && <TeamCardDialog {...props} onClose={() => setOpen(false)} />}
    </>
  )
}

type TeamCardProps = {
  teamId: string
  result: TeamOptResult
  /** the settings the result was found with */
  runTeamOpt: TeamOpt
  /** how long one rotation takes (seconds), if set: the figures are then per second */
  rotationTime?: number
}

function TeamCardDialog({
  teamId,
  result,
  runTeamOpt,
  rotationTime,
  onClose,
}: TeamCardProps & { onClose: () => void }) {
  const { t } = useTranslation([
    'page_team',
    'ui',
    'sheet_gen',
    'charNames_gen',
    'weaponNames_gen',
    'artifactNames_gen',
  ])
  const database = useDatabase()
  const { gender } = useDBMeta()
  const theme = useTheme()
  const team = useTeam(teamId)
  const teamName = team?.name ?? ''

  const data = useMemo((): TeamCardData | undefined => {
    const uiData = teamOptUIData(database, teamId, gender, runTeamOpt, result)
    if (!uiData) return undefined
    const rollColors = rollColorsOf(theme)
    const { total } = result.after
    const members = teamOptMembers(database, teamId).flatMap(
      ({ characterKey }) => {
        const build = uiData[characterKey]
        const card =
          build &&
          makeBuildCardData(build, {
            database,
            gender,
            t: t as unknown as TFunction,
            rollColors,
            rvKeys: rvKeysOf(database.charMeta.get(characterKey).rvFilter),
          })
        if (!card) return []
        const damage = result.after.members[characterKey] ?? 0
        return [
          {
            card,
            share: total > 0 ? damage / total : 0,
            damage: rotationTime
              ? t('page_team:teamOpt.card.memberDps', {
                  defaultValue: '{{value}} DPS',
                  value: formatRate(damage, rotationTime),
                })
              : formatDamage(damage),
          },
        ]
      }
    )
    return {
      name: teamName,
      headline: rotationTime
        ? {
            label: t('page_team:teamOpt.result.dps', 'Team DPS'),
            value: formatRate(total, rotationTime),
          }
        : {
            label: t('page_team:teamOpt.result.total', 'Rotation damage'),
            value: formatDamage(total),
          },
      // from the headline leftward
      figures: rotationTime
        ? [
            {
              label: t('page_team:teamOpt.card.rotation', 'Rotation'),
              value: t('page_team:teamOpt.card.seconds', {
                defaultValue: '{{value}} s',
                value: rotationTime,
              }),
            },
            {
              label: t(
                'page_team:teamOpt.card.rotationDamage',
                'Damage per rotation'
              ),
              value: formatDamage(total),
            },
          ]
        : [],
      members,
      labels: {
        share: t('page_team:teamOpt.card.share', 'of the damage'),
        siteName: 'Stellar Optimizer',
      },
    }
  }, [
    database,
    teamId,
    gender,
    runTeamOpt,
    result,
    rotationTime,
    theme,
    t,
    teamName,
  ])

  const render = useMemo(() => data && (() => renderTeamCard(data)), [data])
  return (
    <CardImageDialog
      title={t('page_team:teamOpt.card.title', 'Team card')}
      alt={t('page_team:teamOpt.card.alt', {
        defaultValue: 'The builds of {{team}}',
        team: teamName,
      })}
      fileName={`${safeName(teamName)}-team`}
      aspectRatio={`${TEAM_CARD_WIDTH} / ${TEAM_CARD_HEIGHT}`}
      render={render}
      format="jpeg"
      onClose={onClose}
    />
  )
}
