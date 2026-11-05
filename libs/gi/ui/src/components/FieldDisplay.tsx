import {
  BootstrapTooltip,
  type CardBackgroundColor,
  ColorText,
} from '@genshin-optimizer/common/ui'
import { evalIfFunc, valueString } from '@genshin-optimizer/common/util'
import type { AmpReactionKey } from '@genshin-optimizer/gi/consts'
import {
  allAmpReactionKeys,
  allStellarReactionKeys,
} from '@genshin-optimizer/gi/consts'
import type {
  IBasicFieldDisplay,
  IFieldDisplay,
} from '@genshin-optimizer/gi/sheets'
import type { CalcResult } from '@genshin-optimizer/gi/uidata'
import ArrowDropDownIcon from '@mui/icons-material/ArrowDropDown'
import ArrowDropUpIcon from '@mui/icons-material/ArrowDropUp'
import GroupsIcon from '@mui/icons-material/Groups'
import HelpIcon from '@mui/icons-material/Help'
import TrackChangesIcon from '@mui/icons-material/TrackChanges'
import type { ListProps, PaletteColor } from '@mui/material'
import {
  alpha,
  Box,
  Divider,
  List,
  ListItem,
  Skeleton,
  styled,
  Typography,
} from '@mui/material'
import type React from 'react'
import type { ReactNode } from 'react'
import { Suspense, useCallback, useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { DataContext, FormulaDataContext } from '../context'
import { GetCalcDisplay, resolveInfo } from '../util'
import { AmpReactionModeText } from './AmpReactionModeText'

export function FieldsDisplay({
  fields,
  bgt = 'normal',
}: {
  fields: IFieldDisplay[]
  bgt?: CardBackgroundColor
}) {
  return (
    // every field can be hidden (canShow / empty node): then show no empty well
    <FieldDisplayList sx={{ m: 0, '&:empty': { display: 'none' } }} bgt={bgt}>
      {fields.map((field, i) => (
        <FieldDisplay key={i} field={field} />
      ))}
    </FieldDisplayList>
  )
}

function FieldDisplay({
  field,
  component = ListItem,
}: {
  field: IFieldDisplay
  component?: React.ElementType
}) {
  const { data, compareData } = useContext(DataContext)
  const canShow = useMemo(() => field?.canShow?.(data) ?? true, [field, data])
  if (!canShow) return null
  if ('node' in field) {
    const node = data.get(field.node)
    if (node.isEmpty) return null
    if (compareData) {
      const compareNode = compareData.get(field.node)
      return (
        <NodeFieldDisplay
          calcRes={node}
          compareCalcRes={compareNode}
          component={component}
        />
      )
    } else return <NodeFieldDisplay calcRes={node} component={component} />
  }
  return <BasicFieldDisplay field={field} component={component} />
}

export function BasicFieldDisplay({
  field,
  component,
}: {
  field: IBasicFieldDisplay
  component?: React.ElementType
}) {
  const { data } = useContext(DataContext)
  const v = evalIfFunc(field.value, data)
  const variant = evalIfFunc(field.variant, data)
  const text = field.text && <span>{field.text}</span>
  const suffix = field.textSuffix && <span> {field.textSuffix}</span>
  return (
    <Box
      width="100%"
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 1,
        py: 0.25,
      }}
      component={component}
    >
      <Typography color={`${variant}.main`}>
        {text}
        {suffix}
      </Typography>
      <Typography>
        {typeof v === 'number' ? v.toFixed?.(field.fixed) : v}
        {field.unit}
      </Typography>
    </Box>
  )
}

export function NodeFieldDisplay({
  calcRes,
  compareCalcRes,
  component = ListItem,
  emphasize,
  showZero = false,
}: {
  calcRes?: CalcResult
  compareCalcRes?: CalcResult
  component?: React.ElementType
  emphasize?: boolean

  // Show field, even if the value is zero
  showZero?: boolean
}) {
  const { t } = useTranslation('ui')
  const { data } = useContext(DataContext)
  const { setFormulaData } = useContext(FormulaDataContext)
  const onClick = useCallback(
    () => setFormulaData(data, calcRes),
    [setFormulaData, data, calcRes]
  )
  if (!calcRes && !compareCalcRes) return null
  const { multi, strikethrough } = calcRes?.info ?? compareCalcRes?.info ?? {}

  const multiDisplay = multi && <span>{multi}&#215;</span>
  const calcValue = calcRes?.value ?? 0
  const compareCalcValue = compareCalcRes?.value ?? 0

  if (!showZero && !calcValue && !compareCalcValue) return null

  let fieldVal = false as ReactNode
  const { unit, fixed, variant, subVariant } = resolveInfo(
    (calcRes?.info ?? compareCalcRes?.info)!
  )
  const node = (calcRes ?? compareCalcRes)!
  // Same condition as `!!GetCalcDisplay(node).formula` (numeric formulas are
  // always non-empty), without building the formula display, which is costly
  // and only needed when the tooltip opens
  const hasFormula = typeof node.value === 'number' || !!node.value

  const diff = calcValue - compareCalcValue
  const pctDiff =
    compareCalcRes &&
    unit !== '%' &&
    (calcValue > 100 || compareCalcValue > 100)
      ? valueString(Math.abs(diff / compareCalcValue), '%', fixed)
      : null

  fieldVal = (
    <>
      <span>{valueString(calcValue, unit, fixed)}</span>
      {Math.abs(diff) > 0.0001 && compareCalcRes && (
        <BootstrapTooltip
          title={
            <Typography>
              Compare to{' '}
              <strong>{valueString(compareCalcValue, unit, fixed)}</strong>
            </Typography>
          }
        >
          {/* the change against the compared build: one compact, coloured figure */}
          <Box
            component="span"
            sx={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.5,
              whiteSpace: 'nowrap',
              fontSize: '0.8125rem',
              fontWeight: 600,
              fontVariantNumeric: 'tabular-nums',
              color: diff > 0 ? 'success.main' : 'error.main',
            }}
          >
            {diff > 0 ? (
              <ArrowDropUpIcon sx={{ fontSize: 18, mx: -0.5 }} />
            ) : (
              <ArrowDropDownIcon sx={{ fontSize: 18, mx: -0.5 }} />
            )}
            {valueString(Math.abs(diff), unit, fixed)}
            {!!pctDiff && (
              <Box component="span" sx={{ fontWeight: 500, opacity: 0.8 }}>
                · {pctDiff}
              </Box>
            )}
          </Box>
        </BootstrapTooltip>
      )}
    </>
  )

  return (
    <Box
      width="100%"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 1,
        py: 0.25,
        textDecoration: strikethrough ? 'line-through' : undefined,
        // the optimization target: a gold accent bar and tint (an image layer, so the list's
        // zebra background colour cannot cover it), not an error-red outline
        ...(emphasize && {
          backgroundImage: (theme) =>
            `linear-gradient(${alpha(theme.palette.primary.main, 0.14)}, ${alpha(theme.palette.primary.main, 0.14)})`,
          boxShadow: (theme) => `inset 3px 0 0 ${theme.palette.primary.main}`,
        }),
      }}
      component={component}
    >
      {emphasize && (
        <BootstrapTooltip title={t('optimizationTarget')} placement="top">
          <TrackChangesIcon
            aria-label={t('optimizationTarget')}
            sx={{
              fontSize: 16,
              color: 'primary.main',
              flexShrink: 0,
              mr: -0.5,
            }}
          />
        </BootstrapTooltip>
      )}
      <NodeFieldDisplayText node={(calcRes ?? compareCalcRes)!} />
      <Typography
        sx={{
          ml: 'auto',
          display: 'flex',
          columnGap: 1,
          rowGap: 0,
          alignItems: 'center',
          justifyContent: 'flex-end',
          flexWrap: 'wrap',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {multiDisplay}
        {fieldVal}
      </Typography>
      {hasFormula && (
        <BootstrapTooltip
          placement="top"
          title={
            <Typography>
              <Suspense
                fallback={
                  <Skeleton variant="rectangular" width={300} height={30} />
                }
              >
                {allAmpReactionKeys.includes(variant as any) && (
                  <Box sx={{ display: 'inline-flex', gap: 1, mr: 1 }}>
                    <Box>
                      <AmpReactionModeText
                        reaction={variant as AmpReactionKey}
                        trigger={
                          subVariant as 'cryo' | 'pyro' | 'hydro' | undefined
                        }
                      />
                    </Box>
                    <Divider orientation="vertical" flexItem />
                  </Box>
                )}
                <LazyFormula node={node} />
              </Suspense>
            </Typography>
          }
        >
          <HelpIcon
            onClick={onClick}
            fontSize="inherit"
            sx={{ cursor: 'help' }}
          />
        </BootstrapTooltip>
      )}
    </Box>
  )
}

/** The formula of `node`, computed on demand (tooltips only render their title when open) */
function LazyFormula({ node }: { node: CalcResult }) {
  return <span>{GetCalcDisplay(node).formula}</span>
}

export function NodeFieldDisplayText({ node }: { node: CalcResult }) {
  const { textSuffix, icon, isTeamBuff, variant, subVariant, name } =
    resolveInfo(node.info)
  const suffixDisplay = textSuffix && <span> {textSuffix}</span>
  const color =
    variant !== 'invalid'
      ? allStellarReactionKeys.includes(variant as any) && subVariant === 'cryo'
        ? 'stellarcryo'
        : variant
      : undefined
  return (
    <Typography
      component="div"
      sx={{
        display: 'flex',
        gap: 1,
        alignItems: 'center',
        marginRight: 'auto',
      }}
    >
      {!!isTeamBuff && <GroupsIcon />}
      {icon}
      <ColorText color={color}>
        {name}
        {suffixDisplay}
      </ColorText>
    </Typography>
  )
}
export interface FieldDisplayListProps extends ListProps {
  bgt?: CardBackgroundColor
  palletOption?: keyof PaletteColor
}
export const FieldDisplayList = styled(List)<FieldDisplayListProps>(
  ({ theme, bgt = 'normal' }) => {
    const palette =
      bgt === 'light'
        ? 'contentLight'
        : bgt === 'dark'
          ? 'contentDark'
          : 'contentNormal'
    // a slightly recessed well (a softened darker shade of the card it sits on) with soft zebra
    // stripes; the old alternating near-black rows were heavy
    const shade = (theme.palette[palette] as PaletteColor)['dark']
    return {
      borderRadius: theme.shape.borderRadius,
      overflow: 'hidden',
      margin: 0,
      backgroundColor: alpha(shade, 0.55),
      '> .MuiListItem-root:nth-of-type(even)': {
        backgroundColor: 'transparent',
      },
      '> .MuiListItem-root:nth-of-type(odd)': {
        backgroundColor: alpha(theme.palette.text.primary, 0.035),
      },
    }
  }
)
