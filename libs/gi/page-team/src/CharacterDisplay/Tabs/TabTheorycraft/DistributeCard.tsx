import { CustomNumberInput } from '@genshin-optimizer/common/ui'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type { BuildStatus } from '@genshin-optimizer/gi/ui'
import { BuildAlert } from '@genshin-optimizer/gi/ui'
import CalculateIcon from '@mui/icons-material/Calculate'
import CloseIcon from '@mui/icons-material/Close'
import { Alert, Box, Button, Typography } from '@mui/material'
import { Trans, useTranslation } from 'react-i18next'
import { SettingsCard } from '../TabOptimize/Components/SettingsCard'
import ScalesWith from './ScalesWith'

/**
 * The theorycraft solver: the best way to spend some extra substat rolls on this build (within
 * the constraints and each substat's roll limit), applied to the build when it finishes.
 */
export function DistributeCard({
  distributedSubstats,
  setDistributedSubstats,
  maxTotalRolls,
  usedRolls,
  hasTarget,
  solving,
  onDistribute,
  onCancel,
  minSubLines,
  minOtherRolls,
  status,
  characterKey,
  gender,
}: {
  distributedSubstats: number
  setDistributedSubstats: (n: number) => void
  maxTotalRolls: number
  /** Rolls the substats amount to already (in the build's roll size) */
  usedRolls: number
  hasTarget: boolean
  solving: boolean
  onDistribute: () => void
  onCancel: () => void
  minSubLines: number
  minOtherRolls: number
  status: BuildStatus
  characterKey: CharacterKey
  gender: GenderKey
}) {
  const { t } = useTranslation('page_character')
  const canDistribute =
    hasTarget && !!distributedSubstats && distributedSubstats <= maxTotalRolls
  return (
    <SettingsCard
      title={t('tabTheorycraft.distTitle', 'Best roll distribution')}
      info={
        <Typography>
          {t(
            'tabTheorycraft.distInfo',
            'Finds the best way to spend extra substat rolls on this build for the optimization target, within the constraints and how many rolls each substat can take, then adds them to the substats.'
          )}
        </Typography>
      }
    >
      <Box
        sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}
      >
        <CustomNumberInput
          value={distributedSubstats}
          disabled={!hasTarget || solving}
          onChange={(v) => v !== undefined && setDistributedSubstats(v)}
          endAdornment={t('tabTheorycraft.distRolls', 'extra rolls')}
          sx={{ borderRadius: 1, px: 1, textWrap: 'nowrap', flexShrink: 1 }}
          inputProps={{
            sx: { textAlign: 'right', px: 1, width: '3em', minWidth: '3em' },
            min: 0,
          }}
        />
        {!solving ? (
          <Button
            onClick={onDistribute}
            disabled={!canDistribute}
            startIcon={<CalculateIcon />}
            // the main action of the tab, once there is something to distribute
            sx={canDistribute ? giCtaSx : undefined}
          >
            {t('tabTheorycraft.distribute')}
          </Button>
        ) : (
          <Button onClick={onCancel} color="error" startIcon={<CloseIcon />}>
            {t('tabTheorycraft.cancel', 'Cancel')}
          </Button>
        )}
        <Typography variant="caption" color="text.secondary">
          {t('tabTheorycraft.distUsed', {
            defaultValue:
              'About {{used}} of the {{max}} rolls these artifacts hold are used',
            used: Math.round(usedRolls),
            max: maxTotalRolls,
          })}
        </Typography>
      </Box>
      {minOtherRolls > 0 && (
        <Alert severity="warning">
          <Trans
            t={t}
            i18nKey="tabTheorycraft.feasibilityAlert"
            values={{ minSubLines, minOtherRolls }}
          >
            The current substat distribution requires at least{' '}
            <strong>{{ minSubLines } as never}</strong> lines of substats. Need
            to assign <strong>{{ minOtherRolls } as never}</strong> rolls to
            other substats for this solution to be feasible.
          </Trans>
        </Alert>
      )}
      <ScalesWith minOtherRolls={minOtherRolls} />
      <BuildAlert status={status} characterKey={characterKey} gender={gender} />
    </SettingsCard>
  )
}
