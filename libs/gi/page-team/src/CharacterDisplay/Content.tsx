import {
  EmptyState,
  isPlainLeftClick,
  useOptimisticValue,
} from '@genshin-optimizer/common/ui'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import FactCheckIcon from '@mui/icons-material/FactCheck'
import PersonIcon from '@mui/icons-material/Person'
import ScienceIcon from '@mui/icons-material/Science'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import UpgradeIcon from '@mui/icons-material/Upgrade'
import { Box, Button, Skeleton, Tab, Tabs } from '@mui/material'
import type { MouseEvent } from 'react'
import { Suspense, useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Navigate, Route, Link as RouterLink, Routes } from 'react-router-dom'
import FormulaModal from './FormulaModal'
import { LoadoutHeader } from './LoadoutHeader'
import TabBuild from './Tabs/TabOptimize'
import TabOverview from './Tabs/TabOverview'
import TabTalent from './Tabs/TabTalent'
import TabTheorycraft from './Tabs/TabTheorycraft'
import { buildBeforeTc } from './Tabs/TabTheorycraft/buildBeforeTc'
import TabUpopt from './Tabs/TabUpgradeOpt'
export default function Content({ tab }: { tab?: string }) {
  const { loadoutDatum } = useContext(TeamCharacterContext)
  const isTCBuild = !!(
    loadoutDatum.buildTcId && loadoutDatum.buildType === 'tc'
  )
  const scrollTop = useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])
  return (
    <>
      <FormulaModal />
      <TabNav tab={tab} isTCBuild={isTCBuild} onChange={() => {}} />
      <Box sx={{ p: 1 }}>
        <CharacterPanel isTCBuild={isTCBuild} />
      </Box>
      <TabNav tab={tab} isTCBuild={isTCBuild} hideTitle onChange={scrollTop} />
    </>
  )
}

function CharacterPanel({ isTCBuild }: { isTCBuild: boolean }) {
  return (
    <Suspense
      fallback={<Skeleton variant="rectangular" width="100%" height={500} />}
    >
      <Routes>
        {/* Character Panel */}
        {isTCBuild ? (
          <Route path="" element={<TabTheorycraft />} />
        ) : (
          <Route path="" element={<TabOverview />} />
        )}
        <Route path="talent" element={<TabTalent />} />
        {/* a theorycraft build has no real artifacts to search: explain instead of hiding the tabs */}
        <Route
          path="optimize"
          element={isTCBuild ? <NeedsRealBuild /> : <TabBuild />}
        />
        <Route
          path="upopt"
          element={isTCBuild ? <NeedsRealBuild /> : <TabUpopt />}
        />
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </Suspense>
  )
}
/**
 * The open member's bar: the tabs on the left (gold when active, as everywhere), the loadout and
 * build choosers on the right; on small screens the choosers sit above the tabs. At the top of the
 * card it is its header; repeated below the panel (`hideTitle`) it is the footer, tabs only.
 */
function TabNav({
  tab,
  isTCBuild,
  hideTitle = false,
  onChange,
}: {
  tab?: string
  isTCBuild: boolean
  hideTitle?: boolean
  onChange?: () => void
}) {
  return (
    <Box
      component="nav"
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 2,
        rowGap: 1,
        px: { xs: 1, md: 1.5 },
        pt: hideTitle ? 0 : { xs: 1, md: 0 },
        ...(hideTitle
          ? { borderTop: 1, borderColor: 'divider' }
          : { borderBottom: 1, borderColor: 'divider' }),
      }}
    >
      {!hideTitle && (
        <Box
          sx={{
            order: { xs: 0, md: 1 },
            ml: { md: 'auto' },
            width: { xs: '100%', md: 'auto' },
            minWidth: 0,
            py: { md: 1 },
          }}
        >
          <LoadoutHeader />
        </Box>
      )}
      <LoadoutTabs tab={tab} isTCBuild={isTCBuild} onChange={onChange} />
    </Box>
  )
}

function LoadoutTabs({
  tab,
  isTCBuild,
  onChange,
}: {
  tab?: string
  isTCBuild: boolean
  onChange?: () => void
}) {
  const { t } = useTranslation('page_character')
  // the clicked tab is selected at once; its panel renders in the navigation's transition
  const [value, select] = useOptimisticValue(tab ?? 'overview')

  return (
    <Tabs
      value={value}
      variant="scrollable"
      scrollButtons="auto"
      allowScrollButtonsMobile
      onChange={(e, clicked: string) => {
        // a modified click opens the tab in a new browser tab instead
        if (isPlainLeftClick(e as MouseEvent)) select(clicked)
        onChange?.()
      }}
      sx={{
        order: { xs: 1, md: 0 },
        minWidth: 0,
        maxWidth: '100%',
        minHeight: 0,
        '& .MuiTab-root': {
          minHeight: 52,
          px: 1.75,
          fontWeight: 600,
          color: 'text.secondary',
          transition: 'color 150ms ease',
        },
        '& .MuiTab-root .MuiSvgIcon-root': { fontSize: 20 },
        '& .MuiTab-root:hover': { color: 'text.primary' },
        '& .MuiTab-root.Mui-selected': { color: 'primary.light' },
        '& .MuiTabs-indicator': { height: 2, borderRadius: 1 },
      }}
    >
      {isTCBuild ? (
        <Tab
          iconPosition="start"
          value="overview"
          label={t('tabs.theorycraft')}
          icon={<ScienceIcon />}
          component={RouterLink}
          to=""
        />
      ) : (
        <Tab
          iconPosition="start"
          value="overview"
          label={t('tabs.overview')}
          icon={<PersonIcon />}
          component={RouterLink}
          to=""
        />
      )}
      <Tab
        iconPosition="start"
        value="talent"
        label={t('tabs.talent')}
        icon={<FactCheckIcon />}
        component={RouterLink}
        to="talent"
      />
      <Tab
        iconPosition="start"
        value="optimize"
        label={t('tabs.optimize')}
        icon={<TrendingUpIcon />}
        component={RouterLink}
        to="optimize"
      />
      <Tab
        iconPosition="start"
        value="upopt"
        label={t('tabs.upopt')}
        icon={<UpgradeIcon />}
        component={RouterLink}
        to="upopt"
      />
    </Tabs>
  )
}

/** Shown on Optimize / Artifact Upgrader while the loadout uses a theorycraft build. */
function NeedsRealBuild() {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const { teamId, teamCharId, loadoutDatum } = useContext(TeamCharacterContext)
  // the build the theorycraft copy came from, when it is not just the equipped one
  const back = buildBeforeTc(database, teamCharId, loadoutDatum)
  const use = (buildType: 'equipped' | 'real') =>
    database.teams.setLoadoutDatum(teamId, teamCharId, { buildType })
  return (
    <Box sx={{ p: { xs: 1, md: 2 } }}>
      <EmptyState
        icon={<ScienceIcon />}
        title={t('tcNoOptimize.title')}
        description={t('tcNoOptimize.description')}
        actions={
          <Box
            sx={{
              display: 'flex',
              gap: 1,
              flexWrap: 'wrap',
              justifyContent: 'center',
            }}
          >
            {back === 'real' && (
              <Button sx={giCtaSx} onClick={() => use('real')}>
                {t('tcNoOptimize.back', {
                  defaultValue: 'Back to {{name}}',
                  name: database.teams.getActiveBuildName({
                    ...loadoutDatum,
                    buildType: 'real',
                  }),
                })}
              </Button>
            )}
            <Button
              // the main (gold) action unless "Back to <build>" is offered
              sx={back === 'real' ? undefined : giCtaSx}
              onClick={() => use('equipped')}
            >
              {t('tcNoOptimize.useEquipped')}
            </Button>
          </Box>
        }
      />
    </Box>
  )
}
