import type { CardBackgroundColor } from '@genshin-optimizer/common/ui'
import { CardThemed } from '@genshin-optimizer/common/ui'
import { evalIfFunc } from '@genshin-optimizer/common/util'
import { TeamCharacterContext } from '@genshin-optimizer/gi/db-ui'
import type {
  DocumentConditional,
  DocumentSection,
} from '@genshin-optimizer/gi/sheets'
import type { SxProps } from '@mui/material'
import { Box } from '@mui/material'
import { useContext } from 'react'
import { DataContext } from '../../context'
import { HeaderDisplay } from '../DocumentDisplay'
import { FieldsDisplay } from '../FieldDisplay'
import { ConditionalSelector } from './ConditionalSelector'

type ConditionalDisplayProps = {
  conditional: DocumentConditional
  hideHeader?: boolean | ((section: DocumentSection) => boolean)
  hideDesc?: boolean
  disabled?: boolean
  bgt?: CardBackgroundColor
  sx?: SxProps
  /** no card or padding of its own, for a parent card that already frames it */
  flat?: boolean
  /** a smaller header (narrow columns) */
  compact?: boolean
}

export function ConditionalDisplay({
  conditional,
  hideHeader = false,
  hideDesc = false,
  disabled = false,
  bgt = 'normal',
  sx,
  flat = false,
  compact = false,
}: ConditionalDisplayProps) {
  const { data } = useContext(DataContext)
  const { teamId } = useContext(TeamCharacterContext)
  if (!data) return null
  if (!teamId) return null
  let fields
  if ('path' in conditional) {
    const condVal = data.get(conditional.value).value
    const condStates = evalIfFunc(conditional.states, data)
    fields = condVal && condStates[condVal]?.fields
  } /* if ("path" in Object.entries(conditional.states)[0]) */ else {
    const condStates = evalIfFunc(conditional.states, data)
    fields = Object.values(condStates).flatMap((state) => {
      const stateVal = data.get(state.value).value
      return stateVal ? state.fields : []
    })
  }
  const content = (
    <>
      {!evalIfFunc(hideHeader, conditional) && (
        <HeaderDisplay
          header={conditional.header}
          hideDesc={hideDesc}
          compact={compact}
        />
      )}
      {/* the control and what it switches on, as one padded group */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: flat ? 0 : 1.25,
          minWidth: 0,
          '& > *': { minWidth: 0 },
        }}
      >
        <ConditionalSelector conditional={conditional} disabled={disabled} />
        {fields && <FieldsDisplay bgt={bgt} fields={fields} />}
      </Box>
    </>
  )
  return flat ? (
    <Box sx={sx}>{content}</Box>
  ) : (
    <CardThemed bgt={bgt} sx={sx}>
      {content}
    </CardThemed>
  )
}
