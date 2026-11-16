import {
  CardThemed,
  InfoTooltipInline,
  ModalWrapper,
} from '@genshin-optimizer/common/ui'
import { deepClone, layeredAssignment } from '@genshin-optimizer/common/util'
import type { CharacterKey, GenderKey } from '@genshin-optimizer/gi/consts'
import { charKeyToLocGenderedCharKey } from '@genshin-optimizer/gi/consts'
import type {
  TeamOpt,
  TeamOptAttack,
  TeamOptKqm,
} from '@genshin-optimizer/gi/db'
import { useDatabase, useDBMeta } from '@genshin-optimizer/gi/db-ui'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { giCtaSx } from '@genshin-optimizer/gi/theme'
import type {
  KqmBuild,
  KqmPlayed,
  KqmReplayInput,
  RotationEnergy,
  SimGear,
  TeamData,
  TeamDataOverrides,
  TeamOptMember,
} from '@genshin-optimizer/gi/ui'
import {
  actionFrameDefaults,
  CharacterName,
  energyFromRotation,
  everyNthBursts,
  type FrameData,
  HEXEREI_CHARACTERS,
  kitModels,
  kqmMemberConstellation,
  kqmSimGear,
  lastRotation,
  needsRotationCalculation,
  parseRotation,
  REACTION_NAMES,
  type RotationMember,
  rotationAttacks,
  rotationBuffDefaults,
  rotationCalculation,
  rotationSamples,
  type SimBuffOwner,
  type SimHit,
  simulateRotationSamples,
} from '@genshin-optimizer/gi/ui'
import type { UIData } from '@genshin-optimizer/gi/uidata'
import AddIcon from '@mui/icons-material/Add'
import CloseIcon from '@mui/icons-material/Close'
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
  TextField,
  type Theme,
  Tooltip,
  Typography,
  useMediaQuery,
} from '@mui/material'
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
import type { TimelineMoment } from './RotationTimeline'
import { laneColor, RotationTimeline, SHORT_SCREEN } from './RotationTimeline'
import {
  DEFAULT_SWAP_FRAMES,
  firstRotations,
  frameOverrides,
  openerCounted as openerIsCounted,
  type RotationTimingSettings,
  timingPing,
} from './RotationTiming'
import {
  TimelineHitStats,
  useMomentStats,
  useTimelineFigures,
} from './TimelineFigures'
import { Disclosure, focusSx, quickSx, tokens, type } from './ui'
import type { TeamOptUpdate } from './useTeamOpt'

const storageKey = (teamId: string) => `teamOptRotationText_${teamId}`
/** What was typed but not used yet (kept when the writer closes) */
const draftKey = (teamId: string) => `teamOptRotationDraft_${teamId}`
const openerKey = (teamId: string) => `teamOptRotationOpener_${teamId}`
const timingKey = (teamId: string) => `teamOptRotationTiming_${teamId}`
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
/** The writer's action words, inserted from the quick row */
const TOKENS: { text: string; key: string; label: string }[] = [
  { text: 'E', key: 'skill', label: 'Elemental Skill (tap)' },
  { text: 'hE', key: 'hold', label: 'Elemental Skill (hold)' },
  { text: 'Q', key: 'burst', label: 'Elemental Burst' },
  { text: 'N3', key: 'normal', label: 'Normal attacks: N1 to N6 hits' },
  {
    text: 'CA',
    key: 'charged',
    label: 'Charged Attack (Sandrone: CA[beams=2] releases it after 2 beams)',
  },
  { text: 'P', key: 'plunge', label: 'Plunging Attack' },
  { text: 'D', key: 'dash', label: 'Dash' },
  { text: 'J', key: 'jump', label: 'Jump' },
  { text: 'W1', key: 'wait', label: 'Wait: W1.5 is 1.5 s, W90f is 90 frames' },
  { text: '->', key: 'next', label: 'Next step or another member' },
]

/** The writer's saved state, with a signal so every view of it (the inline field, the writer) follows */
const storageEvent = 'teamOpt.rotationStorage'
function writeStored(key: string, value: string | null) {
  if (value === null) localStorage.removeItem(key)
  else localStorage.setItem(key, value)
  window.dispatchEvent(new Event(storageEvent))
}
/** Saves the rotation's timing settings (the page's Rotations setting writes it directly) */
export function saveRotationTiming(
  teamId: string,
  timing: RotationTimingSettings
) {
  writeStored(timingKey(teamId), JSON.stringify(timing))
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
  return useMemo(() => {
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
  }, [members, database, kqm, kqmBuilds])
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
  auraTimeline,
  burstEvery,
}: {
  /** Record the enemy's auras over time (the writer's timeline; never KQM's many replays) */
  auraTimeline?: boolean
  /**
   * Members that use their Burst only every Nth rotation (KQM's ER calculator): the written
   * rotation is played N in a row with their Burst in one of them (`loops` in the result)
   */
  burstEvery?: Partial<Record<CharacterKey, number>>
  text: string
  opener: string
  timing: RotationTimingSettings
  frameData: FrameData
  team: SimTeam
  names: RotationMember[]
  members: TeamOptMember[]
  database: Database
  teamId: string
  gender: GenderKey
  openerWarning: (warning: string) => string
  /**
   * How many times it is played, and which of them count. Default: as KQM counts it, 4 in a row
   * with the last 2 averaged (the pace it keeps: an action not ready again in time waits), the
   * result's `sim` then the last of them (what a timeline shows) and `counted` the 2.
   */
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
  // the opener: the first rotation (counted from the start; else a setup before the loop)
  if (opener.trim()) {
    const parsed = parseRotation(opener, names)
    rotation.opener = parsed.steps
    rotation.warnings.push(...parsed.warnings.map(openerWarning))
  }
  if (!rotation.steps.length) return { rotation }
  // (a Burst every Nth rotation: N written rotations played as one, timing edits kept per copy)
  const nth = burstEvery ? everyNthBursts(rotation, burstEvery) : undefined
  const edits = frameOverrides(rotation, timing.edits)
  const loops = nth?.loops ?? 1
  // (the writer's and Team optimize's own play: the pace it keeps, as KQM counts it, or the first
  // few rotations from the start when chosen)
  const steady = repeats === undefined
  const first = firstRotations(timing)
  // (counted from the start, the opener is the first rotation, the rotation's copies after it,
  // unless it is a setup before the start)
  const openerCounted = !!rotation.opener?.length && openerIsCounted(timing)
  /** The written rotations counted from the start (each played copy is `loops` of them) */
  const fromStart =
    first === undefined
      ? undefined
      : openerCounted
        ? 1 + (first - 1) * loops
        : first * loops
  const sampled = team.members.some((m) => kitModels[m]?.sampled)
  const sim = simulateRotationSamples(
    {
      ...team,
      calculate: needsRotationCalculation(team.members)
        ? rotationCalculation(database, teamId, gender, calculation)
        : undefined,
      rotation: nth?.rotation ?? rotation,
      frameOverrides: nth
        ? Object.fromEntries(
            nth.index.flatMap((written, played) =>
              edits[written] === undefined ? [] : [[played, edits[written]]]
            )
          )
        : edits,
      swapFrames: timing.swapFrames,
      frameData,
      repeats: first ?? (steady ? STEADY_REPEATS : repeats),
      keep: first ? 'all' : steady ? 'last2' : keep,
      openerCounted,
      auraTimeline,
    },
    // (two rotations kept: half the samples each, as much as one rotation of 64)
    // (no more than the members' kits need: a small randomness, few plays)
    sampled
      ? rotationSamples(
          team.members,
          kitModels,
          samples ?? (steady ? 32 : undefined)
        )
      : undefined
  )
  const own =
    current ??
    ((owner: SimBuffOwner, path: string[]) =>
      ownConditional(database, teamId, members, owner, path))
  if (!steady)
    return {
      rotation,
      sim,
      own,
      attacks: rotationAttacks(sim, own),
      counted: undefined,
      loops,
      fromStart,
    }
  const counted = fromStart ?? STEADY_COUNTED
  return {
    rotation,
    // (what the timeline shows: the last of the two counted; the first few, all of them)
    sim: first ? sim : lastRotation(sim),
    own,
    // per rotation: the hits of those counted, averaged
    attacks: perRotation(rotationAttacks(sim, own), counted),
    counted: { sim, rotations: counted, openerCounted },
    loops,
    fromStart,
  }
}

/** Played the writer's way (default `repeats`): 4 rotations in a row, the last 2 counted */
const STEADY_REPEATS = 4
const STEADY_COUNTED = 2
/** Attacks of `rotations` rotations, per rotation */
function perRotation(
  attacks: Partial<Record<CharacterKey, TeamOptAttack[]>>,
  rotations: number
) {
  return Object.fromEntries(
    Object.entries(attacks).map(([k, list]) => [
      k,
      (list ?? []).map((a) => ({ ...a, hits: (a.hits ?? 1) / rotations })),
    ])
  ) as Partial<Record<CharacterKey, TeamOptAttack[]>>
}
/** A played rotation's time per rotation, seconds (as counted: the steady pace) */
export const writtenSeconds = (result: WrittenRotation) =>
  result.counted
    ? result.counted.sim.frames / 60 / result.counted.rotations
    : result.sim
      ? result.sim.frames / 60
      : undefined
/**
 * When the rotation cannot keep its pace: its first time through (nothing waited for), seconds,
 * and what waits per rotation since (seconds each, the longest first); undefined when it keeps it
 */
export function writtenWaits(result: WrittenRotation) {
  const counted = result.counted
  // (the opener counted as the first rotation is another rotation: not its first time through)
  if (!counted || counted.openerCounted) return undefined
  const first = (counted.sim.rotationFrames?.[0] ?? 0) / 60
  const per = writtenSeconds(result) ?? 0
  const waits = Object.entries(counted.sim.stalls ?? {})
    .map(([label, frames]) => ({
      label,
      seconds: frames / 60 / counted.rotations,
    }))
    .filter((w) => w.seconds >= 0.1)
    .sort((a, b) => b.seconds - a.seconds)
  if (!first || per - first < 0.2) return undefined
  return { first, waits }
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
}):
  | ((input: KqmReplayInput) => KqmPlayed & { energy?: RotationEnergy })
  | undefined {
  const text = localStorage.getItem(storageKey(teamId)) ?? ''
  if (!text.trim()) return undefined
  const common = {
    text,
    opener: localStorage.getItem(openerKey(teamId)) ?? '',
    timing: parseTiming(localStorage.getItem(timingKey(teamId))),
    frameData: parseFrameData(localStorage.getItem(frameDataKey)),
    names,
    members,
    database,
    teamId,
    gender,
    openerWarning: (w: string) => w,
  }
  const keys = members.map((m) => m.characterKey)
  const elements = simTeamOf(members, database).elements
  // (the ER calculator's "Burst: Every 2nd": that member's Burst in one of every 2 rotations)
  const calculator =
    teamOpt.kqm?.energySource === 'calculator'
      ? teamOpt.kqm.energyCalculator
      : undefined
  const burstEvery = calculator
    ? (Object.fromEntries(
        Object.entries(calculator.members).map(([k, m]) => [
          k,
          m?.burstEvery ?? 1,
        ])
      ) as Partial<Record<CharacterKey, number>>)
    : undefined
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
      burstEvery,
      // (two rotations kept: fewer samples, as much as the writer's one rotation of 64)
      samples: 32,
    })
    // (written but nothing to play: an error, not the attacks Team optimize played)
    if (!played?.sim || !played.attacks)
      throw new Error(
        'The written rotation has no actions to play. Check the rotation text.'
      )
    // (per rotation: the hits and time of the 2 counted, averaged, each of them `loops` written
    // rotations, or of those counted from the start; members the simulation has no kit for keep
    // the attacks entered for them)
    const counted = played.fromStart ?? KQM_COUNTED * (played.loops ?? 1)
    const attacks = { ...teamOpt.attacks }
    for (const k of keys)
      if (!played.sim.unsupported.includes(k))
        attacks[k] = (played.attacks[k] ?? []).map((a) => ({
          ...a,
          hits: a.hits / counted,
        }))
    const stalls = Object.entries(played.sim.stalls ?? {})
      .map(([label, frames]) => ({ label, seconds: frames / 60 / counted }))
      .filter((s) => s.seconds >= 0.3)
      .sort((a, b) => b.seconds - a.seconds)
    return {
      attacks,
      rotationTime: Math.round((played.sim.frames / 60 / counted) * 10) / 10,
      stalls,
      // (the ER calculator's inputs as this rotation plays them)
      energy: energyFromRotation(played.sim, keys, counted, constellations),
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
}): WriterUndo | undefined {
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
        storageKey(teamId),
        draftKey(teamId),
        openerKey(teamId),
        timingKey(teamId),
        frameDataKey,
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
  // Hexerei: Witch's Homework is taken as done for each Hexerei member (gcsim's default), so its
  // bonuses apply even alone; their Secret Rite effects still need two (the sheets' tally)
  const hexerei = members.filter((m) =>
    HEXEREI_CHARACTERS.includes(m.characterKey)
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
  teamData,
  kqm,
  kqmBuilds,
  kqmBuffs,
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
          teamData={teamData}
          kqm={kqm}
          kqmBuilds={kqmBuilds}
          kqmBuffs={kqmBuffs}
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
  return { open, openWriter: () => setOpen(true), onApplied: setUndo, element }
}
export type RotationWriterHandle = ReturnType<typeof useRotationWriter>

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
        'Write the rotation and see its timeline, frame data and opener'
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
          {t('teamOpt.writer.configure', 'Write rotation')}
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
  teamData,
  kqm,
  kqmBuilds,
  kqmBuffs,
  setTeamOpt,
  onClose,
  onApplied,
}: {
  teamId: string
  members: TeamOptMember[]
  teamData: TeamData | undefined
  kqm: TeamOptKqm | undefined
  kqmBuilds: Partial<Record<CharacterKey, KqmBuild>> | undefined
  kqmBuffs: TeamBuff[] | undefined
  setTeamOpt: (update: TeamOptUpdate) => void
  onClose: () => void
  onApplied: (undo: WriterUndo) => void
}) {
  const { t } = useTranslation(['page_team', 'charNames_gen'])
  const database = useDatabase()
  const { gender } = useDBMeta()
  // a phone in landscape (or a narrow window): the detailed timeline takes the whole screen
  const fullScreen = useMediaQuery(`${SHORT_SCREEN}, (max-width: 700px)`)
  // the rotation in use, and a draft typed since (kept when the writer is closed without using it)
  const { applied, text, setText, isDraft: changed } = useRotationText(teamId)
  const isDraft = changed && !!applied.trim()
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const insert = (word: string) =>
    insertWord(inputRef.current, text, word, setText)
  // (the last play's time: a slow one waits for typing to pause)
  const playMs = useRef(0)
  const deferred = useSettled(text, playMs)
  const [openerText, setOpenerText] = useState(
    () => localStorage.getItem(openerKey(teamId)) ?? ''
  )
  const deferredOpener = useSettled(openerText, playMs)
  const [openerShown, setOpenerShown] = useState(() => !!openerText.trim())
  const [timing, setTiming] = useState(() =>
    parseTiming(localStorage.getItem(timingKey(teamId)))
  )
  const deferredTiming = useDeferredValue(timing)
  const [frameData, setFrameData] = useState(() =>
    parseFrameData(localStorage.getItem(frameDataKey))
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
  // (the attacks a rotation leaves on the team are Team optimize's: always the members' own)
  const ownTeam = useSimTeam(members)
  const figures = !kqm
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

  // (using the rotation closes the writer: the team it changes is not played again before that)
  const closing = useRef(false)
  const lastResult = useRef<ReturnType<typeof simulateWritten>>(undefined)
  const result = useMemo(
    () => {
      if (closing.current && lastResult.current) return lastResult.current
      const start = performance.now()
      const played = simulateWritten({
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
        openerWarning: (warning) =>
          t('teamOpt.writer.openerWarning', {
            defaultValue: 'Opener: {{warning}}',
            warning,
          }),
      })
      playMs.current = performance.now() - start
      lastResult.current = played
      return played
    },
    // (the members' constellations are read when the text changes)
    [
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
  // the detailed timeline's window
  const [detailOpen, setDetailOpen] = useState(false)
  // (what both timelines, the writer's and the detailed window's, are given)
  const timelineProps = (
    rotation: NonNullable<typeof result>['rotation'],
    sim: NonNullable<NonNullable<typeof result>['sim']>
  ) => ({
    members: keys,
    rotation,
    sim,
    edited: editedSteps,
    selected: selectedStep,
    teamData,
    // (on the KQM tab, the KQM builds' effects: never the members' own)
    buffs: figures ? teamBuffs : kqmBuffs,
    damage: timelineFigures.damage,
    renderHit: (hit: SimHit) => {
      const found = timelineFigures.attackOf?.(hit)
      return (
        found && (
          <TimelineHitStats
            teamId={teamId}
            characterKey={found.characterKey}
            attack={found.attack}
          />
        )
      )
    },
    onSelect: (i: number) => {
      setDetailOpen(false)
      setSelectedStep(i)
      setInspectorTab('steps')
      toggleTiming(true)
    },
  })
  // the members' stats at the timeline's moment (their own builds: never on the KQM tab)
  const [moment, setMoment] = useState<TimelineMoment>()
  const momentStats = useMomentStats(teamId, moment, figures)
  // (the members' own weapon and set effects: listed on the timeline, never on the KQM tab)
  const teamBuffs = useTeamBuffs(teamId, teamData)
  // the timeline's damage and stats, with the members' own builds
  const timelineFigures = useTimelineFigures(
    teamId,
    result?.sim,
    result?.own,
    figures
  )
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
    timing.rotations !== undefined ||
    keys.some((k) => Object.keys(frameData[k] ?? {}).length > 0) ||
    (!!result &&
      Object.keys(frameOverrides(result.rotation, timing.edits)).length > 0)

  const seconds = result ? writtenSeconds(result) : undefined
  const waited = result ? writtenWaits(result) : undefined
  const hadRotation = Object.values(
    database.teams.get(teamId)?.teamOpt?.attacks ?? {}
  ).some((a) => !!a?.length)
  // (typed since the preview's play, which waits for a pause on a heavy team: used as it is now)
  const stale = deferred !== text || deferredOpener !== openerText
  const apply = () => {
    if (!result?.sim && !stale) return
    const applied =
      kqm || stale
        ? simulateWritten({
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
    <ModalWrapper open onClose={onClose} containerProps={{ maxWidth: 'xl' }}>
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
                    'Who acts, then their actions, steps separated by ->:\nE / tE skill (tap) · hE skill (hold) · Q burst · N1–N6 normal attacks · CA charged (Sandrone: CA[beams=2], 2 condensed beams) · P plunge · D dash · J jump · W1.5 wait 1.5 s (W90f: 90 frames) · E? Q? only when ready (left out, not waited for)\nEnd with the first member ("-> bina") where the rotation loops.\nFrame data: gcsim and kqmsim (AGPLv3). Mitya: E again within 6 s switches cores. Automatic entry skills are included. Unimplemented actions are listed below.'
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
            {/* the rotation: its text, quick words, the first-rotation-only opener */}
            <WriterSection first title={t('teamOpt.writer.loop', 'Rotation')}>
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
                      'Your first rotation, when it differs from the rest (no Energy at the start, a setup skill). Played instead of the rotation the first time through. Counted from the start, it is the first rotation; repeating, it only sets up cooldowns, summons and auras and is not counted.'
                    )}
                  />
                  <TextField
                    fullWidth
                    size="small"
                    value={openerText}
                    placeholder={exampleRotation(names.map((n) => n.name))}
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
                  {/* (counted from the start: the first rotation, or a setup before the start) */}
                  {firstRotations(timing) !== undefined && (
                    <Tooltip
                      title={t(
                        'teamOpt.writer.openerCountedTip',
                        'Off: played before the start as a setup and not counted. Its cooldowns, summons and auras carry into the rotations.'
                      )}
                    >
                      <Box
                        component="label"
                        sx={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 0.5,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          color: 'text.secondary',
                          fontSize: 14,
                        }}
                      >
                        <Checkbox
                          size="small"
                          checked={!timing.openerSetup}
                          onChange={(_, checked) => {
                            const { openerSetup: _setup, ...rest } = timing
                            setTiming(
                              checked ? rest : { ...rest, openerSetup: true }
                            )
                          }}
                          sx={{ p: 0.5 }}
                        />
                        {t('teamOpt.writer.openerCounted', 'Counted')}
                      </Box>
                    </Tooltip>
                  )}
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
            </WriterSection>
            {result?.sim && seconds !== undefined ? (
              <>
                {/* how long it takes (the frame settings it plays with beside), then its timeline */}
                <WriterSection>
                  <Box
                    sx={{
                      display: 'flex',
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                      columnGap: 1.5,
                      rowGap: 0.5,
                      mb: 1.5,
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
                      {t('teamOpt.writer.perRotation', 'per rotation')} ·{' '}
                      {Math.round(seconds * 60)}{' '}
                      {t('teamOpt.writer.frames', 'frames')}
                    </Typography>
                    {waited && (
                      <Tooltip
                        title={t(
                          'teamOpt.writer.waitedTip',
                          'Played over and over, an action can still be on cooldown when the next rotation reaches it (for example a Burst used late in one rotation and early in the next): the rotation waits for it. Its first time through, nothing waits. Team optimize and KQM count the time per rotation, waits included.'
                        )}
                        placement="top"
                      >
                        <Typography
                          variant="body2"
                          sx={{
                            color: 'warning.main',
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {t('teamOpt.writer.firstTime', {
                            defaultValue: '{{seconds}} s without waiting',
                            seconds: waited.first.toFixed(1),
                          })}
                          {!!waited.waits.length &&
                            ` · ${t('teamOpt.writer.waitsRepeat', 'Waits for cooldowns from the previous rotation:')} ${waited.waits
                              .slice(0, 3)
                              .map(
                                (w) => `${w.label} ${w.seconds.toFixed(1)} s`
                              )
                              .join(', ')}`}
                        </Typography>
                      </Tooltip>
                    )}
                    <Box sx={{ flexGrow: 1 }} />
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
                    {/* (the Rotations setting is on the page, beside the rotation: shown, not set) */}
                    {firstRotations(timing) !== undefined && (
                      <SettingChip
                        label={t('teamOpt.timing.rotations', 'Rotations')}
                        value={t('teamOpt.timing.firstN', {
                          defaultValue: 'First {{count}}',
                          count: firstRotations(timing),
                        })}
                        edited
                      />
                    )}
                  </Box>
                  <RotationTimeline
                    {...timelineProps(result.rotation, result.sim)}
                    stats={detailOpen ? undefined : momentStats}
                    onMoment={figures && !detailOpen ? setMoment : undefined}
                    onOpenDetail={() => setDetailOpen(true)}
                  />
                  {/* the detailed timeline: its own large window */}
                  <Dialog
                    open={detailOpen}
                    onClose={() => setDetailOpen(false)}
                    maxWidth={false}
                    fullScreen={fullScreen}
                    PaperProps={{
                      sx: {
                        width: fullScreen
                          ? '100vw'
                          : 'min(1760px, calc(100vw - 32px))',
                        maxHeight: fullScreen ? '100dvh' : 'calc(100vh - 32px)',
                        m: 0,
                        display: 'flex',
                        flexDirection: 'column',
                        bgcolor: tokens.panel,
                        backgroundImage: 'none',
                        border: fullScreen
                          ? 'none'
                          : `1px solid ${tokens.hairline}`,
                        borderRadius: fullScreen ? 0 : tokens.radius.panel,
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
                          {...timelineProps(result.rotation, result.sim)}
                          detail
                          stats={momentStats}
                          onMoment={figures ? setMoment : undefined}
                        />
                      )}
                    </Box>
                  </Dialog>
                </WriterSection>
                <WriterSection
                  title={t('teamOpt.writer.hitsTitle', 'Hits per rotation')}
                >
                  <HitsSummary
                    members={members}
                    teamData={teamData}
                    attacks={result.attacks}
                    unsupported={result.sim.unsupported}
                  />
                </WriterSection>
                {!!result.sim.notes.length && (
                  <WriterSection>
                    <RotationNotes notes={result.sim.notes} />
                  </WriterSection>
                )}
              </>
            ) : (
              <WriterSection>
                <EmptyTimeline />
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

/** A frame setting in the summary (opens the timing inspector; without `onClick`, shown only) */
function SettingChip({
  label,
  value,
  edited,
  onClick,
}: {
  label: string
  value: string
  edited: boolean
  onClick?: () => void
}) {
  return (
    <ButtonBase
      onClick={onClick}
      disabled={!onClick}
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
/**
 * One attack of a member's hit card: its name in the hit's own colour (its element, or its Stellar
 * or Lunar reaction's hue, as in the rotation panel), what kind of hit it is, how many, and a
 * quiet bar of that colour for its share of the member's hits
 */
function HitRow({
  label,
  n,
  most,
  path,
  data,
  characterKey,
}: {
  label: string
  n: number
  most: number
  path: string[]
  data: UIData | undefined
  characterKey: CharacterKey
}) {
  const info = useAttackInfo(data, path)
  // "Wing Dance Move (Stellar-Swirl)": the attack, then what kind of hit it is
  const tagged = label.match(/^(.*?)\s*\(([^()]*)\)$/)
  const name = tagged ? tagged[1] : label
  const tag = tagged?.[2]
  const color = variantColor(info?.element)
  const share = `${(n / most) * 100}%`
  return (
    <Tooltip
      title={label}
      placement="top-start"
      enterDelay={600}
      disableInteractive
    >
      <Box
        sx={(theme) => {
          const palette = theme.palette as unknown as Record<
            string,
            { main: string } | undefined
          >
          const tint =
            (info?.element && palette[info.element]?.main) ||
            laneColor(theme, characterKey)
          return {
            position: 'relative',
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            alignItems: 'center',
            gap: 1,
            px: 0.75,
            mx: -0.75,
            minHeight: 26,
            borderRadius: 1,
            fontSize: 12.5,
            background: `linear-gradient(90deg, ${alpha(tint, 0.14)} ${share}, transparent ${share})`,
          }
        }}
      >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'baseline',
            gap: 0.75,
            minWidth: 0,
          }}
        >
          <Box
            component="span"
            sx={{
              color,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </Box>
          {tag && (
            <Box
              component="span"
              sx={{
                flexShrink: 1,
                minWidth: 0,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontSize: 11,
                color: 'text.secondary',
              }}
            >
              {tag}
            </Box>
          )}
        </Box>
        <Box
          component="span"
          sx={{ fontVariantNumeric: 'tabular-nums', fontWeight: 650 }}
        >
          <Box
            component="span"
            sx={{ color: 'text.secondary', fontWeight: 500 }}
          >
            ×
          </Box>
          {Math.round(n * 100) / 100}
        </Box>
      </Box>
    </Tooltip>
  )
}

/**
 * A part of the writer: a hairline above it (not the first), its heading in sentence case, then
 * its content
 */
function WriterSection({
  title,
  aside,
  first,
  children,
}: {
  title?: ReactNode
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
        ...(first ? {} : { mt: 2.5, pt: 2.5, borderTop: tokensHairline }),
      }}
    >
      {(title || aside) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {title && (
            <Typography component="h3" sx={{ ...type.title, flexGrow: 1 }}>
              {title}
            </Typography>
          )}
          {aside}
        </Box>
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
        const counts = new Map<string, { n: number; path: string[] }>()
        for (const a of attacks?.[characterKey] ?? []) {
          const base = a.description ?? a.path.join('.')
          const label = a.reaction
            ? `${base} (${REACTION_NAMES[a.reaction] ?? a.reaction})`
            : base
          const found = counts.get(label)
          if (found) found.n += a.hits ?? 1
          else counts.set(label, { n: a.hits ?? 1, path: a.path })
        }
        const total = [...counts.values()].reduce((sum, c) => sum + c.n, 0)
        const most = Math.max(1, ...[...counts.values()].map((c) => c.n))
        return (
          <Box
            key={characterKey}
            sx={(theme) => ({
              position: 'relative',
              overflow: 'hidden',
              px: 1.5,
              pt: 1.5,
              pb: 1.25,
              borderRadius: 2.5,
              bgcolor: tokens.inset,
              border: `1px solid ${alpha(theme.palette.text.primary, 0.07)}`,
              minWidth: 0,
              // the member's colour, as a soft light from the top edge
              '&::before': {
                content: '""',
                position: 'absolute',
                inset: '0 0 auto 0',
                height: 2,
                background: `linear-gradient(90deg, ${laneColor(theme, characterKey)}, ${alpha(laneColor(theme, characterKey), 0)})`,
              },
            })}
          >
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <MemberAvatar characterKey={characterKey} size={26} />
              <Typography noWrap sx={{ fontSize: 14, fontWeight: 650 }}>
                <CharacterName characterKey={characterKey} gender={gender} />
              </Typography>
              <Box
                component="span"
                sx={(theme) => ({
                  ml: 'auto',
                  flexShrink: 0,
                  px: 0.875,
                  borderRadius: 999,
                  fontSize: 11.5,
                  fontWeight: 600,
                  lineHeight: '20px',
                  whiteSpace: 'nowrap',
                  fontVariantNumeric: 'tabular-nums',
                  color: 'text.secondary',
                  bgcolor: alpha(theme.palette.text.primary, 0.06),
                })}
              >
                {!kitModels[characterKey]
                  ? t('teamOpt.writer.noKitShort', 'attacks kept')
                  : t('teamOpt.writer.hitCount', {
                      defaultValue: '{{count}} hits',
                      count: Math.round(total * 100) / 100,
                    })}
              </Box>
            </Box>
            {unsupported.includes(characterKey) ? null : counts.size ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
                {[...counts].map(([label, { n, path }]) => (
                  <HitRow
                    key={label}
                    label={label}
                    n={n}
                    most={most}
                    path={path}
                    data={teamData?.[characterKey]?.target}
                    characterKey={characterKey}
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
  )
}

/**
 * What the simulation assumed or could not check, and what the rotation waited for: folded
 * behind one line, each a short row (its subject, then what it says)
 */
function RotationNotes({ notes }: { notes: string[] }) {
  const { t } = useTranslation('page_team')
  const [open, setOpen] = useState(false)
  const waits = notes.filter((n) => n.startsWith('Waited '))
  const rest = notes.filter((n) => !n.startsWith('Waited '))
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
        {rest.map((note) => {
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
        {!!waits.length && (
          <>
            <Box
              component="span"
              sx={{ fontWeight: 650, whiteSpace: 'nowrap' }}
            >
              {t('teamOpt.writer.waits', 'Waits')}
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {waits.map((note) => (
                <Box
                  key={note}
                  component="span"
                  sx={(theme) => ({
                    px: 0.875,
                    borderRadius: 999,
                    lineHeight: '22px',
                    fontVariantNumeric: 'tabular-nums',
                    color: 'text.secondary',
                    bgcolor: alpha(theme.palette.text.primary, 0.05),
                  })}
                >
                  {note.replace(/^Waited /, '').replace(/\.$/, '')}
                </Box>
              ))}
            </Box>
          </>
        )}
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
