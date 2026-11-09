import { iconInlineProps } from '@genshin-optimizer/common/svgicons'
import {
  CardThemed,
  ImgIcon,
  SolidToggleButtonGroup,
  SqBadge,
} from '@genshin-optimizer/common/ui'
import type { Unit } from '@genshin-optimizer/common/util'
import { valueString } from '@genshin-optimizer/common/util'
import { artifactDefIcon } from '@genshin-optimizer/gi/assets'
import type {
  ArtifactSetKey,
  ArtifactSlotKey,
  SubstatKey,
} from '@genshin-optimizer/gi/consts'
import {
  allArtifactSlotKeys,
  allSubstatKeys,
} from '@genshin-optimizer/gi/consts'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import { SlotIcon, StatIcon } from '@genshin-optimizer/gi/svgicons'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import {
  ArtifactSetMultiAutocomplete,
  ArtifactSetName,
  ArtifactSetTooltip,
  ArtifactSlotToggle,
  HitModeToggle,
  RangeFilterRow,
  ReactionToggle,
  resolveInfo,
} from '@genshin-optimizer/gi/ui'
import type { Info } from '@genshin-optimizer/gi/wr'
import ScienceIcon from '@mui/icons-material/Science'
import TuneIcon from '@mui/icons-material/Tune'
import {
  Alert,
  AlertTitle,
  Badge,
  Box,
  Button,
  CardContent,
  ToggleButton,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useCallback, useContext } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import OptimizationTargetSelector from '../TabOptimize/Components/OptimizationTargetSelector'
import {
  countOf,
  SettingsCard,
  SwitchRow,
} from '../TabOptimize/Components/SettingsCard'
import { rememberBuildBeforeTc } from '../TabTheorycraft/buildBeforeTc'
import { tcRollCapacity, tcRollsUsed } from '../TabTheorycraft/tcRolls'

/**
 * The top of the Improve tab: what to improve (the optimization target, shared with Optimize),
 * how hits are counted, and the way into theorycrafting this build.
 */
export function ImproveToolbar({
  optimizationTarget,
  setTarget,
}: {
  optimizationTarget?: string[]
  setTarget: (target: string[]) => void
}) {
  return (
    <CardThemed bgt="light">
      <CardContent
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 1,
          py: 1,
          '&:last-child': { pb: 1 },
        }}
      >
        <Box sx={{ flex: '1 1 320px', minWidth: 0, display: 'flex' }}>
          <OptimizationTargetSelector
            optimizationTarget={optimizationTarget}
            setTarget={setTarget}
            // the first step: the main action until a target is picked
            buttonProps={{
              sx: { flexGrow: 1, ...(optimizationTarget ? {} : giCtaSx) },
            }}
            targetSelectorModalProps={{
              excludeSections: ['character', 'bonusStats', 'teamBuff'],
            }}
          />
        </Box>
        <HitModeToggle size="small" />
        <ReactionToggle size="small" />
        <TheorycraftButton />
      </CardContent>
    </CardThemed>
  )
}

/**
 * Copies the current build (weapon, main stats, sets and substats) into a new theorycraft build,
 * switches to it and opens the Theorycraft tab: one click instead of the build list's
 * copy-then-activate. A theorycraft build is duplicated as is.
 */
export function useTheorycraftThisBuild() {
  const { t } = useTranslation('build')
  const database = useDatabase()
  const navigate = useNavigate()
  const {
    teamId,
    teamCharId,
    teamChar: { key: characterKey },
    loadoutDatum,
  } = useContext(TeamCharacterContext)
  return useCallback(() => {
    const buildTcId =
      loadoutDatum.buildType === 'tc'
        ? database.buildTcs.duplicate(loadoutDatum.buildTcId)
        : database.buildTcs.newFromBuild(
            characterKey,
            database.teams.getLoadoutWeapon(loadoutDatum),
            Object.values(database.teams.getLoadoutArtifacts(loadoutDatum)),
            teamCharId
          )
    if (!buildTcId) return
    const buildTc = database.buildTcs.get(buildTcId)
    const name = database.teams.getActiveBuildName(loadoutDatum)
    database.buildTcs.set(buildTcId, {
      // the copy's substats already hold most rolls: only what is left can be distributed
      ...(buildTc && {
        optimization: {
          ...buildTc.optimization,
          distributedSubstats: Math.max(
            0,
            Math.round(tcRollCapacity(buildTc) - tcRollsUsed(buildTc))
          ),
        },
      }),
      name:
        loadoutDatum.buildType === 'equipped'
          ? t('buildEqCard.copy.nameTc')
          : t('buildRealCard.copy.nameTc', { name }),
    })
    rememberBuildBeforeTc(teamCharId, loadoutDatum.buildType)
    database.teams.setLoadoutDatum(teamId, teamCharId, {
      buildType: 'tc',
      buildTcId,
    })
    // the Theorycraft tab is the member's first tab
    navigate(`/teams/${teamId}/${characterKey}`)
  }, [t, database, navigate, teamId, teamCharId, characterKey, loadoutDatum])
}

export function TheorycraftButton() {
  const { t } = useTranslation('page_character_optimize')
  const theorycraft = useTheorycraftThisBuild()
  return (
    <Button startIcon={<ScienceIcon />} onClick={theorycraft}>
      {t('improve.theorycraft', 'Theorycraft this build')}
    </Button>
  )
}

/**
 * Which artifacts to consider for leveling: the level range, slots and sets, with the rest of
 * the options (main stats, set rules, constraints, reshape/define...) behind "More options".
 */
export function UpgradeSearchCard({
  levelTotal,
  levelLow,
  levelHigh,
  setLevel,
  slotKeys,
  slotTotal,
  setSlotKeys,
  artSetKeys,
  setTotal,
  setArtSetKeys,
  moreOpen,
  moreCount,
  onToggleMore,
  action,
}: {
  levelTotal: string
  levelLow: number
  levelHigh: number
  setLevel: (low: number, high: number) => void
  slotKeys: ArtifactSlotKey[]
  slotTotal: Record<ArtifactSlotKey, string>
  setSlotKeys: (slotKeys: ArtifactSlotKey[]) => void
  artSetKeys: ArtifactSetKey[]
  setTotal: Record<ArtifactSetKey, string>
  setArtSetKeys: (artSetKeys: ArtifactSetKey[]) => void
  moreOpen: boolean
  /** How many of the "More options" are changed from their defaults */
  moreCount: number
  onToggleMore: () => void
  action?: ReactNode
}) {
  const { t } = useTranslation('page_character_optimize')
  return (
    <SettingsCard
      title={t('improve.search', 'Artifacts to level')}
      info={
        <Typography>
          <Trans t={t} i18nKey="upOptInfo">
            The Artifact Upgrader identifies artifacts with high potential to
            boost the Optimization Target's value, guiding you to artifacts
            worth leveling up.
            <br />
            As it only swaps one artifact at a time, for the best overall build
            across all artifacts, use the main artifact optimizer.
          </Trans>
        </Typography>
      }
      summary={countOf(
        levelTotal,
        (cur, tot) =>
          t('improve.countOf', {
            defaultValue: '{{cur}} of {{tot}} artifacts',
            cur,
            tot,
          }),
        (tot) =>
          t('improve.countAll', { defaultValue: '{{tot}} artifacts', tot })
      )}
      action={action}
    >
      <RangeFilterRow
        label={t('settings.level')}
        low={levelLow}
        high={levelHigh}
        min={0}
        max={20}
        marks
        setLow={(low) => setLevel(low, levelHigh)}
        setHigh={(high) => setLevel(levelLow, high)}
        setBoth={setLevel}
      />
      <ArtifactSlotToggle
        quiet
        value={slotKeys}
        totals={slotTotal}
        onChange={setSlotKeys}
      />
      <ArtifactSetMultiAutocomplete
        // only 5★ artifacts are considered on this page
        allowRarities={[5]}
        size="small"
        totals={setTotal}
        artSetKeys={artSetKeys}
        setArtSetKeys={setArtSetKeys}
      />
      <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Badge
          color="primary"
          badgeContent={moreCount}
          invisible={moreOpen || !moreCount}
        >
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            startIcon={<TuneIcon />}
            onClick={onToggleMore}
            aria-expanded={moreOpen}
          >
            {moreOpen
              ? t('improve.fewerOptions', 'Fewer options')
              : t('improve.moreOptions', 'More options')}
          </Button>
        </Badge>
      </Box>
    </SettingsCard>
  )
}

/** Reshape (Dust of Enlightenment) and Define (Sanctifying Elixir) candidates. */
export function CraftingCard({
  optConfigId,
  upOptReshape,
  upOptReshapeRolls,
  reshapeCandidateCount,
  upOptDefine,
  upOptDefineSubstats,
  defineSets,
  defineFallbackSlots,
}: {
  optConfigId: string
  upOptReshape: boolean
  upOptReshapeRolls: number
  reshapeCandidateCount: number
  upOptDefine: boolean
  upOptDefineSubstats: SubstatKey[]
  defineSets: {
    setKey: ArtifactSetKey
    slotKeys: ArtifactSlotKey[]
    arbitrary: boolean
  }[]
  defineFallbackSlots: ArtifactSlotKey[]
}) {
  const { t } = useTranslation('page_character_optimize')
  const { t: tk } = useTranslation('statKey_gen')
  const database = useDatabase()
  const set = (
    data: Partial<{
      upOptReshape: boolean
      upOptReshapeRolls: number
      upOptDefine: boolean
      upOptDefineSubstats: SubstatKey[]
    }>
  ) => database.optConfigs.set(optConfigId, data)
  const substatLabel = (key: string) =>
    `${tk(key)}${['atk_', 'def_', 'hp_'].includes(key) ? '%' : ''}`
  return (
    <SettingsCard
      title={t('improve.crafting', 'Reshape & Define')}
      info={
        <Typography>
          {t(
            'improve.craftingInfo',
            'Also rank artifacts you could reshape (level 20, needs data imported from Irminsul) or create by defining.'
          )}
        </Typography>
      }
    >
      <SwitchRow
        label={t('upOptReshape.label')}
        hint={t(
          'improve.reshapeHint',
          'Score level 20 artifacts as reshape candidates'
        )}
        checked={upOptReshape}
        onChange={() => set({ upOptReshape: !upOptReshape })}
        extra={<SqBadge color="info">{reshapeCandidateCount}</SqBadge>}
      />
      {upOptReshape && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 5.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t('upOptReshape.rolls')}
          </Typography>
          <SolidToggleButtonGroup
            quiet
            exclusive
            size="small"
            value={upOptReshapeRolls}
            onChange={(_, rolls: number | null) =>
              rolls && set({ upOptReshapeRolls: rolls })
            }
          >
            {[2, 3, 4].map((rolls) => (
              <ToggleButton key={rolls} value={rolls}>
                {t('upOptReshape.rollOption', { count: rolls })}
              </ToggleButton>
            ))}
          </SolidToggleButtonGroup>
        </Box>
      )}
      <SwitchRow
        label={t('upOptDefine.label')}
        hint={t(
          'improve.defineHint',
          'Score artifacts you could create with two chosen substats'
        )}
        checked={upOptDefine}
        onChange={() => set({ upOptDefine: !upOptDefine })}
      />
      {upOptDefine && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, pl: 5.5 }}>
          <Typography variant="body2" color="text.secondary">
            {t('upOptDefine.substats')}{' '}
            <SqBadge color="info">{upOptDefineSubstats.length}</SqBadge>
          </Typography>
          <SolidToggleButtonGroup
            quiet
            size="small"
            value={upOptDefineSubstats}
            onChange={(_, keys: SubstatKey[]) =>
              set({ upOptDefineSubstats: keys })
            }
          >
            {allSubstatKeys.map((key) => (
              <ToggleButton key={key} value={key}>
                <StatIcon statKey={key} iconProps={iconInlineProps} />
                {substatLabel(key)}
              </ToggleButton>
            ))}
          </SolidToggleButtonGroup>
          <Typography variant="body2" color="text.secondary">
            {t('upOptDefine.sets')}{' '}
            <SqBadge color="info">{defineSets.length}</SqBadge>
          </Typography>
          {defineSets.length ? (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {defineSets.map(({ setKey, slotKeys, arbitrary }) => (
                <ArtifactSetTooltip key={setKey} setKey={setKey}>
                  <SqBadge color={arbitrary ? 'warning' : 'primary'}>
                    <Typography variant="body2" component="span">
                      <ImgIcon size={1.5} src={artifactDefIcon(setKey)} />{' '}
                      <ArtifactSetName setKey={setKey} />
                      {slotKeys.length < allArtifactSlotKeys.length && (
                        <>
                          {' '}
                          {slotKeys.map((slotKey) => (
                            <SlotIcon
                              key={slotKey}
                              slotKey={slotKey}
                              iconProps={iconInlineProps}
                            />
                          ))}
                        </>
                      )}
                    </Typography>
                  </SqBadge>
                </ArtifactSetTooltip>
              ))}
            </Box>
          ) : (
            <Typography variant="caption" color="text.secondary">
              {t('upOptDefine.setsEmpty')}
            </Typography>
          )}
          {!!defineFallbackSlots.length && (
            <Alert severity="warning">
              {t('upOptDefine.setsArbitrary')}{' '}
              {defineFallbackSlots.map((slotKey) => (
                <SlotIcon
                  key={slotKey}
                  slotKey={slotKey}
                  iconProps={iconInlineProps}
                />
              ))}
            </Alert>
          )}
        </Box>
      )}
    </SettingsCard>
  )
}

/**
 * Why the upgrader found nothing. Usually the current build misses a constraint: an upgrade only
 * counts when the whole build meets them, and one artifact rarely gets it there. Name the
 * constraint and how far off the build is, rather than blaming the filters.
 */
export function NoUpgradesAlert({
  unmet,
  unfillable,
  funnel,
  onShowConstraints,
  onShowOptions,
}: {
  unmet: { info: Info | undefined; minimum: number; current: number }[]
  /** Empty slots of the build no candidate can fill */
  unfillable: ArtifactSlotKey[]
  /** How many artifacts each of the upgrader's filters keeps */
  funnel: {
    inRange: number
    fiveStar: number
    setRules: number
    mainStats: number
  }
  onShowConstraints: () => void
  onShowOptions: () => void
}) {
  const { t } = useTranslation(['page_character_optimize', 'artifact'])
  if (!unmet.length && unfillable.length)
    return (
      <Alert
        severity="warning"
        action={
          <Button color="inherit" size="small" onClick={onShowOptions}>
            {t('improve.moreOptions', 'More options')}
          </Button>
        }
      >
        <AlertTitle>
          {t('improve.unfillableTitle', {
            defaultValue: 'Nothing can fill the empty {{slots}}',
            slots: unfillable
              .map((slotKey) => t(`artifact:slotName.${slotKey}`))
              .join(', '),
          })}
        </AlertTitle>
        {t(
          'improve.unfillableHint',
          'No artifact for it is a 5★ within the level range that also passes the main stats and set rules, and nothing else beats the pieces equipped. Widen the level range or those options, or equip one first.'
        )}
      </Alert>
    )
  const moreOptions = (
    <Button color="inherit" size="small" onClick={onShowOptions}>
      {t('improve.moreOptions', 'More options')}
    </Button>
  )
  // a filter of the upgrader's own took every artifact out: say which
  if (!unmet.length && funnel.inRange && !funnel.fiveStar)
    return (
      <Alert severity="warning">
        {t('improve.noFiveStar', {
          defaultValue:
            'The upgrader only levels 5★ artifacts, and none of the {{count}} in range is 5★.',
          count: funnel.inRange,
        })}
      </Alert>
    )
  if (!unmet.length && funnel.fiveStar && !funnel.setRules)
    return (
      <Alert severity="warning" action={moreOptions}>
        <AlertTitle>
          {t(
            'improve.setRulesTitle',
            'Every candidate breaks the artifact set rules'
          )}
        </AlertTitle>
        {t('improve.setRulesHint', {
          defaultValue:
            'Swapping any of the {{count}} 5★ artifacts in range into this build would break the set rules under Artifact sets. Loosen them in More options, or start from a build that already meets them.',
          count: funnel.fiveStar,
        })}
      </Alert>
    )
  if (!unmet.length && funnel.setRules && !funnel.mainStats)
    return (
      <Alert severity="warning" action={moreOptions}>
        {t('improve.mainStatsHint', {
          defaultValue:
            'None of the {{count}} artifacts left has a main stat allowed under Main stats. Allow more in More options.',
          count: funnel.setRules,
        })}
      </Alert>
    )
  // artifacts were evaluated, but none is likely to beat the pieces equipped
  if (!unmet.length && funnel.mainStats)
    return (
      <Alert
        severity="info"
        action={
          <Button
            color="inherit"
            size="small"
            component={RouterLink}
            to="../optimize"
            relative="path"
          >
            {t('improve.openOptimize', 'Open Optimize')}
          </Button>
        }
      >
        <AlertTitle>
          {t('improve.nothingBetterTitle', {
            defaultValue:
              'None of the {{count}} artifacts considered is likely to beat what is equipped',
            count: funnel.mainStats,
          })}
        </AlertTitle>
        {t(
          'improve.nothingBetterHint',
          'These pieces already do well for this target. To go further, let the Optimizer find a better full build, or use Stat value above to see which stats to farm next.'
        )}
      </Alert>
    )
  if (!unmet.length)
    return <Alert severity="warning">{t('upOptNoResults')}</Alert>
  return (
    <Alert
      severity="warning"
      action={
        <Button color="inherit" size="small" onClick={onShowConstraints}>
          {t('improve.showConstraints', 'Show constraints')}
        </Button>
      }
    >
      <AlertTitle>
        {t(
          'improve.unmetTitle',
          'This build does not meet its minimum build constraints'
        )}
      </AlertTitle>
      {unmet.map(({ info, minimum, current }, i) => {
        const { name, unit } = info ? resolveInfo(info) : {}
        const u = (unit ?? '') as Unit
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, rebuilt with the calculation
          <Typography key={i} variant="body2">
            {name}: <strong>{valueString(current, u)}</strong>{' '}
            {t('improve.unmetNeeds', {
              defaultValue: '(needs {{min}})',
              min: valueString(minimum, u),
            })}
          </Typography>
        )
      })}
      <Typography variant="body2" sx={{ mt: 0.5 }}>
        {t(
          'improve.unmetHint',
          'An upgrade only counts when the whole build meets them, and no single artifact gets this build there. Lower or switch off the constraint, or start from a build the Optimizer made.'
        )}
      </Typography>
    </Alert>
  )
}
