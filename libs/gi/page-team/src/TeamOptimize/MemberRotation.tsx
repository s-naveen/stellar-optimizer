import { useBoolState } from '@genshin-optimizer/common/react-util'
import { DropdownButton } from '@genshin-optimizer/common/ui'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import {
  initTeamOptAttack,
  TEAM_OPT_MAX_ATTACKS,
} from '@genshin-optimizer/gi/db'
import { useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { giTokens } from '@genshin-optimizer/gi/theme'
import type {
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import { CharacterName, DataContext, sameBuff } from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AddIcon from '@mui/icons-material/Add'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import TuneIcon from '@mui/icons-material/Tune'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Collapse,
  IconButton,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import type { SxProps, Theme } from '@mui/material/styles'
import type { HTMLAttributes, ReactNode } from 'react'
import { Fragment, forwardRef, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TargetSelectorModal } from '../CharacterDisplay/Tabs/TabOptimize/Components/TargetSelectorModal'
import { AttackEditor, AttackFiguresContext } from './AttackEditor'
import { AttackName } from './AttackName'
import type { TeamBuff } from './buffs'
import { formatDamage, formatHits, formatRate } from './format'
import { MemberAvatar } from './MemberAvatar'
import {
  EmptyLine,
  focusSx,
  numSx,
  quickSx,
  selectedSx,
  tokens,
  type,
} from './ui'

/** One member's rotation: its attacks, what each deals, and the member's share of the team */
export function MemberRotation({
  teamId,
  member,
  teamData,
  attacks,
  setAttacks,
  evaluation,
  buffs,
  mainStatAssumptionLevel,
  members,
  onField,
  rotationTime,
  footer,
  showConditions = false,
  expanded = true,
  onToggle,
  disabled,
  figures = true,
  played = false,
}: {
  teamId: string
  member: TeamOptMember
  teamData: TeamData | undefined
  attacks: TeamOptAttack[]
  setAttacks: (update: (attacks: TeamOptAttack[]) => TeamOptAttack[]) => void
  evaluation: TeamOptEvaluation | undefined
  /** The buffs that can affect this member's attacks */
  buffs: TeamBuff[]
  mainStatAssumptionLevel: number
  /** The team (who may be on the field) */
  members: TeamOptMember[]
  /** Who is on the field by default */
  onField: CharacterKey
  /** How long one rotation takes (seconds): its damage is then shown per second */
  rotationTime?: number
  /** The member's settings, under its rotation */
  footer?: ReactNode
  /** Each attack's buff states and limits are listed under it (else a count with a tooltip) */
  showConditions?: boolean
  /** Its attacks are shown (the header opens and closes them, for every member at once) */
  expanded?: boolean
  onToggle?: () => void
  /** A run is going: its attacks can't be edited */
  disabled?: boolean
  /**
   * Damage figures with the members' own builds, in the attack editor and the rows (KQM
   * theorycrafting has none: it never counts those builds)
   */
  figures?: boolean
  /**
   * The attacks are the ones KQM theorycrafting played for its builds: shown as they are, not
   * edited here (the written rotation is)
   */
  played?: boolean
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  const { characterKey, teamChar } = member
  const data = teamData?.[characterKey]?.target
  const [showPicker, onShowPicker, onHidePicker] = useBoolState()
  const [editing, setEditing] = useState<number | undefined>()
  // several attacks picked to remove at once
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<number>>(new Set())
  // what a removal can be undone to, for a few seconds and while nothing else changed
  const [undo, setUndo] = useState<{
    before: TeamOptAttack[]
    after: string
    count: number
  }>()
  // what the last import of a multi-target did
  const [imported, setImported] = useState<{ added: number; updated: number }>()
  useEffect(() => {
    if (!undo) return undefined
    const timer = setTimeout(() => setUndo(undefined), 8000)
    return () => clearTimeout(timer)
  }, [undo])
  useEffect(() => {
    if (!imported) return undefined
    const timer = setTimeout(() => setImported(undefined), 5000)
    return () => clearTimeout(timer)
  }, [imported])
  const undoable = !!undo && undo.after === JSON.stringify(attacks)
  const remove = (indices: ReadonlySet<number>) => {
    if (!indices.size) return
    const after = attacks.filter((_, i) => !indices.has(i))
    setUndo({
      before: attacks,
      after: JSON.stringify(after),
      count: indices.size,
    })
    setAttacks(() => after)
  }
  const stopSelecting = () => {
    setSelecting(false)
    setSelected(new Set())
  }

  const damage = evaluation?.members[characterKey]
  const share =
    evaluation && evaluation.total > 0 && damage !== undefined
      ? damage / evaluation.total
      : undefined
  const full = attacks.length >= TEAM_OPT_MAX_ATTACKS

  const addAttack = (path: string[], multi?: number) => {
    onHidePicker()
    const attack = initTeamOptAttack(path, multi && multi > 0 ? multi : 1)
    // start from the member's own settings: its reaction and infusion
    if (teamChar.reaction) attack.reaction = teamChar.reaction
    if (teamChar.infusionAura) attack.infusionAura = teamChar.infusionAura
    setAttacks((list) => [...list, attack])
    setEditing(attacks.length)
  }
  /**
   * Adds a multi-target's attacks. One already in the rotation (the same attack, reaction,
   * infusion and hit mode) is updated instead: its hits and bonus stats from the multi-target,
   * its buff settings kept. Importing again does not add them twice.
   */
  const importTargets = (index: number) => {
    const targets = teamChar.customMultiTargets[index]?.targets ?? []
    const next = [...attacks]
    const matched = new Set<number>()
    let added = 0
    let updated = 0
    for (const {
      path,
      weight,
      hitMode,
      reaction,
      infusionAura,
      bonusStats,
    } of targets) {
      const attack: TeamOptAttack = { path, hits: weight, hitMode }
      if (reaction) attack.reaction = reaction
      if (infusionAura) attack.infusionAura = infusionAura
      if (Object.keys(bonusStats).length) attack.bonusStats = bonusStats
      // (each attack of the rotation stands for one target: a multi-target may list one twice)
      const at = next.findIndex(
        (a, i) => !matched.has(i) && sameAttack(a, attack)
      )
      if (at >= 0) {
        matched.add(at)
        const { bonusStats: _b, ...rest } = next[at]
        next[at] = {
          ...rest,
          hits: attack.hits,
          ...(attack.bonusStats ? { bonusStats: attack.bonusStats } : {}),
        }
        updated++
      } else if (next.length < TEAM_OPT_MAX_ATTACKS) {
        matched.add(next.length)
        next.push(attack)
        added++
      }
    }
    setAttacks(() => next)
    setImported({ added, updated })
  }
  const dataContextValue = useMemo(
    () => data && teamData && { data, teamData },
    [data, teamData]
  )
  const editingAttack = editing === undefined ? undefined : attacks[editing]

  return (
    // a column of the team's panel (the panel draws the lines between members)
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        bgcolor: tokens.inset,
      }}
    >
      {/* the member, its attacks and its share of the rotation: also the button that shows or
          hides every member's attacks (a chevron says which) */}
      <ButtonBase
        component="div"
        role="button"
        tabIndex={onToggle ? 0 : -1}
        aria-expanded={onToggle ? expanded : undefined}
        disabled={!onToggle}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (onToggle && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onToggle()
          }
        }}
        sx={(theme) => ({
          display: 'block',
          textAlign: 'left',
          width: '100%',
          position: 'relative',
          cursor: onToggle ? 'pointer' : 'default',
          ...quickSx,
          ...focusSx,
          '&.Mui-focusVisible': { outlineOffset: -2 },
          '&:hover': onToggle
            ? { bgcolor: alpha(theme.palette.text.primary, 0.035) }
            : {},
          '&:hover .member-chevron': { color: 'text.primary' },
          '&.Mui-disabled': { pointerEvents: 'none' },
        })}
      >
        <Box sx={{ px: 1.5, pt: 1.25, pb: 1, pr: onToggle ? 4.5 : 1.5 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              minHeight: 28,
            }}
          >
            <MemberAvatar characterKey={characterKey} size={28} />
            <Box sx={{ minWidth: 0, flexGrow: 1, lineHeight: 1.2 }}>
              <Typography noWrap sx={{ ...type.body, fontWeight: 650 }}>
                <CharacterName characterKey={characterKey} gender={gender} />
              </Typography>
              <Typography noWrap sx={{ ...type.label, fontSize: 12, ...numSx }}>
                {t('teamOpt.rotation.attackCount', {
                  defaultValue: '{{count}} attacks',
                  count: attacks.length,
                })}
              </Typography>
            </Box>
            {!!damage && (
              <Tooltip
                placement="top"
                title={t(
                  'teamOpt.rotation.memberShareTip',
                  'DPS, and its share of the team’s damage'
                )}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 0.75,
                    flexShrink: 0,
                    ...numSx,
                  }}
                >
                  <Typography
                    component="span"
                    sx={{ fontSize: 13.5, fontWeight: 650 }}
                  >
                    {formatRate(damage, rotationTime)}
                  </Typography>
                  {share !== undefined && (
                    <Typography
                      component="span"
                      sx={{
                        ...type.label,
                        minWidth: '3ch',
                        textAlign: 'right',
                      }}
                    >
                      {Math.round(share * 100)}%
                    </Typography>
                  )}
                </Box>
              </Tooltip>
            )}
          </Box>
          {/* (its place is kept while there is no damage yet: nothing moves when it comes) */}
          <ShareBar
            share={damage ? share : undefined}
            characterKey={characterKey}
          />
        </Box>
        {onToggle && (
          <ExpandMoreIcon
            className="member-chevron"
            aria-hidden
            sx={{
              position: 'absolute',
              top: 14,
              right: 10,
              fontSize: 20,
              color: 'text.secondary',
              transition: `transform .18s ${tokens.ease}, color .12s`,
              transform: expanded ? 'rotate(180deg)' : 'none',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          />
        )}
      </ButtonBase>

      <Collapse in={expanded} timeout={180}>
        <Box
          component="fieldset"
          disabled={disabled || played}
          sx={{
            border: 0,
            p: 0,
            m: 0,
            minWidth: 0,
            pointerEvents: disabled || played ? 'none' : undefined,
            opacity: disabled ? 0.6 : 1,
            transition: 'opacity .18s',
          }}
        >
          {/* its attacks, one line each */}
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
              px: 0.75,
              pb: 1,
              flexGrow: 1,
            }}
          >
            {attacks.map((attack, i) => (
              <AttackRow
                // biome-ignore lint/suspicious/noArrayIndexKey: attacks are a list without ids
                key={i}
                data={data}
                attack={attack}
                buffs={buffs}
                onField={onField}
                showConditions={showConditions}
                damage={evaluation?.attacks[characterKey]?.[i]}
                figures={figures || !!evaluation}
                selecting={selecting}
                selected={selected.has(i)}
                onClick={() => {
                  if (!selecting) return setEditing(i)
                  // (from the latest selection: clicks may come faster than renders)
                  setSelected((prev) => {
                    const next = new Set(prev)
                    if (next.has(i)) next.delete(i)
                    else next.add(i)
                    return next
                  })
                }}
                onRemove={() => remove(new Set([i]))}
              />
            ))}
            {!attacks.length && (
              <EmptyLine
                sx={{ mx: 0.75 }}
                info={t(
                  'teamOpt.rotation.empty',
                  'No attacks yet. A support without attacks still counts through the buffs it gives.'
                )}
              >
                {t('teamOpt.rotation.noAttacks', 'No attacks')}
              </EmptyLine>
            )}
            {played ? null : selecting ? (
              <Box sx={{ ...actionsRowSx }}>
                <Button
                  variant="text"
                  size="small"
                  color="error"
                  startIcon={<DeleteOutlineIcon />}
                  disabled={!selected.size}
                  onClick={() => {
                    remove(selected)
                    stopSelecting()
                  }}
                  sx={[actionSx, { color: 'error.main' }]}
                >
                  {t('teamOpt.rotation.removeSelected', {
                    defaultValue: 'Remove ({{count}})',
                    count: selected.size,
                  })}
                </Button>
                <Button
                  variant="text"
                  size="small"
                  color="inherit"
                  sx={actionSx}
                  onClick={() =>
                    setSelected(
                      selected.size === attacks.length
                        ? new Set()
                        : new Set(attacks.map((_, i) => i))
                    )
                  }
                >
                  {selected.size === attacks.length
                    ? t('teamOpt.rotation.selectNone', 'None')
                    : t('teamOpt.rotation.selectAll', 'All')}
                </Button>
                <Box sx={{ flexGrow: 1 }} />
                <Button
                  variant="text"
                  size="small"
                  color="inherit"
                  onClick={stopSelecting}
                  sx={[actionSx, { color: 'text.primary' }]}
                >
                  {t('teamOpt.rotation.selectDone', 'Done')}
                </Button>
              </Box>
            ) : (
              <Box sx={actionsRowSx}>
                <Button
                  variant="text"
                  size="small"
                  color="inherit"
                  startIcon={<AddIcon />}
                  onClick={onShowPicker}
                  disabled={!data || full}
                  sx={actionSx}
                >
                  {t('teamOpt.rotation.add', 'Add attack')}
                </Button>
                {!!teamChar.customMultiTargets.length && (
                  <DropdownButton
                    // (one per member: ids stay unique on the page)
                    id={`teamopt-import-${characterKey}`}
                    variant="text"
                    size="small"
                    color="inherit"
                    disabled={full}
                    title={t('teamOpt.rotation.import', 'From multi-target')}
                    sx={actionSx}
                  >
                    {teamChar.customMultiTargets.map(({ name, targets }, i) => (
                      <MenuItem
                        // biome-ignore lint/suspicious/noArrayIndexKey: multi-targets have no ids
                        key={i}
                        disabled={!targets.length}
                        onClick={() => importTargets(i)}
                        sx={{ gap: 2, justifyContent: 'space-between' }}
                      >
                        {name}
                        <Typography
                          component="span"
                          sx={{ ...type.label, ...numSx }}
                        >
                          {t('teamOpt.rotation.importCount', {
                            count: targets.length,
                            defaultValue: '{{count}} attacks',
                          })}
                        </Typography>
                      </MenuItem>
                    ))}
                  </DropdownButton>
                )}
                <Box sx={{ flexGrow: 1 }} />
                {attacks.length > 1 && (
                  <Button
                    variant="text"
                    size="small"
                    color="inherit"
                    onClick={() => setSelecting(true)}
                    sx={actionSx}
                  >
                    {t('teamOpt.rotation.select', 'Select')}
                  </Button>
                )}
              </Box>
            )}
            {(undoable || imported) && (
              <Box
                role="status"
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 0.5,
                  minHeight: 30,
                  px: 1,
                  ...type.label,
                  ...numSx,
                }}
              >
                {undoable ? (
                  <>
                    {t('teamOpt.rotation.removed', {
                      defaultValue: 'Removed {{count}} attacks',
                      count: undo.count,
                    })}
                    <Button
                      variant="text"
                      size="small"
                      color="inherit"
                      onClick={() => {
                        setAttacks(() => undo.before)
                        setUndo(undefined)
                      }}
                      sx={[actionSx, { color: 'text.primary', minWidth: 0 }]}
                    >
                      {t('teamOpt.rotation.undo', 'Undo')}
                    </Button>
                  </>
                ) : (
                  imported &&
                  t('teamOpt.rotation.imported', {
                    defaultValue: '{{added}} added · {{updated}} updated',
                    added: imported.added,
                    updated: imported.updated,
                  })
                )}
              </Box>
            )}
          </Box>
          {/* the member's settings, at the bottom: in line with the other members' */}
          <Box sx={{ mt: 'auto' }}>{footer}</Box>
        </Box>
      </Collapse>

      {dataContextValue && (
        <DataContext.Provider value={dataContextValue}>
          <TargetSelectorModal
            show={showPicker}
            onClose={onHidePicker}
            setTarget={addAttack}
            flatOnly
            excludeHeal
            excludeSections={[
              'basic',
              'bonusStats',
              'custom',
              'character',
              'teamBuff',
            ]}
          />
        </DataContext.Provider>
      )}
      {editingAttack && editing !== undefined && (
        <AttackFiguresContext.Provider value={figures}>
          <AttackEditor
            open
            onClose={() => setEditing(undefined)}
            teamId={teamId}
            characterKey={characterKey}
            data={data}
            attack={editingAttack}
            buffs={buffs}
            mainStatAssumptionLevel={mainStatAssumptionLevel}
            members={members}
            onField={onField}
            onChange={(attack) =>
              setAttacks((list) =>
                list.map((a, i) => (i === editing ? attack : a))
              )
            }
            onDuplicate={() => {
              setAttacks((list) =>
                [
                  ...list.slice(0, editing + 1),
                  structuredClone(list[editing]),
                  ...list.slice(editing + 1),
                ].slice(0, TEAM_OPT_MAX_ATTACKS)
              )
              setEditing(editing + 1)
            }}
            onRemove={() => {
              remove(new Set([editing]))
              setEditing(undefined)
            }}
          />
        </AttackFiguresContext.Provider>
      )}
    </Box>
  )
}

/** The column's quiet text actions (Add attack, From multi-target, Select...) */
const actionSx = {
  minHeight: 30,
  px: 1,
  borderRadius: tokens.radius.control,
  fontSize: 13,
  fontWeight: 600,
  whiteSpace: 'nowrap',
  color: 'text.secondary',
  ...quickSx,
  '&:hover': {
    color: 'text.primary',
    bgcolor: alpha(giTokens.parchment, 0.05),
  },
  '& .MuiButton-startIcon': { mr: 0.5, ml: -0.25 },
  '& .MuiButton-endIcon': { ml: 0.25 },
  '& .MuiButton-startIcon svg, & .MuiButton-endIcon svg': { fontSize: 18 },
} as const
/** (labels stay on one line; the row wraps instead) */
const actionsRowSx = {
  display: 'flex',
  alignItems: 'center',
  flexWrap: 'wrap',
  gap: 0.25,
  mt: 0.5,
} as const

/**
 * A member's colour: its element's, from the theme (the same hue as its lane in the rotation's
 * timeline)
 */
export function memberHue(theme: Theme, characterKey: CharacterKey) {
  const palette = (
    theme.palette as unknown as Record<string, { main: string } | undefined>
  )[getCharEle(characterKey)]
  return palette?.main ?? theme.palette.text.secondary
}

/** A member's share of the rotation's damage, in its element's colour */
export function ShareBar({
  share,
  characterKey,
  sx,
}: {
  /** None yet: the bar's place is kept, empty */
  share: number | undefined
  characterKey: CharacterKey
  sx?: SxProps<Theme>
}) {
  return (
    <Box
      aria-hidden
      sx={[
        {
          mt: 1,
          height: 3,
          borderRadius: 2,
          bgcolor: share === undefined ? 'transparent' : tokens.hairline,
          overflow: 'hidden',
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      <Box
        sx={(theme) => ({
          height: '100%',
          width: `${Math.round((share ?? 0) * 100)}%`,
          borderRadius: 2,
          bgcolor: memberHue(theme, characterKey),
          opacity: 0.85,
          transition: `width .3s ${tokens.ease}`,
          '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
        })}
      />
    </Box>
  )
}

/** The same attack of a multi-target (what an import updates rather than adds again) */
function sameAttack(a: TeamOptAttack, b: TeamOptAttack) {
  return (
    a.path.join('.') === b.path.join('.') &&
    (a.reaction ?? '') === (b.reaction ?? '') &&
    (a.infusionAura ?? '') === (b.infusionAura ?? '') &&
    a.hitMode === b.hitMode
  )
}

/**
 * An attack of the rotation, on one line: what it is (with its reaction, crit mode, own on-field
 * member and buff conditions as small marks), its damage over the rotation and how often it hits
 */
function AttackRow({
  data,
  attack,
  buffs,
  onField,
  damage,
  selecting,
  selected,
  onClick,
  onRemove,
  showConditions,
  figures,
}: {
  data: UIData | undefined
  attack: TeamOptAttack
  showConditions: boolean
  /** Its damage column (none without figures) */
  figures: boolean
  buffs: TeamBuff[]
  /** Who is on the field by default */
  onField: CharacterKey
  damage: number | undefined
  /** Picking attacks to remove: a click toggles this one */
  selecting: boolean
  selected: boolean
  onClick: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation('page_team')
  const { t: tSheet } = useTranslation('sheet_gen')
  const { gender } = useDBMeta()
  const limits = attack.limits ?? []
  const states = attack.states ?? []
  // who is on the field during this attack: its own choice, else the rotation's (always shown,
  // the rotation's default member too, so every row says it)
  const ownOnField = attack.onField ?? onField
  // (the buff states and limits, as text for the compact view's tooltip)
  const conditionLines: { key: string; node: ReactNode }[] = [
    ...states.map((state) => {
      const buff = buffs.find((b) => sameBuff(b.ref, state))
      const stateName =
        buff?.states?.find((x) => x.value === state.value)?.name ?? state.value
      return {
        key: `s${state.owner}${state.path.join('.')}`,
        node: (
          <>
            {buff?.label ?? state.path.at(-1)}: {stateName}
          </>
        ),
      }
    }),
    ...limits.map((limit) => {
      const buff = buffs.find((b) => sameBuff(b.ref, limit))
      return {
        key: `l${limit.owner}${limit.path.join('.')}`,
        node: (
          <>
            {buff?.name ?? limit.path.at(-1)}
            {limit.hits
              ? ` ${formatHits(limit.hits)}/${formatHits(attack.hits)}`
              : ` (${t('teamOpt.rotation.conditionOff', 'off')})`}
          </>
        ),
      }
    }),
  ]
  const conditionCount = conditionLines.length
  const listConditions = showConditions && (!!limits.length || !!states.length)
  const SelectIcon = selected ? CheckBoxIcon : CheckBoxOutlineBlankIcon
  return (
    // the row opens the attack (or picks it); its remove button sits beside, not inside
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        borderRadius: tokens.radius.control,
        ...quickSx,
        ...(selected && selectedSx(theme)),
        '&:hover': {
          bgcolor: selected
            ? alpha(theme.palette.primary.main, 0.14)
            : alpha(giTokens.parchment, 0.05),
        },
        // the remove button shows on hover and keyboard focus (always without hover)
        '&:hover .attack-remove, &:focus-within .attack-remove': { opacity: 1 },
        '@media (hover: none)': { '& .attack-remove': { opacity: 1 } },
      })}
    >
      <ButtonBase
        onClick={onClick}
        aria-pressed={selecting ? selected : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          flexGrow: 1,
          minWidth: 0,
          textAlign: 'left',
          pl: 0.75,
          pr: selecting ? 1 : 0.25,
          py: 0.5,
          minHeight: 36,
          borderRadius: tokens.radius.control,
          ...focusSx,
        }}
      >
        {selecting && (
          <SelectIcon
            sx={{
              fontSize: 18,
              color: selected ? 'primary.main' : 'text.secondary',
              flexShrink: 0,
            }}
          />
        )}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.75,
              minWidth: 0,
            }}
          >
            <AttackName data={data} path={attack.path} oneLine />
            {/* what is special about this attack: small marks after its name */}
            {attack.reaction && (
              <Tag
                sx={{
                  color: `${attack.reaction}.main`,
                  flexShrink: 0,
                }}
              >
                {tSheet(`reaction.${attack.reaction}`)}
              </Tag>
            )}
            {attack.hitMode === 'critHit' && (
              <Tag sx={{ flexShrink: 0 }}>
                {t('teamOpt.hitMode.critHit', 'Crit')}
              </Tag>
            )}
            {attack.hitMode === 'hit' && (
              <Tag sx={{ flexShrink: 0 }}>
                {t('teamOpt.hitMode.hit', 'Non-crit')}
              </Tag>
            )}
            {ownOnField && (
              <Tooltip
                placement="top"
                title={
                  <>
                    <CharacterName characterKey={ownOnField} gender={gender} />{' '}
                    {t('teamOpt.attack.onField', 'on the field')}
                  </>
                }
              >
                <Box
                  component="span"
                  sx={{ display: 'inline-flex', flexShrink: 0 }}
                >
                  <MemberAvatar characterKey={ownOnField} size={18} />
                </Box>
              </Tooltip>
            )}
            {!showConditions && conditionCount > 0 && (
              <Tooltip
                placement="bottom-start"
                // (in place: a portal re-rendered the translated names in a loop on resize)
                PopperProps={{ disablePortal: true }}
                title={conditionLines.map((line, n) => (
                  <Fragment key={line.key}>
                    {n > 0 && <br />}
                    {line.node}
                  </Fragment>
                ))}
              >
                <Tag
                  aria-label={t('teamOpt.rotation.conditionCount', {
                    defaultValue: '{{count}} buff conditions',
                    count: conditionCount,
                  })}
                  sx={{
                    flexShrink: 0,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 0.25,
                    color: 'text.secondary',
                    ...numSx,
                  }}
                >
                  <TuneIcon sx={{ fontSize: 13 }} />
                  {conditionCount}
                </Tag>
              </Tooltip>
            )}
          </Box>
          {/* power users: each buff state and limit, listed under the attack */}
          {listConditions && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                mt: 0.5,
                pl: 3.5,
              }}
            >
              {states.map((state) => {
                const buff = buffs.find((b) => sameBuff(b.ref, state))
                const stateName =
                  buff?.states?.find((s) => s.value === state.value)?.name ??
                  state.value
                return (
                  <Tag key={`${state.owner}${state.path.join('.')}=`}>
                    {buff?.label ?? state.path.at(-1)}: {stateName}
                  </Tag>
                )
              })}
              {limits.map((limit) => {
                const buff = buffs.find((b) => sameBuff(b.ref, limit))
                return (
                  <Tag
                    key={`${limit.owner}${limit.path.join('.')}`}
                    off={!limit.hits}
                  >
                    {buff?.name ?? limit.path.at(-1)}
                    {!!limit.hits &&
                      ` ${formatHits(limit.hits)}/${formatHits(attack.hits)}`}
                  </Tag>
                )
              })}
            </Box>
          )}
        </Box>
        {/* its damage over the rotation, and its hits: in columns */}
        {figures && (
          <Typography
            component="span"
            sx={{
              ...type.label,
              ...numSx,
              flexShrink: 0,
              minWidth: '3.4em',
              textAlign: 'right',
            }}
          >
            {formatDamage(damage)}
          </Typography>
        )}
        <Typography
          component="span"
          sx={{
            fontSize: 13.5,
            fontWeight: 650,
            ...numSx,
            flexShrink: 0,
            minWidth: '2.4em',
            textAlign: 'right',
          }}
        >
          ×{formatHits(attack.hits)}
        </Typography>
      </ButtonBase>
      {!selecting && (
        <Tooltip title={t('teamOpt.rotation.remove', 'Remove')}>
          <IconButton
            className="attack-remove"
            size="small"
            aria-label={t('teamOpt.rotation.remove', 'Remove')}
            onClick={onRemove}
            sx={{
              opacity: 0,
              mr: 0.25,
              p: 0.5,
              color: 'text.secondary',
              transition: 'opacity .12s, color .12s, background-color .12s',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
              '&:hover': { color: 'error.main' },
              ...focusSx,
            }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

/** A small mark on an attack: its reaction, crit mode, or a buff state or limit (off: struck) */
const Tag = forwardRef<
  HTMLSpanElement,
  {
    children: ReactNode
    off?: boolean
    sx?: SxProps<Theme>
    'aria-label'?: string
  } & HTMLAttributes<HTMLSpanElement>
>(function Tag({ children, off = false, sx, ...rest }, ref) {
  return (
    <Box
      component="span"
      ref={ref}
      {...rest}
      sx={[
        {
          // not flex: the name's parts (translated pieces) keep their spaces
          display: 'inline-block',
          verticalAlign: 'middle',
          maxWidth: 180,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          px: 0.625,
          borderRadius: 1,
          fontSize: 11.5,
          fontWeight: 600,
          lineHeight: '18px',
          color: off ? 'text.secondary' : 'text.primary',
          textDecoration: off ? 'line-through' : undefined,
          bgcolor: alpha(giTokens.parchment, 0.07),
        },
        ...(Array.isArray(sx) ? sx : [sx]),
      ]}
    >
      {children}
    </Box>
  )
})
