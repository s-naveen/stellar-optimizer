import {
  aboveBottomBar,
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import { deepClone, layeredAssignment } from '@genshin-optimizer/common/util'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import {
  allArtifactSetKeys,
  charKeyToLocGenderedCharKey,
} from '@genshin-optimizer/gi/consts'
import type {
  RotationDocumentField,
  TeamOpt,
  TeamOptAttack,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { defaultTeamOptKqm, initTeamOpt } from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta, useTeam } from '@genshin-optimizer/gi/db-ui'
import { giCtaSx, giTokens } from '@genshin-optimizer/gi/theme'
import type {
  KqmBuild,
  KqmPlayed,
  KqmReplayInput,
  RotationEnergy,
  RotationTemplate,
  TeamData,
  TeamDataOverrides,
  TeamOptMember,
  TeamOptRunRotation,
} from '@genshin-optimizer/gi/ui'
import {
  actionFrameDefaults,
  CharacterName,
  calculateEnergyRecharge,
  energyFromRotation,
  type FrameData,
  HEXEREI_CHARACTERS,
  isSacrificialWeapon,
  KQM_COUNTED,
  KQM_REPEATS,
  kitModels,
  kqmBurstEvery,
  kqmMemberConstellation,
  kqmSimGear,
  parseFrameData,
  parseTiming,
  perRotation,
  REACTION_NAMES,
  type RotationMember,
  rotationAttacks,
  rotationBuffDefaults,
  type SimHit,
  type SimTeam,
  simTeamOf,
  STEADY_COUNTED,
  STEADY_REPEATS,
  simulateWritten,
  simulateWrittenAsync,
  syncEnergyCalculator,
  teamBurstEvery,
  teamOptMembers,
  templatesForTeam,
  type WrittenRotation,
  withRotationEnergy,
  writtenKqmReplay,
  writtenSeconds,
  replayTeamAttacks,
  writtenWaits,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
import FullscreenExitRoundedIcon from '@mui/icons-material/FullscreenExitRounded'
import FullscreenRoundedIcon from '@mui/icons-material/FullscreenRounded'
import HourglassBottomRoundedIcon from '@mui/icons-material/HourglassBottomRounded'
import TuneIcon from '@mui/icons-material/Tune'
import {
  alpha,
  Box,
  Button,
  ButtonBase,
  Checkbox,
  Dialog,
  Divider,
  IconButton,
  Snackbar,
  type Theme,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
import type { i18n } from 'i18next'
import {
  Fragment,
  type ReactNode,
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { useTranslation } from 'react-i18next'
import { useAttackInfo, variantColor } from './AttackName'
import type { TeamBuff } from './buffs'
import { useTeamBuffs } from './buffs'
import { FrameDataPanel } from './FrameDataPanel'
import { MemberAvatar } from './MemberAvatar'
import { RotationCode } from './RotationCode'
import {
  starterRotation,
  TemplatesButton,
  templateText,
} from './RotationTemplates'
import type { TimelineMoment, TimelinePin } from './RotationTimeline'
import { laneColor, RotationTimeline, SHORT_SCREEN } from './RotationTimeline'
import {
  DEFAULT_SWAP_FRAMES,
  firstRotations,
  frameOverrides,
  RotationsDropdown,
  type RotationTimingSettings,
  STEADY_RANGE,
  timingPing,
} from './RotationTiming'
import { teamQuickTokens, teamSyntaxRows } from './rotationWriterHints'
import {
  TimelineHitStats,
  useMomentFigures,
  useTimelineFigures,
} from './TimelineFigures'
import {
  Disclosure,
  focusSx,
  numSx,
  quickSx,
  Segmented,
  tokens,
  type,
} from './ui'
import type { TeamOptUpdate } from './useTeamOpt'
import { kqmRotationUpdate, kqmRotationView } from './useTeamOpt'

export {
  kqmBurstEvery,
  simulateWritten,
  teamBurstEvery,
  type WrittenRotation,
  writtenSeconds,
  writtenWaits,
} from '@genshin-optimizer/gi/ui'

const storageKey = (teamId: string) => `teamOptRotationText_${teamId}`
const manualAttacksKey = (teamId: string) =>
  `teamOptRotationUseAttacks_${teamId}`
/** What was typed but not used yet (kept when the writer closes) */
const draftKey = (teamId: string) => `teamOptRotationDraft_${teamId}`
const openerKey = (teamId: string) => `teamOptRotationOpener_${teamId}`
/** The opener typed but not used yet (kept when the writer closes, as the rotation's draft) */
const openerDraftKey = (teamId: string) =>
  `teamOptRotationOpenerDraft_${teamId}`
/**
 * The KQM tab's rotation: its saved text, opener and timing under their own keys (the Team
 * optimize tab's are the team's id)
 */
export const kqmRotationId = (teamId: string) => `${teamId}_kqm`
/** The saved rotation's id for a tab: the team's (Team optimize), or `kqmRotationId` */
export const rotationIdOf = (teamId: string, kqm?: unknown) =>
  kqm ? kqmRotationId(teamId) : teamId
/** The KQM tab's rotation set up from Team optimize's the first time (a copy) */
export function copyRotationToKqm(
  database: Database,
  teamId: string,
  /** The members' own constellations (Team optimize's attacks were played at them) */
  own: Partial<Record<CharacterKey, number>>,
  replace = false
) {
  const kqmId = kqmRotationId(teamId)
  // (the copied attacks were played at the members' own constellations: at KQM's, the KQM tab
  // plays the rotation again and says what changed)
  if (replace) {
    writeStored(database, draftKey(kqmId), null)
    writeStored(database, openerDraftKey(kqmId), null)
    writeStored(database, consKey(kqmId), null)
    writeStored(database, copiedKey(kqmId), null)
  }
  if (readStored(database, storageKey(teamId))?.trim()) {
    writeStored(
      database,
      consKey(kqmId),
      readStored(database, consKey(teamId)) ?? JSON.stringify(own)
    )
    writeStored(database, copiedKey(kqmId), '1')
  }
  for (const key of [
    storageKey,
    openerKey,
    timingKey,
    manualAttacksKey,
    playedKey,
  ]) {
    const source = readStored(database, key(teamId))
    if (
      replace ||
      (readStored(database, key(kqmId)) === null && source !== null)
    )
      writeStored(database, key(kqmId), source)
  }
}
/**
 * Team optimize's rotation replaced by the KQM tab's: its text, opener and timing (the caller
 * copies the attacks). A written one is played again at the members' own constellations, which
 * also turns on the buffs it times for the team, and the toast says it was copied.
 */
export function copyRotationFromKqm(database: Database, teamId: string) {
  const kqmId = kqmRotationId(teamId)
  for (const key of [draftKey, openerDraftKey])
    writeStored(database, key(teamId), null)
  for (const key of [
    storageKey,
    openerKey,
    timingKey,
    manualAttacksKey,
    playedKey,
  ])
    writeStored(database, key(teamId), readStored(database, key(kqmId)))
  if (readStored(database, storageKey(kqmId))?.trim()) {
    // (no constellations recorded: the tab plays it again at its own)
    writeStored(database, consKey(teamId), '{}')
    writeStored(database, copiedKey(teamId), '1')
  }
}
/**
 * A written rotation as played, as what records it keeps it (KQM's ER targets): its text with its
 * opener, timing and frame data; empty when none is written
 */
export const playedRotationKey = (
  text: string,
  opener: string,
  timing: RotationTimingSettings,
  frameData: FrameData
) =>
  text.trim()
    ? `${text.trim()}|${JSON.stringify([opener, timing, frameData])}`
    : ''
/** A tab's saved timing settings (rotations counted, the opener's, swap edits) */
export function savedTimingOf(database: Database, rid: string) {
  return parseTiming(readStored(database, timingKey(rid)))
}
/** `playedRotationKey` of a tab's saved rotation */
export function savedPlayedRotationKey(database: Database, rid: string) {
  const manual = readStored(database, manualAttacksKey(rid)) === '1'
  return playedRotationKey(
    manual ? '' : (readStored(database, storageKey(rid)) ?? ''),
    readStored(database, openerKey(rid)) ?? '',
    parseTiming(readStored(database, timingKey(rid))),
    parseFrameData(readStored(database, frameDataKey))
  )
}
/**
 * A tab's written rotation set from outside the writer (a KQM version's): its text and opener,
 * with what was typed, played or copied for the one before forgotten; its timing when given
 */
export function setWrittenRotation(
  database: Database,
  rid: string,
  { text, opener, timing }: { text: string; opener: string; timing?: string }
) {
  for (const key of [
    draftKey,
    openerDraftKey,
    manualAttacksKey,
    playedKey,
    consKey,
    copiedKey,
  ])
    writeStored(database, key(rid), null)
  writeStored(database, storageKey(rid), text)
  writeStored(database, openerKey(rid), opener || null)
  if (timing !== undefined)
    writeStored(database, timingKey(rid), timing || null)
}
/** A tab's saved rotation settings as stored: its text, opener and timing (JSON) */
export function writtenRotationOf(database: Database, rid: string) {
  return {
    text: readStored(database, storageKey(rid)) ?? '',
    opener: readStored(database, openerKey(rid)) ?? '',
    timing: readStored(database, timingKey(rid)) ?? '',
  }
}
/**
 * A tab's saved rotation played and used as "Use this rotation" does, for a team set up outside
 * its page (a KQM version): false when none is written, or it does not play
 */
/**
 * The tab's ER calculator "Burst: Every 2nd / 3rd" (Team optimize's or KQM's), played as its runs
 * play it: those members' Bursts in one of every N rotations
 */
function tabBurstEvery(database: Database, teamId: string, kqm?: boolean) {
  const teamOpt = database.teams.get(teamId)?.teamOpt
  return kqm ? kqmBurstEvery(teamOpt?.kqm) : teamBurstEvery(teamOpt)
}

export function applySavedRotation(
  database: Database,
  teamId: string,
  { kqm, i18n, gender }: { kqm?: boolean; i18n: i18n; gender: GenderKey }
): boolean {
  const rid = rotationIdOf(teamId, kqm)
  const { text, opener } = writtenRotationOf(database, rid)
  if (!text.trim() || readStored(database, manualAttacksKey(rid)) === '1')
    return false
  const timing = parseTiming(readStored(database, timingKey(rid)))
  const frameData = parseFrameData(readStored(database, frameDataKey))
  const members = teamOptMembers(database, teamId)
  const team = simTeamFor(
    members,
    database,
    kqm
      ? (database.teams.get(teamId)?.teamOpt?.kqm ?? defaultTeamOptKqm)
      : undefined
  )
  let result: WrittenRotation | undefined
  try {
    result = simulateWritten({
      kqm,
      text,
      opener,
      timing,
      frameData,
      team,
      names: memberNamesOf(members, i18n, gender),
      members,
      database,
      teamId,
      gender,
      openerWarning: (warning) => warning,
      burstEvery: tabBurstEvery(database, teamId, kqm),
    })
  } catch {
    return false
  }
  if (!result?.sim) return false
  const setStored = (update: TeamOptUpdate) =>
    database.teams.set(teamId, (t) => {
      const draft = structuredClone(t.teamOpt ?? initTeamOpt())
      t.teamOpt = update(draft) ?? draft
    })
  applyWritten({
    database,
    teamId,
    members,
    setTeamOpt: kqm
      ? (update) => setStored(kqmRotationUpdate(update))
      : setStored,
    result,
    text,
    opener,
    timing,
    frameData,
    kqm,
    constellations: team.constellations,
  })
  return true
}
/** Both tabs hold the same rotation: the same written text, opener and timing, or the same attacks */
export function useSameRotations(teamId: string) {
  const kqmId = kqmRotationId(teamId)
  const own = useRotationDocument(teamId)
  const kqm = useRotationDocument(kqmId)
  const teamOpt = useTeam(teamId)?.teamOpt
  return useMemo(() => {
    if (own.text || kqm.text)
      return (
        own.text === kqm.text &&
        own.opener === kqm.opener &&
        own.timing === kqm.timing
      )
    return (
      JSON.stringify(teamOpt?.attacks ?? {}) ===
      JSON.stringify(teamOpt?.kqm?.attacks ?? {})
    )
  }, [own, kqm, teamOpt])
}
/** A tab's written rotation as saved: its text (none when attacks are entered by hand), opener, timing */
function useRotationDocument(rid: string) {
  const text = useStored(storageKey(rid))
  const manual = useStored(manualAttacksKey(rid)) === '1'
  const opener = useStored(openerKey(rid)) ?? ''
  const timing = useStored(timingKey(rid)) ?? ''
  return useMemo(
    () => ({ text: manual ? '' : (text ?? '').trim(), opener, timing }),
    [text, manual, opener, timing]
  )
}
/** The constellations the written rotation was last played at (its tab's: own, or KQM's) */
const consKey = (teamId: string) => `teamOptRotationCons_${teamId}`
/** Set while the KQM tab's rotation is a fresh copy of Team optimize's (its first play says so) */
const copiedKey = (teamId: string) => `teamOptRotationCopied_${teamId}`
const timingKey = (teamId: string) => `teamOptRotationTiming_${teamId}`
/** A fingerprint of the attacks the written rotation was last played into (hand edits change them) */
const playedKey = (teamId: string) => `teamOptRotationPlayed_${teamId}`
function attacksPrint(attacks: unknown) {
  const text = JSON.stringify(attacks)
  let h = 2166136261
  for (let i = 0; i < text.length; i++)
    h = Math.imul(h ^ text.charCodeAt(i), 16777619)
  return `${text.length}:${h >>> 0}`
}
/** A tab's attacks were changed by hand since its written rotation was played into them */
function editedByHand(database: Database, teamId: string, kqm?: boolean) {
  const rid = rotationIdOf(teamId, kqm)
  if (!readStored(database, storageKey(rid))?.trim()) return false
  if (readStored(database, manualAttacksKey(rid)) === '1') return false
  const played = readStored(database, playedKey(rid))
  return (
    played !== null &&
    played !== attacksPrint(scopeAttacks(database, teamId, kqm))
  )
}
/** Whether a tab's attacks were changed by hand since its written rotation was played */
export function useEditedByHand(teamId: string, kqm?: boolean) {
  const rid = rotationIdOf(teamId, kqm)
  const text = useStored(storageKey(rid))
  const manual = useStored(manualAttacksKey(rid)) === '1'
  const played = useStored(playedKey(rid))
  const teamOpt = useTeam(teamId)?.teamOpt
  const attacks = teamOpt && (kqm ? kqmRotationView(teamOpt) : teamOpt).attacks
  return useMemo(
    () =>
      !!text?.trim() &&
      !manual &&
      played !== null &&
      played !== attacksPrint(attacks ?? {}),
    [text, manual, played, attacks]
  )
}
const timingOpenKey = 'teamOpt.timingOpen'
/**
 * Character frame data: the player's own, for every team. (Ping, once its own setting that
 * delayed every action, is now the swap time it gives, in each team's timing.)
 */
const frameDataKey = 'teamOpt.frameData'
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

/** The writer's saved state, with a signal so every view of it (the inline field, the writer) follows */
const storageEvent = 'teamOpt.rotationStorage'
function rotationField(key: string) {
  const match =
    /^teamOptRotation(Text|Draft|Opener|OpenerDraft|Timing|Cons|Copied|Played|UseAttacks)_(.+)$/.exec(
      key
    )
  return match && { field: match[1] as RotationDocumentField, id: match[2]! }
}

/**
 * Drafts as they are typed, saved to the team when the writer closes, the page is left or typing
 * stops for a while: saving one changes the team, which re-renders its whole page, so a keystroke must
 * not save it. Read and followed as if saved.
 */
const pendingDrafts = new Map<
  string,
  { database: Database; value: string | null }
>()
const draftListeners = new Set<() => void>()
let draftTimer: ReturnType<typeof setTimeout> | undefined
const DRAFT_SAVE_MS = 30_000
export function saveDrafts() {
  clearTimeout(draftTimer)
  const drafts = [...pendingDrafts]
  pendingDrafts.clear()
  for (const [key, { database, value }] of drafts) {
    const rotation = rotationField(key)!
    database.teams.setRotationField(rotation.id, rotation.field, value)
  }
}
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', saveDrafts)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saveDrafts()
  })
}
const isDraftField = (rotation: ReturnType<typeof rotationField>) =>
  rotation?.field === 'Draft' || rotation?.field === 'OpenerDraft'

function readStored(database: Database, key: string): string | null {
  const pending = pendingDrafts.get(key)
  if (pending) return pending.value
  const rotation = rotationField(key)
  return rotation
    ? (database.teams.getRotationField(rotation.id, rotation.field) ?? null)
    : (globalThis.localStorage?.getItem(key) ?? null)
}

function writeStored(database: Database, key: string, value: string | null) {
  const rotation = rotationField(key)
  if (rotation && isDraftField(rotation)) {
    pendingDrafts.set(key, { database, value })
    for (const listener of draftListeners) listener()
    clearTimeout(draftTimer)
    draftTimer = setTimeout(saveDrafts, DRAFT_SAVE_MS)
    return
  }
  if (rotation) {
    database.teams.setRotationField(rotation.id, rotation.field, value)
    return
  }
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new Event(storageEvent))
}

/** Saves the rotation's timing settings (the page's Rotations setting writes it directly) */
export function saveRotationTiming(
  database: Database,
  teamId: string,
  timing: RotationTimingSettings
) {
  writeStored(database, timingKey(teamId), JSON.stringify(timing))
}

function useStored(key: string) {
  const database = useDatabase()
  const subscribe = useCallback(
    (onChange: () => void) => {
      const rotation = rotationField(key)
      if (rotation) {
        const unfollow = database.teams.follow(
          rotation.id.replace(/_kqm$/, ''),
          onChange
        )
        if (!isDraftField(rotation)) return unfollow
        draftListeners.add(onChange)
        return () => {
          unfollow()
          draftListeners.delete(onChange)
        }
      }
      window.addEventListener(storageEvent, onChange)
      return () => window.removeEventListener(storageEvent, onChange)
    },
    [database, key]
  )
  return useSyncExternalStore(subscribe, () => readStored(database, key))
}

/**
 * The rotation in use, not what is typed since: for what only plays it (the page, its fight and
 * energy), which then does not re-render on every key typed in the writer
 */
export function useAppliedRotation(teamId: string) {
  const savedText = useStored(storageKey(teamId)) ?? ''
  const useAttacks = useStored(manualAttacksKey(teamId)) === '1'
  return useAttacks ? '' : savedText
}

/**
 * Puts a rotation in the writer as what was typed (a draft, used once it is applied), without the
 * page following the draft (`useRotationText` does)
 */
export function setRotationDraft(
  database: Database,
  rid: string,
  text: string
) {
  const saved = readStored(database, storageKey(rid)) ?? ''
  writeStored(database, draftKey(rid), text === saved ? null : text)
}

/** The rotation in use, and what was typed since (a draft, kept until it is used or reverted) */
export function useRotationText(teamId: string) {
  const database = useDatabase()
  const savedText = useStored(storageKey(teamId)) ?? ''
  const applied = useAppliedRotation(teamId)
  const draft = useStored(draftKey(teamId))
  const text = draft ?? savedText
  const setText = useCallback(
    (value: string) =>
      writeStored(
        database,
        draftKey(teamId),
        value === savedText ? null : value
      ),
    [database, teamId, savedText]
  )
  return { applied, text, setText, isDraft: text !== applied }
}

/** The settings the rotation plays with besides its text: opener, timing (swap) edits, frame data */
export function useRotationSettings(teamId: string) {
  const opener = useStored(openerKey(teamId)) ?? ''
  const timingRaw = useStored(timingKey(teamId))
  const frameRaw = useStored(frameDataKey)
  const timing = useMemo(() => parseTiming(timingRaw), [timingRaw])
  const frameData = useMemo(() => parseFrameData(frameRaw), [frameRaw])
  const edited =
    !!opener.trim() ||
    timing.swapFrames !== undefined ||
    timing.rotations !== undefined ||
    Object.keys(timing.edits).length > 0 ||
    Object.values(frameData).some((m) => Object.keys(m ?? {}).length > 0)
  return { opener, timing, frameData, edited }
}

/** The members' names as the parser matches them (any language) */
export function useMemberNames(members: TeamOptMember[]) {
  const { i18n } = useTranslation('charNames_gen')
  const { gender } = useDBMeta()
  return useMemo(
    () => memberNamesOf(members, i18n, gender),
    [members, gender, i18n]
  )
}
/** `useMemberNames` outside a page */
export function memberNamesOf(
  members: readonly { characterKey: CharacterKey }[],
  i18n: i18n,
  gender: GenderKey
): RotationMember[] {
  return members.map(({ characterKey }) => ({
    characterKey,
    name: i18n.t(
      `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
    ),
  }))
}

/** The team as the simulation sees it (constellations, elements, the members' sets) */
export function useSimTeam(
  members: TeamOptMember[],
  /**
   * KQM theorycrafting's settings: the rotation is then played at its constellations, with none
   * of the members' own weapons or sets (it never uses their builds)
   */
  kqm?: TeamOptKqm,
  /**
   * With KQM: the builds of its result shown on the page, whose weapons and sets the rotation is
   * played with (their effects: Instructor, Noblesse Oblige...); none without a current result
   */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
) {
  const database = useDatabase()
  return useMemo(
    () => simTeamFor(members, database, kqm, kqmBuilds),
    [members, database, kqm, kqmBuilds]
  )
}
/** `useSimTeam` outside a page */
export function simTeamFor(
  members: TeamOptMember[],
  database: Database,
  kqm?: TeamOptKqm,
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
): SimTeam {
  const own = simTeamOf(members, database)
  if (!kqm) return own
  return {
    ...own,
    constellations: Object.fromEntries(
      own.members.map((k) => [k, kqmMemberConstellation(k, kqm)])
    ),
    gear: Object.fromEntries(
      own.members.flatMap((k) => {
        const build = kqmBuilds?.[k]
        return build ? [[k, kqmSimGear(build)]] : []
      })
    ),
  }
}
type Database = ReturnType<typeof useDatabase>

/**
 * KQM theorycrafting's own play of the written rotation (`KqmRunArgs.replay`, see
 * `writtenKqmReplay`), with the KQM tab's saved opener, timing and frame data. Nothing written:
 * undefined (the attacks entered are used as they are).
 */
export function kqmRotationReplay({
  database,
  teamId,
  members,
  gender,
  names,
  teamOpt,
  text: given,
  warnings,
}: {
  database: Database
  teamId: string
  members: TeamOptMember[]
  gender: GenderKey
  names: RotationMember[]
  teamOpt: TeamOpt
  /** Another rotation to play (one constellation's own); absent: the team's written one */
  text?: string
  /** Where each play adds its parser's and simulation's warnings */
  warnings?: string[]
}):
  | ((input: KqmReplayInput) => KqmPlayed & { energy?: RotationEnergy })
  | undefined {
  const kqmId = kqmRotationId(teamId)
  const useAttacks = readStored(database, manualAttacksKey(kqmId)) === '1'
  const text =
    given ?? (useAttacks ? '' : (readStored(database, storageKey(kqmId)) ?? ''))
  return writtenKqmReplay({
    database,
    teamId,
    members,
    gender,
    names,
    teamOpt,
    text,
    opener: useAttacks ? '' : (readStored(database, openerKey(kqmId)) ?? ''),
    timing: parseTiming(
      useAttacks ? null : readStored(database, timingKey(kqmId))
    ),
    frameData: parseFrameData(readStored(database, frameDataKey)),
    warnings,
  })
}

/**
 * Team optimize's written rotation played with the members' own constellations and gear, as KQM's
 * replay plays its own: the ER calculator's inputs as it plays them, and its length (s). Nothing
 * written: undefined.
 */
export function teamRotationEnergy({
  database,
  teamId,
  members,
  gender,
  names,
  team,
  text: given,
  burstEvery: givenBurstEvery,
  saved,
}: {
  database: Database
  teamId: string
  members: TeamOptMember[]
  gender: GenderKey
  names: RotationMember[]
  team: SimTeam
  /** Another rotation to play, with the saved opener and timing; absent: the written one */
  text?: string
  /** Per-member Burst cadence overrides from the ER calculator (e.g. Every 2nd) */
  burstEvery?: Partial<Record<CharacterKey, number>>
  /** Saved rotation settings when already loaded (defaults to reading from storage) */
  saved?: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
}): { energy: RotationEnergy; rotationTime: number } | undefined {
  if (
    given === undefined &&
    readStored(database, manualAttacksKey(teamId)) === '1'
  )
    return undefined
  const text = given ?? readStored(database, storageKey(teamId)) ?? ''
  if (!text.trim()) return undefined
  const burstEvery =
    givenBurstEvery !== undefined
      ? givenBurstEvery
      : teamBurstEvery(database.teams.get(teamId)?.teamOpt)
  const played = simulateWritten({
    text,
    opener: saved?.opener ?? readStored(database, openerKey(teamId)) ?? '',
    timing:
      saved?.timing ?? parseTiming(readStored(database, timingKey(teamId))),
    frameData:
      saved?.frameData ?? parseFrameData(readStored(database, frameDataKey)),
    names,
    members,
    database,
    teamId,
    gender,
    openerWarning: (w: string) => w,
    team,
    repeats: KQM_REPEATS,
    keep: 'last2',
    samples: 32,
    burstEvery,
    sacrificial: false,
  })
  if (!played?.sim || played.sim.frames <= 0) return undefined
  const counted = played.fromStart ?? KQM_COUNTED * (played.loops ?? 1)
  return {
    energy: energyFromRotation(
      played.sim,
      members.map((m) => m.characterKey),
      counted,
      team.constellations
    ),
    rotationTime: Math.round((played.sim.frames / 60 / counted) * 10) / 10,
  }
}

/** The saved rotation to replay for a gear search, with localized member aliases. */
export function teamRunRotation(
  database: Database,
  gender: GenderKey,
  i18n: i18n,
  teamId: string
): TeamOptRunRotation | undefined {
  if (readStored(database, manualAttacksKey(teamId)) === '1') return undefined
  const { text, opener, timing } = writtenRotationOf(database, teamId)
  if (!text.trim()) return undefined
  return {
    text,
    opener,
    timing: parseTiming(timing),
    frameData: parseFrameData(readStored(database, frameDataKey)),
    names: memberNamesOf(teamOptMembers(database, teamId), i18n, gender),
  }
}

/** KQM tab's saved rotation metadata (for running replays inside parallel worker threads). */
export function kqmRunRotation(
  database: Database,
  gender: GenderKey,
  i18n: i18n,
  teamId: string
): TeamOptRunRotation {
  const kqmId = kqmRotationId(teamId)
  const useAttacks = readStored(database, manualAttacksKey(kqmId)) === '1'
  return {
    text: useAttacks ? '' : (readStored(database, storageKey(kqmId)) ?? ''),
    opener: useAttacks ? '' : (readStored(database, openerKey(kqmId)) ?? ''),
    timing: parseTiming(
      useAttacks ? null : readStored(database, timingKey(kqmId))
    ),
    frameData: parseFrameData(readStored(database, frameDataKey)),
    names: memberNamesOf(teamOptMembers(database, teamId), i18n, gender),
  }
}

const timedSetEffects = new Map<
  string,
  Partial<Record<CharacterKey, ReadonlySet<string>>> | undefined
>()
/**
 * A saved rotation's key (its team and attacks): saved settings come back as new objects, a
 * weapon ticked in Weapons too, so the attacks' content stands for them (worked out once each)
 */
const timedKeys = new WeakMap<object, string>()
function timedKey(teamId: string, teamOpt: TeamOpt) {
  let key = timedKeys.get(teamOpt.attacks)
  if (key === undefined) {
    key = `${teamId}|${JSON.stringify(teamOpt.attacks)}`
    timedKeys.set(teamOpt.attacks, key)
  }
  return key
}
/**
 * The set effects (`set.condition`) the written rotation turns on and off for each member, for any
 * set it may wear: in a Team optimize run they follow the rotation, not the member's switches.
 * Undefined without a written rotation. Kept per saved rotation (`timedKey`).
 */
export function teamTimedSetEffects(
  database: Database,
  gender: GenderKey,
  i18n: i18n,
  teamId: string,
  teamOpt: TeamOpt
) {
  const key = timedKey(teamId, teamOpt)
  if (timedSetEffects.has(key)) return timedSetEffects.get(key)
  const rotation = teamRunRotation(database, gender, i18n, teamId)
  const attacks =
    rotation &&
    replayTeamAttacks(database, teamId, gender, teamOpt, rotation, (own) =>
      Object.fromEntries(
        Object.entries(own).map(([k, gear]) => [
          k,
          { ...gear, candidates: { sets: allArtifactSetKeys, weapons: [] } },
        ])
      )
    )
  const timed = attacks && timedRefs(attacks)
  timedSetEffects.set(key, timed)
  // (a few rotations kept: the ones a session goes back and forth between)
  if (timedSetEffects.size > 8)
    timedSetEffects.delete(timedSetEffects.keys().next().value!)
  return timed
}
/** `teamTimedSetEffects`, worked out after the page paints while `enabled` (undefined until then) */
export function useTimedSetEffects(
  teamId: string,
  teamOpt: TeamOpt,
  enabled = true
) {
  const database = useDatabase()
  const { gender } = useDBMeta()
  const { i18n } = useTranslation('charNames_gen')
  const [timed, setTimed] = useState<
    Partial<Record<CharacterKey, ReadonlySet<string>>> | undefined
  >(() => timedSetEffects.get(timedKey(teamId, teamOpt)))
  useEffect(() => {
    if (!enabled) return undefined
    const id = setTimeout(
      () =>
        setTimed(teamTimedSetEffects(database, gender, i18n, teamId, teamOpt)),
      0
    )
    return () => clearTimeout(id)
  }, [database, gender, i18n, teamId, teamOpt, enabled])
  return timed
}
/** Each member's set conditions the attacks decide (states and limits) */
function timedRefs(attacks: TeamOpt['attacks']) {
  const sets = new Set<string>(allArtifactSetKeys)
  const out: Partial<Record<CharacterKey, Set<string>>> = {}
  const add = (
    refs?: readonly { owner: string; path: readonly string[] }[]
  ) => {
    for (const { owner, path } of refs ?? [])
      if (owner !== 'team' && sets.has(path[0] ?? ''))
        (out[owner as CharacterKey] ??= new Set()).add(path.join('.'))
  }
  for (const list of Object.values(attacks))
    for (const a of list ?? []) {
      add(a.states)
      add(a.limits)
      for (const snap of a.statSnapshots ?? []) add(snap.states)
      for (const states of Object.values(a.reactionContributorStates ?? {}))
        add(states)
    }
  return out
}

/** Every member's hits in a played rotation */
export const writtenHits = (result: WrittenRotation) =>
  Object.values(result.attacks ?? {}).reduce(
    (n, attacks) => n + (attacks ?? []).reduce((m, a) => m + (a.hits ?? 1), 0),
    0
  )

/**
 * Uses a played rotation: every member's attacks (with the buffs it times) and the rotation time,
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
  kqm,
  constellations,
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
  /**
   * The KQM tab's rotation (its saved text; `setTeamOpt` is then the tab's, changing its own
   * attacks), not Team optimize's
   */
  kqm?: boolean
  /** The constellations it was played at (a change plays it again: `useRotationWriter`) */
  constellations: Partial<Record<CharacterKey, number>>
}): WriterUndo | undefined {
  const rid = rotationIdOf(teamId, kqm)
  const attacksNow = () => scopeAttacks(database, teamId, kqm)
  const { own } = result
  // (the rotations counted: their buffs, attacks and time, per rotation)
  const sim = result.counted?.sim ?? result.sim
  const rotations = result.counted?.rotations ?? 1
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
        storageKey(rid),
        manualAttacksKey(rid),
        draftKey(rid),
        openerKey(rid),
        timingKey(rid),
        consKey(rid),
        playedKey(rid),
        frameDataKey,
      ].map((k) => [k, readStored(database, k)])
    ),
    replaced: Object.values(attacksNow()).some((a) => !!a?.length),
    handEdits: editedByHand(database, teamId, kqm),
  }
  // The KQM tab's own switches take the buffs the rotation times (at the state they are in for
  // most hits), so it lists them on; the attacks outside them turn them off. Team optimize leaves
  // the team's and members' switches as they are: its attacks carry what the rotation times, and
  // its buff list shows them as from the rotation.
  const defaults = kqm
    ? rotationBuffDefaults(sim).filter(
        (d) => d.owner === 'team' || keys.includes(d.owner)
      )
    : []
  if (kqm)
    setTeamOpt((o) => {
      const settings = (o.kqm ??= { ...defaultTeamOptKqm })
      const teamSwitches = structuredClone(
        settings.teamConditional ?? { resonance: {}, reaction: {} }
      )
      const passives = structuredClone(settings.passives ?? {})
      for (const d of defaults)
        if (d.owner === 'team') layeredAssignment(teamSwitches, d.path, d.value)
        else layeredAssignment((passives[d.owner] ??= {}), d.path, d.value)
      settings.teamConditional = teamSwitches
      settings.passives = passives
    })
  // Hexerei: Witch's Homework is taken as done for each Hexerei member (gcsim's default), so its
  // bonuses apply even alone; their Secret Rite effects still need two (the sheets' tally)
  // (KQM's rules count it already)
  const hexerei = members.filter(
    (m) => !kqm && HEXEREI_CHARACTERS.includes(m.characterKey)
  )
  for (const m of hexerei)
    database.teamChars.set(m.teamCharId, (teamChar) => {
      const values = deepClone(teamChar.conditional ?? {})
      layeredAssignment(values, [m.characterKey, 'lockHomework'], 'on')
      teamChar.conditional = values
    })
  const attacks = perRotation(
    rotationAttacks(sim, (owner, path) => {
      const d = defaults.find(
        (x) => x.owner === owner && x.path.join('.') === path.join('.')
      )
      return d ? d.value : own(owner, path)
    }),
    rotations
  )
  const seconds = sim.frames / 60 / rotations
  const unsupported = sim.unsupported
  const update = (o: TeamOpt) => {
    for (const k of keys)
      if (!unsupported.includes(k)) o.attacks[k] = attacks[k] ?? []
    if (seconds) o.rotationTime = Math.round(seconds * 10) / 10
  }
  // (the setter is the tab's: on the KQM tab it changes KQM's rotation, `kqmRotationUpdate`)
  setTeamOpt(update)
  writeStored(database, storageKey(rid), text)
  writeStored(database, manualAttacksKey(rid), null)
  writeStored(database, draftKey(rid), null)
  writeStored(database, openerKey(rid), opener)
  writeStored(database, openerDraftKey(rid), null)
  writeStored(database, timingKey(rid), JSON.stringify(timing))
  writeStored(database, frameDataKey, JSON.stringify(frameData))
  writeStored(database, consKey(rid), JSON.stringify(constellations))
  const after = attacksNow()
  writeStored(database, playedKey(rid), attacksPrint(after))
  return {
    ...snapshot,
    kqm: !!kqm,
    after: JSON.stringify(after),
  }
}

/** A tab's attacks as saved: Team optimize's, or the KQM tab's own (`kqmRotationView`) */
function scopeAttacks(database: Database, teamId: string, kqm?: boolean) {
  const teamOpt = database.teams.get(teamId)?.teamOpt
  return (teamOpt && (kqm ? kqmRotationView(teamOpt) : teamOpt).attacks) ?? {}
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
  /** Its attacks had been changed by hand since the rotation was played: those changes are gone */
  handEdits: boolean
  /** The KQM tab's rotation */
  kqm: boolean
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
    writeStored(database, key, value)
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
  teamData,
  kqm,
  kqmBuilds,
  kqmBuffs,
  kqmOverrides,
  searchButton,
}: {
  teamId: string
  members: TeamOptMember[]
  setTeamOpt: (update: TeamOptUpdate) => void
  /** The team's data: the names of what the timeline follows */
  teamData?: TeamData
  /**
   * KQM theorycrafting's settings, on its tab: the rotation is previewed at its constellations
   * without the members' own gear, and the timeline shows no damage or stats (those are the
   * members' own builds')
   */
  kqm?: TeamOptKqm
  /** With KQM: the shown result's builds, whose weapon and set effects the preview plays */
  kqmBuilds?: Partial<Record<CharacterKey, KqmBuild>>
  /**
   * With KQM: the shown result's buffs (its builds' weapon and set effects, as KQM counts them):
   * the timeline lists those it does not time (Disenchantment's, on by rule) as on all rotation
   */
  kqmBuffs?: TeamBuff[]
  /** With KQM: the shown result's builds as team data (what each buff gives on the timeline) */
  kqmOverrides?: TeamDataOverrides
  /** A rotation search's button beside the rotation box, from its text (it may replace it) */
  searchButton?: SearchButton
}) {
  const { t } = useTranslation('page_team')
  const database = useDatabase()
  // (whether the writer is open: kept apart from the page, so opening it draws the writer alone)
  const openStore = useMemo(() => writerOpenStore(), [])
  // what using a rotation replaced: undone for a few seconds, while the attacks are unchanged
  const [undo, setUndo] = useState<WriterUndo>()
  // (a rotation played again by itself: what changed, said in the toast instead)
  const [replayed, setReplayed] = useState<string>()
  const setApplied = useCallback((next: WriterUndo | undefined) => {
    setReplayed(undefined)
    setUndo(next)
  }, [])
  // A member's own constellation changed (or a TC build's): the written rotation is played again
  // at the new ones and used, as it would have been written with them (Zibai's C1 fifth Stride),
  // and the toast says what changed
  const { gender } = useDBMeta()
  // (the tab's: the members' own constellations, or KQM's)
  const ownTeam = useSimTeam(members, kqm)
  const names = useMemberNames(members)
  const rid = rotationIdOf(teamId, kqm)
  const appliedText = useAppliedRotation(rid)
  const { opener, timing, frameData } = useRotationSettings(rid)
  const consSig = JSON.stringify(ownTeam.constellations)
  // (another tab's rotation: what was said about this one's goes)
  useEffect(() => setApplied(undefined), [rid, setApplied])
  const isKqm = !!kqm
  // biome-ignore lint/correctness/useExhaustiveDependencies: replay only when the applied rotation or constellations change.
  useEffect(() => {
    const key = consKey(rid)
    if (!appliedText.trim()) return
    const stored = readStored(database, key)
    // (one used before this was kept: taken as used at these constellations)
    if (stored === null) {
      writeStored(database, key, consSig)
      return
    }
    if (stored === consSig) {
      // (a copy at the same constellations: nothing to say)
      writeStored(database, copiedKey(rid), null)
      return
    }
    // (marked as played at these only once it is: a render before then cancels and starts over)
    const id = setTimeout(() => {
      writeStored(database, key, consSig)
      const savedBefore = database.teams.get(teamId)?.teamOpt
      const before =
        savedBefore && (kqm ? kqmRotationView(savedBefore) : savedBefore)
      const beforeAttacks = before?.attacks ?? {}
      const beforeTime = before?.rotationTime
      let result: WrittenRotation | undefined
      try {
        result = simulateWritten({
          kqm: isKqm,
          text: appliedText,
          opener,
          timing,
          frameData,
          team: ownTeam,
          names,
          members,
          database,
          teamId,
          gender,
          openerWarning: (warning) => warning,
          burstEvery: tabBurstEvery(database, teamId, isKqm),
        })
      } catch {
        return
      }
      if (!result?.sim) return
      const next = applyWritten({
        database,
        teamId,
        members,
        setTeamOpt,
        result,
        text: appliedText,
        opener,
        timing,
        frameData,
        kqm: isKqm,
        constellations: ownTeam.constellations,
      })
      if (!next) return
      const saved = database.teams.get(teamId)?.teamOpt
      const after = saved && (kqm ? kqmRotationView(saved) : saved)
      const was = JSON.parse(stored) as Record<string, number>
      const changedCons = members
        .map((m) => m.characterKey)
        .filter((k) => (was[k] ?? 0) !== (ownTeam.constellations[k] ?? 0))
        .map(
          (k) =>
            `${names.find((n) => n.characterKey === k)?.name ?? k} C${was[k] ?? 0}→C${ownTeam.constellations[k] ?? 0}`
        )
      const changes: string[] = []
      const fmt = (v: number | undefined) =>
        v === undefined ? '–' : `${Math.round(v * 10) / 10} s`
      if (Math.abs((beforeTime ?? 0) - (after?.rotationTime ?? 0)) > 0.05)
        changes.push(`${fmt(beforeTime)} → ${fmt(after?.rotationTime)}`)
      for (const m of members) {
        const a = beforeAttacks[m.characterKey]?.length ?? 0
        const b = after?.attacks?.[m.characterKey]?.length ?? 0
        if (a !== b)
          changes.push(
            t('teamOpt.writer.replayedAttacks', {
              defaultValue: '{{name}} {{from}} → {{to}} attacks',
              name:
                names.find((n) => n.characterKey === m.characterKey)?.name ??
                m.characterKey,
              from: a,
              to: b,
            })
          )
      }
      const sameAttacks =
        JSON.stringify(beforeAttacks) === JSON.stringify(after?.attacks ?? {})
      if (sameAttacks && !changes.length) return
      setUndo(next)
      const changed = changes.length
        ? changes.join(' · ')
        : t('teamOpt.writer.replayedHits', 'its hits changed')
      // (the KQM tab's copy of Team optimize's rotation, played at KQM's constellations the first
      // time: nothing was changed by the user)
      const copied = readStored(database, copiedKey(rid)) !== null
      writeStored(database, copiedKey(rid), null)
      setReplayed(
        copied
          ? t(
              isKqm
                ? 'teamOpt.writer.replayedKqm'
                : 'teamOpt.writer.replayedFromKqm',
              {
                defaultValue: isKqm
                  ? 'Rotation copied from Team optimize, played at the KQM constellations ({{cons}}) · {{changes}}'
                  : 'Rotation copied from KQM Theorycrafting, played at your constellations ({{cons}}) · {{changes}}',
                cons: members
                  .map(
                    (m) =>
                      `${names.find((n) => n.characterKey === m.characterKey)?.name ?? m.characterKey} C${ownTeam.constellations[m.characterKey] ?? 0}`
                  )
                  .join(', '),
                changes: changed,
              }
            )
          : t('teamOpt.writer.replayedCons', {
              defaultValue: '{{cons}}: rotation played again · {{changes}}',
              cons: changedCons.join(', '),
              changes: changed,
            })
      )
    }, 0)
    return () => clearTimeout(id)
    // (the rest read as they are when the constellations change)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isKqm, consSig, appliedText, rid])
  const undoNow = () => {
    if (!undo) return
    if (JSON.stringify(scopeAttacks(database, teamId, undo.kqm)) === undo.after)
      restoreWriterUndo(database, teamId, undo)
    setUndo(undefined)
  }
  const element = (
    <>
      <WriterHost
        store={openStore}
        teamId={teamId}
        members={members}
        teamData={teamData}
        kqm={kqm}
        kqmBuilds={kqmBuilds}
        kqmBuffs={kqmBuffs}
        kqmOverrides={kqmOverrides}
        searchButton={searchButton}
        setTeamOpt={setTeamOpt}
        onApplied={setApplied}
      />
      <Snackbar
        open={!!undo}
        autoHideDuration={replayed || undo?.handEdits ? 15000 : 10000}
        onClose={(_, reason) => reason !== 'clickaway' && setApplied(undefined)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        sx={{ bottom: { xs: aboveBottomBar(8), sm: aboveBottomBar(24) } }}
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
          <>
            {replayed ??
              (undo?.replaced
                ? t('teamOpt.writer.replaced', 'Rotation replaced')
                : t('teamOpt.writer.appliedToast', 'Rotation added'))}
            {undo?.handEdits && (
              <Box component="span" sx={{ display: 'block', mt: 0.25 }}>
                {t(
                  'teamOpt.writer.handEditsReplaced',
                  'Your changes to its attacks were replaced.'
                )}
              </Box>
            )}
          </>
        }
        action={
          // (played again for new constellations: nothing to undo, the old attacks are for
          // constellations the team no longer has)
          replayed ? (
            <Button
              size="small"
              onClick={() => setApplied(undefined)}
              sx={{ color: 'primary.main', fontWeight: 700 }}
            >
              {t('teamOpt.writer.replayedOk', 'OK')}
            </Button>
          ) : (
            <Button
              size="small"
              onClick={undoNow}
              sx={{ color: 'primary.main', fontWeight: 700 }}
            >
              {t('teamOpt.rotation.undo', 'Undo')}
            </Button>
          )
        }
      />
    </>
  )
  return {
    /** Whether the writer is open (`useWriterOpen` to follow it) */
    openStore,
    openWriter: openStore.open,
    /** Opens the writer with a template in its boxes (used once the player applies it) */
    openTemplate: openStore.openTemplate,
    onApplied: setApplied,
    element,
    /** The tab's saved rotation (`rotationIdOf`) */
    rid,
  }
}
export type RotationWriterHandle = ReturnType<typeof useRotationWriter>

/** Whether a writer is open, as a store: the page does not draw again when it opens or closes */
function writerOpenStore() {
  let open = false
  let template: RotationTemplate | undefined
  const listeners = new Set<() => void>()
  const set = (next: boolean) => {
    if (next === open) return
    open = next
    for (const l of listeners) l()
  }
  return {
    get: () => open,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    open: () => {
      template = undefined
      set(true)
    },
    openTemplate: (next: RotationTemplate) => {
      template = next
      set(true)
    },
    /** The template it was opened with (until it closes) */
    takeTemplate: () => template,
    close: () => {
      template = undefined
      set(false)
    },
  }
}
type WriterOpenStore = ReturnType<typeof writerOpenStore>

/** Whether the writer is open (drawn again when it opens or closes, not the page around it) */
export function useWriterOpen(writer: Pick<RotationWriterHandle, 'openStore'>) {
  return useSyncExternalStore(writer.openStore.subscribe, writer.openStore.get)
}

/** The writer window, drawn while its store says it is open */
/** `useRotationWriter`'s search button, drawn from the rotation being written */
export type SearchButton = (rotation: {
  text: string
  names: RotationMember[]
  setText: (text: string) => void
  close: () => void
  saved: {
    opener: string
    timing: RotationTimingSettings
    frameData: FrameData
  }
}) => ReactNode

function WriterHost({
  store,
  ...props
}: { store: WriterOpenStore } & Omit<
  Parameters<typeof WriterModal>[0],
  'onClose' | 'takeTemplate'
>) {
  const open = useSyncExternalStore(store.subscribe, store.get)
  return open ? (
    <WriterModal
      {...props}
      takeTemplate={store.takeTemplate}
      onClose={store.close}
    />
  ) : null
}

/**
 * `value` for playing the rotation: at once while a play is quick, once typing pauses when it is
 * slow (`playMs`, the last play's time: a heavy team's play blocks the page for a few hundred ms,
 * too long to run on every key)
 */
function useSettled<T>(value: T, playMs: { current: number }) {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = setTimeout(
      () => startTransition(() => setSettled(value)),
      playMs.current > 50 ? 250 : 0
    )
    return () => clearTimeout(timer)
  }, [value, playMs])
  return settled
}

/**
 * Opens the writer dialog for the rotation written inline: its timeline, frame data and opener
 * (shown once there is a rotation text; reads the saved text itself, so typing re-renders only it)
 */
export function RotationConfigureButton({
  writer,
  disabled,
}: {
  writer: RotationWriterHandle
  disabled?: boolean
}) {
  const { t } = useTranslation('page_team')
  const { edited } = useRotationSettings(writer.rid)
  // (shown before a rotation is written too: the writer is where one is written)
  return (
    <Tooltip
      arrow
      title={
        edited
          ? t(
              'teamOpt.writer.configureEditedTip',
              'Write the rotation and see its timeline, frame data and opener. The dot: it has a first-rotation opener, or timing or frame data you changed.'
            )
          : t(
              'teamOpt.writer.configureTip',
              'Write the rotation and see its timeline, frame data and opener'
            )
      }
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
            height: 30,
            color: 'text.primary',
            borderColor: tokens.hairlineStrong,
            bgcolor: alpha(giTokens.parchment, 0.03),
            whiteSpace: 'nowrap',
            fontSize: 13,
            fontWeight: 600,
            px: 1.25,
            ...quickSx,
            ...focusSx,
            '&:hover': {
              borderColor: alpha(giTokens.parchment, 0.3),
              bgcolor: alpha(giTokens.parchment, 0.06),
            },
            '& .MuiButton-startIcon': { mr: 0.625 },
            '& .MuiButton-startIcon svg': {
              fontSize: 16,
              color: giTokens.gold,
            },
          }}
        >
          {t('teamOpt.writer.configure', 'Write rotation')}
          {edited && (
            <Box
              component="span"
              role="img"
              aria-label={t(
                'teamOpt.timing.edited',
                'Opener, timing or frame data edited'
              )}
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
  teamData,
  kqm,
  kqmBuilds,
  kqmBuffs,
  kqmOverrides,
  searchButton,
  setTeamOpt,
  onClose,
  onApplied,
  takeTemplate,
}: {
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  kqm: TeamOptKqm | undefined
  kqmBuilds: Partial<Record<CharacterKey, KqmBuild>> | undefined
  kqmBuffs: TeamBuff[] | undefined
  kqmOverrides: TeamDataOverrides | undefined
  searchButton: SearchButton | undefined
  setTeamOpt: (update: TeamOptUpdate) => void
  onClose: () => void
  onApplied: (undo: WriterUndo) => void
  /** The template it opens with, if any */
  takeTemplate?: () => RotationTemplate | undefined
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  // a phone in landscape (or a narrow window): the detailed timeline takes the whole screen
  const fullScreen = useMediaQuery(`${SHORT_SCREEN}, (max-width: 700px)`)
  // the rotation in use, and a draft typed since (kept when the writer is closed without using it):
  // the tab's own (Team optimize's, or KQM's)
  const rid = rotationIdOf(teamId, kqm)
  const { applied, text, setText, isDraft: changed } = useRotationText(rid)
  // (what was typed is saved with the team once the writer closes)
  useEffect(() => saveDrafts, [])
  const savedOpener = useStored(openerKey(rid)) ?? ''
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const openerRef = useRef<HTMLTextAreaElement | null>(null)
  // (the last play's time: a slow one waits for typing to pause)
  const playMs = useRef(0)
  const deferred = useSettled(text, playMs)
  const names = useMemberNames(members)
  const memberKeys = useMemo(
    () => members.map((m) => m.characterKey),
    [members]
  )
  const templates = useMemo(() => templatesForTeam(memberKeys), [memberKeys])
  const [startTemplate] = useState(() => takeTemplate?.())
  const [openerText, setOpenerState] = useState(() =>
    startTemplate
      ? templateText(startTemplate.opener ?? '', names)
      : (readStored(database, openerDraftKey(rid)) ??
        readStored(database, openerKey(rid)) ??
        '')
  )
  const setOpenerText = useCallback(
    (value: string) => {
      setOpenerState(value)
      writeStored(
        database,
        openerDraftKey(rid),
        value === (readStored(database, openerKey(rid)) ?? '') ? null : value
      )
    },
    [database, rid]
  )
  const deferredOpener = useSettled(openerText, playMs)
  const [openerShown, setOpenerShown] = useState(() => !!openerText.trim())
  const isDraft = changed || (openerShown ? openerText : '') !== savedOpener
  const revert = () => {
    setText(applied)
    setOpenerText(savedOpener)
    setOpenerShown(!!savedOpener.trim())
  }
  const pickTemplate = (template: RotationTemplate) => {
    setText(templateText(template.text, names))
    setOpenerText(templateText(template.opener ?? '', names))
    setOpenerShown(!!template.opener)
  }
  // (a template chosen on the start screen: its rotation is the draft, used once it is applied)
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, when the writer opens with it
  useEffect(() => {
    if (!startTemplate) return
    setText(templateText(startTemplate.text, names))
    setOpenerText(templateText(startTemplate.opener ?? '', names))
  }, [])
  // the box the quick row inserts into: the one typed in last
  const [target, setTarget] = useState<'loop' | 'opener'>('loop')
  const insert = (word: string) =>
    target === 'opener' && openerShown
      ? insertWord(openerRef.current, openerText, word, setOpenerText)
      : insertWord(inputRef.current, text, word, setText)
  const [syntaxOpen, setSyntaxOpen] = useState(false)
  const [timing, setTiming] = useState(() =>
    parseTiming(readStored(database, timingKey(rid)))
  )
  const deferredTiming = useDeferredValue(timing)
  const [frameData, setFrameData] = useState(() =>
    parseFrameData(readStored(database, frameDataKey))
  )
  const deferredFrameData = useDeferredValue(frameData)
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

  const team = useSimTeam(members, kqm, kqmBuilds)
  const sacHolders = useMemo(
    () =>
      team.members.filter((key) => isSacrificialWeapon(team.gear[key]?.weapon)),
    [team]
  )
  // (the attacks a rotation leaves are the tab's: at the members' own constellations, or KQM's
  // without the shown builds' gear)
  const ownTeam = useSimTeam(members, kqm)
  const figures = !kqm
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

  // (using the rotation closes the writer: the team it changes is not played again before that)
  const closing = useRef(false)
  const lastResult = useRef<ReturnType<typeof simulateWritten>>(undefined)
  const isKqm = !!kqm
  // (members set to Burst every 2nd / 3rd rotation in the tab's ER calculator: played so, as its
  // runs play them)
  const savedTeamOpt = useTeam(teamId)?.teamOpt
  const burstKey = JSON.stringify(
    (kqm ? kqmBurstEvery(kqm) : teamBurstEvery(savedTeamOpt)) ?? {}
  )
  const burstEvery = useMemo(
    () => JSON.parse(burstKey) as Partial<Record<CharacterKey, number>>,
    [burstKey]
  )
  // the window first: the rotation is played once it is open (a play blocks the page for a moment,
  // which would hold the window back and stall its opening)
  const [primed, setPrimed] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => startTransition(() => setPrimed(true)), 200)
    return () => clearTimeout(id)
  }, [])
  // (what the rotation is played with: the preview's, and the whole play's on the timeline)
  const playArgs = useMemo(
    () => ({
      kqm: isKqm,
      text: deferred,
      opener: deferredOpener,
      timing: deferredTiming,
      frameData: deferredFrameData,
      team,
      names,
      members,
      database,
      teamId,
      gender,
      auraTimeline: true,
      openerWarning: (warning: string) =>
        t('teamOpt.writer.openerWarning', {
          defaultValue: 'Opener: {{warning}}',
          warning,
        }),
      burstEvery,
    }),
    // (the members' constellations are read when the text changes)
    [
      isKqm,
      burstEvery,
      deferred,
      deferredTiming,
      deferredFrameData,
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
  const [sacPreview, setSacPreview] = useState<{
    args: typeof playArgs
    result: ReturnType<typeof simulateWritten>
  }>()
  useEffect(() => {
    if (!primed || !sacHolders.length || closing.current) return undefined
    let cancelled = false
    const start = performance.now()
    void simulateWrittenAsync(playArgs, () => cancelled || closing.current)
      .then((played) => {
        if (cancelled || closing.current) return
        playMs.current = performance.now() - start
        lastResult.current = played
        startTransition(() => setSacPreview({ args: playArgs, result: played }))
      })
      .catch(() => {
        if (!cancelled) setSacPreview({ args: playArgs, result: undefined })
      })
    return () => {
      cancelled = true
    }
  }, [primed, playArgs, sacHolders])
  const basicResult = useMemo(() => {
    if (!primed || sacHolders.length) return undefined
    if (closing.current && lastResult.current) return lastResult.current
    const start = performance.now()
    const played = simulateWritten(playArgs)
    playMs.current = performance.now() - start
    lastResult.current = played
    return played
  }, [primed, playArgs, sacHolders])
  const result = sacHolders.length ? sacPreview?.result : basicResult
  // (the moment pinned: the same in the timeline here and in the detailed window)
  const [timelinePin, setTimelinePin] = useState<TimelinePin>()
  const [sacView, setSacView] = useState<'used' | 'skipped'>()
  const [sacEnergyOpen, setSacEnergyOpen] = useState(false)
  // The timeline's rotations: the last one counted, or every one played (the opener before them)
  // so that waits show where they happen. The whole play is played when asked for, in a task of
  // its own after the preview's (never both in one), and is never counted (a single sample: what
  // the timeline shows of the others too)
  const [wholeAsked, setWholeAsked] = useState(false)
  const [whole, setWhole] = useState<ReturnType<typeof simulateWritten>>()
  const repeating = !!result?.counted && result.fromStart === undefined
  useEffect(() => {
    if (!wholeAsked || !repeating || !primed) return undefined
    const id = setTimeout(() => {
      if (closing.current) return
      const played = simulateWritten({
        ...playArgs,
        repeats: STEADY_REPEATS,
        keep: 'play',
        samples: 1,
        timelineOnly: true,
      })
      startTransition(() => setWhole(played))
    }, 0)
    return () => clearTimeout(id)
  }, [wholeAsked, repeating, primed, playArgs])
  const wholeShown = wholeAsked && repeating && !!whole?.sim
  const shown = wholeShown ? whole : result
  const countedSim = result?.counted?.sim ?? result?.sim
  const sacSummary = useMemo(() => {
    if (!countedSim || !sacHolders.length) return []
    const runs = countedSim.samples ?? [{ probability: 1, result: countedSim }]
    return sacHolders.flatMap((key) => {
      let used = 0
      let loops = 0
      for (const { probability, result } of runs) {
        const attempts = (result.optionalSkills ?? []).filter(
          (step) => step.characterKey === key
        )
        loops +=
          probability * new Set(attempts.map((step) => step.rotationStart)).size
        used +=
          probability *
          new Set(
            attempts
              .filter((step) => step.played)
              .map((step) => step.rotationStart)
          ).size
      }
      return loops > 0
        ? [{ key, percent: Math.round((used / loops) * 100) }]
        : []
    })
  }, [countedSim, sacHolders])
  const examples = useMemo(() => {
    const out: Partial<Record<'used' | 'skipped', typeof shownSim>> = {}
    const shownSim = result?.sim
    if (!shownSim || !sacSummary.length) return out
    for (const { result: sample } of shownSim.samples ?? [
      { result: shownSim },
    ]) {
      const attempts = (sample.optionalSkills ?? []).filter((step) =>
        sacHolders.includes(step.characterKey)
      )
      if (attempts.length)
        out[attempts.some((step) => step.played) ? 'used' : 'skipped'] ??=
          sample
    }
    return out
  }, [result, sacSummary, sacHolders])
  const timelineSim =
    (!wholeShown && sacView ? examples[sacView] : undefined) ?? shown?.sim
  const [sacEnergyPreview, setSacEnergyPreview] = useState<{
    args: typeof playArgs
    noReset?: Partial<Record<CharacterKey, number>>
    average?: Partial<Record<CharacterKey, number>>
  }>()
  const sacEnergy =
    sacEnergyPreview?.args === playArgs ? sacEnergyPreview : undefined
  useEffect(() => {
    if (
      !sacEnergyOpen ||
      !countedSim ||
      !sacSummary.length ||
      sacPreview?.args !== playArgs
    )
      return undefined
    const active = countedSim
    let cancelled = false
    const compare = async () => {
      const noReset = await simulateWrittenAsync(
        {
          ...playArgs,
          sacrificial: false,
          auraTimeline: false,
          timelineOnly: true,
        },
        () => cancelled
      )
      if (!noReset?.sim) return undefined
      const source = database.teams.get(teamId)?.teamOpt
      const saved = isKqm
        ? source?.kqm?.energyCalculator
        : source?.energyCalculator
      const rotations = result?.counted?.rotations ?? result?.fromStart ?? 1
      const weapons = Object.fromEntries(
        team.members.map((key) => [key, team.gear[key]?.weapon])
      )
      const refinements = Object.fromEntries(
        team.members.map((key) => [key, team.gear[key]?.refinement])
      )
      const sets = Object.fromEntries(
        team.members.map((key) => [key, team.gear[key]?.sets])
      )
      const estimate = async (sim: NonNullable<typeof countedSim>) => {
        const targets: Partial<Record<CharacterKey, number>> = {}
        const unavailable = new Set<CharacterKey>()
        const runs = sim.samples ?? [{ probability: 1, result: sim }]
        let frame = performance.now()
        for (const { probability, result: run } of runs) {
          if (performance.now() - frame >= 10) {
            await new Promise((resolve) => setTimeout(resolve, 0))
            if (cancelled) return {}
            frame = performance.now()
          }
          const seconds = run.frames / 60 / rotations
          if (seconds <= 0) return {}
          const calc = withRotationEnergy(
            {
              ...syncEnergyCalculator(
                team.members,
                saved,
                seconds,
                source?.onField ?? team.members[0],
                team.constellations
              ),
              rotationTime: seconds,
            },
            team.members,
            energyFromRotation(
              run,
              team.members,
              rotations,
              team.constellations
            )
          )
          const current = calculateEnergyRecharge(
            team.members,
            calc,
            weapons,
            refinements,
            sets
          )
          for (const key of team.members) {
            const value = current.targets[key]
            if (value === undefined || !Number.isFinite(value)) {
              unavailable.add(key)
              continue
            }
            targets[key] = (targets[key] ?? 0) + probability * value
          }
        }
        for (const key of unavailable) delete targets[key]
        return targets
      }
      return {
        noReset: await estimate(noReset.counted?.sim ?? noReset.sim),
        average: await estimate(active),
      }
    }
    void compare()
      .then((scores) => {
        if (cancelled) return
        startTransition(() =>
          setSacEnergyPreview({ args: playArgs, ...scores })
        )
      })
      .catch(() => {
        if (!cancelled) setSacEnergyPreview({ args: playArgs })
      })
    return () => {
      cancelled = true
    }
  }, [
    sacEnergyOpen,
    countedSim,
    sacSummary,
    sacPreview,
    playArgs,
    database,
    teamId,
    isKqm,
    team,
    result,
  ])
  const rotationsControl = useMemo(
    () =>
      repeating ? (
        <Segmented
          size="small"
          aria-label={t('teamOpt.timeline.rotationsShown', 'Rotations shown')}
          value={wholeAsked ? 'all' : 'last'}
          onChange={(value) => {
            // (a pinned moment is the other play's)
            setTimelinePin(undefined)
            setWholeAsked(value === 'all')
            if (value !== 'all') setWhole(undefined)
          }}
          options={[
            {
              value: 'last',
              label: t('teamOpt.timeline.lastRotation', 'Last rotation'),
            },
            {
              value: 'all',
              label: t('teamOpt.timeline.allRotations', 'All rotations'),
              tip: t(
                'teamOpt.timeline.allRotationsTip',
                'Every rotation played, the opener first: waits show where they happen. The ones counted are marked.'
              ),
            },
          ]}
        />
      ) : undefined,
    [repeating, wholeAsked, t]
  )
  // the detailed timeline's window
  const [detailOpen, setDetailOpen] = useState(false)
  // (the detailed window over the whole screen: always on a small one, else when asked)
  const [detailFull, setDetailFull] = useState(false)
  const detailFullScreen = fullScreen || detailFull
  // (what both timelines, the writer's and the detailed window's, are given)
  const timelineProps = (
    rotation: NonNullable<typeof result>['rotation'],
    sim: NonNullable<NonNullable<typeof result>['sim']>
  ) => ({
    // (each the same object while nothing changes: the timeline is memoized)
    members: memberKeys,
    rotation,
    sim,
    edited: editedSteps,
    selected: selectedStep,
    teamData,
    // (on the KQM tab, the KQM builds' effects: never the members' own)
    buffs: figures ? teamBuffs : kqmBuffs,
    damage: timelineFigures.damage,
    renderHit,
    onSelect: selectStep,
    control: rotationsControl,
    countedFrom: wholeShown ? STEADY_REPEATS - STEADY_COUNTED : undefined,
  })
  // the members' stats at the timeline's moment and what each buff up then gives: their own
  // builds; on the KQM tab the shown result's (none before a result)
  const [moment, setMoment] = useState<TimelineMoment>()
  const momentOn = figures || !!kqmOverrides
  const { stats: momentStats, effects: momentEffects } = useMomentFigures(
    teamId,
    moment,
    {
      enabled: momentOn,
      teamData,
      overrides: figures ? undefined : kqmOverrides,
    }
  )
  // (the members' own weapon and set effects: listed on the timeline, never on the KQM tab)
  const teamBuffs = useTeamBuffs(teamId, teamData)
  // the timeline's damage and stats: with the members' own builds; on the KQM tab the shown
  // result's (none before a result)
  const timelineFigures = useTimelineFigures(
    teamId,
    timelineSim,
    shown?.own,
    figures || !!kqmOverrides,
    figures ? undefined : kqmOverrides
  )
  const renderHit = useCallback(
    (hit: SimHit) => {
      // (the KQM tab before its first builds: nothing to work a hit's damage out with)
      if (!figures && !kqmOverrides)
        return (
          <Typography sx={type.label}>
            {t(
              'teamOpt.writer.hitNeedsBuilds',
              'Its damage shows once KQM builds are generated.'
            )}
          </Typography>
        )
      const found = timelineFigures.attackOf?.(hit)
      return (
        found && (
          <TimelineHitStats
            teamId={teamId}
            characterKey={found.characterKey}
            attack={found.attack}
            overrides={figures ? undefined : kqmOverrides}
          />
        )
      )
    },
    [figures, kqmOverrides, timelineFigures, teamId, t]
  )
  // (a step's block: its timing opened; the latest toggle, which reads the panel's state)
  const toggleTimingRef = useRef(toggleTiming)
  toggleTimingRef.current = toggleTiming
  const selectStep = useCallback((i: number) => {
    setDetailOpen(false)
    setSelectedStep(i)
    setInspectorTab('steps')
    toggleTimingRef.current(true)
  }, [])
  const openDetail = useCallback(() => setDetailOpen(true), [])
  // a mode or stance's version of an action (Zibai's Spirit Steed's Stride) has its own frame data:
  // the versions this rotation played join each member's defaults
  const frameDefaultsWithVersions = useMemo(() => {
    const played = result?.sim?.actionData
    if (!played) return frameDefaults
    const out = { ...frameDefaults }
    for (const [member, data] of Object.entries(played))
      for (const [key, d] of Object.entries(data ?? {}))
        if (d.variant && out[member as CharacterKey])
          out[member as CharacterKey] = {
            ...out[member as CharacterKey],
            [key]: d,
          }
    return out
  }, [frameDefaults, result])
  const timingEdited =
    timing.swapFrames !== undefined ||
    keys.some((k) => Object.keys(frameData[k] ?? {}).length > 0) ||
    (!!result &&
      Object.keys(frameOverrides(result.rotation, timing.edits)).length > 0)
  const updateRotationsTiming = (next: RotationTimingSettings) => {
    if (
      next.rotations !== timing.rotations ||
      next.countOpener !== timing.countOpener
    ) {
      setTimelinePin(undefined)
      setWhole(undefined)
    }
    setTiming(next)
  }

  const seconds = result ? writtenSeconds(result) : undefined
  const waited = result ? writtenWaits(result) : undefined
  // (the waits have their own warning, above the timeline)
  const notes = useMemo(
    () => result?.sim?.notes.filter((n) => !n.startsWith('Waited ')) ?? [],
    [result]
  )
  const hadRotation = Object.values(scopeAttacks(database, teamId, !!kqm)).some(
    (a) => !!a?.length
  )
  // (changed since the preview's play, which waits for a pause on a heavy team: used as it is now)
  const stale =
    deferred !== text ||
    deferredOpener !== openerText ||
    deferredTiming !== timing ||
    deferredFrameData !== frameData ||
    (!!sacHolders.length && sacPreview?.args !== playArgs)
  const apply = () => {
    if (!result?.sim && !stale) return
    const applied =
      kqm || stale
        ? simulateWritten({
            kqm: !!kqm,
            text,
            opener: openerShown ? openerText : '',
            timing,
            frameData,
            team: ownTeam,
            names,
            members,
            database,
            teamId,
            gender,
            openerWarning: (warning) => warning,
          })
        : result
    if (!applied?.sim) return
    closing.current = true
    const undo = applyWritten({
      database,
      teamId,
      members,
      setTeamOpt,
      result: applied,
      text,
      opener: openerShown ? openerText : '',
      timing,
      frameData,
      kqm: !!kqm,
      constellations: ownTeam.constellations,
    })
    if (undo) onApplied(undo)
    onClose()
  }

  const editedSteps = useMemo(
    () =>
      new Set(
        Object.keys(
          result?.rotation ? frameOverrides(result.rotation, timing.edits) : {}
        ).map(Number)
      ),
    [result?.rotation, timing.edits]
  )
  const warnings = [
    ...new Set([...(result?.sim?.warnings ?? result?.rotation.warnings ?? [])]),
  ]

  return (
    <ModalWrapper
      open
      onClose={onClose}
      containerProps={{ maxWidth: 'xl' }}
      aria-labelledby="rotation-writer-title"
    >
      {/* (phones and tablets: the window scrolls as one; its footer stays at the bottom of the
          screen, so the card must not clip it) */}
      <CardThemed sx={{ overflow: { xs: 'visible', md: 'hidden' } }}>
        {/* title, rotations counted dropdown, the timing inspector's toggle, close */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1,
            px: { xs: 2, sm: 2.5 },
            py: 1.5,
          }}
        >
          <Typography
            id="rotation-writer-title"
            component="h2"
            sx={{ flexGrow: 1, ...type.section }}
          >
            {t('teamOpt.writer.title', 'Write rotation')}{' '}
            <InfoTooltipInline
              title={t(
                'teamOpt.writer.subtitle',
                'Who acts and what they do, step by step. The timeline and hits follow as you type.'
              )}
            />
          </Typography>
          <RotationsDropdown
            timing={timing}
            hasOpener={openerShown && !!openerText.trim()}
            onChange={updateRotationsTiming}
            variant="outlined"
          />
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
            // (a phone in landscape: one column, the window scrolls, not each column in its 76%)
            [`@media ${SHORT_SCREEN}`]: {
              gridTemplateColumns: 'minmax(0, 1fr)',
            },
          }}
        >
          <Box
            sx={{
              p: { xs: 1.5, sm: 3 },
              display: 'flex',
              flexDirection: 'column',
              minWidth: 0,
              maxHeight: { md: '80vh' },
              overflowY: { md: 'auto' },
              // (the column scrolls: its parts keep their height. Shrunk, the timeline's box went
              // to 0 on a laptop at 100% zoom and the hit cards covered the chart)
              '& > *': { flexShrink: 0 },
              [`@media ${SHORT_SCREEN}`]: {
                maxHeight: 'none',
                overflowY: 'visible',
              },
            }}
          >
            {/* the rotation and its first-rotation-only opener: one code panel, the quick row under
                both (it inserts into the box typed in last) */}
            <WriterSection first>
              <Box
                sx={{
                  borderRadius: tokens.radius.panel,
                  bgcolor: tokens.inset,
                  border: tokensHairline,
                  overflow: 'hidden',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 1,
                    p: { xs: 1.25, sm: 1.75 },
                    pb: { xs: 1.25, sm: 1.5 },
                  }}
                >
                  <EditorHead
                    label={
                      isDraft
                        ? t('teamOpt.writer.rotationDraft', 'Rotation draft')
                        : t('teamOpt.writer.loop', 'Rotation')
                    }
                    aside={
                      <>
                        {isDraft && (
                          <Button
                            size="small"
                            color="inherit"
                            onClick={revert}
                            sx={{
                              color: 'text.secondary',
                              whiteSpace: 'nowrap',
                              fontSize: 12.5,
                            }}
                          >
                            {t('teamOpt.writer.discardDraft', 'Discard draft')}
                          </Button>
                        )}
                        {searchButton?.({
                          text,
                          names,
                          setText,
                          close: onClose,
                          saved: {
                            opener: openerShown ? openerText : '',
                            timing,
                            frameData,
                          },
                        })}
                        <TemplatesButton
                          templates={templates}
                          team={memberKeys}
                          onPick={pickTemplate}
                          onStarter={() => {
                            setText(
                              starterRotation(names, templates[0]?.characterKey)
                            )
                            setOpenerText('')
                            setOpenerShown(false)
                          }}
                        />
                        <Button
                          size="small"
                          color="inherit"
                          aria-expanded={syntaxOpen}
                          aria-controls="rotation-syntax"
                          onClick={() => setSyntaxOpen((open) => !open)}
                          sx={(theme) => ({
                            fontSize: 12.5,
                            whiteSpace: 'nowrap',
                            color: syntaxOpen
                              ? 'primary.main'
                              : 'text.secondary',
                            bgcolor: syntaxOpen
                              ? alpha(theme.palette.primary.main, 0.1)
                              : 'transparent',
                          })}
                        >
                          {t('teamOpt.writer.syntax', 'How to write it')}
                        </Button>
                      </>
                    }
                  />
                  <RotationCode
                    autoFocus
                    value={text}
                    onChange={setText}
                    names={names}
                    label={t('teamOpt.writer.loop', 'Rotation')}
                    placeholder={exampleRotation(names.map((n) => n.name))}
                    inputRef={inputRef}
                    active={target === 'loop'}
                    onFocus={() => setTarget('loop')}
                  />
                  {openerShown && (
                    <>
                      <EditorHead
                        sx={{ mt: 1 }}
                        label={t(
                          'teamOpt.writer.opener',
                          'First rotation only'
                        )}
                        info={t('teamOpt.writer.openerTip', {
                          defaultValue:
                            'Your first rotation, when it differs from the rest (no Energy at the start, a setup skill). Played instead of the rotation the first time through. It only sets up cooldowns, summons and auras and is not counted; counting from the start, tick Counted to make it the first rotation.',
                          ...STEADY_RANGE,
                        })}
                        aside={
                          <>
                            {/* (counted from the start: the first rotation, or a setup before the start) */}
                            {firstRotations(timing) !== undefined && (
                              <Tooltip
                                title={t(
                                  'teamOpt.writer.openerCountedTip',
                                  'Off (default): played before the start as a setup and not counted. Its cooldowns, summons and auras carry into the rotations. On: it is the first rotation, and counted.'
                                )}
                              >
                                <Box
                                  component="label"
                                  sx={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 0.25,
                                    cursor: 'pointer',
                                    whiteSpace: 'nowrap',
                                    color: 'text.secondary',
                                    fontSize: 12.5,
                                  }}
                                >
                                  <Checkbox
                                    size="small"
                                    checked={!!timing.countOpener}
                                    onChange={(_, checked) => {
                                      const { countOpener: _count, ...rest } =
                                        timing
                                      setTiming(
                                        checked
                                          ? { ...rest, countOpener: true }
                                          : rest
                                      )
                                    }}
                                    sx={{ p: 0.5 }}
                                  />
                                  {t('teamOpt.writer.openerCounted', 'Counted')}
                                </Box>
                              </Tooltip>
                            )}
                            <Tooltip
                              title={t('teamOpt.writer.removeOpener', 'Remove')}
                            >
                              <IconButton
                                size="small"
                                aria-label={t(
                                  'teamOpt.writer.removeOpener',
                                  'Remove'
                                )}
                                onClick={() => {
                                  setOpenerShown(false)
                                  setOpenerText('')
                                  setTarget('loop')
                                }}
                                sx={{ color: 'text.secondary' }}
                              >
                                <CloseIcon sx={{ fontSize: 16 }} />
                              </IconButton>
                            </Tooltip>
                          </>
                        }
                      />
                      <RotationCode
                        minRows={1}
                        value={openerText}
                        onChange={setOpenerText}
                        names={names}
                        label={t(
                          'teamOpt.writer.opener',
                          'First rotation only'
                        )}
                        placeholder={exampleRotation(names.map((n) => n.name))}
                        inputRef={openerRef}
                        active={target === 'opener'}
                        onFocus={() => setTarget('opener')}
                      />
                    </>
                  )}
                </Box>
                <WriterQuickRow
                  bar
                  members={members}
                  constellations={ownTeam.constellations}
                  onInsert={insert}
                  optionalSkill={sacHolders.length > 0}
                  into={
                    openerShown
                      ? target === 'opener'
                        ? t('teamOpt.writer.opener', 'First rotation only')
                        : t('teamOpt.writer.loop', 'Rotation')
                      : undefined
                  }
                  trailing={
                    !openerShown && (
                      <Button
                        size="small"
                        color="inherit"
                        startIcon={
                          <AddIcon sx={{ fontSize: '16px !important' }} />
                        }
                        onClick={() => {
                          setOpenerShown(true)
                          setTarget('opener')
                          requestAnimationFrame(() =>
                            openerRef.current?.focus()
                          )
                        }}
                        sx={{
                          color: 'text.secondary',
                          fontSize: 12.5,
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {t(
                          'teamOpt.writer.addOpenerShort',
                          'First rotation only'
                        )}
                      </Button>
                    )
                  }
                />
                <OptionalSyntaxHint
                  bar
                  onInsert={insert}
                  onToggleSyntax={
                    !syntaxOpen ? () => setSyntaxOpen(true) : undefined
                  }
                />
                {syntaxOpen && (
                  <SyntaxSheet
                    members={members}
                    names={names}
                    constellations={ownTeam.constellations}
                  />
                )}
              </Box>
              {!!warnings.length && (
                <Box
                  role="status"
                  sx={(theme) => ({
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.25,
                    px: 1.5,
                    py: 1,
                    borderRadius: tokens.radius.inset,
                    bgcolor: alpha(theme.palette.warning.main, 0.07),
                    border: `1px solid ${alpha(theme.palette.warning.main, 0.22)}`,
                  })}
                >
                  {warnings.map((w) => (
                    <Typography key={w} variant="body2" color="warning.main">
                      {w}
                    </Typography>
                  ))}
                </Box>
              )}
            </WriterSection>
            {result?.sim && seconds !== undefined ? (
              <>
                {/* how long it takes (the frame settings it plays with beside), then its timeline */}
                <WriterSection>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      flexWrap: 'wrap',
                      columnGap: 1.5,
                      rowGap: 1,
                      mb: 1.25,
                    }}
                  >
                    {/* the time per rotation, and what of it is waiting for cooldowns */}
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'baseline',
                        flexWrap: 'wrap',
                        columnGap: 1.25,
                        rowGap: 0.5,
                        minWidth: 0,
                      }}
                    >
                      <Typography sx={type.figure}>
                        {seconds.toFixed(1)}
                        <Box
                          component="span"
                          sx={{ fontSize: 15, fontWeight: 500, ml: 0.5 }}
                        >
                          s
                        </Box>
                      </Typography>
                      <Typography sx={{ ...type.label, ...numSx }}>
                        {t('teamOpt.writer.perRotation', 'per rotation')} ·{' '}
                        {Math.round(seconds * 60)}{' '}
                        {t('teamOpt.writer.frames', 'frames')}
                      </Typography>
                    </Box>
                    {/* the frame settings it plays with: together on the right, wrapping as one */}
                    <Box
                      sx={{
                        ml: 'auto',
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 0.75,
                      }}
                    >
                      {(result.loops ?? 1) > 1 &&
                        keys
                          .filter((k) => Math.round(burstEvery[k] ?? 1) >= 2)
                          .map((k) => {
                            const every = Math.round(burstEvery[k] ?? 1)
                            const name =
                              names.find((n) => n.characterKey === k)?.name ?? k
                            return (
                              <SettingChip
                                key={k}
                                label={t('teamOpt.writer.burstOf', {
                                  defaultValue: '{{name}} Burst',
                                  name,
                                })}
                                value={
                                  every === 2
                                    ? t(
                                        'teamOpt.kqm.calc.burstEvery2',
                                        'Every 2nd'
                                      )
                                    : t(
                                        'teamOpt.kqm.calc.burstEvery3',
                                        'Every 3rd'
                                      )
                                }
                                edited
                                tip={t('teamOpt.writer.burstEveryTip', {
                                  defaultValue:
                                    'From the ER calculator: {{name}} uses the Burst in 1 of every {{count}} rotations, as the optimizer plays it. The timeline shows them together; in the other rotations, a fallback written as Q/N3 plays instead.',
                                  name,
                                  count: every,
                                })}
                              />
                            )
                          })}
                      <SettingChip
                        label={t('teamOpt.timing.swap', 'Swap time')}
                        value={`${timing.swapFrames ?? DEFAULT_SWAP_FRAMES} f`}
                        edited={timing.swapFrames !== undefined}
                        onClick={() => toggleTiming(true)}
                      />
                      <SettingChip
                        label={t('teamOpt.frames.ping', 'Ping')}
                        value={`${timingPing(timing)} ms`}
                        edited={timing.swapFrames !== undefined}
                        onClick={() => toggleTiming(true)}
                      />
                    </Box>
                  </Box>
                  {waited && <WaitsWarning waited={waited} />}
                  {!!sacSummary.length && (
                    <Box sx={{ display: 'grid', gap: 0.5, px: 1.5, py: 0.75 }}>
                      {sacSummary.map(({ key, percent }) => (
                        <Typography key={key} sx={type.label} component="div">
                          <CharacterName characterKey={key} gender={gender} />{' '}
                          {t('teamOpt.writer.sacPercent', {
                            defaultValue:
                              '· Extra Skill used in {{percent}}% of sampled rotations',
                            percent,
                          })}
                        </Typography>
                      ))}
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {!wholeShown && examples.used && examples.skipped && (
                          <Segmented
                            size="small"
                            value={
                              sacView ??
                              (timelineSim?.optionalSkills?.some(
                                (step) =>
                                  step.played &&
                                  sacHolders.includes(step.characterKey)
                              )
                                ? 'used'
                                : 'skipped')
                            }
                            options={[
                              {
                                value: 'used',
                                label: t(
                                  'teamOpt.writer.sacUsed',
                                  'Extra Skill used'
                                ),
                              },
                              {
                                value: 'skipped',
                                label: t(
                                  'teamOpt.writer.sacSkipped',
                                  'Extra Skill skipped'
                                ),
                              },
                            ]}
                            onChange={(value) => {
                              setTimelinePin(undefined)
                              setSacView(value as 'used' | 'skipped')
                            }}
                          />
                        )}
                        <Button
                          size="small"
                          aria-expanded={sacEnergyOpen}
                          onClick={() => setSacEnergyOpen(!sacEnergyOpen)}
                        >
                          {t(
                            'teamOpt.writer.sacEnergy',
                            'Compare ER with Sacrificial'
                          )}
                        </Button>
                      </Box>
                      {!wholeShown &&
                        sacView === 'skipped' &&
                        examples.skipped && (
                          <Typography sx={type.label}>
                            {t(
                              'teamOpt.writer.sacSkipReason',
                              'The Skill was still on cooldown at E?.'
                            )}
                          </Typography>
                        )}
                      {sacEnergyOpen && !sacEnergy && (
                        <Typography role="status" sx={type.label}>
                          {t(
                            'teamOpt.writer.sacEnergyLoading',
                            'Calculating ER…'
                          )}
                        </Typography>
                      )}
                      {sacEnergyOpen && sacEnergy && !sacEnergy.noReset && (
                        <Typography role="status" sx={type.label}>
                          {t(
                            'teamOpt.writer.sacEnergyUnavailable',
                            'ER comparison unavailable.'
                          )}
                        </Typography>
                      )}
                      {sacEnergyOpen &&
                        sacEnergy?.noReset &&
                        sacEnergy.average && (
                          <Box
                            component="table"
                            sx={{
                              fontSize: 12,
                              textAlign: 'right',
                              width: '100%',
                            }}
                          >
                            <thead>
                              <tr>
                                <th scope="col">
                                  {t('teamOpt.writer.sacMember', 'Member')}
                                </th>
                                <th scope="col">
                                  {t('teamOpt.writer.sacSafe', 'No reset')}
                                </th>
                                <th scope="col">
                                  {t(
                                    'teamOpt.writer.sacAverage',
                                    'Average with Sacrificial'
                                  )}
                                </th>
                              </tr>
                            </thead>
                            <tbody>
                              {team.members.map((key) => (
                                <tr key={key}>
                                  <th scope="row">
                                    <CharacterName
                                      characterKey={key}
                                      gender={gender}
                                    />
                                  </th>
                                  <td>
                                    {sacEnergy.noReset?.[key] === undefined
                                      ? '—'
                                      : `${Math.ceil(sacEnergy.noReset[key]!)}%`}
                                  </td>
                                  <td>
                                    {sacEnergy.average?.[key] === undefined
                                      ? '—'
                                      : `${Math.ceil(sacEnergy.average[key]!)}%`}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </Box>
                        )}
                    </Box>
                  )}
                  <RotationTimeline
                    {...timelineProps(
                      shown?.rotation ?? result.rotation,
                      timelineSim ?? result.sim
                    )}
                    stats={detailOpen ? undefined : momentStats}
                    effects={detailOpen ? undefined : momentEffects}
                    onMoment={momentOn && !detailOpen ? setMoment : undefined}
                    onOpenDetail={openDetail}
                    pinned={timelinePin}
                    onPin={setTimelinePin}
                  />
                  {/* the detailed timeline: its own large window */}
                  <Dialog
                    open={detailOpen}
                    onClose={() => setDetailOpen(false)}
                    maxWidth={false}
                    fullScreen={detailFullScreen}
                    PaperProps={{
                      sx: {
                        width: detailFullScreen
                          ? '100vw'
                          : 'min(1760px, calc(100vw - 32px))',
                        // (as tall as the screen allows, always: what the moment's panel shows
                        // changes its height, which would move the window while pointing)
                        height: detailFullScreen
                          ? '100dvh'
                          : 'calc(100vh - 32px)',
                        maxHeight: detailFullScreen
                          ? '100dvh'
                          : 'calc(100vh - 32px)',
                        m: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        bgcolor: tokens.panel,
                        backgroundImage: 'none',
                        border: detailFullScreen
                          ? 'none'
                          : `1px solid ${tokens.hairline}`,
                        borderRadius: detailFullScreen
                          ? 0
                          : tokens.radius.panel,
                      },
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: 2,
                        flexShrink: 0,
                        pl: fullScreen ? 1.5 : 3,
                        pr: fullScreen ? 0.5 : 1.5,
                        py: fullScreen ? 0.25 : 1.75,
                        borderBottom: `1px solid ${tokens.hairline}`,
                      }}
                    >
                      <Typography component="h2" sx={type.section}>
                        {t('teamOpt.timeline.title', 'Timeline')}
                      </Typography>
                      <Typography
                        sx={{
                          fontSize: 15,
                          fontWeight: 650,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {(seconds ?? result.sim.frames / 60).toFixed(1)} s
                      </Typography>
                      <Typography
                        noWrap
                        sx={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: 13,
                          color: 'text.secondary',
                          fontFamily: 'ui-monospace, monospace',
                        }}
                      >
                        {text}
                      </Typography>
                      {/* (a small screen has it full already) */}
                      {!fullScreen && (
                        <Tooltip
                          title={
                            detailFull
                              ? t(
                                  'teamOpt.timeline.exitFull',
                                  'Exit full screen'
                                )
                              : t('teamOpt.timeline.full', 'Full screen')
                          }
                        >
                          <IconButton
                            onClick={() => setDetailFull((on) => !on)}
                            aria-pressed={detailFull}
                            aria-label={t(
                              'teamOpt.timeline.full',
                              'Full screen'
                            )}
                            sx={{ alignSelf: 'center', ...quickSx, ...focusSx }}
                          >
                            {detailFull ? (
                              <FullscreenExitRoundedIcon />
                            ) : (
                              <FullscreenRoundedIcon />
                            )}
                          </IconButton>
                        </Tooltip>
                      )}
                      <IconButton
                        onClick={() => setDetailOpen(false)}
                        aria-label={t('teamOpt.editor.close', 'Close')}
                        sx={{ alignSelf: 'center', ...quickSx, ...focusSx }}
                      >
                        <CloseIcon />
                      </IconButton>
                    </Box>
                    <Box
                      sx={{
                        minHeight: 0,
                        p: fullScreen ? 1 : 3,
                        overflowY: 'auto',
                      }}
                    >
                      {detailOpen && (
                        <RotationTimeline
                          {...timelineProps(
                            shown?.rotation ?? result.rotation,
                            timelineSim ?? result.sim
                          )}
                          detail
                          // (a bar here: its step selected and its moment pinned; the window stays,
                          // where the simple timeline's bar opens the step's timing)
                          onSelect={setSelectedStep}
                          stats={momentStats}
                          effects={momentEffects}
                          onMoment={momentOn ? setMoment : undefined}
                          pinned={timelinePin}
                          onPin={setTimelinePin}
                        />
                      )}
                    </Box>
                  </Dialog>
                </WriterSection>
                <WriterSection
                  title={t('teamOpt.writer.hitsTitle', 'Hits per rotation')}
                  info={t(
                    'teamOpt.writer.hitsInfo',
                    'Averaged over the rotations played: a hit that lands in some of them and not in others (a random proc, a reaction tick, a buff that is up every other time) counts as a fraction, as 0.5.'
                  )}
                >
                  <HitsSummary
                    members={members}
                    teamData={teamData}
                    attacks={result.attacks}
                    unsupported={result.sim.unsupported}
                  />
                </WriterSection>
                {!!notes.length && (
                  <WriterSection>
                    <RotationNotes notes={notes} />
                  </WriterSection>
                )}
              </>
            ) : (
              <WriterSection>
                <EmptyTimeline playing={!primed && !!deferred.trim()} />
              </WriterSection>
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
                [`@media ${SHORT_SCREEN}`]: {
                  maxHeight: 'none',
                  borderLeft: 'none',
                  borderTop: `1px solid ${theme.palette.divider}`,
                },
              })}
            >
              <FrameDataPanel
                members={keys}
                rotation={result?.rotation}
                sim={result?.sim}
                defaults={frameDefaultsWithVersions}
                frameData={frameData}
                setFrameData={setFrameData}
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
          sx={(theme) => ({
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 1,
            px: { xs: 1.5, sm: 2.5 },
            py: 1.5,
            // (phones and tablets: Use this rotation always in reach, not under the hit lists)
            position: { xs: 'sticky', md: 'static' },
            bottom: 0,
            zIndex: 3,
            bgcolor: 'contentNormal.main',
            borderTop: { xs: `1px solid ${theme.palette.divider}`, md: 'none' },
            borderRadius: { xs: '0 0 12px 12px', md: 0 },
          })}
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
            {t('teamOpt.editor.close', 'Close')}
          </Button>
          <Button
            variant="contained"
            disabled={!result?.sim && !stale}
            onClick={apply}
            sx={result?.sim || stale ? giCtaSx : undefined}
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

/**
 * What the rotation waits for each time it is played (an action not ready when the rotation
 * reaches it, or a swap), as gcsim warns of it: the time per rotation, then each wait
 */
function WaitsWarning({
  waited,
}: {
  waited: NonNullable<ReturnType<typeof writtenWaits>>
}) {
  const { t } = useTranslation('page_team')
  return (
    <Box
      role="status"
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 1.25,
        rowGap: 0.75,
        px: 1.5,
        py: 1,
        mb: 1.25,
        borderRadius: tokens.radius.inset,
        bgcolor: alpha(theme.palette.warning.main, 0.07),
        border: `1px solid ${alpha(theme.palette.warning.main, 0.22)}`,
      })}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          color: 'warning.main',
        }}
      >
        <HourglassBottomRoundedIcon sx={{ fontSize: 18 }} />
        <Typography
          sx={{ fontSize: 13.5, fontWeight: 650, color: 'inherit', ...numSx }}
        >
          {t('teamOpt.writer.waitsTitle', {
            defaultValue: 'Waits {{seconds}} s per rotation',
            seconds: waited.seconds.toFixed(1),
          })}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
        {waited.waits.map((w) => (
          <Box
            key={w.label}
            component="span"
            sx={(theme) => ({
              display: 'inline-flex',
              alignItems: 'center',
              gap: 0.625,
              pl: 0.375,
              pr: 0.875,
              height: 24,
              borderRadius: tokens.radius.pill,
              fontSize: 12.5,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              bgcolor: alpha(theme.palette.warning.main, 0.1),
              boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.warning.main, 0.28)}`,
            })}
          >
            <MemberAvatar characterKey={w.characterKey} size={18} />
            <Box
              component="span"
              sx={{ fontFamily: 'ui-monospace, monospace' }}
            >
              {w.action ?? t('teamOpt.writer.waitsSwap', 'swap')}
            </Box>
            <Box component="span" sx={{ color: 'text.secondary', ...numSx }}>
              {w.seconds.toFixed(1)} s
            </Box>
          </Box>
        ))}
      </Box>
      <Typography
        sx={{
          ...type.label,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          ml: { sm: 'auto' },
        }}
      >
        {t('teamOpt.writer.waitsShortHint', 'Not ready in time')}
        <InfoTooltipInline
          title={t(
            'teamOpt.writer.waitsTip',
            'Played back to back, an action can still be on cooldown when the rotation reaches it again (a Burst used late in one rotation and early in the next): the team stands idle until it is ready. The time per rotation includes the waits, so they lower DPS. Use it later in the rotation, make the rotation longer, or write E? / Q? (or Q?/N4) to skip or replace it when not ready. The timeline shows each wait hatched; All rotations shows them where they happen.'
          )}
        />
      </Typography>
    </Box>
  )
}

/** A frame setting in the summary (opens the timing inspector; without `onClick`, shown only) */
function SettingChip({
  label,
  value,
  edited,
  onClick,
  tip,
}: {
  label: string
  value: string
  edited: boolean
  onClick?: () => void
  /** What it is, on hover or focus (a chip without a click) */
  tip?: string
}) {
  const chip = (
    <ButtonBase
      onClick={onClick}
      disabled={!onClick && !tip}
      disableRipple={!onClick}
      sx={(theme) => ({
        cursor: onClick ? 'pointer' : 'default',
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
  return tip ? (
    <Tooltip title={tip} arrow>
      {chip}
    </Tooltip>
  ) : (
    chip
  )
}

/** Before a rotation is written: the timeline's frame, empty */
function EmptyTimeline({ playing }: { playing?: boolean }) {
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
        ...(playing && {
          '@keyframes writerPlaying': {
            from: { opacity: 0.45 },
            to: { opacity: 1 },
          },
          '& p': {
            animation: 'writerPlaying .8s ease-in-out infinite alternate',
          },
          '@media (prefers-reduced-motion: reduce)': {
            '& p': { animation: 'none' },
          },
        }),
      })}
    >
      <Typography variant="body2" color="text.secondary">
        {playing
          ? t('teamOpt.writer.playing', 'Playing the rotation…')
          : t('teamOpt.writer.emptyTimeline', 'The rotation plays out here')}
      </Typography>
    </Box>
  )
}

/** One part of an attack in a hit card: what kind of hit it is ("Stellar-Conduct"), how many */
interface HitPart {
  tag?: string
  n: number
  path: string[]
}
/**
 * One attack of a member's hit card, named once: its name in the hit's own colour (its element,
 * or its Stellar or Lunar reaction's hue, as in the rotation panel) with its first part's kind
 * and count, its other parts (a Stellar-Conduct hit, a DoT) as quiet rows under it
 */
function HitGroup({
  name,
  parts,
  data,
}: {
  name: string
  parts: HitPart[]
  data: UIData | undefined
}) {
  const [first, ...rest] = parts
  const info = useAttackInfo(data, first.path)
  const color = variantColor(info?.element)
  const count = (value: number, quiet?: boolean) => (
    <Box
      component="span"
      sx={{
        ...numSx,
        fontWeight: quiet ? 500 : 650,
        color: quiet ? 'text.secondary' : 'text.primary',
        textAlign: 'right',
      }}
    >
      {Math.round(value * 100) / 100}
    </Box>
  )
  const tagSx = {
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontSize: 11.5,
    color: 'text.secondary',
  } as const
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1fr) auto',
        columnGap: 1.5,
        py: 0.75,
        fontSize: 12.5,
        lineHeight: 1.45,
        '& + &': { borderTop: `1px solid ${tokens.hairline}` },
      }}
    >
      <Tooltip
        title={first.tag ? `${name} (${first.tag})` : name}
        placement="top-start"
        enterDelay={600}
        disableInteractive
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 0.75,
            minWidth: 0,
            width: 'fit-content',
            maxWidth: '100%',
          }}
        >
          <Box
            component="span"
            sx={{
              color,
              fontWeight: 550,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </Box>
          {first.tag && (
            <Box component="span" sx={tagSx}>
              {first.tag}
            </Box>
          )}
        </Box>
      </Tooltip>
      {count(first.n)}
      {rest.map((part) => (
        <Fragment key={part.tag ?? part.path.join('.')}>
          <Box component="span" sx={{ ...tagSx, pl: 1.5 }}>
            {part.tag ?? name}
          </Box>
          {count(part.n, true)}
        </Fragment>
      ))}
    </Box>
  )
}

/**
 * A part of the writer: a hairline above it (not the first), its heading in sentence case, then
 * its content
 */
function WriterSection({
  title,
  info,
  aside,
  first,
  children,
}: {
  title?: ReactNode
  info?: string
  aside?: ReactNode
  first?: boolean
  children: ReactNode
}) {
  return (
    <Box
      component="section"
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        minWidth: 0,
        // (space between the parts, no rules: each is a panel or a titled group of its own)
        ...(first ? {} : { mt: { xs: 2, sm: 3 } }),
      }}
    >
      {(title || aside) && (
        <EditorHead label={title} info={info} aside={aside} />
      )}
      {children}
    </Box>
  )
}

function HitsSummary({
  members,
  attacks,
  unsupported,
  teamData,
}: {
  /** The team's data: each attack's own colour (its element or reaction) */
  teamData: TeamData | undefined
  members: TeamOptMember[]
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>> | undefined
  unsupported: CharacterKey[]
}) {
  const { t } = useTranslation('page_team')
  const { gender } = useDBMeta()
  return (
    // (columns by the space it has, not the screen: the frame data panel beside it narrows it.
    // Every member in a row when they fit, else two by two, never 3 + 1)
    <Box sx={{ containerType: 'inline-size' }}>
      <Box
        sx={{
          display: 'grid',
          gap: 1,
          gridTemplateColumns: 'minmax(0, 1fr)',
          '@container (min-width: 480px)': {
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          },
          [`@container (min-width: ${members.length * 250}px)`]: {
            gridTemplateColumns: `repeat(${members.length}, minmax(0, 1fr))`,
          },
        }}
      >
        {members.map(({ characterKey }) => {
          // each attack once ("Palestar Crown"), its kinds of hit (Cryo, Stellar-Conduct) as its parts
          const groups = new Map<string, HitPart[]>()
          for (const a of attacks?.[characterKey] ?? []) {
            const base = a.description ?? a.path.join('.')
            const label = a.reaction
              ? `${base} (${REACTION_NAMES[a.reaction] ?? a.reaction})`
              : base
            // "Wing Dance Move (Stellar-Swirl)": the attack, then what kind of hit it is
            const tagged = label.match(/^(.*?)\s*\(([^()]*)\)$/)
            const name = tagged ? tagged[1] : label
            const tag = tagged?.[2]
            const parts = groups.get(name) ?? []
            const part = parts.find((p) => p.tag === tag)
            if (part) part.n += a.hits ?? 1
            else parts.push({ tag, n: a.hits ?? 1, path: a.path })
            groups.set(name, parts)
          }
          const sums = [...groups.values()].map((parts) =>
            parts.reduce((sum, p) => sum + p.n, 0)
          )
          const total = sums.reduce((a, b) => a + b, 0)
          return (
            <Box
              key={characterKey}
              sx={{
                px: 1.5,
                pt: 1.25,
                pb: 0.75,
                borderRadius: tokens.radius.inset,
                bgcolor: tokens.inset,
                border: tokensHairline,
                minWidth: 0,
              }}
            >
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1,
                  pb: 0.75,
                  borderBottom: tokensHairline,
                }}
              >
                <MemberAvatar characterKey={characterKey} size={24} />
                <Typography noWrap sx={{ fontSize: 14, fontWeight: 650 }}>
                  <CharacterName characterKey={characterKey} gender={gender} />
                </Typography>
                <Typography
                  component="span"
                  sx={{
                    ...type.label,
                    ...numSx,
                    ml: 'auto',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {!kitModels[characterKey]
                    ? t('teamOpt.writer.noKitShort', 'attacks kept')
                    : t('teamOpt.writer.hitCount', {
                        defaultValue: '{{count}} hits',
                        count: Math.round(total * 100) / 100,
                      })}
                </Typography>
              </Box>
              {unsupported.includes(characterKey) ? null : groups.size ? (
                <Box>
                  {[...groups].map(([name, parts]) => (
                    <HitGroup
                      key={name}
                      name={name}
                      parts={parts}
                      data={teamData?.[characterKey]?.target}
                    />
                  ))}
                </Box>
              ) : (
                <Typography variant="caption" color="text.secondary">
                  {t('teamOpt.writer.none', 'No hits')}
                </Typography>
              )}
            </Box>
          )
        })}
      </Box>
    </Box>
  )
}

/**
 * What the simulation assumed or could not check: shown by default (still collapsible), each a
 * short row (its subject, then what it says)
 */
function RotationNotes({ notes }: { notes: string[] }) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(true)
  return (
    <Disclosure
      open={open}
      onToggle={() => setOpen((o) => !o)}
      label={t('teamOpt.writer.notes', 'Notes')}
      count={notes.length}
    >
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'auto minmax(0, 1fr)',
          columnGap: 1.5,
          rowGap: 0.75,
          mt: 0.5,
          p: 1.5,
          borderRadius: 2,
          bgcolor: tokens.inset,
          border: tokensHairline,
          fontSize: 12.5,
          lineHeight: 1.5,
        }}
      >
        {notes.map((note) => {
          const at = note.indexOf(': ')
          const subject = at > 0 && at < 28 ? note.slice(0, at) : ''
          return (
            <Fragment key={note}>
              <Box
                component="span"
                sx={{ fontWeight: 650, whiteSpace: 'nowrap' }}
              >
                {subject}
              </Box>
              <Box component="span" sx={{ color: 'text.secondary' }}>
                {subject ? note.slice(at + 2) : note}
              </Box>
            </Fragment>
          )
        })}
      </Box>
    </Disclosure>
  )
}
const tokensHairline = `1px solid ${tokens.hairline}`

/** (a chip pressed keeps the cursor in the text: it inserts there) */
const keepFocus = (e: { preventDefault: () => void }) => e.preventDefault()

/** One row under the writer: the members (insert their name) and the action words */
export function WriterQuickRow({
  members,
  constellations,
  onInsert,
  draft,
  into,
  trailing,
  bar,
  optionalSkill,
}: {
  members: readonly { characterKey: CharacterKey }[]
  constellations?: Partial<Record<CharacterKey, number>>
  onInsert: (word: string) => void
  draft?: ReactNode
  /** The box the words go into, when there are several (shown with the row) */
  into?: string
  /** At the row's end (the writer: add the first-rotation-only box) */
  trailing?: ReactNode
  /** The writer's code panel: a bar along its bottom */
  bar?: boolean
  optionalSkill?: boolean
}) {
  const { t, i18n } = useTranslation(['page_team', 'charNames_gen'])
  const { gender } = useDBMeta()
  const memberNames = useMemo<RotationMember[]>(
    () =>
      members.map(({ characterKey }) => ({
        characterKey,
        name: i18n.t(
          `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
        ),
      })),
    [members, i18n, gender]
  )
  const quickTokens = useMemo(
    () => teamQuickTokens(members, memberNames, t, constellations),
    [members, memberNames, t, constellations]
  )
  const chip = (theme: Theme) => ({
    height: 28,
    px: 1,
    gap: 0.625,
    borderRadius: tokens.radius.control,
    fontSize: 13,
    color: alpha(theme.palette.text.primary, 0.82),
    bgcolor: alpha(theme.palette.text.primary, 0.035),
    boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.1)}`,
    ...quickSx,
    '&:hover, &.Mui-focusVisible': {
      color: 'text.primary',
      bgcolor: alpha(theme.palette.primary.main, 0.1),
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.55)}`,
    },
    '&:active': { bgcolor: alpha(theme.palette.primary.main, 0.18) },
  })
  const tip = (what: string) =>
    into
      ? t('teamOpt.writer.insertInto', {
          defaultValue: 'Insert {{what}} into {{box}}',
          what,
          box: into,
        })
      : what
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.625,
        ...(bar && {
          px: { xs: 1.25, sm: 1.75 },
          py: 1.125,
          borderTop: `1px solid ${tokens.hairline}`,
          bgcolor: alpha(theme.palette.common.black, 0.14),
        }),
      })}
    >
      {into && (
        <Typography
          component="span"
          sx={{
            fontSize: 12,
            color: 'text.secondary',
            whiteSpace: 'nowrap',
            mr: 0.5,
          }}
        >
          {t('teamOpt.writer.into', 'Into')}{' '}
          <Box component="span" sx={{ color: 'text.primary', fontWeight: 600 }}>
            {into}
          </Box>
        </Typography>
      )}
      {members.map(({ characterKey }) => {
        const name = i18n.t(
          `charNames_gen:${charKeyToLocGenderedCharKey(characterKey, gender)}`
        )
        return (
          <Tooltip
            key={characterKey}
            arrow
            title={
              into
                ? tip(name)
                : t('teamOpt.writer.insertMember', 'Insert {{name}}', { name })
            }
          >
            <ButtonBase
              onClick={() => onInsert(name)}
              onMouseDown={keepFocus}
              sx={(theme) => ({
                ...chip(theme),
                pl: 0.5,
                // (the member's colour, as in the text and the timeline)
                '& .lane': { bgcolor: laneColor(theme, characterKey) },
              })}
            >
              <MemberAvatar characterKey={characterKey} size={20} />
              {name}
              <Box
                className="lane"
                component="span"
                sx={{ width: 5, height: 5, borderRadius: '50%', ml: 0.25 }}
              />
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
      {quickTokens.map((tok) => (
        <Tooltip key={tok.key} arrow title={tip(tok.label)}>
          <ButtonBase
            onClick={() => onInsert(tok.text)}
            onMouseDown={keepFocus}
            sx={(theme) => ({
              ...chip(theme),
              fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
              fontSize: 13,
              minWidth: 34,
              px: 0.875,
              ...(tok.characterKey && {
                '& .lane': { bgcolor: laneColor(theme, tok.characterKey) },
              }),
            })}
          >
            {tok.characterKey && (
              <Box
                className="lane"
                component="span"
                sx={{ width: 5, height: 5, borderRadius: '50%' }}
              />
            )}
            {tok.text}
          </ButtonBase>
        </Tooltip>
      ))}
      {optionalSkill && (
        <Tooltip
          arrow
          title={t('teamOpt.writer.sacOptionalTip', 'Use Skill again if ready')}
        >
          <ButtonBase
            aria-label={t(
              'teamOpt.writer.sacOptionalTip',
              'Use Skill again if ready'
            )}
            onClick={() => onInsert('E?')}
            onMouseDown={keepFocus}
            sx={chip}
          >
            E?
          </ButtonBase>
        </Tooltip>
      )}
      {(draft || trailing) && (
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center' }}>
          {draft}
          {trailing}
        </Box>
      )}
    </Box>
  )
}

/** Always-visible inline hint surfacing optional / fallback notation (`E?`, `Q?`, `Q?/N4`) */
export function OptionalSyntaxHint({
  onInsert,
  onToggleSyntax,
  bar,
}: {
  onInsert?: (word: string) => void
  onToggleSyntax?: () => void
  bar?: boolean
}) {
  const { t } = useTranslation('page_team')
  const code = (token: string) => {
    const sx = (theme: Theme) => ({
      display: 'inline-flex',
      alignItems: 'center',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 11.5,
      lineHeight: 1.4,
      px: 0.625,
      py: 0.125,
      borderRadius: 0.75,
      color: 'text.primary',
      bgcolor: alpha(theme.palette.text.primary, 0.06),
      boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.text.primary, 0.12)}`,
      ...(onInsert && {
        cursor: 'pointer',
        ...quickSx,
        '&:hover, &.Mui-focusVisible': {
          bgcolor: alpha(theme.palette.primary.main, 0.12),
          boxShadow: `inset 0 0 0 1px ${alpha(theme.palette.primary.main, 0.5)}`,
        },
      }),
    })
    return onInsert ? (
      <ButtonBase
        component="button"
        type="button"
        onMouseDown={keepFocus}
        onClick={() => onInsert(token)}
        aria-label={t('teamOpt.writer.insertToken', {
          defaultValue: 'Insert {{token}}',
          token,
        })}
        sx={sx}
      >
        {token}
      </ButtonBase>
    ) : (
      <Box component="code" sx={sx}>
        {token}
      </Box>
    )
  }
  return (
    <Box
      sx={(theme) => ({
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        columnGap: 0.625,
        rowGap: 0.5,
        fontSize: 12,
        lineHeight: 1.5,
        color: 'text.secondary',
        ...(bar && {
          px: { xs: 1.25, sm: 1.75 },
          py: 0.875,
          borderTop: `1px solid ${tokens.hairline}`,
          bgcolor: alpha(theme.palette.common.black, 0.08),
        }),
      })}
    >
      <span>{t('teamOpt.writer.optionalHint.prefix', 'Tip:')}</span>
      {code('E?')}
      <span>{t('teamOpt.writer.optionalHint.slash', '/')}</span>
      {code('Q?')}
      <span>
        {t(
          'teamOpt.writer.optionalHint.ready',
          'cast only when ready (skip instead of waiting) ·'
        )}
      </span>
      {code('Q?/N4')}
      <span>{t('teamOpt.writer.optionalHint.or', 'or')}</span>
      {code('E?/N2')}
      <span>
        {t(
          'teamOpt.writer.optionalHint.fallback',
          'play a fallback when not ready ·'
        )}
      </span>
      {code('[Q E]?/[N3 N3]')}
      <span>
        {t(
          'teamOpt.writer.optionalHint.group',
          'a group only when Q is ready, else the fallback ·'
        )}
      </span>
      {code('3[N3 CA]')}
      <span>{t('teamOpt.writer.optionalHint.repeat', 'repeats a combo')}</span>
      {onToggleSyntax && (
        <ButtonBase
          type="button"
          onClick={onToggleSyntax}
          sx={{
            ml: { sm: 'auto' },
            fontSize: 12,
            fontWeight: 600,
            color: 'primary.main',
            borderRadius: 0.75,
            px: 0.5,
            '&:hover': { textDecoration: 'underline' },
          }}
        >
          {t('teamOpt.writer.optionalHint.more', 'More syntax')}
        </ButtonBase>
      )}
    </Box>
  )
}

/** A code box's heading: its name (and ⓘ), with its own controls on the right */
function EditorHead({
  label,
  info,
  aside,
  sx,
}: {
  label?: ReactNode
  info?: string
  aside?: ReactNode
  sx?: object
}) {
  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 0.75,
        minHeight: 30,
        ...sx,
      }}
    >
      <Typography component="h3" sx={type.title}>
        {label}
      </Typography>
      {info && <InfoTooltipInline title={info} />}
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 0.5,
          minWidth: 0,
          maxWidth: '100%',
          ml: { xs: 0, sm: 'auto' },
          flexBasis: { xs: '100%', sm: 'auto' },
        }}
      >
        {aside}
      </Box>
    </Box>
  )
}

/** How a rotation is written: team-specific mechanics first, then universal syntax */
function SyntaxSheet({
  members,
  names,
  constellations,
}: {
  members: readonly { characterKey: CharacterKey }[]
  names: readonly RotationMember[]
  constellations?: Partial<Record<CharacterKey, number>>
}) {
  const { t } = useTranslation('page_team')
  const { teamRows, generalRows, examples } = useMemo(
    () => teamSyntaxRows(members, names, t, constellations),
    [members, names, t, constellations]
  )
  const listSx = {
    m: 0,
    display: 'grid',
    gridTemplateColumns: {
      xs: 'max-content minmax(0, 1fr)',
      md: 'max-content minmax(0, 1fr) max-content minmax(0, 1fr)',
    },
    columnGap: 2,
    rowGap: 0.75,
    fontSize: 12.5,
    lineHeight: 1.5,
    '& dt': {
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      color: 'text.primary',
      whiteSpace: 'nowrap',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 0.625,
    },
    '& dd': { m: 0, color: 'text.secondary' },
  } as const
  return (
    <Box
      id="rotation-syntax"
      sx={{
        px: { xs: 1.25, sm: 1.75 },
        py: 1.5,
        borderTop: `1px solid ${tokens.hairline}`,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
      }}
    >
      {!!teamRows.length && (
        <Box
          sx={{
            pb: 1.25,
            borderBottom: `1px solid ${tokens.hairline}`,
            display: 'flex',
            flexDirection: 'column',
            gap: 0.75,
          }}
        >
          <Typography sx={{ ...type.label, fontWeight: 600 }}>
            {t('teamOpt.writer.syntax.forTeam', 'For this team')}
          </Typography>
          <Box component="dl" sx={listSx}>
            {teamRows.map(({ code, meaning, characterKey }) => (
              <Fragment key={code}>
                <dt>
                  {characterKey && (
                    <Box
                      component="span"
                      sx={(theme) => ({
                        width: 6,
                        height: 6,
                        borderRadius: '50%',
                        bgcolor: laneColor(theme, characterKey),
                        flexShrink: 0,
                      })}
                    />
                  )}
                  {code}
                </dt>
                <dd>{meaning}</dd>
              </Fragment>
            ))}
          </Box>
        </Box>
      )}
      <Box component="dl" sx={listSx}>
        {generalRows.map(({ code, meaning }) => (
          <Fragment key={code}>
            <dt>{code}</dt>
            <dd>{meaning}</dd>
          </Fragment>
        ))}
      </Box>
      {/* whole rotations with the conditional forms, as they are written */}
      <Box
        sx={{
          pt: 1.25,
          borderTop: `1px solid ${tokens.hairline}`,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.75,
        }}
      >
        <Typography sx={{ ...type.label, fontWeight: 600 }}>
          {t('teamOpt.writer.syntax.examples', 'Examples')}
        </Typography>
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, minmax(0, 1fr))' },
            gap: 1,
          }}
        >
          {examples.map(({ code, meaning }) => (
            <Box
              key={code}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                p: 1,
                borderRadius: 1.5,
                bgcolor: tokens.inset,
              }}
            >
              <Box
                component="code"
                sx={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 12.5,
                  color: 'text.primary',
                  overflowWrap: 'anywhere',
                }}
              >
                {code}
              </Box>
              <Typography
                sx={{ fontSize: 12, lineHeight: 1.45, color: 'text.secondary' }}
              >
                {meaning}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', opacity: 0.8 }}>
        {t(
          'teamOpt.writer.syntax.credit',
          'Automatic entry skills are included; actions not modelled are listed in the notes. Frame data: gcsim and kqmsim (AGPLv3).'
        )}
      </Typography>
    </Box>
  )
}
