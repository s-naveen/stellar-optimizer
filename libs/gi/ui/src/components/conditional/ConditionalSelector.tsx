import { DropdownButton, SqBadge } from '@genshin-optimizer/common/ui'
import {
  deepClone,
  deletePropPath,
  evalIfFunc,
  layeredAssignment,
} from '@genshin-optimizer/common/util'
import type { ArtCharDatabase } from '@genshin-optimizer/gi/db'
import { TeamCharacterContext, useDatabase } from '@genshin-optimizer/gi/db-ui'
import { Translate } from '@genshin-optimizer/gi/i18n'
import type {
  DocumentConditional,
  IDocumentConditionalExclusive,
  IDocumentConditionalMultiple,
} from '@genshin-optimizer/gi/sheets'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import type { ButtonProps, Palette, Theme } from '@mui/material'
import {
  alpha,
  Box,
  Button,
  Divider,
  MenuItem,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useCallback, useContext } from 'react'
import { DataContext } from '../../context'

interface ConditionalSelectorProps {
  conditional: DocumentConditional
  disabled?: boolean
}
/**
 * Conditionals are form fields: a checkbox is a bordered toggle row, a multi-state conditional is a
 * labelled select field. Both are green-tinted while on, so the state is readable at a glance.
 */
function toggleRowSx(active: boolean) {
  return (theme: Theme) => {
    const { success, text, divider } = theme.palette
    return {
      borderRadius: 2,
      justifyContent: 'flex-start',
      textAlign: 'left',
      minHeight: 40,
      px: 1.25,
      py: 0.75,
      gap: 0.25,
      boxShadow: 'none',
      fontWeight: 600,
      border: `1px solid ${active ? alpha(success.main, 0.45) : divider}`,
      backgroundColor: active ? alpha(success.main, 0.1) : 'transparent',
      color: active ? text.primary : text.secondary,
      '& .MuiButton-startIcon': {
        mr: 1,
        ml: 0,
        color: active ? success.main : text.secondary,
      },
      '&:hover': {
        boxShadow: 'none',
        backgroundColor: active
          ? alpha(success.main, 0.16)
          : alpha(text.primary, 0.05),
        color: text.primary,
      },
    }
  }
}

function selectFieldSx(active: boolean) {
  return (theme: Theme) => {
    const { success, text } = theme.palette
    return {
      minWidth: 0,
      maxWidth: '100%',
      borderRadius: 2,
      justifyContent: 'flex-start',
      textAlign: 'left',
      minHeight: 40,
      px: 1.5,
      py: 0.75,
      boxShadow: 'none',
      fontWeight: 600,
      border: `1px solid ${active ? alpha(success.main, 0.5) : alpha(text.primary, 0.2)}`,
      backgroundColor: active
        ? alpha(success.main, 0.1)
        : alpha(text.primary, 0.04),
      color: active ? success.light : text.primary,
      '& .MuiButton-endIcon': { ml: 'auto', color: text.secondary },
      '&:hover': {
        boxShadow: 'none',
        borderColor: active ? success.main : alpha(text.primary, 0.4),
        backgroundColor: active
          ? alpha(success.main, 0.14)
          : alpha(text.primary, 0.07),
      },
    }
  }
}

export function ConditionalSelector({
  conditional,
  disabled = false,
}: ConditionalSelectorProps) {
  const { data } = useContext(DataContext)
  if (
    Object.keys(evalIfFunc(conditional.states, data)).length === 1 &&
    'path' in conditional
  ) {
    return (
      <SimpleConditionalSelector
        conditional={conditional}
        disabled={disabled}
      />
    )
  } else if ('path' in conditional) {
    return (
      <ExclusiveConditionalSelector
        conditional={conditional}
        disabled={disabled}
      />
    )
  } /*if ("path" in Object.entries(conditional.states)[0]) */ else {
    return (
      <MultipleConditionalSelector
        conditional={conditional}
        disabled={disabled}
      />
    )
  }
}

interface SimpleConditionalSelectorProps extends ConditionalSelectorProps {
  conditional: IDocumentConditionalExclusive
}
function SimpleConditionalSelector({
  conditional,
  disabled,
}: SimpleConditionalSelectorProps) {
  const { teamId, teamCharId } = useContext(TeamCharacterContext)
  const { data } = useContext(DataContext)
  const database = useDatabase()

  const setConditional = useSetConditionalCallback(database, teamId, teamCharId)

  const conditionalValue = data.get(conditional.value).value
  const [stateKey, st] = Object.entries(evalIfFunc(conditional.states, data))[0]
  const validValue = conditionalValue === stateKey
  const badge = getStateBadge(st.name)
  const condName = getCondName(conditional.name)

  return (
    <Button
      fullWidth
      size="small"
      sx={toggleRowSx(validValue)}
      color={validValue ? 'success' : 'primary'}
      onClick={() =>
        setConditional(conditional.path, validValue ? undefined : stateKey)
      }
      disabled={disabled}
      startIcon={validValue ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />}
    >
      {condName} {badge}
    </Button>
  )
}

interface ExclusiveConditionalSelectorProps extends ConditionalSelectorProps {
  conditional: IDocumentConditionalExclusive
}
function ExclusiveConditionalSelector({
  conditional,
  disabled,
}: ExclusiveConditionalSelectorProps) {
  const { teamId, teamCharId } = useContext(TeamCharacterContext)
  const { data } = useContext(DataContext)
  const database = useDatabase()
  const setConditional = useSetConditionalCallback(database, teamId, teamCharId)

  const conditionalValue = data.get(conditional.value).value
  const condStates = evalIfFunc(conditional.states, data)
  const state = conditionalValue ? condStates[conditionalValue] : undefined
  const active = !!(conditionalValue && state)
  const condName = getCondName(conditional.name)

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        variant="caption"
        component="div"
        sx={{ mb: 0.5, px: 0.25, color: 'text.secondary', fontWeight: 600 }}
      >
        {condName}
      </Typography>
      <DropdownButton
        fullWidth
        size="small"
        sx={selectFieldSx(active)}
        color={active ? 'success' : 'primary'}
        title={
          // long state names wrap inside the field: a nowrap value would widen the whole card
          <Box
            component="span"
            sx={{
              display: 'block',
              minWidth: 0,
              flex: 1,
              whiteSpace: 'normal',
            }}
          >
            {state ? stateLabel(state.name) : 'Not Active'}
          </Box>
        }
        disabled={disabled}
      >
        {/* the current value is marked as selected, not disabled (a greyed-out item reads as broken) */}
        <MenuItem
          onClick={() => setConditional(conditional.path)}
          selected={!state}
        >
          <span>Not Active</span>
        </MenuItem>
        <Divider />
        {Object.entries(condStates).map(([stateKey, st]) => (
          <MenuItem
            key={stateKey}
            onClick={() => setConditional(conditional.path, stateKey)}
            selected={conditionalValue === stateKey}
          >
            {st.name}
          </MenuItem>
        ))}
      </DropdownButton>
    </Box>
  )
}

interface MultipleConditionalSelectorProps extends ConditionalSelectorProps {
  conditional: IDocumentConditionalMultiple
}
function MultipleConditionalSelector({
  conditional,
  disabled,
}: MultipleConditionalSelectorProps) {
  const { teamId, teamCharId } = useContext(TeamCharacterContext)
  const { data } = useContext(DataContext)
  const database = useDatabase()
  const setConditional = useSetConditionalCallback(database, teamId, teamCharId)

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      {Object.entries(evalIfFunc(conditional.states, data)).map(
        ([stateKey, st]) => {
          const conditionalValue = data.get(st.value).value
          const isSelected = conditionalValue === stateKey
          return (
            <Button
              color={isSelected ? 'success' : 'primary'}
              disabled={disabled}
              fullWidth
              key={stateKey}
              onClick={() =>
                setConditional(st.path, conditionalValue ? undefined : stateKey)
              }
              size="small"
              startIcon={
                isSelected ? <CheckBoxIcon /> : <CheckBoxOutlineBlankIcon />
              }
              sx={toggleRowSx(isSelected)}
            >
              {getCondName(st.name)}
            </Button>
          )
        }
      )}
    </Box>
  )
}

/** A state's name as plain text, keeping its colour when it is an element/reaction name. */
function stateLabel(stateName: ReactNode): ReactNode {
  if (isElement(stateName) && stateName.props.color)
    return (
      <Box component="span" sx={{ color: `${stateName.props.color}.main` }}>
        {stateName.props.children}
      </Box>
    )
  return stateName
}

function isElement(disp: ReactNode): disp is JSX.Element {
  return typeof disp !== 'string'
}

// Use colored badges instead of colored text inside these buttons
function getStateBadge(stateName: ReactNode | undefined): ReactNode {
  if (!stateName) return ''

  let badgeColor: ButtonProps['color'] = 'primary'
  let badgeText = stateName
  if (stateName && isElement(stateName)) {
    if (stateName.props.color) {
      badgeColor = stateName.props.color
      badgeText = <span>{stateName.props.children}</span>
    }
  }
  return (
    <SqBadge
      sx={{ ml: 0.5, whiteSpace: 'unset' }}
      color={badgeColor as keyof Palette}
    >
      {badgeText}
    </SqBadge>
  )
}

// Use colored badges instead of colored text inside these buttons
function getCondName(condName: ReactNode): ReactNode {
  if (isElement(condName)) {
    const key = condName.props.key18
    const ns = condName.props.ns
    const values = condName.props.values
    return <Translate ns={ns} key18={key} values={values} useBadge />
  }
  return condName
}

const teamConditionals = ['resonance', 'reaction']
function useSetConditionalCallback(
  database: ArtCharDatabase,
  teamId: string,
  teamCharId: string
) {
  return useCallback(
    (path: readonly string[], v?: string) => {
      if (teamConditionals.includes(path[0]))
        database.teams.set(teamId, (team) => {
          const conditionalValues = deepClone(team.conditional)
          if (v) {
            layeredAssignment(conditionalValues, path, v)
          } else {
            deletePropPath(conditionalValues, path)
          }
          team.conditional = conditionalValues
        })
      else
        database.teamChars.set(teamCharId, (teamChar) => {
          const conditionalValues = deepClone(teamChar.conditional)
          if (v) {
            layeredAssignment(conditionalValues, path, v)
          } else {
            deletePropPath(conditionalValues, path)
          }
          teamChar.conditional = conditionalValues
        })
    },
    [database, teamId, teamCharId]
  )
}
