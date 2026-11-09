import { useBoolState } from '@genshin-optimizer/common/react-util'
import { DropdownButton } from '@genshin-optimizer/common/ui'
import type {
  AdditiveReactionKey,
  AmpReactionKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import { allAmpReactionKeys } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import {
  initTeamOptAttack,
  TEAM_OPT_MAX_ATTACKS,
} from '@genshin-optimizer/gi/db'
import { useDBGender } from '@genshin-optimizer/gi/db-ui'
import type {
  TeamData,
  TeamOptEvaluation,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  AdditiveReactionModeText,
  AmpReactionModeText,
  CharacterName,
  DataContext,
  sameBuff,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AddIcon from '@mui/icons-material/Add'
import CheckBoxIcon from '@mui/icons-material/CheckBox'
import CheckBoxOutlineBlankIcon from '@mui/icons-material/CheckBoxOutlineBlank'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import DownloadIcon from '@mui/icons-material/Download'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  IconButton,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TargetSelectorModal } from '../CharacterDisplay/Tabs/TabOptimize/Components/TargetSelectorModal'
import { AttackEditor } from './AttackEditor'
import { AttackName } from './AttackName'
import type { TeamBuff } from './buffs'
import { formatDamage, formatHits, formatRate } from './format'
import { MemberAvatar } from './MemberAvatar'

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
}) {
  const { t } = useTranslation('page_team')
  const gender = useDBGender()
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
        bgcolor: 'contentLight.main',
      }}
    >
      {/* the member, and its share of the rotation */}
      <Box sx={{ px: 1.25, pt: 1, pb: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MemberAvatar characterKey={characterKey} />
          <Typography sx={{ fontWeight: 600, minWidth: 0 }} noWrap>
            <CharacterName characterKey={characterKey} gender={gender} />
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}
          >
            {damage ? formatRate(damage, rotationTime) : ''}
          </Typography>
          {share !== undefined && damage ? (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {Math.round(share * 100)}%
            </Typography>
          ) : null}
        </Box>
        {/* the member's share of the rotation: only once there is damage to share */}
        {!!damage && <ShareBar share={share} />}
      </Box>

      {/* its attacks */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          px: 1,
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
            damage={evaluation?.attacks[characterKey]?.[i]}
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
          <Box
            sx={(theme) => ({
              borderRadius: 2,
              border: `1px dashed ${alpha(theme.palette.text.primary, 0.2)}`,
              px: 1.5,
              py: 2,
              textAlign: 'center',
            })}
          >
            <Typography variant="body2" color="text.secondary">
              {t(
                'teamOpt.rotation.empty',
                'No attacks yet. A support without attacks still counts through the buffs it gives.'
              )}
            </Typography>
          </Box>
        )}
        {selecting ? (
          <Box
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: 0.5 }}
          >
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              disabled={!selected.size}
              onClick={() => {
                remove(selected)
                stopSelecting()
              }}
            >
              {t('teamOpt.rotation.removeSelected', {
                defaultValue: 'Remove ({{count}})',
                count: selected.size,
              })}
            </Button>
            <Button
              size="small"
              color="inherit"
              sx={{ color: 'text.secondary' }}
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
            <Button size="small" color="inherit" onClick={stopSelecting}>
              {t('teamOpt.rotation.selectDone', 'Done')}
            </Button>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 0.5 }}>
            <Button
              size="small"
              color="inherit"
              startIcon={<AddIcon />}
              onClick={onShowPicker}
              disabled={!data || full}
              sx={{
                color: 'text.secondary',
                '&:hover': { color: 'text.primary' },
              }}
            >
              {t('teamOpt.rotation.add', 'Add attack')}
            </Button>
            {!!teamChar.customMultiTargets.length && (
              <DropdownButton
                size="small"
                color="inherit"
                startIcon={<DownloadIcon />}
                disabled={full}
                title={t('teamOpt.rotation.import', 'From multi-target')}
                sx={{ color: 'text.secondary' }}
              >
                {teamChar.customMultiTargets.map(({ name, targets }, i) => (
                  <MenuItem
                    // biome-ignore lint/suspicious/noArrayIndexKey: multi-targets have no ids
                    key={i}
                    disabled={!targets.length}
                    onClick={() => importTargets(i)}
                  >
                    {name}
                    <Typography
                      component="span"
                      variant="caption"
                      color="text.secondary"
                      sx={{ ml: 1 }}
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
                size="small"
                color="inherit"
                onClick={() => setSelecting(true)}
                sx={{
                  color: 'text.secondary',
                  '&:hover': { color: 'text.primary' },
                }}
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
              gap: 1,
              mt: 0.25,
              px: 0.75,
              fontSize: '0.8125rem',
              color: 'text.secondary',
            }}
          >
            {undoable ? (
              <>
                {t('teamOpt.rotation.removed', {
                  defaultValue: 'Removed {{count}} attacks',
                  count: undo.count,
                })}
                <Button
                  size="small"
                  onClick={() => {
                    setAttacks(() => undo.before)
                    setUndo(undefined)
                  }}
                  sx={{ minWidth: 0, px: 0.75 }}
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
      )}
    </Box>
  )
}

function ShareBar({ share }: { share: number | undefined }) {
  return (
    <Box
      sx={(theme) => ({
        mt: 1,
        height: 4,
        borderRadius: 2,
        backgroundColor: alpha(theme.palette.text.primary, 0.08),
        overflow: 'hidden',
      })}
    >
      <Box
        sx={{
          height: '100%',
          width: `${Math.round((share ?? 0) * 100)}%`,
          borderRadius: 2,
          backgroundColor: 'primary.main',
          transition: 'width 300ms ease',
        }}
      />
    </Box>
  )
}

/** An attack of the rotation: what it is, how often, its buff limits, and its damage */
/** The same attack of a multi-target (what an import updates rather than adds again) */
function sameAttack(a: TeamOptAttack, b: TeamOptAttack) {
  return (
    a.path.join('.') === b.path.join('.') &&
    (a.reaction ?? '') === (b.reaction ?? '') &&
    (a.infusionAura ?? '') === (b.infusionAura ?? '') &&
    a.hitMode === b.hitMode
  )
}

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
}: {
  data: UIData | undefined
  attack: TeamOptAttack
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
  const gender = useDBGender()
  const limits = attack.limits ?? []
  const states = attack.states ?? []
  const ownOnField =
    attack.onField && attack.onField !== onField ? attack.onField : undefined
  const SelectIcon = selected ? CheckBoxIcon : CheckBoxOutlineBlankIcon
  return (
    // the row opens the attack (or picks it); its remove button sits beside, not inside
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        width: '100%',
        borderRadius: 2,
        backgroundColor: selected
          ? alpha(theme.palette.primary.main, 0.12)
          : alpha(theme.palette.text.primary, 0.03),
        border: `1px solid ${
          selected
            ? alpha(theme.palette.primary.main, 0.5)
            : alpha(theme.palette.text.primary, 0.08)
        }`,
        transition: 'background-color 150ms ease, border-color 150ms ease',
        '&:hover': {
          backgroundColor: selected
            ? alpha(theme.palette.primary.main, 0.16)
            : alpha(theme.palette.text.primary, 0.07),
          borderColor: selected
            ? alpha(theme.palette.primary.main, 0.6)
            : alpha(theme.palette.text.primary, 0.18),
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
          pl: 1,
          pr: selecting ? 1 : 0.25,
          py: 0.5,
          minHeight: 36,
          borderRadius: 2,
        }}
      >
        {selecting && (
          <SelectIcon
            fontSize="small"
            sx={{
              color: selected ? 'primary.main' : 'text.secondary',
              flexShrink: 0,
            }}
          />
        )}
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <AttackName data={data} path={attack.path} oneLine />
          {(!!limits.length ||
            !!states.length ||
            ownOnField ||
            attack.reaction ||
            (attack.hitMode !== 'avgHit' && attack.hitMode !== 'global')) && (
            <Box
              sx={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: 0.5,
                mt: 0.25,
                pl: 3.75,
              }}
            >
              {attack.reaction && (
                <Tag>
                  {(allAmpReactionKeys as readonly string[]).includes(
                    attack.reaction
                  ) ? (
                    <AmpReactionModeText
                      reaction={attack.reaction as AmpReactionKey}
                    />
                  ) : (
                    <AdditiveReactionModeText
                      reaction={attack.reaction as AdditiveReactionKey}
                    />
                  )}
                </Tag>
              )}
              {attack.hitMode === 'critHit' && (
                <Tag>{t('teamOpt.hitMode.critHit', 'Crit')}</Tag>
              )}
              {attack.hitMode === 'hit' && (
                <Tag>{t('teamOpt.hitMode.hit', 'Non-crit')}</Tag>
              )}
              {ownOnField && (
                <Tag>
                  <CharacterName characterKey={ownOnField} gender={gender} />{' '}
                  {t('teamOpt.attack.onField', 'on the field')}
                </Tag>
              )}
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
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 1,
            flexShrink: 0,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          <Typography variant="caption" color="text.secondary">
            {formatDamage(damage)}
          </Typography>
          <Typography
            variant="body2"
            sx={{ fontWeight: 600, minWidth: '2.2em', textAlign: 'right' }}
          >
            ×{formatHits(attack.hits)}
          </Typography>
        </Box>
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
              transition: 'opacity 120ms ease, color 120ms ease',
              mr: 0.25,
              p: 0.5,
              color: 'text.secondary',
              '&:hover': { color: 'error.main' },
            }}
          >
            <CloseIcon sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      )}
    </Box>
  )
}

/** A small label under an attack: its reaction, crit mode, or a buff that is off or limited */
function Tag({
  children,
  off = false,
}: {
  children: ReactNode
  off?: boolean
}) {
  return (
    <Box
      component="span"
      sx={(theme) => ({
        // not flex: the name's parts (translated pieces) keep their spaces
        display: 'inline-block',
        verticalAlign: 'middle',
        maxWidth: 180,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        px: 0.75,
        py: 0.125,
        borderRadius: 1,
        fontSize: '0.75rem',
        lineHeight: 1.5,
        color: off ? theme.palette.text.secondary : theme.palette.text.primary,
        textDecoration: off ? 'line-through' : undefined,
        backgroundColor: alpha(theme.palette.text.primary, 0.07),
      })}
    >
      {children}
    </Box>
  )
}
