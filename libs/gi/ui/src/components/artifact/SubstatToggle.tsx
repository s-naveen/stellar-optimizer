import { iconInlineProps } from '@genshin-optimizer/common/svgicons'
import { SolidToggleButtonGroup } from '@genshin-optimizer/common/ui'
import { handleMultiSelect } from '@genshin-optimizer/common/util'
import type { SubstatKey } from '@genshin-optimizer/gi/consts'
import { allSubstatKeys } from '@genshin-optimizer/gi/consts'
import { StatIcon } from '@genshin-optimizer/gi/svgicons'
import { Box, ToggleButton } from '@mui/material'
import type { ReactNode } from 'react'
import { ArtifactStatWithUnit } from './ArtifactStatKeyDisplay'

const rvfilterHandler = handleMultiSelect([...allSubstatKeys])
// HP/ATK/DEF (flat and %) on the first row, the rest below
const keyRows = [allSubstatKeys.slice(0, 6), allSubstatKeys.slice(6)]
export function SubstatToggle({
  selectedKeys,
  onChange,
  renderLabel,
  quiet = false,
}: {
  selectedKeys: SubstatKey[]
  onChange: (keys: SubstatKey[]) => void
  renderLabel?: (key: SubstatKey) => ReactNode
  /** compact filter style, see `SolidToggleButtonGroup` */
  quiet?: boolean
}) {
  const label = (key: SubstatKey) =>
    renderLabel ? renderLabel(key) : <ArtifactStatWithUnit statKey={key} />
  if (quiet)
    return (
      // two aligned rows (6 + 4) when there is room, otherwise rows of 3 and 2
      <Box sx={{ containerType: 'inline-size' }}>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          {keyRows.map((keys) => (
            <SolidToggleButtonGroup
              key={keys[0]}
              quiet
              size="small"
              value={selectedKeys.filter((k) => keys.includes(k))}
              sx={{
                display: 'grid',
                gridTemplateColumns: `repeat(${keys.length / 2}, minmax(0, 1fr))`,
                '@container (min-width: 520px)': {
                  gridTemplateColumns: `repeat(${keys.length}, minmax(0, 1fr))`,
                },
              }}
            >
              {keys.map((key) => (
                <ToggleButton
                  key={key}
                  value={key}
                  onClick={() => onChange(rvfilterHandler(selectedKeys, key))}
                >
                  <StatIcon statKey={key} iconProps={iconInlineProps} />
                  {/* a long name may take two lines in a narrow cell */}
                  <Box
                    component="span"
                    sx={{ whiteSpace: 'normal', textAlign: 'center' }}
                  >
                    {label(key)}
                  </Box>
                </ToggleButton>
              ))}
            </SolidToggleButtonGroup>
          ))}
        </Box>
      </Box>
    )
  return (
    <Box display="flex" gap={1} flexWrap="wrap">
      {keyRows.map((keys) => (
        <SolidToggleButtonGroup
          key={keys[0]}
          value={selectedKeys.filter((k) => keys.includes(k))}
          sx={{ flexGrow: 1 }}
        >
          {keys.map((key) => (
            <ToggleButton
              sx={{ flexGrow: 1 }}
              size="small"
              key={key}
              value={key}
              onClick={() => onChange(rvfilterHandler(selectedKeys, key))}
            >
              <Box display="flex" gap={1} alignItems="center">
                <StatIcon statKey={key} iconProps={iconInlineProps} />
                {label(key)}
              </Box>
            </ToggleButton>
          ))}
        </SolidToggleButtonGroup>
      ))}
    </Box>
  )
}
