import {
  CardThemed,
  ColorText,
  InfoTooltipInline,
  ModalWrapper,
  NumberInputLazy,
} from '@genshin-optimizer/common/ui'
import { getUnitStr } from '@genshin-optimizer/common/util'
import type {
  AdditiveReactionKey,
  AmpReactionKey,
  CharacterKey,
  ElementKey,
  HitModeKey,
} from '@genshin-optimizer/gi/consts'
import {
  allAmpReactionKeys,
  allowedAdditiveReactions,
  allowedAmpReactions,
} from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { KeyMap } from '@genshin-optimizer/gi/keymap'
import type { BuffRef, StatGain, TeamOptMember } from '@genshin-optimizer/gi/ui'
import {
  AdditiveReactionModeText,
  AmpReactionModeText,
  attackHitData,
  CharacterName,
  DataContext,
  FieldDisplayList,
  GetCalcDisplay,
  hitFormulaParts,
  NodeFieldDisplay,
  partTerms,
  partUncapped,
  StatEditorList,
  sameBuff,
  statGains,
  statName,
  teamOptBonusStats,
  teamOptMembers,
} from '@genshin-optimizer/gi/ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import { uiInput } from '@genshin-optimizer/gi/wr'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import GroupsIcon from '@mui/icons-material/Groups'
import RemoveIcon from '@mui/icons-material/Remove'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  IconButton,
  ListItem,
  MenuItem,
  Select,
  Skeleton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import {
  createContext,
  Suspense,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
} from 'react'
import { useTranslation } from 'react-i18next'
import { AttackName, useAttackInfo } from './AttackName'
import type { BuffEffect, TeamBuff } from './buffs'
import { buffEffects, useAttackTeamData } from './buffs'
import { extraStatKeys } from './ExtraBuffs'
import { formatHits } from './format'
import { MemberAvatar } from './MemberAvatar'
import { basicStats } from './ResultDetails'
import {
  EmptyLine,
  FieldLabel,
  focusSx,
  hairline,
  insetSx,
  numSx,
  PanelHeader,
  Pill,
  quickSx,
  rowHoverSx,
  Segmented,
  tokens,
  type,
} from './ui'
import { useTeamOpt } from './useTeamOpt'

/**
 * The editor shows the attack's figures with the members' own builds (its stats, what each buff
 * adds per hit, gear not equipped). Off in KQM theorycrafting, which never counts those builds.
 */
export const AttackFiguresContext = createContext(true)

/** A section's header in the editor: its title (with ⓘ), and on the right a meta line */
const sectionHeaderSx = {
  mb: 1,
  minHeight: 28,
  // (a little air between a title and its ⓘ)
  '& > h3': { gap: 0.5 },
} as const

/** A control with its label above it (the explanation in the label's tooltip) */
function Field({
  label,
  tip,
  children,
}: {
  label: ReactNode
  tip?: ReactNode
  children: ReactNode
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: 0.75,
        minWidth: 0,
      }}
    >
      <FieldLabel tip={tip}>{label}</FieldLabel>
      {children}
    </Box>
  )
}

/**
 * A list of a hit's stats, on an inset: one hairline between stats, a stat's terms under it
 * (indented, quieter), numbers in one column, the formula's ? quiet until pointed at
 */
const statListSx = {
  ...insetSx,
  m: 0,
  py: 0.25,
  // (no zebra: hairlines between stats, none between a stat and its terms)
  '& > .MuiListItem-root:nth-of-type(n)': {
    bgcolor: 'transparent',
    px: 1.25,
    py: 0.375,
    minHeight: 30,
  },
  '& > .MuiListItem-root:nth-of-type(n) + .MuiListItem-root:not(.term)': {
    borderTop: hairline,
  },
  '& .MuiTypography-root': { fontSize: 13 },
  '& > .term .MuiTypography-root': { fontSize: 12 },
  '& svg[data-testid="HelpIcon"]': {
    opacity: 0.35,
    ...quickSx,
    transition: 'opacity .12s',
  },
  '& .MuiListItem-root:hover svg[data-testid="HelpIcon"]': { opacity: 0.9 },
} as const

/** The hit itself, first in its stats: the figure the rest add up to */
const hitRowSx = {
  '& > .MuiListItem-root:first-of-type': {
    minHeight: 38,
    '& .MuiTypography-root': { fontSize: 14, fontWeight: 650 },
  },
  '& > .MuiListItem-root:nth-of-type(2)': {
    borderTop: `1px solid ${giTokens.hairlineStrong} !important`,
  },
} as const

const hitModes: HitModeKey[] = ['avgHit', 'hit', 'critHit']

/** The limit of `buff` on `attack`: undefined when it covers every hit */
const limitOf = (attack: TeamOptAttack, buff: BuffRef) =>
  attack.limits?.find((l) => sameBuff(l, buff))

/** The state of `buff` during `attack`, when it is not the rotation's */
const stateOf = (attack: TeamOptAttack, buff: BuffRef) =>
  attack.states?.find((s) => sameBuff(s, buff))?.value

/** `attack` with `buff` in `value` during it (undefined: the rotation's state) */
export function withBuffState(
  attack: TeamOptAttack,
  buff: BuffRef,
  value: string | undefined
): TeamOptAttack {
  const others = (attack.states ?? []).filter((s) => !sameBuff(s, buff))
  const states =
    value === undefined
      ? others
      : [...others, { owner: buff.owner, path: [...buff.path], value }]
  const { states: _, ...rest } = attack
  return states.length ? { ...rest, states } : rest
}

/** `attack` with `buff` covering only its first `hits` hits (all of them: no limit) */
export function withBuffLimit(
  attack: TeamOptAttack,
  buff: BuffRef,
  hits: number | undefined
): TeamOptAttack {
  const others = (attack.limits ?? []).filter((l) => !sameBuff(l, buff))
  const limits =
    hits === undefined || hits >= attack.hits
      ? others
      : [...others, { owner: buff.owner, path: [...buff.path], hits }]
  const { limits: _, ...rest } = attack
  return limits.length ? { ...rest, limits } : rest
}

/**
 * Edits one attack of the rotation: how often it hits, how (hit mode, reaction), who is on the
 * field while it hits, and the team's buffs during it (off, in another state, or for its first
 * hits only, like Shenhe's quills).
 */
export function AttackEditor({
  open,
  onClose,
  teamId,
  characterKey,
  data,
  attack,
  buffs,
  mainStatAssumptionLevel,
  members,
  onField,
  onChange,
  onDuplicate,
  onRemove,
}: {
  open: boolean
  onClose: () => void
  teamId: string
  characterKey: CharacterKey
  data: UIData | undefined
  attack: TeamOptAttack
  /** The buffs that can affect this member's attacks */
  buffs: TeamBuff[]
  mainStatAssumptionLevel: number
  /** The team (who may be on the field) */
  members: TeamOptMember[]
  /** Who is on the field by default */
  onField: CharacterKey
  onChange: (attack: TeamOptAttack) => void
  onDuplicate: () => void
  onRemove: () => void
}) {
  const { t } = useTranslation(['page_team', 'loadout'])
  const { gender } = useDBMeta()
  const info = useAttackInfo(data, attack.path)
  const element = (info?.variant ?? 'physical') as ElementKey
  const reactions = useMemo(
    () => [
      ...new Set([
        ...(allowedAmpReactions[element] ?? []),
        ...(allowedAmpReactions[(attack.infusionAura ?? '') as ElementKey] ??
          []),
        ...(allowedAdditiveReactions[element] ?? []),
        ...(allowedAdditiveReactions[
          (attack.infusionAura ?? '') as ElementKey
        ] ?? []),
      ]),
    ],
    [element, attack.infusionAura]
  )
  const hitMode = attack.hitMode === 'global' ? 'avgHit' : attack.hitMode
  // one hit as it is, and what each buff gives the attacker (gear not on now: not computed)
  const inUse = useMemo(() => buffs.filter((b) => !b.inactive), [buffs])
  const figures = useContext(AttackFiguresContext)
  const { hit, gains, impacts, settled } = useAttackStats(
    teamId,
    characterKey,
    attack,
    inUse,
    mainStatAssumptionLevel,
    onField,
    open && figures
  ) // this hit's CRIT Rate before its 100% cap, when capped (a CRIT Rate buff may then add nothing)
  const critUncapped = useMemo(() => {
    if (!hit?.hit) return undefined
    const part = hitFormulaParts(hit.hit).parts.find((p) =>
      p.info.path?.endsWith('critRate_')
    )
    return part && partUncapped(part)
  }, [hit])

  const currentOnField = attack.onField ?? onField

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      containerProps={{ maxWidth: 'lg' }}
    >
      {/* (its texts load here: the page behind it stays) */}
      <Suspense
        fallback={
          <CardThemed sx={dialogSx}>
            <Skeleton variant="rectangular" height={640} />
          </CardThemed>
        }
      >
        {/* header and footer stay; the body scrolls (on wide screens, each column apart) */}
        <CardThemed sx={dialogSx}>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              flexShrink: 0,
              px: { xs: 2, sm: 2.5 },
              py: 1.5,
              borderBottom: hairline,
            }}
          >
            <MemberAvatar characterKey={characterKey} size={36} />
            <Box
              sx={{
                flexGrow: 1,
                minWidth: 0,
                // the attack's name leads the dialog (two lines at most), its talent under it
                '& .MuiTypography-body2': {
                  ...type.section,
                  lineHeight: 1.3,
                  whiteSpace: 'normal',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                },
                '& .MuiTypography-caption': {
                  fontSize: 12.5,
                  fontWeight: 500,
                  mt: 0.25,
                },
              }}
            >
              <AttackName data={data} path={attack.path} dense />
            </Box>
            <IconButton
              onClick={onClose}
              aria-label={t('teamOpt.editor.close', 'Close')}
              sx={{ mr: -0.75 }}
            >
              <CloseIcon />
            </IconButton>
          </Box>
          <Box
            sx={{
              flex: '1 1 auto',
              minHeight: 0,
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                md: '340px minmax(0, 1fr)',
                lg: '370px minmax(0, 1fr)',
              },
              gridTemplateRows: { md: 'minmax(0, 1fr)' },
              // phones: one scroll, the controls first (the hit's stats after the buffs)
              overflowY: { xs: 'auto', md: 'hidden' },
              p: { xs: 2, md: 0 },
              rowGap: { xs: 3.5, md: 0 },
              overscrollBehavior: 'contain',
            }}
          >
            {/* the attack: how it hits, and what one hit uses */}
            <Box sx={[columnSx, { borderRight: { md: hairline } }]}>
              <Box
                sx={{
                  order: { xs: 0, md: 0 },
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2,
                }}
              >
                <Field
                  label={t('teamOpt.editor.hits', 'Hits per rotation')}
                  tip={t(
                    'teamOpt.editor.hitsHint',
                    'Casts or hits in one rotation; averages like 2.5 are fine.'
                  )}
                >
                  <HitsStepper
                    hits={attack.hits}
                    onChange={(hits) =>
                      onChange(clampLimits({ ...attack, hits }))
                    }
                  />
                </Field>
                <Field label={t('teamOpt.editor.hitMode', 'Hit')}>
                  <Segmented<HitModeKey>
                    size="small"
                    aria-label={t('teamOpt.editor.hitMode', 'Hit')}
                    value={hitMode}
                    onChange={(v) =>
                      v !== hitMode && onChange({ ...attack, hitMode: v })
                    }
                    options={hitModes.map((mode) => ({
                      value: mode,
                      label: t(
                        `teamOpt.hitMode.${mode}`,
                        hitModeDefaults[mode]
                      ),
                    }))}
                  />
                </Field>
                {!!reactions.length && (
                  <Field label={t('teamOpt.editor.reaction', 'Reaction')}>
                    {/* (scrolls rather than overflow on the narrowest phones) */}
                    <Box sx={{ maxWidth: '100%', overflowX: 'auto' }}>
                      <Segmented<AmpReactionKey | AdditiveReactionKey | ''>
                        size="small"
                        aria-label={t('teamOpt.editor.reaction', 'Reaction')}
                        value={attack.reaction ?? ''}
                        onChange={(v) => {
                          if (v === (attack.reaction ?? '')) return
                          const { reaction: _r, ...rest } = attack
                          onChange(v ? { ...rest, reaction: v } : rest)
                        }}
                        options={[
                          {
                            value: '' as const,
                            label: t('loadout:mTargetEditor.noReaction'),
                          },
                          ...reactions.map((r) => ({
                            value: r,
                            label: (
                              allAmpReactionKeys as readonly string[]
                            ).includes(r) ? (
                              <AmpReactionModeText
                                reaction={r as AmpReactionKey}
                              />
                            ) : (
                              <AdditiveReactionModeText
                                reaction={r as AdditiveReactionKey}
                              />
                            ),
                          })),
                        ]}
                      />
                    </Box>
                  </Field>
                )}
                {members.length > 1 && (
                  <Field
                    label={t(
                      'teamOpt.editor.onField',
                      'On the field during these hits'
                    )}
                    tip={t(
                      'teamOpt.editor.onFieldHint',
                      'Buffs for the active character (e.g. Mitya’s C1) go to whoever is on the field. Pick another member for hits that land while they are, e.g. a skill that keeps hitting after a switch.'
                    )}
                  >
                    <Box
                      role="group"
                      aria-label={t(
                        'teamOpt.editor.onField',
                        'On the field during these hits'
                      )}
                      sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}
                    >
                      {members.map((m) => (
                        <Pill
                          key={m.characterKey}
                          selected={m.characterKey === currentOnField}
                          onClick={() => {
                            if (m.characterKey === currentOnField) return
                            const { onField: _o, ...rest } = attack
                            onChange(
                              m.characterKey === onField
                                ? rest
                                : { ...rest, onField: m.characterKey }
                            )
                          }}
                          icon={
                            <MemberAvatar
                              characterKey={m.characterKey}
                              size={22}
                            />
                          }
                          sx={{ pl: 0.375, pr: 1.25, gap: 0.625 }}
                        >
                          <CharacterName
                            characterKey={m.characterKey}
                            gender={gender}
                          />
                        </Pill>
                      ))}
                    </Box>
                  </Field>
                )}
              </Box>
              {figures && (
                <Box sx={{ order: { xs: 2, md: 0 } }}>
                  <HitStats hit={hit} />
                </Box>
              )}
            </Box>
            {/* what changes it: the buffs, and this attack's own extra stats */}
            <Box sx={columnSx}>
              <Box sx={{ order: { xs: 1, md: 0 }, minWidth: 0 }}>
                <BuffList
                  teamId={teamId}
                  characterKey={characterKey}
                  attack={attack}
                  buffs={buffs}
                  inUse={inUse}
                  gains={gains}
                  critUncapped={critUncapped}
                  impacts={impacts}
                  settled={settled}
                  mainStatAssumptionLevel={mainStatAssumptionLevel}
                  onField={onField}
                  onChange={onChange}
                  active={open}
                />
              </Box>
              <Box sx={{ order: { xs: 3, md: 0 } }}>
                <PanelHeader
                  title={t('teamOpt.editor.extra', 'Extra stats')}
                  info={t(
                    'teamOpt.editor.extraHint',
                    'Bonus stats for this attack only: a buff the game data does not have, or your own numbers. For the whole rotation, use Extra buffs.'
                  )}
                  sx={sectionHeaderSx}
                />
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1,
                    maxWidth: { md: 480 },
                    // (the editor's type size, not the stat editor's larger one)
                    '& .MuiInputBase-root, & .MuiInputBase-input': {
                      fontSize: 14,
                    },
                  }}
                >
                  <StatEditorList
                    statKeys={extraStatKeys}
                    statFilters={attack.bonusStats ?? {}}
                    label={t('teamOpt.extra.add', 'Add a stat')}
                    setStatFilters={(stats) => {
                      const { bonusStats: _b, ...rest } = attack
                      onChange(
                        Object.keys(stats).length
                          ? { ...rest, bonusStats: stats }
                          : rest
                      )
                    }}
                  />
                </Box>
              </Box>
            </Box>
          </Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              flexShrink: 0,
              px: { xs: 1.5, sm: 2 },
              py: 1.25,
              borderTop: hairline,
            }}
          >
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={onRemove}
              sx={{ px: 1.25 }}
            >
              {t('teamOpt.editor.remove', 'Remove')}
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<ContentCopyIcon />}
              onClick={onDuplicate}
              sx={{ px: 1.25, color: 'text.secondary' }}
            >
              {t('teamOpt.editor.duplicate', 'Duplicate')}
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              variant="contained"
              onClick={onClose}
              sx={{ ...giCtaSx, minWidth: 96, minHeight: 34 }}
            >
              {t('teamOpt.editor.done', 'Done')}
            </Button>
          </Box>
        </CardThemed>
      </Suspense>
    </ModalWrapper>
  )
}

/** The dialog: as tall as the screen allows, its body scrolling between a fixed header and footer */
const dialogSx = {
  display: 'flex',
  flexDirection: 'column',
  maxHeight: { xs: 'calc(100vh - 16px)', md: 'calc(100vh - 48px)' },
  '@supports (height: 100dvh)': {
    maxHeight: { xs: 'calc(100dvh - 16px)', md: 'calc(100dvh - 48px)' },
  },
  border: hairline,
  borderRadius: tokens.radius.panel,
  backgroundImage: 'none',
} as const

/**
 * One of the body's columns: on wide screens it scrolls on its own (the hit's stats stay in view
 * while the buffs scroll); on phones its parts join the body's one column, in their `order`
 */
const columnSx = {
  display: { xs: 'contents', md: 'flex' },
  flexDirection: 'column',
  gap: 3.5,
  minWidth: 0,
  minHeight: 0,
  overflowY: { md: 'auto' },
  overscrollBehavior: 'contain',
  scrollbarWidth: 'thin',
  scrollbarColor: `${giTokens.hairlineStrong} transparent`,
  p: { md: 2.5 },
} as const

const hitModeDefaults: Record<HitModeKey, string> = {
  avgHit: 'Average',
  hit: 'Non-crit',
  critHit: 'Crit',
}

/** Limits beyond the attack's hits mean "every hit": drop them */
function clampLimits(attack: TeamOptAttack): TeamOptAttack {
  if (!attack.limits) return attack
  const limits = attack.limits.filter((l) => l.hits < attack.hits)
  const { limits: _, ...rest } = attack
  return limits.length ? { ...rest, limits } : rest
}

/** The attack's hits per rotation: − [27] +, as one control */
function HitsStepper({
  hits,
  onChange,
}: {
  hits: number
  onChange: (hits: number) => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'stretch',
        height: 34,
        borderRadius: tokens.radius.control,
        border: `1px solid ${giTokens.hairlineStrong}`,
        overflow: 'hidden',
        ...quickSx,
        '&:focus-within': { borderColor: alpha(giTokens.gold, 0.7) },
      }}
    >
      <IconButton
        size="small"
        disabled={hits <= 1}
        onClick={() => onChange(Math.max(1, Math.ceil(hits) - 1))}
        aria-label={t('teamOpt.editor.fewer', 'Fewer hits')}
        sx={stepperButtonSx}
      >
        <RemoveIcon fontSize="small" />
      </IconButton>
      <NumberInputLazy
        float
        size="small"
        value={hits}
        onChange={(v) => onChange(Math.max(0, v))}
        inputProps={{
          min: 0,
          max: 999,
          'aria-label': t('teamOpt.editor.hits', 'Hits per rotation'),
          sx: {
            textAlign: 'center',
            width: '3.6em',
            py: 0,
            height: 32,
            fontSize: 15,
            fontWeight: 650,
            ...numSx,
          },
        }}
        sx={{
          borderLeft: hairline,
          borderRight: hairline,
          '& .MuiInputBase-root': { height: '100%', borderRadius: 0 },
          '& .MuiOutlinedInput-notchedOutline': { border: 'none' },
        }}
      />
      <IconButton
        size="small"
        disabled={hits >= 999}
        onClick={() => onChange(Math.floor(hits) + 1)}
        aria-label={t('teamOpt.editor.more', 'More hits')}
        sx={stepperButtonSx}
      >
        <AddIcon fontSize="small" />
      </IconButton>
    </Box>
  )
}

const stepperButtonSx = {
  width: 34,
  borderRadius: 0,
  color: 'text.secondary',
  ...quickSx,
  '&.Mui-focusVisible, &:focus-visible': {
    outline: `2px solid ${giTokens.gold}`,
    outlineOffset: -2,
  },
  '&:hover': {
    color: 'text.primary',
    bgcolor: alpha(giTokens.parchment, 0.06),
  },
} as const

/** A buff's worth on one hit of the attack */
interface BuffImpact {
  /** The hit's damage with the buff up */
  on: number
  /** ...and without it */
  off: number
}

const impactRatio = ({ on, off }: BuffImpact) =>
  off > 0 ? on / off - 1 : on > 0 ? 1 : 0

/** The buff changes nothing for this attack (exactly: float noise aside) */
const noChange = (impact: BuffImpact | undefined) =>
  !!impact &&
  Number.isFinite(impact.on) &&
  Number.isFinite(impact.off) &&
  Math.abs(impact.on - impact.off) <=
    1e-9 * Math.max(1, Math.abs(impact.on), Math.abs(impact.off))

type TeamUIData = ReturnType<typeof useAttackTeamData>

/**
 * The buffs that can affect this attack, grouped by who gives them. Each shows what it gives (as
 * on the character's page) and how much more damage the attack deals with it; those that change
 * nothing are folded away. Off: not up during this attack. With a number: up for its first hits.
 */
function BuffList({
  teamId,
  characterKey,
  attack,
  buffs,
  inUse,
  gains,
  critUncapped,
  impacts,
  settled,
  mainStatAssumptionLevel,
  onField,
  onChange,
  active,
}: {
  teamId: string
  characterKey: CharacterKey
  attack: TeamOptAttack
  buffs: TeamBuff[]
  /** The buffs that can do something now (not gear that is off) */
  inUse: TeamBuff[]
  /** What each buff gives the attacker */
  gains: Partial<Record<string, StatGain[]>>
  /** The hit's CRIT Rate before its 100% cap, when capped */
  critUncapped?: number
  /** What each buff is worth on one hit */
  impacts: Partial<Record<string, BuffImpact>>
  /** Every buff is computed for the attack as it is now */
  settled: boolean
  mainStatAssumptionLevel: number
  onField: CharacterKey
  onChange: (attack: TeamOptAttack) => void
  active: boolean
}) {
  const { t } = useTranslation('page_team')
  const figures = useContext(AttackFiguresContext)
  // gear that is not equipped (or an effect the sheet hides) does nothing now: not computed
  const unused = useMemo(() => buffs.filter((b) => b.inactive), [buffs])
  // (computed by the editor, with what each buff gives: one team calculation per buff)
  const teamData = useAttackTeamData(
    teamId,
    attack,
    onField,
    mainStatAssumptionLevel,
    buffs
  )
  // Buffs that change nothing for this attack, folded once all are known. Decided once, and not
  // after an edit, so rows never move under the pointer.
  const [idle, setIdle] = useState<ReadonlySet<string>>()
  const [edited, setEdited] = useState(false)
  useEffect(() => {
    if (idle || edited || !settled) return
    setIdle(
      new Set(inUse.filter((b) => noChange(impacts[b.key])).map((b) => b.key))
    )
  }, [idle, edited, settled, inUse, impacts])
  const change = (next: TeamOptAttack) => {
    setEdited(true)
    onChange(next)
  }
  // the attacker's own buffs first, then each teammate's, then the team's
  const owners = useMemo(
    () => [
      characterKey,
      ...new Set(
        buffs
          .map((b) => b.ref.owner)
          .filter((o) => o !== characterKey && o !== 'team')
      ),
      'team' as const,
    ],
    [buffs, characterKey]
  )
  const shown = idle ? inUse.filter((b) => !idle.has(b.key)) : inUse
  const folded = idle ? inUse.filter((b) => idle.has(b.key)) : []
  // Buffs that only work together (Danica's enhanced Maid Form needs her Burst in Radiance too):
  // without either, the same is lost. The effect is shown once, on the first one listed.
  const sharedWith = useMemo(() => {
    const ordered = owners.flatMap((owner) =>
      inUse.filter((b) => b.ref.owner === owner)
    )
    const first = new Map<string, TeamBuff>()
    const shared: Partial<Record<string, TeamBuff>> = {}
    for (const buff of ordered) {
      const found = gains[buff.key]
      if (!found?.length) continue
      const signature = found
        .map(({ key, value }) => `${key}:${value.toPrecision(6)}`)
        .sort()
        .join('|')
      const earlier = first.get(signature)
      if (earlier) shared[buff.key] = earlier
      else first.set(signature, buff)
    }
    return shared
  }, [owners, inUse, gains])
  const groups = (list: TeamBuff[]) =>
    owners
      .map((owner) => ({
        owner,
        buffs: list.filter((b) => b.ref.owner === owner),
      }))
      .filter((g) => g.buffs.length)
      .map(({ owner, buffs }) => (
        <BuffGroup
          key={owner}
          owner={owner}
          characterKey={characterKey}
          buffs={buffs}
          attack={attack}
          impacts={impacts}
          gains={gains}
          critUncapped={critUncapped}
          sharedWith={sharedWith}
          teamData={teamData}
          onChange={change}
        />
      ))

  return (
    <Box>
      <PanelHeader
        title={t('teamOpt.editor.buffs', 'Buffs during this attack')}
        info={t(
          'teamOpt.editor.buffsHint',
          'Each buff shows what it gives and how much more damage this attack deals with it. Untick one that is not up during this attack, pick another of its states, or limit it to the first hits (e.g. Shenhe’s quills).'
        )}
        actions={
          !!inUse.length &&
          figures && (
            // the column of what each buff adds (its right edge on the rows' numbers)
            <FieldLabel
              tip={t(
                'teamOpt.editor.impact',
                'What the buff adds to this attack’s damage'
              )}
              sx={{ mr: '13px', whiteSpace: 'nowrap' }}
            >
              {t('teamOpt.editor.impactPerHit', 'DMG per hit')}
            </FieldLabel>
          )
        }
        sx={sectionHeaderSx}
      />
      {!buffs.length ? (
        <EmptyLine
          info={t(
            'teamOpt.editor.noBuffs',
            'No conditional buffs are on in this team. Turn them on in Team settings or on each character’s tabs.'
          )}
        >
          {t('teamOpt.editor.noBuffsShort', 'No buffs are on in this team')}
        </EmptyLine>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {groups(shown)}
          {!shown.length && (
            <EmptyLine>
              {t(
                'teamOpt.editor.allIdle',
                'None of the team’s buffs changes this attack’s damage.'
              )}
            </EmptyLine>
          )}
          {(!!folded.length || !!unused.length) && (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
              {!!folded.length && (
                <FoldedBuffs
                  label={t('teamOpt.editor.idle', {
                    count: folded.length,
                    defaultValue: 'No effect on this attack ({{count}})',
                  })}
                >
                  {groups(folded)}
                </FoldedBuffs>
              )}
              {!!unused.length && (
                <FoldedBuffs
                  label={t('teamOpt.editor.unused', {
                    count: unused.length,
                    defaultValue: 'Not in use now ({{count}})',
                  })}
                  info={t(
                    'teamOpt.editor.unusedHint',
                    'Passives of weapons and artifact sets the member does not have on now, and effects that are not unlocked. A weapon’s or set’s passive counts once Team Optimize picks it for the member.'
                  )}
                >
                  {groups(unused)}
                </FoldedBuffs>
              )}
            </Box>
          )}
        </Box>
      )}
    </Box>
  )
}

/**
 * A group of buffs behind a toggle, closed at first. Looks like `Disclosure`, but its content is a
 * plain conditional render that fades in: MUI's Collapse around these lists loops ("Maximum
 * update depth exceeded" in Transition).
 */
function FoldedBuffs({
  label,
  info,
  children,
}: {
  label: ReactNode
  info?: ReactNode
  children: ReactNode
}) {
  const [open, setOpen] = useState(false)
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center' }}>
        <ButtonBase
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          sx={{
            gap: 0.5,
            py: 0.5,
            pr: 1,
            borderRadius: 1,
            fontSize: 13.5,
            fontWeight: 600,
            color: open ? 'text.primary' : 'text.secondary',
            ...quickSx,
            ...focusSx,
            '&:hover': { color: 'text.primary' },
          }}
        >
          <ExpandMoreIcon
            sx={{
              fontSize: 18,
              transition: `transform .18s ${tokens.ease}`,
              transform: open ? 'none' : 'rotate(-90deg)',
              '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
            }}
          />
          {label}
        </ButtonBase>
        {info && <InfoTooltipInline title={info} />}
      </Box>
      {open && (
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            pt: 1,
            pb: 1,
            '@keyframes attackEditorFoldIn': {
              from: { opacity: 0, transform: 'translateY(-4px)' },
              to: { opacity: 1, transform: 'none' },
            },
            animation: `attackEditorFoldIn .18s ${tokens.ease}`,
            '@media (prefers-reduced-motion: reduce)': { animation: 'none' },
          }}
        >
          {children}
        </Box>
      )}
    </Box>
  )
}

/** One member's buffs (or the team's) */
function BuffGroup({
  owner,
  characterKey,
  buffs,
  attack,
  impacts,
  gains,
  critUncapped,
  sharedWith,
  teamData,
  onChange,
}: {
  owner: CharacterKey | 'team'
  characterKey: CharacterKey
  buffs: TeamBuff[]
  attack: TeamOptAttack
  impacts: Partial<Record<string, BuffImpact>>
  /** What each buff gives the attacker (by buff key) */
  gains: Partial<Record<string, StatGain[]>>
  critUncapped?: number
  /** The buff listed before each one that has the very same effect (they work only together) */
  sharedWith: Partial<Record<string, TeamBuff>>
  teamData: TeamUIData
  onChange: (attack: TeamOptAttack) => void
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  // what a buff gives is read where Team settings shows it: on its owner (the team's: the attacker)
  const data = teamData?.[owner === 'team' ? characterKey : owner]?.target
  return (
    <Box>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          mb: 0.75,
          pl: 0.25,
          color: 'text.secondary',
        }}
      >
        {owner === 'team' ? (
          <GroupsIcon sx={{ fontSize: 20 }} />
        ) : (
          <MemberAvatar characterKey={owner} size={20} />
        )}
        <Typography component="h4" sx={{ fontSize: 13, fontWeight: 600 }}>
          {owner === 'team' ? (
            t('teamOpt.editor.teamBuffs', 'Team')
          ) : (
            <CharacterName characterKey={owner} gender={gender} />
          )}
        </Typography>
      </Box>
      <Box sx={{ ...insetSx, overflow: 'hidden' }}>
        {buffs.map((buff, i) => (
          <BuffRow
            key={buff.key}
            buff={buff}
            attack={attack}
            impact={impacts[buff.key]}
            gains={gains[buff.key]}
            critUncapped={critUncapped}
            sharedWith={sharedWith[buff.key]}
            data={data}
            divider={i > 0}
            onChange={onChange}
          />
        ))}
      </Box>
    </Box>
  )
}

function BuffRow({
  buff,
  attack,
  impact,
  gains,
  critUncapped,
  sharedWith,
  data,
  divider,
  onChange,
}: {
  buff: TeamBuff
  attack: TeamOptAttack
  /** The buff listed before it with the very same effect: they work only together */
  sharedWith?: TeamBuff
  /** What the buff is worth on one hit; undefined while computing */
  impact: BuffImpact | undefined
  /** What it gives the attacker, exactly; undefined while computing */
  gains: StatGain[] | undefined
  /** The hit's CRIT Rate before its 100% cap, when capped */
  critUncapped?: number
  /** Where what it gives is read (undefined while it is built) */
  data: UIData | undefined
  divider: boolean
  onChange: (attack: TeamOptAttack) => void
}) {
  const { t } = useTranslation('page_team')
  const figures = useContext(AttackFiguresContext)
  const limit = limitOf(attack, buff.ref)
  const on = !limit || limit.hits > 0
  const state = stateOf(attack, buff.ref) ?? buff.value
  // No effect because the hit's CRIT Rate is over 100% even without it: says so (it is not that
  // the buff does not apply)
  const critGain = (gains ?? [])
    .filter((g) => g.key.endsWith('critRate_'))
    .reduce((n, g) => n + g.value, 0)
  const cappedWithout =
    on && noChange(impact) && critGain > 0 && critUncapped !== undefined
      ? critUncapped - critGain
      : undefined
  // gear that is not on: what its sheet would show here is not what it gives (none of it applies)
  // What it gives the attacker, exactly (its stats with the buff, against without it); else, for
  // an effect that is no stat (a state, e.g. "gains Radiance"), what its sheet says
  const effects = useMemo(
    () =>
      buff.inactive
        ? []
        : gains?.length
          ? gains.map(gainEffect)
          : data && gains
            ? // (its values are someone else's: only what it does, in words)
              buffEffects(buff.fields?.[state], data).filter(
                (effect) => effect.value === undefined
              )
            : undefined,
    [buff, state, data, gains]
  )
  const id = useId()
  return (
    <Box
      sx={{
        display: 'grid',
        // phones: name and number, then source and hits, then what it gives; wider: the hits
        // and the number in columns of their own, the numbers aligned down the list
        gridTemplateColumns: {
          xs: '20px minmax(0, 1fr) auto',
          sm: '20px minmax(0, 1fr) auto 76px',
        },
        gridTemplateAreas: {
          xs: '"check name impact" ". source hits" ". details details"',
          sm: '"check name hits impact" ". source hits impact" ". details details impact"',
        },
        columnGap: 1.25,
        rowGap: 0.375,
        alignItems: 'start',
        px: 1.5,
        py: 1.125,
        borderTop: divider ? hairline : undefined,
        ...rowHoverSx,
        // the hits it is up for: quiet until the row is pointed at (always shown when limited)
        '&:hover .hits-all, &:focus-within .hits-all': {
          color: 'text.secondary',
        },
      }}
    >
      <Checkbox
        id={id}
        size="small"
        checked={on}
        onChange={(_, checked) =>
          onChange(withBuffLimit(attack, buff.ref, checked ? undefined : 0))
        }
        inputProps={{ 'aria-label': t('teamOpt.editor.buffOn', 'Up') }}
        sx={{
          gridArea: 'check',
          p: 0.5,
          m: -0.5,
          mt: -0.375,
          color: 'text.disabled',
          '&.Mui-checked': { color: 'text.secondary' },
          '&:hover': { color: 'text.primary' },
        }}
      />
      {/* (the name ticks it too) */}
      <Typography
        component="label"
        htmlFor={id}
        variant="body2"
        sx={{
          gridArea: 'name',
          fontSize: 13.5,
          fontWeight: 600,
          lineHeight: 1.4,
          cursor: 'pointer',
          // long condition names: two lines, then an ellipsis
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          color: on ? 'text.primary' : 'text.secondary',
          opacity: on ? 1 : 0.75,
        }}
      >
        {buff.states ? (buff.label ?? buff.name) : buff.name}
      </Typography>
      {/* where it comes from: the talent, weapon or artifact set */}
      <Typography
        variant="caption"
        color="text.secondary"
        noWrap
        sx={{
          gridArea: 'source',
          minWidth: 0,
          fontSize: 12,
          lineHeight: 1.5,
          opacity: on ? 0.85 : 0.55,
        }}
      >
        {buff.title}
      </Typography>
      <Box
        sx={{
          gridArea: 'impact',
          justifySelf: 'end',
          textAlign: 'right',
          opacity: on ? 1 : 0.5,
        }}
      >
        {!figures ? null : buff.inactive ? (
          <Typography
            component="span"
            sx={{
              display: 'block',
              fontSize: 12,
              lineHeight: '19px',
              color: 'text.disabled',
              whiteSpace: 'nowrap',
            }}
          >
            {buff.inactive === 'gear'
              ? t('teamOpt.editor.notEquipped', 'not equipped')
              : t('teamOpt.editor.notActive', 'not active')}
          </Typography>
        ) : (
          <ImpactText impact={impact} gains={gains} shared={!!sharedWith} />
        )}
      </Box>
      <Box
        sx={{
          gridArea: 'details',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          columnGap: 0.75,
          rowGap: 0.75,
          minWidth: 0,
          mt: 0.375,
          '&:empty': { display: 'none' },
        }}
      >
        {on && buff.states && (
          <StateSelect
            buff={buff}
            state={state}
            onChange={(value) =>
              onChange(
                withBuffState(
                  attack,
                  buff.ref,
                  value === buff.value ? undefined : value
                )
              )
            }
          />
        )}
        {cappedWithout !== undefined && cappedWithout >= 1 && (
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ flexBasis: '100%', order: 1, fontSize: 12 }}
          >
            {t('teamOpt.editor.critCapped', {
              value: `${+(cappedWithout * 100).toFixed(1)}%`,
              defaultValue:
                'CRIT Rate is {{value}} without it: already over the 100% cap',
            })}
          </Typography>
        )}
        {sharedWith ? (
          // the same effect as a buff above: said once, there
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ fontSize: 12.5 }}
          >
            {t('teamOpt.editor.sharedEffect', 'Needed with')}{' '}
            <Box component="span" sx={{ fontWeight: 600 }}>
              {sharedWith.states
                ? (sharedWith.label ?? sharedWith.name)
                : sharedWith.name}
            </Box>{' '}
            {t('teamOpt.editor.sharedEffectEnd', 'for the same effect')}
          </Typography>
        ) : effects === undefined ? (
          <Skeleton variant="rounded" width={140} height={22} />
        ) : (
          effects.map((effect) => (
            <EffectChip key={effect.key} effect={effect} dim={!on} />
          ))
        )}
      </Box>
      <Box sx={{ gridArea: 'hits', justifySelf: 'end', minWidth: 0 }}>
        {on && <HitsLimit attack={attack} buff={buff} onChange={onChange} />}
      </Box>
    </Box>
  )
}

/** One stat a buff gives, and its value, as a quiet chip: "Charged ATK DMG Bonus +40%" */
function EffectChip({ effect, dim }: { effect: BuffEffect; dim: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.625,
        maxWidth: '100%',
        minHeight: 24,
        px: effect.value !== undefined ? 0.875 : 0,
        py: 0.25,
        borderRadius: tokens.radius.control,
        bgcolor:
          effect.value !== undefined
            ? alpha(giTokens.parchment, 0.045)
            : 'transparent',
        fontSize: 12.5,
        lineHeight: 1.45,
        opacity: dim ? 0.55 : 1,
      }}
    >
      <Box
        component="span"
        sx={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: effect.value !== undefined ? 'nowrap' : 'normal',
          color: 'text.secondary',
        }}
      >
        <ColorText color={effect.variant}>{effect.name}</ColorText>
      </Box>
      {effect.value !== undefined && (
        <Box
          component="span"
          sx={{
            flexShrink: 0,
            fontWeight: 650,
            color: 'text.primary',
            ...numSx,
          }}
        >
          {effect.value}
        </Box>
      )}
    </Box>
  )
}

/** A buff's state during this attack (the rotation's unless changed here) */
function StateSelect({
  buff,
  state,
  onChange,
}: {
  buff: TeamBuff
  state: string
  onChange: (value: string) => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Tooltip
      title={t(
        'teamOpt.editor.stateHint',
        'Its state during this attack. The rotation’s is the one set in Team settings or on the character’s tabs.'
      )}
      placement="top"
      // (not on focus: it would cover the buff's name after a pick)
      disableFocusListener
      enterDelay={400}
      enterNextDelay={400}
    >
      <Select
        size="small"
        value={state}
        renderValue={(v) => buff.states?.find((s) => s.value === v)?.name ?? v}
        onChange={(e) => onChange(e.target.value)}
        inputProps={{
          'aria-label': t('teamOpt.editor.state', 'State during this attack'),
        }}
        sx={(theme) => ({
          maxWidth: '100%',
          height: 26,
          fontSize: 12.5,
          fontWeight: 500,
          borderRadius: tokens.radius.control,
          bgcolor: alpha(giTokens.parchment, 0.03),
          '& .MuiSelect-select': { py: 0, pl: 1, minHeight: 0 },
          '& .MuiSelect-icon': { fontSize: 18, right: 4 },
          '& .MuiOutlinedInput-notchedOutline': {
            borderColor: giTokens.hairlineStrong,
          },
          // a state other than the rotation's: edited, in gold
          ...(state !== buff.value && {
            color: 'primary.main',
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: alpha(theme.palette.primary.main, 0.7),
            },
          }),
        })}
      >
        {buff.states?.map((s) => (
          <MenuItem
            key={s.value}
            value={s.value}
            sx={{ fontSize: '0.8125rem' }}
          >
            {s.name}
            {s.value === buff.value &&
              ` · ${t('teamOpt.editor.rotationState', 'rotation')}`}
          </MenuItem>
        ))}
      </Select>
    </Tooltip>
  )
}

/** The hits the buff is up for: all of them, or the first few (Shenhe's quills, a buff that runs out) */
function HitsLimit({
  attack,
  buff,
  onChange,
}: {
  attack: TeamOptAttack
  buff: TeamBuff
  onChange: (attack: TeamOptAttack) => void
}) {
  const { t } = useTranslation('page_team')
  const limit = limitOf(attack, buff.ref)
  const [editing, setEditing] = useState(false)
  const hint = t(
    'teamOpt.editor.limitHint',
    'Up for the first hits only (e.g. quills). All hits by default.'
  )
  if (limit || editing)
    return (
      <Tooltip title={hint}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.625 }}>
          <NumberInputLazy
            float
            size="small"
            autoFocus={editing && !limit}
            value={limit ? limit.hits : attack.hits}
            onChange={(v) => {
              setEditing(false)
              onChange(
                withBuffLimit(
                  attack,
                  buff.ref,
                  v >= attack.hits ? undefined : Math.max(0, v)
                )
              )
            }}
            inputProps={{
              min: 0,
              max: attack.hits,
              'aria-label': t('teamOpt.editor.limit', 'Hits with this buff'),
              sx: {
                textAlign: 'center',
                width: '2.6em',
                height: 24,
                py: 0,
                fontSize: 12.5,
                fontWeight: 650,
                ...numSx,
              },
            }}
            sx={{
              '& .MuiInputBase-root': { borderRadius: tokens.radius.control },
              '& .MuiOutlinedInput-notchedOutline': {
                borderColor: giTokens.hairlineStrong,
              },
              // limited: edited, in gold
              ...(limit && {
                '& .MuiInputBase-input': { color: 'primary.main' },
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: alpha(giTokens.gold, 0.7),
                },
              }),
            }}
          />
          <Typography
            component="span"
            sx={{ fontSize: 12, color: 'text.secondary', whiteSpace: 'nowrap' }}
          >
            {t('teamOpt.editor.ofHits', {
              hits: formatHits(attack.hits),
              defaultValue: 'of {{hits}} hits',
            })}
          </Typography>
        </Box>
      </Tooltip>
    )
  return (
    <Tooltip title={hint}>
      <ButtonBase
        className="hits-all"
        onClick={() => setEditing(true)}
        aria-label={t('teamOpt.editor.limit', 'Hits with this buff')}
        sx={{
          px: 0.75,
          minHeight: 24,
          mr: -0.75,
          borderRadius: tokens.radius.control,
          fontSize: 12,
          color: 'text.disabled',
          whiteSpace: 'nowrap',
          ...numSx,
          ...quickSx,
          ...focusSx,
          '@media (hover: none)': { color: 'text.secondary' },
          '&&:hover': {
            color: 'text.primary',
            bgcolor: alpha(giTokens.parchment, 0.06),
          },
        }}
      >
        {t('teamOpt.editor.allHitsCount', {
          hits: formatHits(attack.hits),
          defaultValue: 'all {{hits}} hits',
        })}
      </ButtonBase>
    </Tooltip>
  )
}

const perHit = new Intl.NumberFormat('en', { maximumFractionDigits: 0 })
const perHitSmall = new Intl.NumberFormat('en', { maximumFractionDigits: 2 })
/** What a buff adds to a hit, in damage: "+6,527", "−2,176", "+0.42" */
const signedDamage = (value: number) =>
  `${value < 0 ? '−' : '+'}${(Math.abs(value) < 10 ? perHitSmall : perHit).format(Math.abs(value))}`

function ImpactText({
  impact,
  gains,
  shared,
}: {
  impact: BuffImpact | undefined
  /** What the buff changes on the attacker: says why it lowers the attack */
  gains?: StatGain[]
  /** Its effect is a buff's above (they work only together): the same damage, not more */
  shared?: boolean
}) {
  const { t } = useTranslation('page_team')
  if (impact === undefined)
    return (
      <Skeleton variant="rounded" width={48} height={17} sx={{ mt: '1px' }} />
    )
  const ratio = impactRatio(impact)
  const valid = Number.isFinite(impact.on) && Number.isFinite(impact.off)
  const none = !valid || noChange(impact)
  // without it the attack deals nothing (e.g. the Radiance a Stellar-Conduct hit needs)
  const needed = valid && impact.off <= 0 && impact.on > 0
  // A buff that lowers the attack: it trades a stat the attack uses for one it does not (e.g.
  // Valeriy in a Polestar Field: his Electro DMG Increase becomes a Stellar-Conduct one)
  const names = (list: StatGain[]) =>
    list.map((g) => statName(g.key)).join(', ')
  const lowered = gains?.filter((g) => g.value < 0) ?? []
  const raised = gains?.filter((g) => g.value > 0) ?? []
  return (
    <Tooltip
      title={
        shared && !none
          ? t('teamOpt.editor.sharedImpact', {
              with: perHit.format(impact.on),
              without: perHit.format(impact.off),
              defaultValue:
                'It works only together with the buff above: without either one, the same damage is lost ({{with}} per hit with both, {{without}} without). Not extra damage on top.',
            })
          : none
            ? t('teamOpt.editor.noImpact', 'No effect on this attack')
            : !needed && ratio < 0
              ? [
                  t('teamOpt.editor.lowersDetail', {
                    with: perHit.format(impact.on),
                    without: perHit.format(impact.off),
                    defaultValue:
                      'Less damage on this attack with it: {{with}} per hit, {{without}} without.',
                  }),
                  lowered.length &&
                    (raised.length
                      ? t('teamOpt.editor.lowersTrade', {
                          lowered: names(lowered),
                          raised: names(raised),
                          defaultValue:
                            'It lowers {{lowered}} and raises {{raised}}, which this attack does not use.',
                        })
                      : t('teamOpt.editor.lowersStat', {
                          lowered: names(lowered),
                          defaultValue: 'It lowers {{lowered}}.',
                        })),
                  t(
                    'teamOpt.editor.lowersUntick',
                    'Untick it if it is not up during these hits.'
                  ),
                ]
                  .filter(Boolean)
                  .join(' ')
              : needed
                ? t('teamOpt.editor.neededDetail', {
                    with: perHit.format(impact.on),
                    defaultValue:
                      'The attack deals no damage without it: {{with}} per hit with it',
                  })
                : t('teamOpt.editor.impactDetail', {
                    with: perHit.format(impact.on),
                    without: perHit.format(impact.off),
                    defaultValue:
                      'One hit: {{with}} with this buff, {{without}} without',
                  })
      }
    >
      <Typography
        component="span"
        sx={{
          display: 'inline-block',
          minWidth: 44,
          fontSize: 13.5,
          lineHeight: '19px',
          textAlign: 'right',
          whiteSpace: 'nowrap',
          ...numSx,
          color:
            none || shared
              ? 'text.disabled'
              : ratio > 0
                ? 'success.main'
                : 'error.main',
          fontWeight: none ? 400 : 650,
        }}
      >
        {none
          ? '–'
          : needed
            ? t('teamOpt.editor.needed', 'needed')
            : signedDamage(impact.on - impact.off)}
      </Typography>
    </Tooltip>
  )
}

/** A stat a buff gives the attacker, as a chip: "CRIT DMG +24%", "ATK +337.8" */
function gainEffect({ key, value }: StatGain): BuffEffect {
  return {
    key,
    name: statName(key),
    value: signed(value, getUnitStr(key) === '%'),
    variant: KeyMap.getVariant(key) || undefined,
  }
}

/** "+24%", "−20%", "+337.8", "+1,204" */
function signed(value: number, percent: boolean) {
  const sign = value < 0 ? '−' : '+'
  const abs = Math.abs(percent ? value * 100 : value)
  const digits = abs >= 100 ? 0 : 1
  return `${sign}${(+abs.toFixed(digits)).toLocaleString()}${percent ? '%' : ''}`
}

/**
 * One hit of the attack, as the rotation computes it (the buffs as set below): its damage, and
 * every value its formula uses (the talent's multiplier, Total ATK, DMG Bonus, CRIT, the enemy's
 * RES and DEF…), as its tooltip shows them
 */
function HitStats({
  hit,
}: {
  hit: { target: UIData; hit: CalcResult | undefined } | undefined | null
}) {
  const { t } = useTranslation('page_team')
  const { rows, enemy, multipliers, ignoresDef } = useMemo(() => {
    if (!hit?.hit)
      return {
        rows: [] as StatRow[],
        enemy: [] as StatRow[],
        multipliers: [] as number[],
        ignoresDef: false,
      }
    const found = hitFormulaParts(hit.hit)
    // (a value of 0 adds nothing to the hit, an enemy's RES aside)
    const parts = found.parts.filter(
      (part) => part.value !== 0 || isEnemyPart(part)
    )
    const hitParts = parts.filter((part) => !isEnemyPart(part))
    const used = new Set<CalcResult>()
    // The character's stats during this attack (HP, ATK, DEF, EM, ER, CRIT…); where this hit
    // uses its own value (CRIT Rate with the element's), that one, with what it adds up
    const hasDmgBonus = hitParts.some((part) => part.info.path === 'dmg_')
    const rows: StatRow[] = []
    for (const [key, calc] of basicStats(hit.target)) {
      const part = hitParts.find((p) => p.info.path === key)
      if (part) {
        used.add(part)
        rows.push({ key, calc: part, showZero: true })
      } else if (!(hasDmgBonus && key.endsWith('_dmg_')))
        // (an element's DMG Bonus is in the hit's DMG Bonus, with its parts)
        rows.push({
          key,
          calc,
          showZero: key === 'eleMas' || key.endsWith('dmg_') || key === 'heal_',
        })
    }
    // then the rest of what the hit uses (its DMG Bonus, a reaction's, DMG Increase…)
    for (const part of hitParts)
      if (!used.has(part))
        rows.push({ key: `${part.info.path}|${part.value}`, calc: part })
    // The enemy: its level, DEF lowered or ignored, and what that leaves; each RES
    const get = (node: unknown) => hit.target.get(node as never)
    const enemyRows: StatRow[] = [
      { key: 'enemyLevel', calc: get(uiInput.enemy.level), showZero: true },
      { key: 'enemyDefRed_', calc: get(uiInput.total.enemyDefRed_) },
      { key: 'enemyDefIgn_', calc: get(uiInput.total.enemyDefIgn_) },
      ...parts.filter(isEnemyPart).map((part) => ({
        key: `${part.info.path}|${part.value}`,
        calc: part,
        showZero: true,
      })),
    ]
    // reaction damage (a transformative or Stellar-Conduct hit): DEF does not count
    const ignoresDef = parts.some(
      // (its DEF multiplier is 99999999 / (99999999 + DEF): 100% but for a hair)
      (part) => part.info.path === 'enemyDef_multi_' && part.value > 0.9999
    )
    return {
      rows,
      enemy: enemyRows,
      multipliers: found.multipliers,
      ignoresDef,
    }
  }, [hit])
  const context = useMemo(
    () => hit && { data: hit.target, teamData: {} as never },
    [hit]
  )
  const statsHeader = (aside?: ReactNode) => (
    <PanelHeader
      title={t('teamOpt.editor.hitStats', 'Stats for this hit')}
      info={t(
        'teamOpt.editor.hitStatsHint',
        'One hit of this attack with the buffs as they are set: the character’s stats during it, as this hit uses them (CRIT Rate with the element’s, DMG Bonus with the talent’s…), and what each adds up, with where it comes from. The ? on a row shows its formula.'
      )}
      actions={aside}
      sx={sectionHeaderSx}
    />
  )
  if (hit === null) return null
  if (!hit?.hit || !context)
    return (
      <Box>
        {statsHeader()}
        <Box
          sx={{
            ...insetSx,
            p: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
          }}
        >
          {Array.from({ length: 12 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, all alike
            <Skeleton key={i} variant="rounded" height={22} />
          ))}
        </Box>
      </Box>
    )
  return (
    // the rows' formulas (the ? on each) are the attacker's, during this attack
    <DataContext.Provider value={context}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <Box>
          {statsHeader(
            multipliers.length === 1 && (
              <Typography
                component="span"
                sx={{ ...type.label, ...numSx, whiteSpace: 'nowrap' }}
              >
                {t('teamOpt.editor.multiplier', 'Multiplier')}{' '}
                <Box
                  component="span"
                  sx={{ color: 'text.primary', fontWeight: 650 }}
                >
                  {`${+(multipliers[0] * 100).toFixed(1)}%`}
                </Box>
              </Typography>
            )
          )}
          <FieldDisplayList sx={[statListSx, hitRowSx]}>
            <NodeFieldDisplay calcRes={hit.hit} component={ListItem} showZero />
            {rows.map((row) => (
              <StatWithTerms key={row.key} row={row} />
            ))}
          </FieldDisplayList>
        </Box>
        <Box>
          <PanelHeader
            title={t('teamOpt.editor.enemy', 'Enemy')}
            info={t(
              'teamOpt.editor.enemyHint',
              'The enemy this hit lands on: its level, its DEF lowered or ignored (and the DEF multiplier that leaves), and its RES with what lowers it.'
            )}
            actions={
              ignoresDef && (
                // reaction damage: DEF does not count (the why in its tooltip)
                <FieldLabel
                  tip={t(
                    'teamOpt.editor.ignoresDef',
                    'This hit ignores enemy DEF, as reaction damage does.'
                  )}
                >
                  {t('teamOpt.editor.ignoresDefShort', 'Ignores DEF')}
                </FieldLabel>
              )
            }
            sx={sectionHeaderSx}
          />
          <FieldDisplayList sx={statListSx}>
            {enemy.map((row) => (
              <StatWithTerms key={row.key} row={row} />
            ))}
          </FieldDisplayList>
        </Box>
      </Box>
    </DataContext.Provider>
  )
}

/** A row of the hit's stats */
interface StatRow {
  key: string
  calc: CalcResult
  showZero?: boolean
}

/** What the enemy has: its DEF (multiplier, reduction) and its RES */
const isEnemyPart = (part: CalcResult) =>
  /enemy|_res_|resMulti/i.test(part.info.path ?? '')

/** A stat, and under it what it adds up (with where each comes from) */
function StatWithTerms({ row }: { row: StatRow }) {
  const { t } = useTranslation('page_team')
  const uncapped = partUncapped(row.calc)
  const percent = row.calc.info.unit === '%'
  return (
    <>
      <NodeFieldDisplay
        calcRes={row.calc}
        component={ListItem}
        showZero={row.showZero}
      />
      {partTerms(row.calc).map((term, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a sum's terms, in order
        <PartTerm key={i} term={term} />
      ))}
      {/* its terms add up to more (or less) than the hit uses: capped */}
      {uncapped !== undefined && (
        <ListItem className="term" sx={termSx}>
          <Typography color="warning.main" noWrap sx={{ minWidth: 0 }}>
            {t('teamOpt.editor.capped', {
              value: percent
                ? `${+(row.calc.value * 100).toFixed(1)}%`
                : +row.calc.value.toFixed(2),
              defaultValue: 'Capped at {{value}}',
            })}
          </Typography>
          <Typography color="warning.main" sx={termValueSx}>
            {percent
              ? `${+(uncapped * 100).toFixed(1)}%`
              : +uncapped.toFixed(2)}
          </Typography>
        </ListItem>
      )}
    </>
  )
}

/** One term of a part of the hit, under it: its name, where it comes from, its value */
function PartTerm({ term }: { term: CalcResult }) {
  const display = GetCalcDisplay(term)
  return (
    <ListItem className="term" sx={termSx}>
      <Typography color="text.secondary" noWrap sx={{ minWidth: 0 }}>
        {display.name}
      </Typography>
      <Typography color="text.secondary" sx={termValueSx}>
        {display.valueString}
      </Typography>
    </ListItem>
  )
}

/** A term of a stat, under it: indented, quieter */
const termSx = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 1,
  minHeight: '24px !important',
  pl: '30px !important',
  py: '1px !important',
} as const

/** A term's value: in the stats' number column (left of where their ? sits) */
const termValueSx = {
  ...numSx,
  whiteSpace: 'nowrap',
  pr: '21px',
} as const

/**
 * One hit of the attack as it is (`null`: it cannot be computed), and for each buff, from the
 * same team calculations: what it is worth on one hit (the hit with it up, and without it) and
 * what it gives the attacker exactly (its stats with it, against without). Computed in the
 * background, one buff at a time, once the dialog is painted; earlier values stay until they are
 * recomputed. `settled`: every buff is computed for the attack as it is now.
 */
function useAttackStats(
  teamId: string,
  characterKey: CharacterKey,
  attack: TeamOptAttack,
  buffs: TeamBuff[],
  mainStatAssumptionLevel: number,
  onField: CharacterKey,
  active: boolean
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const [teamOpt] = useTeamOpt(teamId)
  const [hit, setHit] = useState<
    { target: UIData; hit: CalcResult | undefined } | null | undefined
  >()
  const [gains, setGains] = useState<Partial<Record<string, StatGain[]>>>({})
  const [impacts, setImpacts] = useState<Partial<Record<string, BuffImpact>>>(
    {}
  )
  const [settledKey, setSettledKey] = useState<string>()
  // (the hit count does not change what a buff adds, relatively)
  const key = JSON.stringify([
    attack.path,
    attack.hitMode,
    attack.reaction,
    attack.infusionAura,
    attack.limits,
    attack.states,
    attack.onField ?? onField,
    attack.bonusStats,
    teamOpt.bonusStats,
    buffs.map((b) => b.key),
  ])
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` stands for `attack` and `buffs`
  useEffect(() => {
    if (!active) return undefined
    let cancelled = false
    // every member's extra buffs: a teammate's can change this attack too
    const bonusStats = teamOptBonusStats(
      teamOpt,
      teamOptMembers(database, teamId).map((m) => m.characterKey)
    )
    const dataOf = (variant: TeamOptAttack) =>
      attackHitData(database, teamId, gender, {
        attack: variant,
        characterKey,
        mainStatAssumptionLevel,
        onField,
        bonusStats,
      })
    const hitValue = (data: ReturnType<typeof dataOf>) =>
      typeof data?.hit?.value === 'number' ? data.hit.value : Number.NaN
    let asIs: ReturnType<typeof dataOf>
    let i = -1
    let timer: ReturnType<typeof setTimeout> | undefined
    const next = () => {
      if (cancelled) return
      if (i < 0) {
        asIs = dataOf(attack)
        setHit(asIs ?? null)
      } else {
        const buff = buffs[i]
        if (!buff) {
          setSettledKey(key)
          return
        }
        // up for every hit: the attack as it is, unless the buff is off or limited there
        const on = limitOf(attack, buff.ref)
          ? dataOf(withBuffLimit(attack, buff.ref, undefined))
          : asIs
        const off = dataOf(withBuffLimit(attack, buff.ref, 0))
        const found = on && off ? statGains(on.target, off.target) : []
        setGains((prev) => ({ ...prev, [buff.key]: found }))
        setImpacts((prev) => ({
          ...prev,
          [buff.key]: { on: hitValue(on), off: hitValue(off) },
        }))
      }
      i++
      timer = setTimeout(next, 0)
    }
    // after the dialog has painted (and its opening transition run): it opens at once
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(next, 120)
    })
    return () => {
      cancelled = true
      cancelAnimationFrame(frame)
      if (timer) clearTimeout(timer)
    }
  }, [
    database,
    teamId,
    gender,
    characterKey,
    key,
    mainStatAssumptionLevel,
    active,
  ])
  return {
    hit,
    gains,
    impacts,
    settled: settledKey === key && buffs.every((b) => impacts[b.key]),
  }
}
