import { CardThemed, SqBadge } from '@genshin-optimizer/common/ui'
import { notEmpty } from '@genshin-optimizer/common/util'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import { ArtifactCardPico, CharIconSide } from '@genshin-optimizer/gi/ui'
import InfoIcon from '@mui/icons-material/Info'
import { Box, Grid, Skeleton, Tooltip, Typography } from '@mui/material'
import type { ReactNode } from 'react'
import { memo, Suspense, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { SwitchRow } from './SettingsCard'
export const UseTeammateArt = memo(function UseTeammateArt({
  totalTally,
  useTeammateBuild,
  disabled = false,
}: {
  totalTally: ReactNode
  useTeammateBuild: boolean
  disabled?: boolean
}) {
  const { t } = useTranslation('page_character_optimize')
  const database = useDatabase()
  const {
    teamCharId,
    teamChar: { optConfigId },
    team: { loadoutData },
  } = useContext(TeamCharacterContext)
  // the teammates' active builds, shown on hover over the count
  const preview = (
    <Box>
      <Suspense
        fallback={<Skeleton variant="rectangular" width={400} height={400} />}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          {loadoutData
            .filter(notEmpty)
            .filter((loadoutDatum) => loadoutDatum.teamCharId !== teamCharId)
            .map((loadoutDatum) => {
              const characterKey = database.teamChars.get(
                loadoutDatum?.teamCharId
              )?.key
              const artifacts =
                loadoutDatum.buildType === 'tc'
                  ? undefined
                  : database.teams.getLoadoutArtifacts(loadoutDatum)
              return (
                <CardThemed
                  sx={{
                    p: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                  }}
                  key={loadoutDatum.teamCharId}
                >
                  <Box display="flex" alignItems="center" gap={1}>
                    {characterKey && (
                      <CharIconSide characterKey={characterKey} />
                    )}
                    <Typography>
                      {database.teams.getActiveBuildName(loadoutDatum)}
                    </Typography>
                  </Box>
                  {artifacts ? (
                    <Grid container columns={5} spacing={1}>
                      {Object.entries(artifacts).map(([slotKey, art]) => (
                        <Grid item key={slotKey} xs={1}>
                          <ArtifactCardPico
                            artifactObj={art}
                            slotKey={slotKey}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  ) : (
                    <Typography>
                      <SqBadge sx={{ width: '100%' }}>{t('tcBadge')}</SqBadge>
                    </Typography>
                  )}
                </CardThemed>
              )
            })}
        </Box>
      </Suspense>
    </Box>
  )
  return (
    <SwitchRow
      label={t('settings.teammates')}
      hint={t('settings.teammatesHint')}
      checked={useTeammateBuild}
      onChange={() =>
        database.optConfigs.set(optConfigId, {
          useTeammateBuild: !useTeammateBuild,
        })
      }
      disabled={disabled}
      extra={
        <Tooltip arrow title={preview}>
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              color: 'text.secondary',
              fontSize: '0.8125rem',
              fontVariantNumeric: 'tabular-nums',
              cursor: 'help',
            }}
          >
            {totalTally}
            <InfoIcon fontSize="small" />
          </Box>
        </Tooltip>
      }
    />
  )
})
