import { useBoolState } from '@genshin-optimizer/common/react-util'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import { RangeFilterRow } from '@genshin-optimizer/gi/ui'
import { Box, Typography } from '@mui/material'
import { memo, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { CustomMultiTargetModal } from '../../../CustomMultiTarget/CustomMultiTargetModal'
import AssumeFullLevelToggle from './AssumeFullLevelToggle'
import ExcludeArt from './ExcludeArt'
import MainStatSelectionCard from './MainStatSelectionCard'
import {
  countOf,
  SettingsCard,
  SettingsCardButton,
  SwitchRow,
} from './SettingsCard'
import { UseTeammateArt } from './UseTeammateArt'

/** How many multi-target names the card lists before "+N more". */
const MULTI_TARGETS_SHOWN = 5

/** Artifact level range, with how many artifacts it keeps ("472 of 661"). */
export const LevelFilterCard = memo(function LevelFilterCard({
  levelTotal,
  levelLow,
  levelHigh,
  disabled,
  optConfigId,
}: {
  levelTotal: string
  levelLow: number
  levelHigh: number
  disabled: boolean
  optConfigId: string
}) {
  const database = useDatabase()
  const { t } = useTranslation('page_character_optimize')
  return (
    <SettingsCard
      title={t('levelFilter')}
      summary={countOf(
        levelTotal,
        (cur, tot) => t('settings.of', { cur, tot }),
        (tot) => tot
      )}
    >
      <RangeFilterRow
        label={t('settings.level')}
        low={levelLow}
        high={levelHigh}
        min={0}
        max={20}
        marks
        setLow={(levelLow) =>
          database.optConfigs.set(optConfigId, { levelLow })
        }
        setHigh={(levelHigh) =>
          database.optConfigs.set(optConfigId, { levelHigh })
        }
        setBoth={(levelLow, levelHigh) =>
          database.optConfigs.set(optConfigId, { levelLow, levelHigh })
        }
        disabled={disabled}
      />
    </SettingsCard>
  )
})

/** Main stat level assumption, then the main stats allowed per slot. */
export function MainStatCard({
  disabled,
  filteredArtIdMap,
  mainStatAssumptionLevel,
  optConfigId,
}: {
  disabled: boolean
  filteredArtIdMap: Record<string, boolean>
  mainStatAssumptionLevel: number
  optConfigId: string
}) {
  const database = useDatabase()
  const { t } = useTranslation('page_character_optimize')
  return (
    <SettingsCard title={t('settings.mainStats')}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography
          variant="body2"
          color="text.secondary"
          sx={{ flexShrink: 0 }}
        >
          {t('settings.levelAssumption')}
        </Typography>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <AssumeFullLevelToggle
            mainStatAssumptionLevel={mainStatAssumptionLevel}
            setmainStatAssumptionLevel={(mainStatAssumptionLevel: number) =>
              database.optConfigs.set(optConfigId, { mainStatAssumptionLevel })
            }
            disabled={disabled}
          />
        </Box>
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ mt: -0.5 }}>
        {t('mainStat.levelAssTooltip.desc')}
      </Typography>
      <MainStatSelectionCard
        disabled={disabled}
        filteredArtIdMap={filteredArtIdMap}
      />
    </SettingsCard>
  )
}

/** Which artifacts the optimizer may use: exclusion list, teammates' builds, partial builds. */
export function ArtifactPoolCard({
  disabled,
  excludedTotal,
  teammateBuildTotal,
  useTeammateBuild,
  allowPartial,
  optConfigId,
}: {
  disabled: boolean
  excludedTotal: string
  teammateBuildTotal: string
  useTeammateBuild: boolean
  allowPartial: boolean
  optConfigId: string
}) {
  const database = useDatabase()
  const { t } = useTranslation('page_character_optimize')
  return (
    <SettingsCard title={t('settings.pool')}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
        <ExcludeArt disabled={disabled} excludedTotal={excludedTotal} />
        <UseTeammateArt
          totalTally={teammateBuildTotal}
          useTeammateBuild={useTeammateBuild}
          disabled={disabled}
        />
        <SwitchRow
          label={t('settings.partial')}
          hint={t('settings.partialHint')}
          checked={allowPartial}
          onChange={() =>
            database.optConfigs.set(optConfigId, {
              allowPartial: !allowPartial,
            })
          }
          disabled={disabled}
        />
      </Box>
    </SettingsCard>
  )
}

/** The character's multi-optimization targets (name and size of each), with Edit opening the editor. */
export function MultiTargetCard() {
  const { t } = useTranslation(['page_character_optimize', 'common'])
  const [show, onShow, onClose] = useBoolState()
  const {
    teamChar: { customMultiTargets },
  } = useContext(TeamCharacterContext)
  const hidden = customMultiTargets.length - MULTI_TARGETS_SHOWN
  return (
    <>
      <SettingsCard
        title={t('settings.multiTargets')}
        summary={
          customMultiTargets.length ? undefined : t('settings.noTargets')
        }
        action={
          <SettingsCardButton onClick={onShow}>
            {t('common:edit')}
          </SettingsCardButton>
        }
      >
        {!!customMultiTargets.length && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {customMultiTargets
              .slice(0, MULTI_TARGETS_SHOWN)
              .map(({ name, targets }, i) => (
                <Box
                  // biome-ignore lint/suspicious/noArrayIndexKey: names need not be unique, and this list is display-only
                  key={i}
                  sx={{ display: 'flex', alignItems: 'baseline', gap: 2 }}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    title={name}
                    sx={{ flex: '1 1 auto', minWidth: 0 }}
                  >
                    {name}
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{
                      flexShrink: 0,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {t('settings.targets', { count: targets.length })}
                  </Typography>
                </Box>
              ))}
            {hidden > 0 && (
              <Typography variant="body2" color="text.secondary">
                {t('settings.moreTargets', { count: hidden })}
              </Typography>
            )}
          </Box>
        )}
      </SettingsCard>
      <CustomMultiTargetModal open={show} onClose={onClose} />
    </>
  )
}
