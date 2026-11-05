import type { SolidToggleButtonGroupProps } from '@genshin-optimizer/common/ui'
import {
  filterToggleValue,
  SolidToggleButtonGroup,
  ToggleButtonCount,
} from '@genshin-optimizer/common/ui'
import { handleMultiSelect } from '@genshin-optimizer/common/util'
import type { ArtifactSlotKey } from '@genshin-optimizer/gi/consts'
import { allArtifactSlotKeys } from '@genshin-optimizer/gi/consts'
import { SlotIcon } from '@genshin-optimizer/gi/svgicons'
import { Chip, ToggleButton } from '@mui/material'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

type ArtifactSlotToggleProps = Omit<
  SolidToggleButtonGroupProps,
  'onChange' | 'value'
> & {
  onChange: (value: ArtifactSlotKey[]) => void
  value: ArtifactSlotKey[]
  totals: Record<ArtifactSlotKey, ReactNode>
}

const slotHandler = handleMultiSelect([...allArtifactSlotKeys])

export function ArtifactSlotToggle({
  value,
  totals,
  onChange,
  quiet,
  ...props
}: ArtifactSlotToggleProps) {
  const { t } = useTranslation('artifact')
  return (
    <SolidToggleButtonGroup
      fullWidth
      value={quiet ? filterToggleValue(value, allArtifactSlotKeys) : value}
      size="small"
      quiet={quiet}
      {...props}
    >
      {allArtifactSlotKeys.map((slotKey) => (
        <ToggleButton
          key={slotKey}
          sx={quiet ? undefined : { display: 'flex', gap: 1, flexWrap: 'wrap' }}
          value={slotKey}
          onClick={() => onChange(slotHandler(value, slotKey))}
        >
          {quiet ? (
            <>
              <SlotIcon
                slotKey={slotKey}
                iconProps={{
                  fontSize: 'small',
                  titleAccess: t(`slotName.${slotKey}`),
                }}
              />
              <ToggleButtonCount>{totals[slotKey]}</ToggleButtonCount>
            </>
          ) : (
            <>
              <SlotIcon slotKey={slotKey} />
              <Chip label={totals[slotKey]} size="small" />
            </>
          )}
        </ToggleButton>
      ))}
    </SolidToggleButtonGroup>
  )
}
