import { CardThemed } from '@genshin-optimizer/common/ui'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import { HitModeToggle, ReactionToggle } from '@genshin-optimizer/gi/ui'
import ArrowBackIcon from '@mui/icons-material/ArrowBack'
import ScienceIcon from '@mui/icons-material/Science'
import { Box, Button, CardContent, Typography } from '@mui/material'
import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { BuildTcContext } from '../../../BuildTcContext'
import CompareBtn from '../../CompareBtn'
import { buildBeforeTc } from './buildBeforeTc'
import GcsimButton from './GcsimButton'
import KQMSButton from './KQMSButton'

/**
 * The Theorycraft tab's header: which theorycraft build this is (a what-if copy: nothing gets
 * equipped), its tools, and the way back to the real build.
 */
export function TcHeader({
  kqms,
  solving,
}: {
  kqms: () => void
  solving: boolean
}) {
  const { t } = useTranslation(['page_character', 'page_team'])
  const database = useDatabase()
  const { teamId, teamCharId, loadoutDatum } = useContext(TeamCharacterContext)
  const { buildTc } = useContext(BuildTcContext)
  const back = buildBeforeTc(database, teamCharId, loadoutDatum)
  const backName = database.teams.getActiveBuildName(
    { ...loadoutDatum, buildType: back },
    t('tabTheorycraft.equipped', 'Equipped')
  )
  const goBack = () =>
    database.teams.setLoadoutDatum(teamId, teamCharId, { buildType: back })
  return (
    <CardThemed bgt="light">
      <CardContent
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
          py: 1.25,
          '&:last-child': { pb: 1.25 },
        }}
      >
        {/* which build this is, and the way back */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            flexWrap: 'wrap',
          }}
        >
          <ScienceIcon color="primary" />
          <Box sx={{ flex: '1 1 240px', minWidth: 0 }}>
            <Typography sx={{ fontWeight: 600 }} noWrap>
              {buildTc.name || t('tabs.theorycraft')}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {t(
                'tabTheorycraft.whatIf',
                'A what-if copy of a build: change anything, nothing gets equipped.'
              )}
            </Typography>
          </Box>
          <Button
            startIcon={<ArrowBackIcon />}
            disabled={solving}
            onClick={goBack}
          >
            {t('tabTheorycraft.back', {
              defaultValue: 'Back to {{name}}',
              name: backName,
            })}
          </Button>
        </Box>
        {/* its tools */}
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 1,
          }}
        >
          <KQMSButton action={kqms} disabled={solving} />
          <GcsimButton disabled={solving} />
          <HitModeToggle size="small" />
          <ReactionToggle size="small" />
          <Box sx={{ ml: { md: 'auto' } }}>
            <CompareBtn />
          </Box>
        </Box>
      </CardContent>
    </CardThemed>
  )
}
