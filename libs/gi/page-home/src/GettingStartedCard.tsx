import {
  useDataManagerKeys,
  useDataManagerValues,
} from '@genshin-optimizer/common/database-ui'
import { CardThemed } from '@genshin-optimizer/common/ui'
import { useDatabase } from '@genshin-optimizer/gi/db-ui'
import { giTokens } from '@genshin-optimizer/gi/theme'
import CheckIcon from '@mui/icons-material/Check'
import { Box, Button, CardContent, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link as RouterLink } from 'react-router-dom'

const hiddenKey = 'GOGettingStartedHidden'

type Step = {
  key: 'characters' | 'artifacts' | 'team' | 'optimize'
  done: boolean
  to?: string
  secondary?: { key: string; to: string }
}

/**
 * A checklist for new users: the order is the real dependency chain of the app
 * (characters → artifacts → team → optimizer), so the steps are numbered.
 * Disappears once every step is done, or when hidden.
 */
export default function GettingStartedCard() {
  const { t } = useTranslation('page_home')
  const database = useDatabase()
  const chars = useDataManagerValues(database.chars)
  const arts = useDataManagerValues(database.arts)
  const teamIds = useDataManagerKeys(database.teams)
  const buildLists = useDataManagerValues(database.generatedBuildList)
  const [hidden, setHidden] = useState(
    () => localStorage.getItem(hiddenKey) === '1'
  )

  // the most recently edited team with a character in it, to open its optimizer
  const optimizeTo = (() => {
    const [teamId, team] =
      teamIds
        .map((id) => [id, database.teams.get(id)] as const)
        .filter(([, team]) => team?.loadoutData[0]?.teamCharId)
        .sort(([, a], [, b]) => (b?.lastEdit ?? 0) - (a?.lastEdit ?? 0))[0] ??
      []
    const teamCharId = team?.loadoutData[0]?.teamCharId
    const charKey = teamCharId && database.teamChars.get(teamCharId)?.key
    return teamId && charKey
      ? `/teams/${teamId}/${charKey}/optimize`
      : undefined
  })()

  const steps: Step[] = [
    { key: 'characters', done: chars.length > 0, to: '/characters' },
    {
      key: 'artifacts',
      done: arts.length > 0,
      to: '/setting',
      secondary: { key: 'scanners', to: '/scanner' },
    },
    { key: 'team', done: teamIds.length > 0, to: '/teams' },
    {
      key: 'optimize',
      done: buildLists.some(({ builds }) => builds.length > 0),
      to: optimizeTo,
    },
  ]
  const current = steps.findIndex(({ done }) => !done)
  if (hidden || current === -1) return null

  const hide = () => {
    localStorage.setItem(hiddenKey, '1')
    setHidden(true)
  }
  return (
    <CardThemed role="region" aria-labelledby="getting-started-title">
      <CardContent
        sx={{ display: 'flex', flexDirection: 'column', gap: 2, p: 2.5 }}
      >
        <Box display="flex" alignItems="flex-start" gap={2}>
          <Box flexGrow={1}>
            <Typography variant="h5" component="h2" id="getting-started-title">
              {t('gettingStarted.title')}
            </Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {t('gettingStarted.subtitle')}
            </Typography>
          </Box>
          <Button variant="text" color="inherit" size="small" onClick={hide}>
            {t('gettingStarted.hide')}
          </Button>
        </Box>
        <Box
          component="ol"
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
            alignItems: 'start',
            gap: 1.5,
            listStyle: 'none',
            p: 0,
            m: 0,
          }}
        >
          {steps.map((step, index) => (
            <StepItem
              key={step.key}
              index={index}
              done={step.done}
              isCurrent={index === current}
              title={t(`gettingStarted.steps.${step.key}.title`)}
              description={t(`gettingStarted.steps.${step.key}.description`)}
            >
              <Button
                size="small"
                variant={index === current ? 'contained' : 'outlined'}
                color={index === current ? 'primary' : 'inherit'}
                disabled={!step.to}
                component={RouterLink}
                to={step.to ?? '#'}
              >
                {t(`gettingStarted.steps.${step.key}.action`)}
              </Button>
              {step.secondary && (
                <Button
                  size="small"
                  variant="text"
                  color="inherit"
                  component={RouterLink}
                  to={step.secondary.to}
                >
                  {t(`gettingStarted.steps.${step.key}.${step.secondary.key}`)}
                </Button>
              )}
            </StepItem>
          ))}
        </Box>
      </CardContent>
    </CardThemed>
  )
}

function StepItem({
  index,
  done,
  isCurrent,
  title,
  description,
  children,
}: {
  index: number
  done: boolean
  isCurrent: boolean
  title: string
  description: string
  children: ReactNode
}) {
  const { t } = useTranslation('page_home')
  return (
    <Box
      component="li"
      aria-current={isCurrent ? 'step' : undefined}
      sx={{
        display: 'flex',
        gap: 1.5,
        p: 2,
        borderRadius: 2,
        bgcolor: 'contentLight.main',
        outline: `1px solid ${isCurrent ? giTokens.starlight : 'transparent'}`,
        outlineOffset: -1,
        opacity: done ? 0.75 : 1,
      }}
    >
      <Box
        aria-hidden
        sx={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          fontSize: '0.875rem',
          fontWeight: 700,
          ...(done
            ? { bgcolor: 'success.main', color: 'success.contrastText' }
            : {
                border: `2px solid ${
                  isCurrent ? giTokens.starlight : giTokens.hairlineStrong
                }`,
                color: isCurrent ? giTokens.starlight : 'text.secondary',
              }),
        }}
      >
        {done ? <CheckIcon sx={{ fontSize: 18 }} /> : index + 1}
      </Box>
      <Box minWidth={0}>
        <Typography sx={{ fontWeight: 600 }}>
          {title}
          {done && (
            <Typography
              component="span"
              variant="body2"
              sx={{ ml: 1, color: 'success.light', fontWeight: 600 }}
            >
              {t('gettingStarted.done')}
            </Typography>
          )}
        </Typography>
        {/* finished steps collapse to their title, so what is left stays in view */}
        {!done && (
          <>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ mt: 0.25 }}
            >
              {description}
            </Typography>
            <Box sx={{ mt: 1.25, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              {children}
            </Box>
          </>
        )}
      </Box>
    </Box>
  )
}
