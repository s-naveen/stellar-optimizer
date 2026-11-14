import {
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import { deepClone, layeredAssignment } from '@genshin-optimizer/common/util'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type { TeamOpt, TeamOptAttack } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type {
  KqmPlayed,
  KqmReplayInput,
  SimGear,
  TeamDataOverrides,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  actionFrameDefaults,
  CharacterName,
  type FrameData,
  HEXEREI_CHARACTERS,
  kitModels,
  needsRotationCalculation,
  parseRotation,
  REACTION_NAMES,
  type RotationMember,
  rotationAttacks,
  rotationBuffDefaults,
  rotationCalculation,
  type SimBuffOwner,
  simulateRotationSamples,
} from '@genshin-optimizer/gi/ui'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import TuneIcon from '@mui/icons-material/Tune'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Divider,
  IconButton,
  Snackbar,
  TextField,
  type Theme,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  type ReactNode,
  useCallback,
  useDeferredValue,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { FrameDataPanel, pingToFrames } from './FrameDataPanel'
import { MemberAvatar } from './MemberAvatar'
import { RotationTimeline } from './RotationTimeline'
import {
  DEFAULT_SWAP_FRAMES,
  frameOverrides,
  type RotationTimingSettings,
} from './RotationTiming'
import { focusSx, quickSx, tokens, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

const storageKey = (teamId: string) => `teamOptRotationText_${teamId}`
/** What was typed but not used yet (kept when the writer closes) */
const draftKey = (teamId: string) => `teamOptRotationDraft_${teamId}`
const openerKey = (teamId: string) => `teamOptRotationOpener_${teamId}`
const timingKey = (teamId: string) => `teamOptRotationTiming_${teamId}`
const timingOpenKey = 'teamOpt.timingOpen'
/** Character frame data and ping: the player's own, for every team */
const frameDataKey = 'teamOpt.frameData'
const pingKey = 'teamOpt.pingMs'
/** A placeholder rotation with the team's own members: the supports, then the first member */
export const exampleRotation = (names: string[]) => {
  if (!names.length) return 'Zibai E N1 E N4 Q -> Zibai'
  const [main, ...supports] = names
  if (!supports.length) return `${main} E Q N3 CA N3 CA`
  return [
    ...supports.map((n) => `${n} E Q`),
    `${main} E N3 CA N3 CA`,
    supports[0],
  ].join(' -> ')
}
/** The writer's action words, inserted from the quick row */
const TOKENS: { text: string; key: string; label: string }[] = [
  { text: 'E', key: 'skill', label: 'Elemental Skill (tap)' },
  { text: 'hE', key: 'hold', label: 'Elemental Skill (hold)' },
  { text: 'Q', key: 'burst', label: 'Elemental Burst' },
  { text: 'N3', key: 'normal', label: 'Normal attacks: N1 to N6 hits' },
  { text: 'CA', key: 'charged', label: 'Charged Attack' },
  { text: 'P', key: 'plunge', label: 'Plunging Attack' },
  { text: 'D', key: 'dash', label: 'Dash' },
  { text: 'J', key: 'jump', label: 'Jump' },
  { text: 'W1', key: 'wait', label: 'Wait: W1.5 is 1.5 s' },
  { text: '->', key: 'next', label: 'Next step or another member' },
]

/** The writer's saved state, with a signal so every view of it (the inline field, the writer) follows */
const storageEvent = 'teamOpt.rotationStorage'
function writeStored(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new Event(storageEvent))
}
function subscribeStored(onChange: () => void) {
  window.addEventListener(storageEvent, onChange)
  return () => window.removeEventListener(storageEvent, onChange)
}
function useStored(key: string) {
  return useSyncExternalStore(subscribeStored, () => localStorage.getItem(key))
}
const parseTiming = (raw: string | null): RotationTimingSettings => {
  try {
    const v = JSON.parse(raw ?? '')
    if (v && typeof v === 'object' && v.edits) return v
  } catch {
    // (none saved)
  }
  return { edits: {} }
}
const parseFrameData = (raw: string | null): FrameData => {
  try {
    const v = JSON.parse(raw ?? '')
    if (v && typeof v === 'object') return v
  } catch {
    // (none saved)
  }
  return {}
}

/** The rotation in use, and what was typed since (a draft, kept until it is used or reverted) */
export function useRotationText(teamId: string) {
  const applied = useStored(storageKey(teamId)) ?? ''
  const draft = useStored(draftKey(teamId))
  const text = draft ?? applied
  const setText = useCallback(
    (value: string) =>
      writeStored(draftKey(teamId), value === applied ? null : value),
    [teamId, applied]
  )
  return { applied, text, setText, isDraft: text !== applied }
}

/** The settings the rotation plays with besides its text: opener, timing edits, frame data, ping */
export function useRotationSettings(teamId: string) {
  const opener = useStored(openerKey(teamId)) ?? ''
  const timingRaw = useStored(timingKey(teamId))
  const frameRaw = useStored(frameDataKey)
  const pingMs = Number(useStored(pingKey)) || 0
  const timing = useMemo(() => parseTiming(timingRaw), [timingRaw])
  const frameData = useMemo(() => parseFrameData(frameRaw), [frameRaw])
  const edited =
    !!opener.trim() ||
    pingMs > 0 ||
    timing.swapFrames !== undefined ||
    Object.keys(timing.edits).length > 0 ||
    Object.values(frameData).some((m) => Object.keys(m ?? {}).length > 0)
  return { opener, timing, frameData, pingMs, edited }
}

/** The members' names as the parser matches them (any language) */
export function useMemberNames(members: TeamOptMember[]) {
  const { i18n } = useTranslation('charNames_gen')
  const { gender } = useDBMeta()
  return useMemo(
    () =>
      members.map(({ characterKey }) => ({
        characterKey,
        name: i18n.t(
          `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
        ),
      })),
    [members, gender, i18n]
  )
}

/** The team as the simulation sees it (constellations, elements, the members' sets) */
export function useSimTeam(members: TeamOptMember[]) {
  const database = useDatabase()
  return useMemo(() => simTeamOf(members, database), [members, database])
}
function simTeamOf(members: TeamOptMember[], database: Database) {
  const keys = members.map((m) => m.characterKey)
  return {
    members: keys,
    constellations: Object.fromEntries(
      members.map((m) => [
        m.characterKey,
        (m.isTc
          ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.character
              ?.constellation
          : database.chars.get(m.characterKey)?.constellation) ?? 0,
      ])
    ),
    elements: Object.fromEntries(keys.map((k) => [k, getCharEle(k)])) as never,
    // the members' current sets (for set effects the simulation plays: Thundering Fury)
    gear: Object.fromEntries(
      members.map((m) => {
        const sets: Record<string, number> = {}
        if (m.isTc) {
          const tcSets =
            database.buildTcs.get(m.loadoutDatum.buildTcId)?.artifact.sets ?? {}
          for (const [k, n] of Object.entries(tcSets)) sets[k] = n ?? 0
        } else
          for (const id of Object.values(m.artifactIds)) {
            const setKey = id ? database.arts.get(id)?.setKey : undefined
            if (setKey) sets[setKey] = (sets[setKey] ?? 0) + 1
          }
        const weapon = m.isTc
          ? database.buildTcs.get(m.loadoutDatum.buildTcId)?.weapon
          : database.weapons.get(m.weaponId)
        return [
          m.characterKey,
          { sets, weapon: weapon?.key, refinement: weapon?.refinement },
        ]
      })
    ),
  }
}
/** The team as a simulation plays it: the members' own (`simTeamOf`), or KQM's (`kqmRotationReplay`) */
type SimTeam = {
  members: CharacterKey[]
  constellations: Partial<Record<CharacterKey, number>>
  elements: ReturnType<typeof simTeamOf>['elements']
  gear: Partial<Record<CharacterKey, SimGear>>
}
type Database = ReturnType<typeof useDatabase>

/**
 * The written rotation played frame by frame: its steps, the simulation and each member's attacks
 * (only the buff states that differ from the members' own settings go on the attacks)
 */
export function simulateWritten({
  text,
  opener,
  timing,
  frameData,
  pingMs,
  team,
  names,
  members,
  database,
  teamId,
  gender,
  openerWarning,
  repeats,
  keep,
  samples,
  calculation,
  current,
}: {
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
  pingMs: number
  team: SimTeam
  names: RotationMember[]
  members: TeamOptMember[]
  database: Database
  teamId: string
  gender: GenderKey
  openerWarning: (warning: string) => string
  /** How many times it is played, and which of them count (default: three, the middle one) */
  repeats?: number
  keep?: 'middle' | 'all' | 'last2'
  /** Seeded samples of members with random effects (default 64) */
  samples?: number
  /** The builds the simulation's stats and heals are read from (default: the members' own) */
  calculation?: TeamDataOverrides
  /**
   * A conditional's state where no attack sets it (default: the member's or team's own): the
   * buff states an attack carries are the ones that differ from it
   */
  current?: (owner: SimBuffOwner, path: string[]) => string | undefined
}) {
  if (!text.trim()) return undefined
  const rotation = parseRotation(text, names)
  // the opener: played once before the loop, not counted
  if (opener.trim()) {
    const parsed = parseRotation(opener, names)
    rotation.opener = parsed.steps
    rotation.warnings.push(...parsed.warnings.map(openerWarning))
  }
  if (!rotation.steps.length) return { rotation }
  const sim = simulateRotationSamples(
    {
      ...team,
      calculate: needsRotationCalculation(team.members)
        ? rotationCalculation(database, teamId, gender, calculation)
        : undefined,
      rotation,
      frameOverrides: frameOverrides(rotation, timing.edits),
      swapFrames: timing.swapFrames,
      frameData,
      pingFrames: pingToFrames(pingMs),
      repeats,
      keep,
    },
    samples !== undefined && team.members.some((m) => kitModels[m]?.sampled)
      ? samples
      : undefined
  )
  const own =
    current ??
    ((owner: SimBuffOwner, path: string[]) =>
      ownConditional(database, teamId, members, owner, path))
  return { rotation, sim, own, attacks: rotationAttacks(sim, own) }
}
/** A conditional's state as the member (or the team) has it set */
function ownConditional(
  database: Database,
  teamId: string,
  members: TeamOptMember[],
  owner: SimBuffOwner,
  path: string[]
) {
  const member = members.find((m) => m.characterKey === owner)
  const conditional = (
    owner === 'team'
      ? database.teams.get(teamId)?.conditional
      : member
        ? database.teamChars.get(member.teamCharId)?.conditional
        : undefined
  ) as Record<string, Record<string, string>> | undefined
  return conditional?.[path[0]]?.[path[1]]
}
export type WrittenRotation = NonNullable<ReturnType<typeof simulateWritten>>

/** Rotations played for KQM builds, and the last ones counted (the steady pace, past the start) */
const KQM_REPEATS = 4
const KQM_COUNTED = 2
/**
 * KQM theorycrafting's own play of the written rotation (`KqmRunArgs.replay`), apart from Team
 * optimize's (which plays it with the members' own constellations and gear): at the KQM
 * constellations, with the KQM builds' weapons and sets and their stats, 4 rotations in a row with
 * the last 2 averaged. Past the start, an action that is not ready again in time makes every
 * rotation wait (the second rotation alone can still have it from the start), and two in a row
 * even out a cooldown about a rotation long (one rotation can be a lucky one). Its time is the
 * rotation's time. Nothing written: undefined (the attacks entered are used as they are).
 */
export function kqmRotationReplay({
  database,
  teamId,
  members,
  gender,
  names,
  teamOpt,
}: {
  database: Database
  teamId: string
  members: TeamOptMember[]
  gender: GenderKey
  names: RotationMember[]
  teamOpt: TeamOpt
}): ((input: KqmReplayInput) => KqmPlayed) | undefined {
  const text = localStorage.getItem(storageKey(teamId)) ?? ''
  if (!text.trim()) return undefined
  const common = {
    text,
    opener: localStorage.getItem(openerKey(teamId)) ?? '',
    timing: parseTiming(localStorage.getItem(timingKey(teamId))),
    frameData: parseFrameData(localStorage.getItem(frameDataKey)),
    pingMs: Number(localStorage.getItem(pingKey)) || 0,
    names,
    members,
    database,
    teamId,
    gender,
    openerWarning: (w: string) => w,
  }
  const keys = members.map((m) => m.characterKey)
  const elements = simTeamOf(members, database).elements
  return ({ constellations, gear, overrides }) => {
    // the state where no attack sets one, as KQM counts it: KQM's own weapon and set effects
    // ('' off), else the member's, else the rule's
    const current = (owner: SimBuffOwner, path: string[]) => {
      if (owner !== 'team') {
        const kqm =
          overrides.conditionalOverrides?.[owner]?.[path[0]]?.[path[1]]
        if (kqm !== undefined) return kqm || undefined
      }
      const own = ownConditional(database, teamId, members, owner, path)
      if (own !== undefined || owner === 'team') return own
      const rule = (
        overrides.extraConditionals?.[owner] as
          | Record<string, Record<string, string>>
          | undefined
      )?.[path[0]]?.[path[1]]
      return rule
    }
    const played = simulateWritten({
      ...common,
      team: { members: keys, constellations, elements, gear },
      calculation: overrides,
      current,
      repeats: KQM_REPEATS,
      keep: 'last2',
      // (two rotations kept: fewer samples, as much as the writer's one rotation of 64)
      samples: 32,
    })
    // (written but nothing to play: an error, not the attacks Team optimize played)
    if (!played?.sim || !played.attacks)
      throw new Error(
        'The written rotation has no actions to play. Check the rotation text.'
      )
    // (per rotation: the hits and time of the 2 counted, averaged; members the simulation has no
    // kit for keep the attacks entered for them)
    const attacks = { ...teamOpt.attacks }
    for (const k of keys)
      if (!played.sim.unsupported.includes(k))
        attacks[k] = (played.attacks[k] ?? []).map((a) => ({
          ...a,
          hits: a.hits / KQM_COUNTED,
        }))
    const stalls = Object.entries(played.sim.stalls ?? {})
      .map(([label, frames]) => ({ label, seconds: frames / 60 / KQM_COUNTED }))
      .filter((s) => s.seconds >= 0.3)
      .sort((a, b) => b.seconds - a.seconds)
    return {
      attacks,
      rotationTime:
        Math.round((played.sim.frames / 60 / KQM_COUNTED) * 10) / 10,
      stalls,
    }
  }
}

/** Every member's hits in a played rotation */
export const writtenHits = (result: WrittenRotation) =>
  Object.values(result.attacks ?? {}).reduce(
    (n, attacks) => n + (attacks ?? []).reduce((m, a) => m + (a.hits ?? 1), 0),
    0
  )

/**
 * Uses a played rotation: its buffs on for the team, every member's attacks and the rotation time,
 * the writer's settings saved. Gives back what it replaced, for Undo.
 */
export function applyWritten({
  database,
  teamId,
  members,
  setTeamOpt,
  result,
  text,
  opener,
  timing,
  frameData,
  pingMs,
}: {
  database: Database
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  result: WrittenRotation
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
  pingMs: number
}): WriterUndo | undefined {
  const { sim, own } = result
  if (!sim || !own) return undefined
  const keys = members.map((m) => m.characterKey)
  const before = database.teams.get(teamId)
  const snapshot = {
    teamOpt: before?.teamOpt ? structuredClone(before.teamOpt) : undefined,
    teamConditional: structuredClone(before?.conditional ?? {}),
    charConditionals: Object.fromEntries(
      members.map((m) => [
        m.teamCharId,
        structuredClone(
          database.teamChars.get(m.teamCharId)?.conditional ?? {}
        ),
      ])
    ),
    storage: Object.fromEntries(
      [
        storageKey(teamId),
        draftKey(teamId),
        openerKey(teamId),
        timingKey(teamId),
        frameDataKey,
        pingKey,
      ].map((k) => [k, localStorage.getItem(k)])
    ),
    replaced: Object.values(before?.teamOpt?.attacks ?? {}).some(
      (a) => !!a?.length
    ),
  }
  // The buffs the rotation times go on for the team (at the state they are in for most hits),
  // so Team Optimize lists them on; the attacks outside them turn them off
  const defaults = rotationBuffDefaults(sim).filter(
    (d) => d.owner === 'team' || keys.includes(d.owner)
  )
  for (const d of defaults) {
    if (d.owner === 'team') {
      database.teams.set(teamId, (team) => {
        const values = deepClone(team.conditional ?? {})
        layeredAssignment(values, d.path, d.value)
        team.conditional = values
      })
      continue
    }
    const member = members.find((m) => m.characterKey === d.owner)
    if (!member) continue
    database.teamChars.set(member.teamCharId, (teamChar) => {
      const values = deepClone(teamChar.conditional ?? {})
      layeredAssignment(values, d.path, d.value)
      teamChar.conditional = values
    })
  }
  // Hexerei: with two or more Hexerei members, their Secret Rite effects are on (as in gcsim)
  const hexerei = members.filter((m) =>
    HEXEREI_CHARACTERS.includes(m.characterKey)
  )
  if (hexerei.length >= 2)
    for (const m of hexerei)
      database.teamChars.set(m.teamCharId, (teamChar) => {
        const values = deepClone(teamChar.conditional ?? {})
        layeredAssignment(values, [m.characterKey, 'lockHomework'], 'on')
        teamChar.conditional = values
      })
  const attacks = rotationAttacks(sim, (owner, path) => {
    const d = defaults.find(
      (x) => x.owner === owner && x.path.join('.') === path.join('.')
    )
    return d ? d.value : own(owner, path)
  })
  const seconds = sim.frames / 60
  const unsupported = sim.unsupported
  setTeamOpt((o: TeamOpt) => {
    for (const k of keys)
      if (!unsupported.includes(k)) o.attacks[k] = attacks[k] ?? []
    if (seconds) o.rotationTime = Math.round(seconds * 10) / 10
  })
  writeStored(storageKey(teamId), text)
  writeStored(draftKey(teamId), null)
  writeStored(openerKey(teamId), opener)
  writeStored(timingKey(teamId), JSON.stringify(timing))
  writeStored(frameDataKey, JSON.stringify(frameData))
  writeStored(pingKey, String(pingMs))
  return {
    ...snapshot,
    after: JSON.stringify(database.teams.get(teamId)?.teamOpt?.attacks),
  }
}

/** The state using a rotation changes, to put back with Undo */
interface WriterUndo {
  teamOpt: TeamOpt | undefined
  teamConditional: unknown
  charConditionals: Record<string, unknown>
  storage: Record<string, string | null>
  /** The attacks right after applying: Undo only while they are still these */
  after: string
  /** There was a rotation before (Replace, not Add) */
  replaced: boolean
}
function restoreWriterUndo(
  database: Database,
  teamId: string,
  undo: WriterUndo
) {
  database.teams.set(teamId, (team) => {
    team.teamOpt = undo.teamOpt
    team.conditional = undo.teamConditional as typeof team.conditional
  })
  for (const [id, conditional] of Object.entries(undo.charConditionals))
    database.teamChars.set(id, (teamChar) => {
      teamChar.conditional = conditional as typeof teamChar.conditional
    })
  for (const [key, value] of Object.entries(undo.storage))
    writeStored(key, value)
}

/**
 * "Write rotation": the rotation as players write it ("Zibai E N1 E N4 Q …"), turned into each
 * member's attacks and hits by playing it frame by frame (`simulateRotation`), with the buffs on
 * for the hits they cover. The page writes it inline; this gives the writer dialog (timeline, frame
 * data, opener) and the Undo toast both use.
 */
export function useRotationWriter({
  teamId,
  members,
  setTeamOpt,
}: {
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  const [open, setOpen] = useState(false)
  // what using a rotation replaced: undone for a few seconds, while the attacks are unchanged
  const [undo, setUndo] = useState<WriterUndo>()
  const undoNow = () => {
    if (!undo) return
    if (
      JSON.stringify(database.teams.get(teamId)?.teamOpt?.attacks) ===
      undo.after
    )
      restoreWriterUndo(database, teamId, undo)
    setUndo(undefined)
  }
  const element = (
    <>
      {open && (
        <WriterModal
          teamId={teamId}
          members={members}
          setTeamOpt={setTeamOpt}
          onClose={() => setOpen(false)}
          onApplied={setUndo}
        />
      )}
      <Snackbar
        open={!!undo}
        autoHideDuration={10000}
        onClose={(_, reason) => reason !== 'clickaway' && setUndo(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        ContentProps={{
          sx: (theme) => ({
            bgcolor: theme.palette.contentLight.main,
            color: 'text.primary',
            border: `1px solid ${theme.palette.divider}`,
            boxShadow: '0 10px 30px rgba(0, 0, 0, 0.45)',
            fontWeight: 500,
          }),
        }}
        message={
          undo?.replaced
            ? t('teamOpt.writer.replaced', 'Rotation replaced')
            : t('teamOpt.writer.appliedToast', 'Rotation added')
        }
        action={
          <Button
            size="small"
            onClick={undoNow}
            sx={{ color: 'primary.main', fontWeight: 700 }}
          >
            {t('teamOpt.rotation.undo', 'Undo')}
          </Button>
        }
      />
    </>
  )
  return { openWriter: () => setOpen(true), onApplied: setUndo, element }
}
export type RotationWriterHandle = ReturnType<typeof useRotationWriter>

/**
 * Opens the writer dialog for the rotation written inline: its timeline, frame data and opener
 * (shown once there is a rotation text; reads the saved text itself, so typing re-renders only it)
 */
export function RotationConfigureButton({
  teamId,
  writer,
  disabled,
}: {
  teamId: string
  writer: RotationWriterHandle
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const { edited } = useRotationSettings(teamId)
  // (shown before a rotation is written too: the writer is where one is written)
  return (
    <Tooltip
      arrow
      title={t(
        'teamOpt.writer.configureTip',
        'Timeline, frame data and opener'
      )}
    >
      <span>
        <Button
          size="small"
          variant="outlined"
          color="inherit"
          startIcon={<TuneIcon />}
          onClick={writer.openWriter}
          disabled={disabled}
          sx={{
            color: 'text.secondary',
            borderColor: 'divider',
            whiteSpace: 'nowrap',
            px: 1.25,
            ...quickSx,
            ...focusSx,
            '&:hover': {
              color: 'text.primary',
              borderColor: tokens.hairlineStrong,
            },
            '& .MuiButton-startIcon': { mr: 0.5 },
            '& .MuiButton-startIcon svg': { fontSize: 16 },
          }}
        >
          {t('teamOpt.writer.configure', 'Configure')}
          {edited && (
            <Box
              component="span"
              aria-label={t('teamOpt.timing.edited', 'Timing edited')}
              sx={{
                ml: 0.75,
                width: 6,
                height: 6,
                borderRadius: '50%',
                bgcolor: 'primary.main',
              }}
            />
          )}
        </Button>
      </span>
    </Tooltip>
  )
}

/** Inserts an action word at the cursor, spaced from its neighbours */
export function insertWord(
  el: HTMLTextAreaElement | null,
  text: string,
  word: string,
  setText: (value: string) => void
) {
  const start = el?.selectionStart ?? text.length
  const end = el?.selectionEnd ?? text.length
  const before = text.slice(0, start)
  const after = text.slice(end)
  const pad = before && !/\s$/.test(before) ? ' ' : ''
  const tail = after && !/^\s/.test(after) ? ' ' : ''
  setText(`${before}${pad}${word}${tail}${after}`)
  const caret = before.length + pad.length + word.length + tail.length
  requestAnimationFrame(() => {
    el?.focus()
    el?.setSelectionRange(caret, caret)
  })
}

function WriterModal({
  teamId,
  members,
  setTeamOpt,
  onClose,
  onApplied,
}: {
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  onClose: () => void
  onApplied: (undo: WriterUndo) => void
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  // the rotation in use, and a draft typed since (kept when the writer is closed without using it)
  const { applied, text, setText, isDraft: changed } = useRotationText(teamId)
  const isDraft = changed && !!applied.trim()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const insert = (word: string) =>
    insertWord(inputRef.current, text, word, setText)
  const deferred = useDeferredValue(text)
  const [openerText, setOpenerText] = useState(
    () => localStorage.getItem(openerKey(teamId)) ?? ''
  )
  const deferredOpener = useDeferredValue(openerText)
  const [openerShown, setOpenerShown] = useState(() => !!openerText.trim())
  const [timing, setTiming] = useState(() =>
    parseTiming(localStorage.getItem(timingKey(teamId)))
  )
  const deferredTiming = useDeferredValue(timing)
  const [frameData, setFrameData] = useState(() =>
    parseFrameData(localStorage.getItem(frameDataKey))
  )
  const deferredFrameData = useDeferredValue(frameData)
  const [pingMs, setPingMs] = useState(
    () => Number(localStorage.getItem(pingKey)) || 0
  )
  const deferredPing = useDeferredValue(pingMs)
  const [timingOpen, setTimingOpen] = useState(
    () => localStorage.getItem(timingOpenKey) === 'on'
  )
  const [inspectorTab, setInspectorTab] = useState<'steps' | 'characters'>(
    'steps'
  )
  const [selectedStep, setSelectedStep] = useState<number>()
  const toggleTiming = (force?: boolean) => {
    const next = force ?? !timingOpen
    if (next === timingOpen) return
    localStorage.setItem(timingOpenKey, next ? 'on' : '')
    setTimingOpen(next)
    // (narrow screens: the panel is under the previews, so bring it into view)
    if (next && window.matchMedia('(max-width: 899.95px)').matches)
      requestAnimationFrame(() =>
        document
          .getElementById('rotation-timing')
          ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      )
  }
  const keys = members.map((m) => m.characterKey)

  const team = useSimTeam(members)
  const names = useMemberNames(members)
  // each member's own frame data for every action (shown as the defaults), once the panel opens
  const frameDefaults = useMemo(
    () =>
      timingOpen
        ? Object.fromEntries(
            team.members.map((m) => [m, actionFrameDefaults(team, m)])
          )
        : {},
    [team, timingOpen]
  )

  const result = useMemo(
    () =>
      simulateWritten({
        text: deferred,
        opener: deferredOpener,
        timing: deferredTiming,
        frameData: deferredFrameData,
        pingMs: deferredPing,
        team,
        names,
        members,
        database,
        teamId,
        gender,
        openerWarning: (warning) =>
          t('teamOpt.writer.openerWarning', {
            defaultValue: 'Opener: {{warning}}',
            warning,
          }),
      }),
    // (the members' constellations are read when the text changes)
    [
      deferred,
      deferredTiming,
      deferredFrameData,
      deferredPing,
      deferredOpener,
      t,
      team,
      names,
      members,
      gender,
      database,
      teamId,
    ]
  )
  const timingEdited =
    pingMs > 0 ||
    timing.swapFrames !== undefined ||
    keys.some((k) => Object.keys(frameData[k] ?? {}).length > 0) ||
    (!!result &&
      Object.keys(frameOverrides(result.rotation, timing.edits)).length > 0)

  const seconds = result?.sim ? result.sim.frames / 60 : undefined
  const hadRotation = Object.values(
    database.teams.get(teamId)?.teamOpt?.attacks ?? {}
  ).some((a) => !!a?.length)
  const apply = () => {
    if (!result?.sim) return
    const undo = applyWritten({
      database,
      teamId,
      members,
      setTeamOpt,
      result,
      text,
      opener: openerShown ? openerText : '',
      timing,
      frameData,
      pingMs,
    })
    if (undo) onApplied(undo)
    onClose()
  }

  const overrides = result?.rotation
    ? frameOverrides(result.rotation, timing.edits)
    : {}
  const editedSteps = new Set(Object.keys(overrides).map(Number))
  const warnings = [
    ...new Set([...(result?.sim?.warnings ?? result?.rotation.warnings ?? [])]),
  ]

  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: timingOpen ? 'xl' : 'lg' }}
    >
      <CardThemed>
        {/* title, the timing inspector's toggle, close */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: { xs: 2, sm: 2.5 },
            py: 1.5,
          }}
        >
          <Typography component="h2" sx={{ flexGrow: 1, ...type.section }}>
            {t('teamOpt.writer.title', 'Write rotation')}{' '}
            <InfoTooltipInline
              title={
                <Box sx={{ whiteSpace: 'pre-line' }}>
                  {t(
                    'teamOpt.writer.help',
                    'Who acts, then their actions, steps separated by ->:\nE / tE skill (tap) · hE skill (hold) · Q burst · N1–N6 normal attacks · CA charged · P plunge · D dash · J jump · W1.5 wait 1.5 s · E? Q? only when ready (left out, not waited for)\nEnd with the first member ("-> bina") where the rotation loops.\nFrame data: gcsim and kqmsim (AGPLv3). Mitya: E again within 6 s switches cores. Automatic entry skills are included. Unimplemented actions are listed below.'
                  )}
                </Box>
              }
            />
          </Typography>
          <Button
            size="small"
            color="inherit"
            variant="outlined"
            startIcon={<TuneIcon fontSize="small" />}
            onClick={() => toggleTiming()}
            aria-pressed={timingOpen}
            aria-controls="rotation-timing"
            sx={(theme) => ({
              borderColor: timingOpen
                ? alpha(theme.palette.primary.main, 0.6)
                : 'divider',
              color: timingOpen ? 'primary.main' : 'text.primary',
              bgcolor: timingOpen
                ? alpha(theme.palette.primary.main, 0.1)
                : 'transparent',
              whiteSpace: 'nowrap',
            })}
          >
            {t('teamOpt.frames.button', 'Frame data')}
            {timingEdited && (
              <Box
                component="span"
                title={t('teamOpt.timing.edited', 'Timing edited')}
                sx={{
                  ml: 0.75,
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                }}
              />
            )}
          </Button>
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
            display: 'grid',
            gridTemplateColumns: {
              xs: 'minmax(0, 1fr)',
              md: timingOpen ? 'minmax(0, 1fr) 420px' : 'minmax(0, 1fr)',
            },
            minHeight: 0,
          }}
        >
          <Box
            sx={{
              p: { xs: 1.5, sm: 2.5 },
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              minWidth: 0,
              maxHeight: { md: '76vh' },
              overflowY: { md: 'auto' },
            }}
          >
            {/* the rotation, as text */}
            <TextField
              autoFocus
              multiline
              minRows={2}
              fullWidth
              value={text}
              placeholder={exampleRotation(names.map((n) => n.name))}
              onChange={(e) => setText(e.target.value)}
              inputRef={inputRef}
              inputProps={{
                spellCheck: false,
                'aria-label': t('teamOpt.writer.loop', 'Rotation'),
              }}
              sx={editorSx}
            />
            <WriterQuickRow
              members={members}
              onInsert={insert}
              draft={
                isDraft ? (
                  <Button
                    size="small"
                    color="inherit"
                    onClick={() => setText(applied)}
                    sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}
                  >
                    {t('teamOpt.writer.revert', 'Not used yet · Revert')}
                  </Button>
                ) : undefined
              }
            />
            {openerShown ? (
              <Box
                sx={(theme) => ({
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  pl: 1.25,
                  borderLeft: `2px solid ${alpha(theme.palette.primary.main, 0.5)}`,
                })}
              >
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}
                >
                  {t('teamOpt.writer.opener', 'First rotation only')}
                </Typography>
                <InfoTooltipInline
                  title={t(
                    'teamOpt.writer.openerTip',
                    'Actions played once before the rotation starts looping, like a setup skill (“mitya hE”). They set up cooldowns, summons and auras for the loop but are not counted in its time or damage.'
                  )}
                />
                <TextField
                  fullWidth
                  size="small"
                  value={openerText}
                  placeholder="mitya hE"
                  onChange={(e) => setOpenerText(e.target.value)}
                  inputProps={{
                    spellCheck: false,
                    'aria-label': t(
                      'teamOpt.writer.opener',
                      'First rotation only'
                    ),
                  }}
                  sx={editorSx}
                />
                <Tooltip title={t('teamOpt.writer.removeOpener', 'Remove')}>
                  <IconButton
                    size="small"
                    aria-label={t('teamOpt.writer.removeOpener', 'Remove')}
                    onClick={() => {
                      setOpenerShown(false)
                      setOpenerText('')
                    }}
                  >
                    <CloseIcon sx={{ fontSize: 18 }} />
                  </IconButton>
                </Tooltip>
              </Box>
            ) : (
              <Box>
                <Button
                  size="small"
                  color="inherit"
                  startIcon={<AddIcon fontSize="small" />}
                  onClick={() => setOpenerShown(true)}
                  sx={{ color: 'text.secondary', ml: -0.5 }}
                >
                  {t(
                    'teamOpt.writer.addOpener',
                    'Add a first-rotation-only opener'
                  )}
                </Button>
              </Box>
            )}
            {!!warnings.length && (
              <Box
                role="status"
                sx={(theme) => ({
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 0.25,
                  px: 1.25,
                  py: 0.75,
                  borderRadius: 1.5,
                  bgcolor: alpha(theme.palette.warning.main, 0.08),
                  border: `1px solid ${alpha(theme.palette.warning.main, 0.25)}`,
                })}
              >
                {warnings.map((w) => (
                  <Typography key={w} variant="body2" color="warning.main">
                    {w}
                  </Typography>
                ))}
              </Box>
            )}
            {result?.sim && seconds !== undefined ? (
              <>
                {/* how long it takes, and the frame settings it plays with */}
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'baseline',
                    flexWrap: 'wrap',
                    columnGap: 1.5,
                    rowGap: 0.5,
                    mt: 1,
                  }}
                >
                  <Typography
                    sx={{
                      fontSize: 26,
                      fontWeight: 650,
                      letterSpacing: '-0.02em',
                      lineHeight: 1.1,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {seconds.toFixed(1)}
                    <Box
                      component="span"
                      sx={{ fontSize: 15, fontWeight: 500, ml: 0.5 }}
                    >
                      s
                    </Box>
                  </Typography>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ fontVariantNumeric: 'tabular-nums' }}
                  >
                    {t('teamOpt.writer.oneRotation', 'one rotation')} ·{' '}
                    {result.sim.frames} {t('teamOpt.writer.frames', 'frames')}
                  </Typography>
                  <Box sx={{ flexGrow: 1 }} />
                  <SettingChip
                    label={t('teamOpt.timing.swap', 'Swap time')}
                    value={`${timing.swapFrames ?? DEFAULT_SWAP_FRAMES} f`}
                    edited={timing.swapFrames !== undefined}
                    onClick={() => toggleTiming(true)}
                  />
                  <SettingChip
                    label={t('teamOpt.frames.ping', 'Ping')}
                    value={`${pingMs} ms`}
                    edited={pingMs > 0}
                    onClick={() => toggleTiming(true)}
                  />
                </Box>
                <RotationTimeline
                  members={keys}
                  rotation={result.rotation}
                  sim={result.sim}
                  edited={editedSteps}
                  selected={selectedStep}
                  onSelect={(i) => {
                    setSelectedStep(i)
                    setInspectorTab('steps')
                    toggleTiming(true)
                  }}
                />
                <HitsSummary
                  members={members}
                  attacks={result.attacks}
                  unsupported={result.sim.unsupported}
                />
                {!!result.sim.notes.length && (
                  <Box
                    sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}
                  >
                    {result.sim.notes.map((n) => (
                      <Typography
                        key={n}
                        variant="caption"
                        color="text.secondary"
                      >
                        {n}
                      </Typography>
                    ))}
                  </Box>
                )}
              </>
            ) : (
              <EmptyTimeline />
            )}
          </Box>
          {timingOpen && (
            <Box
              id="rotation-timing"
              component="aside"
              sx={(theme) => ({
                borderLeft: { md: `1px solid ${theme.palette.divider}` },
                borderTop: {
                  xs: `1px solid ${theme.palette.divider}`,
                  md: 'none',
                },
                display: 'flex',
                flexDirection: 'column',
                maxHeight: { md: '76vh' },
                minHeight: 0,
                minWidth: 0,
              })}
            >
              <FrameDataPanel
                members={keys}
                rotation={result?.rotation}
                sim={result?.sim}
                defaults={frameDefaults}
                frameData={frameData}
                setFrameData={setFrameData}
                pingMs={pingMs}
                setPingMs={setPingMs}
                timing={timing}
                setTiming={setTiming}
                tab={inspectorTab}
                setTab={setInspectorTab}
                selectedStep={selectedStep}
                onSelectStep={setSelectedStep}
              />
            </Box>
          )}
        </Box>
        <Divider />
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1,
            px: { xs: 1.5, sm: 2.5 },
            py: 1.5,
          }}
        >
          {timingEdited && (
            <Typography
              variant="caption"
              color="primary.main"
              sx={{ mr: 'auto' }}
            >
              {t('teamOpt.frames.withEdits', 'with your frame data')}
            </Typography>
          )}
          <Button color="secondary" onClick={onClose}>
            {t('teamOpt.runDialog.cancel', 'Cancel')}
          </Button>
          <Button
            variant="contained"
            disabled={!result?.sim}
            onClick={apply}
            sx={result?.sim ? giCtaSx : undefined}
          >
            {hadRotation
              ? t('teamOpt.writer.replace', 'Replace rotation')
              : t('teamOpt.writer.apply', 'Use this rotation')}
          </Button>
        </Box>
      </CardThemed>
    </ModalWrapper>
  )
}

/** The text fields: a code surface (monospace, roomy lines, a gold ring when focused) */
export const editorSx = (theme: Theme) => ({
  '& .MuiInputBase-root': {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: 14.5,
    lineHeight: 1.75,
    bgcolor: theme.palette.contentDark.main,
    borderRadius: 2,
    transition: 'box-shadow .15s',
  },
  '& .MuiOutlinedInput-notchedOutline': {
    borderColor: alpha(theme.palette.text.primary, 0.12),
  },
  '& .MuiInputBase-root:hover .MuiOutlinedInput-notchedOutline': {
    borderColor: alpha(theme.palette.text.primary, 0.24),
  },
  '& .MuiInputBase-root.Mui-focused': {
    boxShadow: `0 0 0 3px ${alpha(theme.palette.primary.main, 0.18)}`,
  },
  '& .MuiInputBase-root.Mui-focused .MuiOutlinedInput-notchedOutline': {
    borderColor: alpha(theme.palette.primary.main, 0.7),
    borderWidth: 1,
  },
  '& textarea::placeholder, & input::placeholder': {
    color: theme.palette.text.secondary,
    opacity: 0.55,
  },
})

/** A frame setting in the summary (opens the timing inspector) */
function SettingChip({
  label,
  value,
  edited,
  onClick,
}: {
  label: string
  value: string
  edited: boolean
  onClick: () => void
}) {
  return (
    <ButtonBase
      onClick={onClick}
      sx={(theme) => ({
        gap: 0.75,
        px: 1,
        py: 0.375,
        borderRadius: 1.25,
        fontSize: 12.5,
        color: 'text.secondary',
        border: `1px solid ${
          edited
            ? alpha(theme.palette.primary.main, 0.5)
            : alpha(theme.palette.text.primary, 0.12)
        }`,
        '&:hover': { color: 'text.primary' },
      })}
    >
      {label}
      <Box
        component="span"
        sx={{
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: edited ? 'primary.main' : 'text.primary',
        }}
      >
        {value}
      </Box>
    </ButtonBase>
  )
}

/** Before a rotation is written: the timeline's frame, empty */
function EmptyTimeline() {
  const { t } = useTranslation('page_team')
  return (
    <Box
      sx={(theme) => ({
        mt: 1,
        height: 150,
        borderRadius: 2,
        border: `1px dashed ${alpha(theme.palette.text.primary, 0.14)}`,
        backgroundImage: `repeating-linear-gradient(90deg, transparent 0 59px, ${alpha(theme.palette.text.primary, 0.05)} 59px 60px)`,
        display: 'grid',
        placeItems: 'center',
      })}
    >
      <Typography variant="body2" color="text.secondary">
        {t('teamOpt.writer.emptyTimeline', 'The rotation plays out here')}
      </Typography>
    </Box>
  )
}

/** Each member's hits in one rotation (what the team's attacks become), compact */
function HitsSummary({
  members,
  attacks,
  unsupported,
}: {
  members: TeamOptMember[]
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>> | undefined
  unsupported: CharacterKey[]
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  return (
    <Box
      sx={{
        display: 'grid',
        gap: 1,
        gridTemplateColumns: {
          xs: 'minmax(0, 1fr)',
          sm: 'repeat(2, minmax(0, 1fr))',
          lg: `repeat(${Math.min(4, members.length)}, minmax(0, 1fr))`,
        },
      }}
    >
      {members.map(({ characterKey }) => {
        const counts = new Map<string, number>()
        for (const a of attacks?.[characterKey] ?? []) {
          const base = a.description ?? a.path.join('.')
          const label = a.reaction
            ? `${base} (${REACTION_NAMES[a.reaction] ?? a.reaction})`
            : base
          counts.set(label, (counts.get(label) ?? 0) + (a.hits ?? 1))
        }
        const total = [...counts.values()].reduce((n, c) => n + c, 0)
        return (
          <Box
            key={characterKey}
            sx={(theme) => ({
              p: 1.25,
              borderRadius: 2,
              bgcolor: alpha(theme.palette.text.primary, 0.025),
              border: `1px solid ${alpha(theme.palette.text.primary, 0.07)}`,
              minWidth: 0,
            })}
          >
            <Box
              sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}
            >
              <MemberAvatar characterKey={characterKey} size={22} />
              <Typography noWrap sx={{ fontSize: 13.5, fontWeight: 650 }}>
                <CharacterName characterKey={characterKey} gender={gender} />
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ ml: 'auto', fontVariantNumeric: 'tabular-nums' }}
              >
                {!kitModels[characterKey]
                  ? t('teamOpt.writer.noKitShort', 'attacks kept')
                  : t('teamOpt.writer.hitCount', {
                      defaultValue: '{{count}} hits',
                      count: Math.round(total * 100) / 100,
                    })}
              </Typography>
            </Box>
            {unsupported.includes(characterKey) ? null : counts.size ? (
              [...counts].map(([label, n]) => (
                <Box
                  key={label}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr) auto',
                    gap: 1,
                    fontSize: 12.5,
                    lineHeight: 1.65,
                  }}
                >
                  <Box
                    component="span"
                    title={label}
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      color: 'text.secondary',
                    }}
                  >
                    {label}
                  </Box>
                  <Box
                    component="span"
                    sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
                  >
                    ×{Math.round(n * 100) / 100}
                  </Box>
                </Box>
              ))
            ) : (
              <Typography variant="caption" color="text.secondary">
                {t('teamOpt.writer.none', 'No hits')}
              </Typography>
            )}
          </Box>
        )
      })}
    </Box>
  )
}

/** (a chip pressed keeps the cursor in the text: it inserts there) */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

/** One row under the writer: the members (insert their name) and the action words */
export function WriterQuickRow({
  members,
  onInsert,
  draft,
}: {
  members: TeamOptMember[]
  onInsert: (word: string) => void
  draft?: ReactNode
}) {
  const { t, i18n } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const chip = (theme: Theme) => ({
    height: 26,
    px: 0.875,
    gap: 0.5,
    borderRadius: 1,
    fontSize: 13,
    color: 'text.secondary',
    border: `1px solid ${alpha(theme.palette.text.primary, 0.12)}`,
    transition: 'color .12s, border-color .12s, background-color .12s',
    '&:hover, &.Mui-focusVisible': {
      color: 'text.primary',
      borderColor: alpha(theme.palette.primary.main, 0.6),
      bgcolor: alpha(theme.palette.primary.main, 0.08),
    },
  })
  return (
    <Box
      sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5 }}
    >
      {members.map(({ characterKey }) => {
        const name = i18n.t(
          `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
        )
        return (
          <Tooltip
            key={characterKey}
            arrow
            title={t('teamOpt.writer.insertMember', 'Insert {{name}}', {
              name,
            })}
          >
            <ButtonBase
              onClick={() => onInsert(name)}
              onMouseDown={keepFocus}
              sx={chip}
            >
              <MemberAvatar characterKey={characterKey} size={18} />
              {name}
            </ButtonBase>
          </Tooltip>
        )
      })}
      <Box
        sx={(theme) => ({
          width: '1px',
          height: 18,
          mx: 0.5,
          bgcolor: alpha(theme.palette.text.primary, 0.12),
        })}
      />
      {TOKENS.map((tok) => (
        <Tooltip
          key={tok.key}
          arrow
          title={t(`teamOpt.writer.token.${tok.key}`, tok.label)}
        >
          <ButtonBase
            onClick={() => onInsert(tok.text)}
            onMouseDown={keepFocus}
            sx={(theme) => ({
              ...chip(theme),
              fontFamily: 'ui-monospace, monospace',
              minWidth: 32,
            })}
          >
            {tok.text}
          </ButtonBase>
        </Tooltip>
      ))}
      {draft && <Box sx={{ ml: 'auto' }}>{draft}</Box>}
    </Box>
  )
}
