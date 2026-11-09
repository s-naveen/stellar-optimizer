import {
  CardThemed,
  ColorText,
  InfoTooltipInline,
  ModalWrapper,
  NumberInputLazy,
  SolidToggleButtonGroup,
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
import type { CalcResult, UIData } from '@genshin-optimizer/gi/uidata'
import { uiInput } from '@genshin-optimizer/gi/wr'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import ContentCopyIcon from '@mui/icons-material/ContentCopy'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import GroupsIcon from '@mui/icons-material/Groups'
import RemoveIcon from '@mui/icons-material/Remove'
import type { Theme } from '@mui/material'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Divider,
  IconButton,
  ListItem,
  MenuItem,
  Select,
  Skeleton,
  ToggleButton,
  Tooltip,
  Typography,
} from '@mui/material'
import type { ReactNode } from 'react'
import { Suspense, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AttackName, useAttackInfo } from './AttackName'
import type { BuffEffect, TeamBuff } from './buffs'
import { buffEffects, useAttackTeamData } from './buffs'
import { extraStatKeys } from './ExtraBuffs'
import { formatHits } from './format'
import { MemberAvatar } from './MemberAvatar'
import { basicStats, listSx } from './ResultDetails'
import { useTeamOpt } from './useTeamOpt'

/** A section's label: small caps, as the result cards' ("FINAL STATS") */
const sectionLabelSx = {
  display: 'block',
  color: 'text.secondary',
  fontSize: '0.6875rem',
  fontWeight: 700,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  lineHeight: 1.6,
  mb: 0.75,
} as const

/** A section's label, with what it is about in a tooltip */
function SectionLabel({
  children,
  info,
}: {
  children: ReactNode
  info?: ReactNode
}) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.75 }}>
      <Typography component="span" sx={{ ...sectionLabelSx, mb: 0 }}>
        {children}
      </Typography>
      {info && <InfoTooltipInline title={info} />}
    </Box>
  )
}

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
  const { hit, gains, impacts, settled } = useAttackStats(
    teamId,
    characterKey,
    attack,
    inUse,
    mainStatAssumptionLevel,
    onField,
    open
  ) // this hit's CRIT Rate before its 100% cap, when capped (a CRIT Rate buff may then add nothing)
  const critUncapped = useMemo(() => {
    if (!hit?.hit) return undefined
    const part = hitFormulaParts(hit.hit).parts.find((p) =>
      p.info.path?.endsWith('critRate_')
    )
    return part && partUncapped(part)
  }, [hit])

  return (
    <ModalWrapper
      open={open}
      onClose={onClose}
      containerProps={{ maxWidth: 'lg' }}
    >
      {/* (its texts load here: the page behind it stays) */}
      <Suspense
        fallback={
          <CardThemed>
            <Skeleton variant="rectangular" height={640} />
          </CardThemed>
        }
      >
        <CardThemed>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 1.5,
              px: { xs: 2, md: 3 },
              pt: 2,
              pb: 1.5,
            }}
          >
            <MemberAvatar characterKey={characterKey} />
            <Box
              sx={{
                flexGrow: 1,
                minWidth: 0,
                // the attack's name leads the dialog
                '& .MuiTypography-body2': { fontSize: '1.0625rem' },
              }}
            >
              <AttackName data={data} path={attack.path} dense />
            </Box>
            <IconButton
              onClick={onClose}
              aria-label={t('teamOpt.editor.close', 'Close')}
            >
              <CloseIcon />
            </IconButton>
          </Box>
          <Divider />
          <Box
            sx={{
              px: { xs: 2, md: 3 },
              py: 2.5,
              display: 'grid',
              gridTemplateColumns: {
                xs: 'minmax(0, 1fr)',
                md: 'minmax(300px, 340px) minmax(0, 1fr)',
              },
              columnGap: 4,
              rowGap: 3,
              alignItems: 'start',
            }}
          >
            {/* the attack: how it hits, and what one hit uses (in view while the buffs scroll) */}
            <Box
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2.5,
                position: { md: 'sticky' },
                top: { md: 16 },
              }}
            >
              <Box>
                <SectionLabel
                  info={t(
                    'teamOpt.editor.hitsHint',
                    'Casts or hits in one rotation; averages like 2.5 are fine.'
                  )}
                >
                  {t('teamOpt.editor.hits', 'Hits per rotation')}
                </SectionLabel>
                <HitsStepper
                  hits={attack.hits}
                  onChange={(hits) =>
                    onChange(clampLimits({ ...attack, hits }))
                  }
                />
              </Box>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5 }}>
                <Box>
                  <Typography component="span" sx={sectionLabelSx}>
                    {t('teamOpt.editor.hitMode', 'Hit')}
                  </Typography>
                  <SolidToggleButtonGroup
                    quiet
                    exclusive
                    size="small"
                    value={hitMode}
                    onChange={(_, v: HitModeKey | null) =>
                      v && onChange({ ...attack, hitMode: v })
                    }
                  >
                    {hitModes.map((mode) => (
                      <ToggleButton key={mode} value={mode}>
                        {t(`teamOpt.hitMode.${mode}`, hitModeDefaults[mode])}
                      </ToggleButton>
                    ))}
                  </SolidToggleButtonGroup>
                </Box>
                {!!reactions.length && (
                  <Box>
                    <Typography component="span" sx={sectionLabelSx}>
                      {t('teamOpt.editor.reaction', 'Reaction')}
                    </Typography>
                    <SolidToggleButtonGroup
                      quiet
                      exclusive
                      size="small"
                      value={attack.reaction ?? ''}
                      onChange={(
                        _,
                        v: AmpReactionKey | AdditiveReactionKey | '' | null
                      ) => {
                        if (v === null) return
                        const { reaction: _r, ...rest } = attack
                        onChange(v ? { ...rest, reaction: v } : rest)
                      }}
                    >
                      <ToggleButton value="">
                        {t('loadout:mTargetEditor.noReaction')}
                      </ToggleButton>
                      {reactions.map((r) => (
                        <ToggleButton key={r} value={r}>
                          {(allAmpReactionKeys as readonly string[]).includes(
                            r
                          ) ? (
                            <AmpReactionModeText
                              reaction={r as AmpReactionKey}
                            />
                          ) : (
                            <AdditiveReactionModeText
                              reaction={r as AdditiveReactionKey}
                            />
                          )}
                        </ToggleButton>
                      ))}
                    </SolidToggleButtonGroup>
                  </Box>
                )}
              </Box>
              {members.length > 1 && (
                <Box>
                  <SectionLabel
                    info={t(
                      'teamOpt.editor.onFieldHint',
                      'Buffs for the active character (e.g. Mitya’s C1) go to whoever is on the field. Pick another member for hits that land while they are, e.g. a skill that keeps hitting after a switch.'
                    )}
                  >
                    {t(
                      'teamOpt.editor.onField',
                      'On the field during these hits'
                    )}
                  </SectionLabel>
                  <SolidToggleButtonGroup
                    quiet
                    exclusive
                    size="small"
                    value={attack.onField ?? onField}
                    onChange={(_, v: CharacterKey | null) => {
                      if (!v) return
                      const { onField: _o, ...rest } = attack
                      onChange(v === onField ? rest : { ...rest, onField: v })
                    }}
                    sx={{ flexWrap: 'wrap' }}
                  >
                    {members.map((m) => (
                      <ToggleButton
                        key={m.characterKey}
                        value={m.characterKey}
                        sx={{ gap: 0.75 }}
                      >
                        <MemberAvatar characterKey={m.characterKey} size={20} />
                        <CharacterName
                          characterKey={m.characterKey}
                          gender={gender}
                        />
                      </ToggleButton>
                    ))}
                  </SolidToggleButtonGroup>
                </Box>
              )}
              <HitStats hit={hit} />
            </Box>
            {/* what changes it: the buffs, and this attack's own extra stats */}
            <Box
              sx={{
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
              }}
            >
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
              <Box>
                <SectionLabel
                  info={t(
                    'teamOpt.editor.extraHint',
                    'Bonus stats for this attack only: a buff the game data does not have, or your own numbers. For the whole rotation, use Extra buffs.'
                  )}
                >
                  {t('teamOpt.editor.extra', 'Extra stats')}
                </SectionLabel>
                <Box sx={{ display: 'grid', gap: 1 }}>
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
          <Divider />
          <Box sx={{ display: 'flex', gap: 1, px: { xs: 2, md: 3 }, py: 1.5 }}>
            <Button
              size="small"
              color="error"
              startIcon={<DeleteOutlineIcon />}
              onClick={onRemove}
            >
              {t('teamOpt.editor.remove', 'Remove')}
            </Button>
            <Button
              size="small"
              color="inherit"
              startIcon={<ContentCopyIcon />}
              onClick={onDuplicate}
              sx={{ color: 'text.secondary' }}
            >
              {t('teamOpt.editor.duplicate', 'Duplicate')}
            </Button>
            <Box sx={{ flexGrow: 1 }} />
            <Button
              size="small"
              variant="contained"
              color="secondary"
              onClick={onClose}
            >
              {t('teamOpt.editor.done', 'Done')}
            </Button>
          </Box>
        </CardThemed>
      </Suspense>
    </ModalWrapper>
  )
}

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

function HitsStepper({
  hits,
  onChange,
}: {
  hits: number
  onChange: (hits: number) => void
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
          sx: { textAlign: 'center', width: '4.5em', fontWeight: 600 },
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

const stepperButtonSx = (theme: Theme) => ({
  border: `1px solid ${alpha(theme.palette.text.primary, 0.16)}`,
  borderRadius: 2,
})

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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Box sx={{ flexGrow: 1, '& > *': { mb: 0 } }}>
          <SectionLabel
            info={t(
              'teamOpt.editor.buffsHint',
              'Each buff shows what it gives and how much more damage this attack deals with it. Untick one that is not up during this attack, pick another of its states, or limit it to the first hits (e.g. Shenhe’s quills).'
            )}
          >
            {t('teamOpt.editor.buffs', 'Buffs during this attack')}
          </SectionLabel>
        </Box>
        {!!inUse.length && (
          <Typography
            component="span"
            sx={{ ...sectionLabelSx, mb: 0, whiteSpace: 'nowrap' }}
          >
            {t('teamOpt.editor.impactHeader', 'Damage on this attack')}
          </Typography>
        )}
      </Box>
      {!buffs.length ? (
        <Typography variant="body2" color="text.secondary">
          {t(
            'teamOpt.editor.noBuffs',
            'No conditional buffs are on in this team. Turn them on in Team settings or on each character’s tabs.'
          )}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
          {groups(shown)}
          {!shown.length && (
            <Typography variant="body2" color="text.secondary">
              {t(
                'teamOpt.editor.allIdle',
                'None of the team’s buffs changes this attack’s damage.'
              )}
            </Typography>
          )}
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
  )
}

/** A group of buffs behind a toggle, closed at first */
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <ButtonBase
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            py: 0.5,
            pr: 1,
            borderRadius: 1,
            color: 'text.secondary',
            fontSize: '0.8125rem',
            fontWeight: 600,
            '&:hover': {
              color: 'text.primary',
              backgroundColor: alpha(theme.palette.text.primary, 0.06),
            },
          })}
        >
          <ExpandMoreIcon
            fontSize="small"
            sx={{
              transform: open ? 'none' : 'rotate(-90deg)',
              transition: 'transform 150ms',
            }}
          />
          {label}
        </ButtonBase>
        {info && <InfoTooltipInline title={info} />}
      </Box>
      {/* a plain conditional render: Collapse around lists has looped before */}
      {open && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, mt: 1 }}>
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
          mb: 0.5,
          color: 'text.secondary',
        }}
      >
        {owner === 'team' ? (
          <GroupsIcon fontSize="small" />
        ) : (
          <MemberAvatar characterKey={owner} size={22} />
        )}
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {owner === 'team' ? (
            t('teamOpt.editor.teamBuffs', 'Team')
          ) : (
            <CharacterName characterKey={owner} gender={gender} />
          )}
        </Typography>
      </Box>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          borderRadius: 2,
          border: (theme) =>
            `1px solid ${alpha(theme.palette.text.primary, 0.1)}`,
        }}
      >
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
  return (
    <Box
      sx={(theme) => ({
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) auto',
        gridTemplateAreas:
          '"check name impact" ". source source" ". details hits"',
        columnGap: 1.25,
        rowGap: 0.25,
        alignItems: 'start',
        px: 1.5,
        py: 1,
        borderTop: divider
          ? `1px solid ${alpha(theme.palette.text.primary, 0.08)}`
          : undefined,
      })}
    >
      <Checkbox
        size="small"
        checked={on}
        onChange={(_, checked) =>
          onChange(withBuffLimit(attack, buff.ref, checked ? undefined : 0))
        }
        inputProps={{ 'aria-label': t('teamOpt.editor.buffOn', 'Up') }}
        sx={{ gridArea: 'check', p: 0.5, m: -0.5, mt: -0.25 }}
      />
      <Typography
        variant="body2"
        sx={{
          gridArea: 'name',
          fontWeight: 600,
          lineHeight: 1.4,
          // long condition names: two lines, then an ellipsis
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
          opacity: on ? 1 : 0.6,
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
          lineHeight: 1.4,
          opacity: on ? 0.8 : 0.5,
        }}
      >
        {buff.title}
      </Typography>
      <Box sx={{ gridArea: 'impact', opacity: on ? 1 : 0.6 }}>
        {buff.inactive ? (
          <Typography
            variant="caption"
            color="text.disabled"
            sx={{ display: 'block', whiteSpace: 'nowrap', lineHeight: 1.8 }}
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
          rowGap: 0.5,
          minWidth: 0,
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
            sx={{ flexBasis: '100%', order: 1 }}
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
          <Typography variant="caption" color="text.secondary">
            {t('teamOpt.editor.sharedEffect', 'Needed with')}{' '}
            <Box component="span" sx={{ fontWeight: 600 }}>
              {sharedWith.states
                ? (sharedWith.label ?? sharedWith.name)
                : sharedWith.name}
            </Box>{' '}
            {t('teamOpt.editor.sharedEffectEnd', 'for the same effect')}
          </Typography>
        ) : effects === undefined ? (
          <Skeleton variant="rounded" width={120} height={22} />
        ) : (
          effects.map((effect) => (
            <EffectChip key={effect.key} effect={effect} dim={!on} />
          ))
        )}
      </Box>
      <Box sx={{ gridArea: 'hits', justifySelf: 'end' }}>
        {on && <HitsLimit attack={attack} buff={buff} onChange={onChange} />}
      </Box>
    </Box>
  )
}

/** One stat a buff gives, and its value: "Charged ATK DMG Bonus 40%" */
function EffectChip({ effect, dim }: { effect: BuffEffect; dim: boolean }) {
  return (
    <Box
      component="span"
      sx={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 0.5,
        maxWidth: '100%',
        fontSize: '0.8125rem',
        lineHeight: 1.5,
        opacity: dim ? 0.55 : 1,
      }}
    >
      <Box
        component="span"
        sx={{
          minWidth: 0,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
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
            fontWeight: 600,
            color: 'text.primary',
            fontVariantNumeric: 'tabular-nums',
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
          fontSize: '0.75rem',
          '& .MuiSelect-select': { py: 0.25, pl: 1 },
          ...(state !== buff.value && {
            '& .MuiOutlinedInput-notchedOutline': {
              borderColor: theme.palette.primary.main,
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
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
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
              sx: { textAlign: 'center', width: '3.2em', py: 0.25 },
            }}
            sx={
              limit
                ? {
                    '& .MuiOutlinedInput-notchedOutline': {
                      borderColor: 'primary.main',
                    },
                  }
                : undefined
            }
          />
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ whiteSpace: 'nowrap' }}
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
        onClick={() => setEditing(true)}
        aria-label={t('teamOpt.editor.limit', 'Hits with this buff')}
        sx={(theme) => ({
          px: 0.75,
          py: 0.25,
          borderRadius: 1,
          fontSize: '0.75rem',
          color: 'text.secondary',
          whiteSpace: 'nowrap',
          '&:hover': {
            color: 'text.primary',
            backgroundColor: alpha(theme.palette.text.primary, 0.06),
          },
        })}
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
    return <Skeleton variant="text" width={44} sx={{ ml: 'auto' }} />
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
        variant="body2"
        sx={{
          minWidth: 44,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums',
          color:
            none || shared
              ? 'text.disabled'
              : ratio > 0
                ? 'success.main'
                : 'error.main',
          fontWeight: none ? 400 : 700,
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
  if (hit === null) return null
  if (!hit?.hit || !context)
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
        {Array.from({ length: 10 }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: placeholders, all alike
          <Skeleton key={i} variant="rounded" height={26} />
        ))}
      </Box>
    )
  return (
    // the rows' formulas (the ? on each) are the attacker's, during this attack
    <DataContext.Provider value={context}>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Box>
          <Box
            sx={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 1,
            }}
          >
            <SectionLabel
              info={t(
                'teamOpt.editor.hitStatsHint',
                'One hit of this attack with the buffs as they are set: the character’s stats during it, as this hit uses them (CRIT Rate with the element’s, DMG Bonus with the talent’s…), and what each adds up, with where it comes from. The ? on a row shows its formula.'
              )}
            >
              {t('teamOpt.editor.hitStats', 'Stats for this hit')}
            </SectionLabel>
            {multipliers.length === 1 && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {t('teamOpt.editor.multiplier', 'Multiplier')}{' '}
                <Box
                  component="span"
                  sx={{ color: 'text.primary', fontWeight: 600 }}
                >
                  {`${+(multipliers[0] * 100).toFixed(1)}%`}
                </Box>
              </Typography>
            )}
          </Box>
          <FieldDisplayList sx={listSx}>
            <NodeFieldDisplay calcRes={hit.hit} component={ListItem} showZero />
            {rows.map((row) => (
              <StatWithTerms key={row.key} row={row} />
            ))}
          </FieldDisplayList>
        </Box>
        <Box>
          <SectionLabel
            info={t(
              'teamOpt.editor.enemyHint',
              'The enemy this hit lands on: its level, its DEF lowered or ignored (and the DEF multiplier that leaves), and its RES with what lowers it.'
            )}
          >
            {t('teamOpt.editor.enemy', 'Enemy')}
          </SectionLabel>
          <FieldDisplayList sx={listSx}>
            {enemy.map((row) => (
              <StatWithTerms key={row.key} row={row} />
            ))}
          </FieldDisplayList>
          {ignoresDef && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ mt: 0.5, px: 1 }}
            >
              {t(
                'teamOpt.editor.ignoresDef',
                'This hit ignores enemy DEF, as reaction damage does.'
              )}
            </Typography>
          )}
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
        <ListItem
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 1,
            pl: '28px !important',
            '& .MuiTypography-root': { fontSize: '0.75rem !important' },
          }}
        >
          <Typography color="warning.main" noWrap sx={{ minWidth: 0 }}>
            {t('teamOpt.editor.capped', {
              value: percent
                ? `${+(row.calc.value * 100).toFixed(1)}%`
                : +row.calc.value.toFixed(2),
              defaultValue: 'Capped at {{value}}',
            })}
          </Typography>
          <Typography
            color="warning.main"
            sx={{
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
              pr: 3.5,
            }}
          >
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
    <ListItem
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        gap: 1,
        // (under its part, indented, quieter)
        pl: '28px !important',
        '& .MuiTypography-root': { fontSize: '0.75rem !important' },
      }}
    >
      <Typography color="text.secondary" noWrap sx={{ minWidth: 0 }}>
        {display.name}
      </Typography>
      <Typography
        color="text.secondary"
        sx={{
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          pr: 3.5,
        }}
      >
        {display.valueString}
      </Typography>
    </ListItem>
  )
}

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
