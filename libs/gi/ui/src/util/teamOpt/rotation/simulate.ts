import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import type { InputPremodKey } from '@genshin-optimizer/gi/wr-types'
import { Cooldowns } from './cooldowns'
import { gearEffects } from './gearEffects'
import { Health } from './health'
import { kitFramesInto, kitModels } from './kits/index'
import { NORMAL_START_DELAYS } from './normalDelays'
import {
  type ParsedRotation,
  parseRotation,
  type RotationAction,
} from './parse'
import { rotationRandom, stratifiedRandoms } from './random'
import { isSacrificialWeapon } from './sacrificial'
import { type AuraTrace, elementalReactions } from './reactions'
import type {
  ActionResult,
  ActionVariant,
  HitElement,
  HpChange,
  KitModel,
  RotationCalculation,
  SimBuffOwner,
  SimBuffWindow,
  SimContext,
  SimCountedBuff,
  SimGear,
  SimHit,
} from './types'
import { FPS } from './types'

const MELEE: string[] = ['sword', 'claymore', 'polearm']

export interface RotationReactions {
  /** Called for every hit in time order, after the kits' `onHit`: may add reaction hits */
  onHit(ctx: SimContext, hit: SimHit): void
  radianceAt?: (t: number) => 'conduct' | 'swirl' | undefined
  stellarSwirlAt?: (t: number) => boolean
  absorbAt?: (
    t: number,
    priority?: readonly HitElement[]
  ) => HitElement | undefined
  moondriftsAt?: (t: number) => number
  burningAt?: (t: number) => boolean
  frozenAt?: (t: number) => boolean
  dewAt?: (t: number) => number
  consumeDewAt?: (t: number, amount: number) => number
  addMoonridgeDew?: () => void
  /** Verdant Dew accrues `rate` times faster from `from` until `until` */
  boostDew?: (from: number, until: number, rate: number) => void
  endDewBoost?: (now: number) => void
  /** Bursts every live Dendro Core */
  ruptureCores?: (ctx: SimContext) => void
  suppressCores?: (now: number, duration: number) => number
  triggerForcedHarmony?: (
    ctx: SimContext,
    owner: CharacterKey,
    emitSync?: (hit: SimHit) => void
  ) => void
}

export interface SimulationResult {
  /** Independent complete runs; hits/actions above describe the first sample. */
  samples?: { probability: number; result: SimulationResult }[]
  /** The steady-state rotation's hits (the middle of three back-to-back runs), in time order */
  hits: SimHit[]
  /** Its length, frames */
  frames: number
  /** Start frame of the kept rotation (hits' `t` are absolute) */
  start: number
  /**
   * The kept rotations' start frames, when several are kept (`keep` 'last2' or 'all'): the last
   * ends at `start + frames`. See `lastRotation`.
   */
  rotationStarts?: number[]
  /** Every played rotation's length, frames: the first from a fresh start, nothing waited for */
  rotationFrames?: number[]
  buffWindows: SimBuffWindow[]
  countedBuffs: SimCountedBuff[]
  /** Buffs only the rotation turns on (`KitModel.simOnlyBuffs`): off where it doesn't */
  simOnlyBuffs?: { owner: CharacterKey; path: string[] }[]
  /** Each member's Nightsoul's Blessing, on the field or off (its kit's own state), in frames */
  nightsoulSpans?: { characterKey: CharacterKey; start: number; end: number }[]
  /**
   * The enemy's auras over the kept rotation (with `auraTimeline`): from each frame, the auras
   * there (by aura, their durability) until the next entry
   */
  auras?: { t: number; auras: Record<string, number> }[]
  /** Character-clock pauses across all passes, including before the retained interval. */
  hitlagEvents?: Pick<
    SimHit,
    'characterKey' | 't' | 'animationPause' | 'enemyAnimationPause'
  >[]
  notes: string[]
  warnings: string[]
  /** Members without a kit model: their actions were skipped */
  unsupported: CharacterKey[]
  /** The kept rotation's actions: who, which, when it started (frame) and how long it took */
  actions: {
    characterKey: CharacterKey
    text: string
    start: number
    frames: number
    /** Position in the written rotation (its actions in order; absent for automatic entries) */
    index?: number
    /** Position in the opener (its actions in order), for the opener's own actions */
    openerIndex?: number
    /** The kit's own frame count, before a `frameOverrides` edit */
    defaultFrames?: number
    /** Its frame-data key (`actionFrameKey`, with the version its kit played) */
    frameKey?: string
    /** The version its kit played (a mode or stance's), if not the ordinary one */
    variant?: ActionVariant
    /** From an optional action ("E?", "Q?", "Q/N3", "EQ/E") */
    optional?: true
  }[]
  /** The kept rotation's written waits (W1.5), in the same form as `actions` */
  waits?: SimulationResult['actions']
  /**
   * The kept rotation's Skill uses: each time a member's Skill cooldown starts (frame), held or
   * pressed (what an ER calculator counts as a use: Durin's recast is not one)
   */
  skillUses?: { characterKey: CharacterKey; t: number; hold: boolean }[]
  /** Each optional Skill the writer tried, including skips at the end of a loop. */
  optionalSkills?: {
    characterKey: CharacterKey
    text: string
    t: number
    rotationStart: number
    played: boolean
  }[]
  /**
   * Optional full Bursts in the kept span that were skipped (not ready, or left out by
   * `everyNthBursts`): lets `energyFromRotation` tell a cooldown-skipped `Q?` apart from one
   * that fired every rotation.
   */
  skippedOptionalBursts?: { characterKey: CharacterKey; t: number }[]
  /**
   * The kept rotation's swaps: who to whom, when the swap began (frame), how long it took (the
   * swap time) and how long it first waited for the 1 s swap cooldown
   */
  swaps?: {
    from: CharacterKey
    to: CharacterKey
    start: number
    frames: number
    cooldown: number
    /** A kit's own swap (Chiori's Tapestry) */
    forced?: boolean
  }[]
  /**
   * Time spent waiting for an action (or a swap) to be ready, in the kept rotations, frames: by
   * what waited (`<member> <action>`, or `swap <member>`); a rotation that cannot keep its pace
   * shows here
   */
  stalls?: Record<string, number>
  /** The same waits one by one: what waited, from which frame, for how long */
  stallSpans?: { label: string; t: number; frames: number }[]
  /** Each member's actions' own frame data (before `frameData` edits), by `actionFrameKey` */
  actionData?: Partial<
    Record<
      CharacterKey,
      Record<
        string,
        {
          frames: number
          framesInto: Partial<Record<FrameKind, number>>
          /** The action (for a version's row: its button) */
          action?: Pick<RotationAction, 'kind' | 'count' | 'hold' | 'text'>
          /** The version, for a mode or stance's own version of the action */
          variant?: ActionVariant
        }
      >
    >
  >
}

/** The action kinds an action can cancel into (and `swap`: the next action is another member's) */
export type FrameKind = RotationAction['kind'] | 'swap'

/**
 * A player's edit to a character's frame data for one action (see `actionFrameKey`): its length,
 * its cancels into the next action, and a delay added to each of its hits.
 */
export interface ActionFrameEdit {
  /** Its length; its own cancels shift by the same amount */
  frames?: number
  framesInto?: Partial<Record<FrameKind, number>>
  hitDelay?: number
}
export type FrameData = Partial<
  Record<CharacterKey, Record<string, ActionFrameEdit>>
>

/**
 * The frame-data key of an action: skill / skillHold / burst / normal1…normal6 / charged / …, and
 * `<key>@<version>` for a mode or stance's version of it (`skill@stride`)
 */
export const actionFrameKey = (
  a: RotationAction,
  variant?: Pick<ActionVariant, 'key'>
) =>
  (a.kind === 'skill'
    ? a.hold
      ? 'skillHold'
      : 'skill'
    : a.kind === 'normal'
      ? `normal${a.count ?? 1}`
      : a.kind) + (variant ? `@${variant.key}` : '')

/**
 * Members whose kits need the team's stats while the rotation plays (`calculate`): HP drains and
 * heals (Furina, Dahlia, Vodyanitsa, Wriothesley's Revelation and A1, Hydro Traveler's Suffusion,
 * Hu Tao, Gaming, Kuki, Lyney's Prop Arrows down to 60% and his Marechaussee stacks), teammates'
 * damage (Lohen), stat thresholds (Chongyun) and expected crits
 * (Xinyan, Dehya), heal chances (Noelle), Max HP (Kirara C1) and talent-scaled ATK SPD (Mika).
 */
export const ROTATION_CALCULATION_MEMBERS: readonly CharacterKey[] = [
  'Furina',
  'Lohen',
  'Vodyanitsa',
  'Chongyun',
  'Dahlia',
  'Wriothesley',
  'TravelerHydro',
  'HuTao',
  'Gaming',
  'KukiShinobu',
  'Xinyan',
  'Dehya',
  'Noelle',
  'Kirara',
  'Mika',
  'Lyney',
]
/** Weapons whose effects need the calculation (Finale of the Deep's Bond: Max HP, heals) */
const ROTATION_CALCULATION_WEAPONS: readonly string[] = ['FinaleOfTheDeep']
export const needsRotationCalculation = (
  members: readonly CharacterKey[],
  gear?: Partial<Record<CharacterKey, SimGear>>
) =>
  members.some(
    (m) =>
      ROTATION_CALCULATION_MEMBERS.includes(m) ||
      ROTATION_CALCULATION_WEAPONS.includes(gear?.[m]?.weapon ?? '')
  )

/** Native queues run enemy tasks, character tasks, then core tasks each frame. */
type Event = { t: number; priority: number; seq: number; run: () => void }

/**
 * Plays a parsed rotation frame by frame with the members' kits: each action starts when the
 * previous one can be cancelled into it, periodic and triggered damage is scheduled, buffs are
 * windows in time. The rotation is played three times back to back and the middle one is kept,
 * so what carries over from the previous rotation (a summon still ticking, a buff still up) is
 * counted as it is in practice.
 */
/** A frame count to use: a non-number (NaN, Infinity) would never end a wait or an action */
const finiteFrames = (frames: number) => (Number.isFinite(frames) ? frames : 0)

/**
 * The members' own buffs their kits play (a probe: each member's Skill, held Skill, Burst and
 * Normals), per team. The rotation decides these: one it never turns on is off, as it is outside
 * its windows when it does, whatever the loadouts' conditionals say.
 */
const kitBuffCache = new Map<
  string,
  { owner: CharacterKey; path: string[] }[]
>()
let probing = false
function kitBuffs(
  members: CharacterKey[],
  constellations: Partial<Record<CharacterKey, number>>,
  elements: Partial<Record<CharacterKey, HitElement>>,
  kits: Partial<Record<CharacterKey, KitModel>>
) {
  // (only the shipped kits: a test's own kit records what it plays)
  if (!members.every((m) => kits[m] === kitModels[m])) return []
  const key = JSON.stringify([
    members,
    members.map((m) => constellations[m] ?? 0),
    members.map((m) => elements[m]),
  ])
  const cached = kitBuffCache.get(key)
  if (cached) return cached
  const names = members.map((characterKey) => ({
    characterKey,
    name: characterKey,
  }))
  const text = members
    .filter((m) => kits[m])
    .flatMap((m) => [`${m} E Q N3`, `${m} hE`])
    .join(' -> ')
  const refs: { owner: CharacterKey; path: string[] }[] = []
  if (text) {
    probing = true
    try {
      const probe = simulateRotation({
        rotation: parseRotation(text, names),
        members,
        constellations,
        elements,
        kits,
        repeats: 1,
        keep: 'all',
      })
      const known = new Set<string>()
      for (const b of [
        ...probe.buffWindows,
        ...probe.countedBuffs,
        ...probe.hits.flatMap((h) => h.states ?? []),
      ]) {
        const owner = b.owner as CharacterKey
        if (!members.includes(owner) || b.path[0] !== owner) continue
        if (b.path[1]?.startsWith('_')) continue
        const k = JSON.stringify(b.path)
        if (known.has(k)) continue
        known.add(k)
        refs.push({ owner, path: b.path })
      }
    } catch {
      // (a probe that cannot play: no buffs are declared, as before)
    } finally {
      probing = false
    }
  }
  kitBuffCache.set(key, refs)
  return refs
}

export function simulateRotation({
  rotation,
  members,
  constellations,
  elements,
  reactions,
  repeats = 3,
  keep = 'middle',
  kits = kitModels,
  gear = {},
  calculate,
  swapFrames = 12,
  target = { radius: 2, distance: 2.4 },
  random = rotationRandom(0),
  sacrificialRandom = random,
  sacrificial = true,
  auraTrace,
  auraTimeline,
  frameOverrides = {},
  frameData = {},
  openerCounted = false,
  freezeImmune = false,
  normalStrings,
}: {
  rotation: ParsedRotation
  members: CharacterKey[]
  constellations: Partial<Record<CharacterKey, number>>
  elements: Partial<Record<CharacterKey, HitElement>>
  reactions?: RotationReactions
  repeats?: number
  /**
   * Benchmarks retain the same complete fixed-loop interval as the native reference. 'play': every
   * rotation and the opener played before them, from the fight's start (what a timeline shows)
   */
  keep?: 'middle' | 'all' | 'last2' | 'play'
  kits?: Partial<Record<CharacterKey, KitModel>>
  /**
   * Frames spent swapping, with the previous member still on field (KQM's standard: 12). A swap
   * waits on the server, so this is where ping goes (gcsim: frames = ping ms × 2 × 60 / 1000);
   * other actions are not delayed by it.
   */
  swapFrames?: number
  target?: { radius: number; distance: number; maxHp?: number }
  /** The members' artifact sets (pieces), for set effects the simulation plays (Thundering Fury) */
  gear?: Partial<Record<CharacterKey, SimGear>>
  calculate?: RotationCalculation
  random?: () => number
  sacrificialRandom?: () => number
  /** Disable Composed for the ER calculation that assumes no resets. */
  sacrificial?: boolean
  /** Debugging: the reaction engine's aura trace (see `AuraTrace`) */
  auraTrace?: (entry: AuraTrace) => void
  /** Record the enemy's auras over time (`SimulationResult.auras`), for a timeline */
  auraTimeline?: boolean
  /**
   * Player-edited timing: frames until the next action, by the action's position in the written
   * rotation (its actions in order). Hits keep their own timing; everything after shifts.
   */
  frameOverrides?: Partial<Record<number, number>>
  /** Player-edited character frame data, by member and `actionFrameKey` */
  frameData?: FrameData
  /**
   * The opener is the first rotation (played in place of the rotation's first copy) and counted
   * with the rest, as rotations counted from the start are. Otherwise it is played before the
   * rotations and not counted (a setup for the loop)
   */
  openerCounted?: boolean
  /** The enemy can't be frozen (see `ReactionOptions.freezeImmune`) */
  freezeImmune?: boolean
  /** Each Normal Attack string a kit plays: its member and how many hits the whole string has */
  normalStrings?: (characterKey: CharacterKey, length: number) => void
}): SimulationResult {
  const notes = new Set<string>()
  const warnings = [...rotation.warnings]
  const unsupported = members.filter((m) => !kits[m])
  const moonsign = members.reduce((n, m) => n + (kits[m]?.moonsign ?? 0), 0)
  const states = new Map<CharacterKey, unknown>(
    members.map((m) => [m, kits[m]?.init?.()])
  )
  const events: Event[] = []
  let seq = 0
  const push = (t: number, run: () => void, priority = 2) => {
    events.push({ t, priority, seq: seq++, run })
  }
  const hits: SimHit[] = []
  const windows: SimBuffWindow[] = []
  /**
   * The attack-speed windows among them: every context reads its attack speed from these, and a
   * context is made each frame for every Natlan member (the Nightsoul poll), so scanning all the
   * windows each time was most of a rotation's play
   */
  const speedWindows: SimBuffWindow[] = []
  const addWindow = (w: SimBuffWindow) => {
    windows.push(w)
    if (
      w.path[1] === '_attackSpeed' ||
      w.path[1] === '_selfAttackSpeed' ||
      w.path[1] === '_normalAttackSpeed'
    )
      speedWindows.push(w)
  }
  /**
   * Obsidian Codex's 4-piece window (6 s) for an on-field member who consumed Nightsoul points at
   * frame `t`. A draining blessing consumes every frame, so a window still running is extended
   * (the same frames covered) instead of one more window each frame, thousands a rotation
   */
  const codexWindows = new Map<CharacterKey, SimBuffWindow>()
  const codexConsumed = (member: CharacterKey, t: number) => {
    const last = codexWindows.get(member)
    if (last && last.start <= t && t <= last.end) {
      last.end = Math.max(last.end, t + 360)
      return
    }
    const next = {
      owner: member,
      path: ['ObsidianCodex', '4NightsoulConsume'],
      value: 'on',
      start: t,
      end: t + 360,
    }
    codexWindows.set(member, next)
    addWindow(next)
  }
  /** A state that lasts until changed (`SimContext.state`), from frame `t` */
  const setState = (
    t: number,
    owner: SimBuffOwner,
    path: string[],
    value: string
  ) => {
    const key = `${owner}.${path.join('.')}`
    const previous = liveStates.get(key)
    if (previous?.value === value) return
    if (previous) previous.end = t
    const next = {
      owner,
      path,
      value,
      start: t,
      end: Number.MAX_SAFE_INTEGER,
    }
    liveStates.set(key, next)
    addWindow(next)
  }
  const liveStates = new Map<string, SimBuffWindow>()
  const characterTasks = new Set<{ member: CharacterKey; end: number }>()
  /** The enemy's task queue (atEnemy) and the end of its current hitlag freeze */
  const enemyTasks = new Set<{ end: number }>()
  let enemyFrozenUntil = 0
  const pauseEnds = new Map<CharacterKey, number>()
  const pauseTotals = new Map<CharacterKey, number>()
  const characterFrameAt = (member: CharacterKey, t: number) =>
    t -
    (pauseTotals.get(member) ?? 0) +
    Math.max(0, (pauseEnds.get(member) ?? t) - t)
  const actionModifiers = new Map<
    string,
    {
      type: 'cooldown' | 'attackSpeed'
      recipient: CharacterKey
      amount: number
      end: number
    }
  >()
  const actionModifierAt = (
    type: 'cooldown' | 'attackSpeed',
    recipient: CharacterKey,
    t: number
  ) =>
    [...actionModifiers.values()]
      .filter(
        (m) =>
          m.type === type &&
          m.recipient === recipient &&
          characterFrameAt(recipient, t) < m.end
      )
      .reduce((sum, m) => sum + m.amount, 0)
  const cooldownFrames = (
    key: string,
    frames: number,
    member: CharacterKey,
    t: number
  ) => {
    if (!['skill', 'burst', 'skillB', 'coda', 'special'].includes(key))
      return frames
    const resonance =
      members.filter((m) => elements[m] === 'anemo').length >= 2 ? -0.05 : 0
    return Math.trunc(
      frames * (1 + resonance + actionModifierAt('cooldown', member, t))
    )
  }
  /** When each member's cooldowns are ready (frame), by key */
  const cooldowns = new Cooldowns((key) => {
    const [member, action] = key.split('.')
    return (
      kits[member as CharacterKey]?.charges?.(
        constellations[member as CharacterKey] ?? 0
      )[action] ?? 1
    )
  })
  let normalCounter = 0
  let lastNormalActor: CharacterKey | undefined
  const constructs: { end: number; kind?: string }[] = []
  let constructsSpawned = 0
  const infusions: {
    element: HitElement
    start: number
    end: number
    recipient?: CharacterKey
    characterEnd?: number
  }[] = []
  // Elemental reactions (gcsim's reactable: reactions.ts), unless other reactions are given
  const windowOn = (owner: string, cond: string, t: number) =>
    windows.some(
      (w) =>
        w.owner === owner && w.path[1] === cond && w.start <= t && t < w.end
    )
  const auraLog: NonNullable<SimulationResult['auras']> = []
  reactions ??= elementalReactions({
    members,
    elements,
    domainActive: (t) => windowOn('Columbina', 'burstDomain', t),
    // Nilou's A1 (Golden Chalice's Bounty) is on the whole party
    bountiful: (_m, t) => windowOn('Nilou', 'a1AfterSkill', t),
    trace: auraTrace,
    watch: auraTimeline ? (t, auras) => auraLog.push({ t, auras }) : undefined,
    freezeImmune,
  })
  let onField: CharacterKey =
    rotation.opener?.[0]?.characterKey ??
    rotation.steps[0]?.characterKey ??
    members[0]
  /**
   * The context of a kit's `nightsoul` (its points and blessing) and `onNightsoulConsume`. Those
   * read the frame and constellations, and the Nightsoul poll calls them for every Natlan member on
   * every frame, so the full context (its hundred functions) is made only if a hook reads more
   */
  const nightsoulCtx = (t: number, actor: CharacterKey): SimContext => {
    let full: SimContext | undefined
    const constellation = (ck: CharacterKey) => constellations[ck] ?? 0
    return new Proxy({} as SimContext, {
      get: (_, key) =>
        key === 'now'
          ? t
          : key === 'constellation'
            ? constellation
            : Reflect.get((full ??= ctxAt(t, actor)), key),
    })
  }
  /** Whether a member is in their own Nightsoul's Blessing (their kit's state, else its windows) */
  const inNightsoulAt = (k: CharacterKey, t: number): boolean =>
    kits[k]?.nightsoul?.(nightsoulCtx(t, k), states.get(k)).active ??
    windows.some(
      (w) =>
        w.owner === k &&
        /nightsoul|nsBlessing/i.test(w.path[1] ?? '') &&
        w.start <= t &&
        t < w.end
    )
  // The player's own auras (gcsim's ApplySelfInfusion): durability decaying over its frames; a
  // refill tops it up at the same rate
  const playerAuras = new Map<
    HitElement,
    { durability: number; rate: number; at: number }
  >()
  const playerAura = (element: HitElement, t: number) => {
    const a = playerAuras.get(element)
    return a ? a.durability - a.rate * (t - a.at) : 0
  }
  const selfInfuse = (
    element: HitElement,
    durability: number,
    frames: number,
    t: number
  ) => {
    const left = playerAura(element, t)
    const a = playerAuras.get(element)
    if (a && left > 0) {
      if (left < durability) Object.assign(a, { durability, at: t })
      return
    }
    playerAuras.set(element, {
      durability,
      rate: durability / Math.max(1, frames),
      at: t,
    })
  }
  /** When a member's action is ready: its cooldown and its kit's resources */
  /** An optional action already found not ready when the action before it was cancelled */
  let decidedNotReady: RotationAction | undefined
  const actionReadyAt = (
    characterKey: CharacterKey,
    action: RotationAction,
    t: number
  ) => {
    const kit = kits[characterKey]
    if (!kit) return t
    const cdKey = kit.cooldownKey
      ? kit.cooldownKey(states.get(characterKey), action, t)
      : action.kind === 'skill' || action.kind === 'burst'
        ? action.kind
        : undefined
    const cooldownReady = cdKey
      ? cooldowns.readyAt(`${characterKey}.${cdKey}`, t)
      : t
    const resourceReady =
      kit.actionReadyAt?.(
        ctxAt(t, characterKey),
        states.get(characterKey),
        action
      ) ?? t
    return Math.max(cooldownReady, resourceReady)
  }
  const linkedCooldowns = (k: CharacterKey, key: string) => [
    key,
    ...(kits[k]?.linkedCooldowns?.[key] ?? []),
  ]
  // set effects the simulation plays (gearEffects.ts)
  const gearFx = gearEffects({
    members,
    gear,
    inNightsoul: (k, t) => inNightsoulAt(k, t),
    onField,
    window: (owner, path, value, start, end, offOnly) =>
      addWindow({
        owner,
        path,
        value,
        start,
        end,
        late: true,
        ...(offOnly ? { offOnly: true } : {}),
      }),
    reduceCooldown: (k, key, frames, t) => {
      for (const linked of linkedCooldowns(k, key))
        cooldowns.reduce(`${k}.${linked}`, t, frames)
    },
    ...(sacrificial && {
      sacrificial: {
        random: sacrificialRandom,
        reset: (k, t) => {
          for (const key of linkedCooldowns(k, 'skill'))
            cooldowns.reset(`${k}.${key}`, t)
        },
      },
    }),
    onShield: (t) => refreshGeoResonance(t),
  })
  let now = 0
  /** The action being played (its actor and start), for triggered hitlag that lengthens it */
  let currentAction: { actor: CharacterKey; start: number } | undefined
  let swapReadyAt = 0
  const natlan = members.filter(
    (m) => getCharStat(m).region === 'natlan'
  ).length
  const nightsoulInterval = [0, 1080, 720, 540, 540][natlan] ?? 540
  // Enduring Rock (gcsim): while the member on the field is shielded or Moondrifts are near,
  // checked every 1 s and on each swap and shield
  const geoTeam =
    members.length === 4 &&
    members.filter((m) => elements[m] === 'geo').length >= 2
  let geoResonance = false
  let geoResonanceToken = 0
  const refreshGeoResonance = (frame: number) => {
    if (!geoTeam) return
    const token = ++geoResonanceToken
    const tick = (t: number) => {
      if (token !== geoResonanceToken) return
      geoResonance =
        gearFx.shieldedAt(onField, t) || (reactions?.moondriftsAt?.(t) ?? 0) > 0
      ctxAt(t, onField).state(
        'team',
        ['resonance', 'EnduringRock'],
        geoResonance ? 'on' : ''
      )
      push(t + 60, () => tick(t + 60))
    }
    tick(frame)
  }
  let nightsoulReady = 0
  const reportedConsumption = new Map<CharacterKey, number>()

  let health: Health | undefined
  let healthFrame = 0
  /**
   * The buff states a calculation reads at a frame (`snapshotAt`), indexed as windows and hits
   * come in. A team with tracked HP calculates at every HP check (Furina's Salon drains, a
   * healer's ticks: thousands a rotation), and building every buff's state from all the windows
   * and hits each time was most of its play (seconds). The same states, in the same order, as
   * `buffStates` reads them: the windows' buffs, then those only hits' own states name.
   */
  type SnapshotRef = {
    owner: SimBuffOwner
    path: string[]
    windows: SimBuffWindow[]
  }
  const windowRefs = new Map<string, SnapshotRef>()
  const stateRefs = new Map<string, SnapshotRef>()
  let windowsIndexed = 0
  let hitsIndexed = 0
  const indexStates = (hit: SimHit) => {
    for (const s of hit.states ?? []) {
      if (s.path[1]?.startsWith('_')) continue
      const key = refKey(s)
      if (!windowRefs.has(key) && !stateRefs.has(key))
        stateRefs.set(key, { owner: s.owner, path: s.path, windows: [] })
    }
  }
  /** Each hitlag window's end for a character so far: the pauses read, continued from there */
  const hitlagEnds = new WeakMap<
    SimBuffWindow,
    Map<CharacterKey, HitlagEnd & { base: number; read: number }>
  >()
  const snapshotEnd = (w: SimBuffWindow, character: CharacterKey) => {
    if (!w.hitlag) return w.end
    let byCharacter = hitlagEnds.get(w)
    if (!byCharacter) hitlagEnds.set(w, (byCharacter = new Map()))
    let known = byCharacter.get(character)
    // (a window ended early again: its pauses read anew)
    if (!known || known.base !== w.end)
      byCharacter.set(
        character,
        (known = { base: w.end, read: 0, end: w.end, enemyPauseEnd: -1 })
      )
    // (every hit is a pause, as a calculation's snapshot reads them; the last one may still be
    // landing, but its pause is set as it lands, before anything calculates)
    extendHitlagEnd(w, character, hits, known.read, known)
    known.read = hits.length
    return known.end
  }
  const snapshotAt = (t: number, member: CharacterKey) => {
    for (; windowsIndexed < windows.length; windowsIndexed++) {
      const w = windows[windowsIndexed]
      if (w.path[1]?.startsWith('_')) continue
      const key = refKey(w)
      let ref = windowRefs.get(key)
      if (!ref) {
        ref = { owner: w.owner, path: w.path, windows: [] }
        stateRefs.delete(key)
        windowRefs.set(key, ref)
      }
      ref.windows.push(w)
    }
    // (the last hit may still be landing: the kits give it states as it lands, read again)
    for (; hitsIndexed < hits.length - 1; hitsIndexed++)
      indexStates(hits[hitsIndexed])
    if (hits.length) indexStates(hits[hits.length - 1])
    const states: { owner: SimBuffOwner; path: string[]; value: string }[] = []
    for (const refs of [windowRefs, stateRefs])
      for (const ref of refs.values()) {
        const on: SimBuffWindow[] = []
        for (const w of ref.windows)
          if (
            w.start <= t &&
            t < snapshotEnd(w, member) &&
            (!w.recipient || w.recipient === member)
          )
            on.push(w)
        states.push({
          owner: ref.owner,
          path: ref.path,
          value: windowsValue(ref.path, on),
        })
      }
    return { t, onField, states }
  }
  const calculateAt = (t: number, member: CharacterKey, path: string[]) => {
    if (!calculate) return undefined
    return calculate(member, path, snapshotAt(t, member).states, onField)
  }
  const hpChanged = (t: number, change: HpChange) => {
    if (change.amount > 1e-9)
      ctxAt(t, change.characterKey).hit(0, {
        path: ['_marker', 'hpChange'],
        tag: 'other',
        element: 'physical',
        label: change.kind === 'drain' ? 'Tracked HP drain' : 'Tracked HP heal',
      })
    for (const member of members)
      kits[member]?.onHpChange?.(ctxAt(t, member), states.get(member), change)
  }
  const healAt = (
    t: number,
    source: CharacterKey,
    target: CharacterKey,
    raw: number,
    party: boolean
  ) => {
    if (!health) return
    const outgoing = calculateAt(t, source, ['total', 'heal_']) ?? 0
    const incoming = calculateAt(t, target, ['total', 'incHeal_']) ?? 0
    healthFrame = t
    const result = health.heal(target, raw * (1 + outgoing + incoming))
    hpChanged(t, {
      ...result,
      source,
      characterKey: target,
      kind: 'heal',
      party,
    })
  }
  const ctxAt = (t: number, actor: CharacterKey): SimContext => ({
    now: t,
    onField,
    healthTracked: !!health,
    damageTracked: !!calculate?.damage,
    calculate: (member, path) => calculateAt(t, member, path),
    snapshot: (member = actor) => snapshotAt(t, member),
    hpRatio: (member) => {
      healthFrame = t
      return health?.ratio(member)
    },
    drainHp(member, fraction, threshold = 0) {
      if (!health) return 0
      healthFrame = t
      const result = health.drain(member, fraction, threshold)
      hpChanged(t, {
        ...result,
        source: actor,
        characterKey: member,
        kind: 'drain',
        party: false,
      })
      return result.amount
    },
    healPercent(source, fraction, targets = members) {
      // (a heal event for what heals trigger, as kit heals are: Tidal Shadow, Dialogues; no sheet
      // node, so it heals nothing itself: the tracked HP below does)
      ctxAt(t, source).hit(0, {
        characterKey: source,
        path: ['_heal', '_percent'],
        tag: 'other',
        element: 'physical',
        healTargets: [...targets],
        label: 'Heal (Max HP %)',
      })
      for (const member of targets) {
        const max = calculateAt(t, member, ['total', 'hp'])
        if (max) healAt(t, source, member, max * fraction, targets.length > 1)
      }
    },
    members,
    moonsign,
    random,
    moondrifts: reactions?.moondriftsAt?.(t) ?? 0,
    get dew() {
      return reactions?.dewAt?.(t) ?? 0
    },
    consumeDew(amount) {
      return reactions?.consumeDewAt?.(t, amount) ?? 0
    },
    addMoonridgeDew() {
      reactions?.addMoonridgeDew?.()
    },
    inNightsoul: (member) => inNightsoulAt(member, t),
    boostDew(duration, rate) {
      reactions?.boostDew?.(t, t + duration, rate)
    },
    endDewBoost() {
      reactions?.endDewBoost?.(t)
    },
    ruptureDendroCores() {
      reactions?.ruptureCores?.(ctxAt(t, actor))
    },
    suppressCores(duration) {
      return reactions?.suppressCores?.(t, duration) ?? 0
    },
    triggerHarmony() {
      reactions?.triggerForcedHarmony?.(ctxAt(t, actor), actor, (mHit) =>
        land({ ...mHit, onField })
      )
    },
    get isBurning() {
      return reactions?.burningAt?.(t) ?? false
    },
    get isFrozen() {
      return reactions?.frozenAt?.(t) ?? false
    },
    radiance: reactions?.radianceAt?.(t),
    hasStellarSwirl:
      reactions?.stellarSwirlAt?.(t) ?? reactions?.radianceAt?.(t) === 'swirl',
    constellation: (ck) => constellations[ck] ?? 0,
    partyCount: (el) => members.filter((m) => elements[m] === el).length,
    normalSequence(length, count) {
      normalStrings?.(actor, length)
      const first = normalCounter % length
      normalCounter = (first + count) % length
      return first
    },
    target,
    swapFrames,
    attackSpeed: speedWindows
      .filter(
        (w) =>
          (w.path[1] === '_attackSpeed' ||
            (w.path[1] === '_selfAttackSpeed' && w.owner === actor)) &&
          w.start <= t &&
          t < w.end &&
          (!w.recipient || w.recipient === actor)
      )
      .reduce(
        (total, w) => total + Number(w.value),
        actionModifierAt('attackSpeed', actor, t)
      ),
    normalAttackSpeed: (continuing) =>
      ctxAt(t, actor).attackSpeed +
      // (a weapon's Normal Attack SPD: its wielder's, or each recipient's)
      speedWindows
        .filter(
          (w) =>
            w.path[1] === '_normalAttackSpeed' &&
            (w.recipient ?? w.owner) === actor &&
            w.start <= t &&
            t < w.end
        )
        .reduce((total, w) => total + Number(w.value), 0) +
      members.reduce(
        (total, m) =>
          total +
          (kits[m]?.normalAttackSpeed?.(
            ctxAt(t, m),
            states.get(m),
            actor,
            continuing || lastNormalActor === actor
          ) ?? 0),
        0
      ),
    normalAnimationDelay: (member, kind) =>
      kits[member]?.normalAnimationDelay?.(
        ctxAt(t, member),
        states.get(member),
        kind
      ) ??
      NORMAL_START_DELAYS[member]?.[kind === 'xingqiu' ? 0 : 1] ??
      0,
    absorb: (priority, opts) => {
      if (!opts?.player) return reactions?.absorbAt?.(t, priority)
      // (gcsim's AbsorbCheck: for each element in turn, the enemy's aura, then the player's)
      return (priority ?? ['pyro', 'hydro', 'electro', 'cryo']).find(
        (e) => reactions?.absorbAt?.(t, [e]) === e || playerAura(e, t) > 1e-9
      )
    },
    selfInfuse: (element, durability, frames) =>
      selfInfuse(element, durability, frames, t),
    nightsoulBurst() {
      push(t, () => {
        hits.push({
          t,
          characterKey: actor,
          onField,
          path: ['_nightsoulBurst'],
          tag: 'other',
          element: 'physical',
          label: 'Nightsoul Burst',
        })
        for (const m of members)
          kits[m]?.onNightsoulBurst?.(ctxAt(t, m), states.get(m))
      })
    },
    get teamNightsoul() {
      return members.reduce(
        (total, m) =>
          total +
          (kits[m]?.nightsoul?.(nightsoulCtx(t, m), states.get(m)).points ?? 0),
        0
      )
    },
    hasBuff: (owner, path) =>
      windows.some(
        (w) =>
          w.owner === owner &&
          w.path.join('.') === path.join('.') &&
          w.value !== '' &&
          w.start <= t &&
          t < w.end
      ),
    constructs: constructs.filter((x) => x.end > t).length,
    constructsSpawned,
    construct: (duration, { kind, replace = true } = {}) => {
      if (kind && replace)
        for (let i = constructs.length - 1; i >= 0; i--)
          if (constructs[i].kind === kind && constructs[i].end > t) {
            constructs[i].end = t
            break
          }
      constructs.push({ end: t + duration, kind })
      constructsSpawned++
    },
    hit(delay, h) {
      const at = t + Math.max(0, delay)
      const characterKey = h.characterKey ?? actor
      const hit: SimHit = { ...h, characterKey, t: at, onField }
      if (h.snapshotDelay !== undefined && h.snapshotDelay <= delay) {
        const s = Math.max(0, h.snapshotDelay)
        hit.snapshotT = t + s
        hit.snapshotOnField = onField
        const capture = () => {
          const snapshot = snapshotAt(t + s, characterKey)
          hit.snapshotOnField = snapshot.onField
          hit.snapshotStates = snapshot.states
        }
        if (s > 0) push(t + s, capture)
        else capture()
      }
      if (hit.contributors?.length)
        for (const m of members)
          kits[m]?.onReactionSnapshot?.(ctxAt(t, m), states.get(m), hit)
      push(
        at,
        () => land({ ...hit, onField }),
        delay <= 0 && processingT === at ? -1 : 2
      )
    },
    buff(owner, path, value, delay, duration, options) {
      const start = t + Math.max(0, delay)
      const opts = typeof options === 'number' ? { max: options } : options
      addWindow({
        owner,
        path,
        value,
        start,
        end: start + duration,
        ...opts,
      })
    },
    state: (owner, path, value) => setState(t, owner, path, value),
    infuse(element, delay, duration, recipient) {
      const start = t + Math.max(0, delay)
      infusions.push({
        element,
        start,
        end: start + duration,
        recipient,
        characterEnd: recipient
          ? ctxAt(t, actor).characterFrame(recipient) +
            Math.max(0, delay) +
            duration
          : undefined,
      })
    },
    atEnemy(delay, fn) {
      if (delay <= 0) return fn(ctxAt(t, actor))
      const task = { end: t + delay }
      enemyTasks.add(task)
      const run = (frame: number) => {
        if (frame < task.end) {
          const next = task.end
          push(next, () => run(next), 0)
          return
        }
        enemyTasks.delete(task)
        fn(ctxAt(frame, actor))
      }
      // (the frame it was queued for: a later hitlag extension reschedules it from there)
      const first = task.end
      push(first, () => run(first), 0)
    },
    atCharacter(member, delay, fn) {
      const task = { member, end: t + Math.max(0, delay) }
      characterTasks.add(task)
      const run = (frame: number) => {
        if (frame < task.end) {
          const next = task.end
          push(next, () => run(next), 1)
          return
        }
        characterTasks.delete(task)
        fn(ctxAt(frame, actor))
      }
      const first = task.end
      push(first, () => run(first), 1)
    },
    characterFrame: (member) => characterFrameAt(member, t),
    at(delay, fn) {
      const at = t + Math.max(0, delay)
      // (same-frame tasks run in scheduling order: lower seq first)
      push(at, () => fn(ctxAt(at, actor)))
    },
    setCooldown(key, frames, ck) {
      cooldowns.set(
        `${ck ?? actor}.${key}`,
        t,
        cooldownFrames(key, frames, ck ?? actor, t)
      )
    },
    spendCooldown(key, frames, ck) {
      cooldowns.spend(
        `${ck ?? actor}.${key}`,
        t,
        cooldownFrames(key, frames, ck ?? actor, t)
      )
    },
    restartCooldown(key, frames, ck) {
      cooldowns.restart(
        `${ck ?? actor}.${key}`,
        t,
        cooldownFrames(key, frames, ck ?? actor, t)
      )
    },
    cooldownReadyAt: (key, ck) => cooldowns.readyAt(`${ck ?? actor}.${key}`, t),
    modifyCooldown(source, amount, duration, recipient = actor) {
      actionModifiers.set(`${recipient}.cooldown.${source}`, {
        type: 'cooldown',
        recipient,
        amount,
        end: characterFrameAt(recipient, t) + duration,
      })
    },
    modifyAttackSpeed(source, amount, duration, recipient = actor) {
      actionModifiers.set(`${recipient}.attackSpeed.${source}`, {
        type: 'attackSpeed',
        recipient,
        amount,
        end: characterFrameAt(recipient, t) + duration,
      })
    },
    reduceCooldown(key, frames, ck) {
      for (const linked of linkedCooldowns(ck ?? actor, key))
        cooldowns.reduce(`${ck ?? actor}.${linked}`, t, frames)
    },
    resetCooldown: (key, count, ck) => {
      for (const linked of linkedCooldowns(ck ?? actor, key))
        cooldowns.reset(`${ck ?? actor}.${linked}`, t, count)
    },
    takeShards: (arrive) => gearFx.takeShards(ctxAt(t, actor), actor, arrive),
    consumeNightsoul(amount, member = actor) {
      if (amount <= 0) return
      reportedConsumption.set(
        member,
        (reportedConsumption.get(member) ?? 0) + amount
      )
      if (member === onField) codexConsumed(member, t)
      for (const recipient of members)
        kits[recipient]?.onNightsoulConsume?.(
          ctxAt(t, recipient),
          states.get(recipient),
          member,
          amount
        )
    },
    // (a KQM candidate set counts as worn for the per-hit set states: Blizzard Strayer…)
    sets: (ck) => ({
      ...Object.fromEntries(
        (gear[ck]?.candidates?.sets ?? []).map((set) => [set, 4])
      ),
      ...(gear[ck]?.sets ?? {}),
    }),
    note: (text) => notes.add(text),
    warn: (text) => {
      if (!warnings.includes(text)) warnings.push(text)
    },
  })

  const land = (hit: SimHit) => {
    // a party infusion on the on-field melee member's Physical attacks (the first one up)
    if (
      hit.element === 'physical' &&
      (hit.tag === 'normal' || hit.tag === 'charged' || hit.tag === 'plunge') &&
      hit.characterKey === hit.onField &&
      MELEE.includes(getCharStat(hit.characterKey).weaponType)
    ) {
      const inf = infusions.find(
        (i) =>
          i.start <= hit.t &&
          (!i.recipient || i.recipient === hit.characterKey) &&
          (i.recipient && i.characterEnd !== undefined
            ? ctxAt(hit.t, hit.characterKey).characterFrame(i.recipient) <
              i.characterEnd
            : hit.t < i.end)
      )
      if (inf) hit.element = inf.element
    }
    hits.push(hit)
    // Character-clock pauses carry no attack, element application, or coordinated-hit proc.
    if (hit.path.join('.') === '_marker.hitlag') {
      hit.enemyAnimationPause ??= hit.animationPause
      const oldEnd = pauseEnds.get(hit.characterKey) ?? hit.t
      const end = Math.max(oldEnd, hit.t + (hit.animationPause ?? 0))
      hit.animationPause = Math.max(0, end - Math.max(hit.t, oldEnd))
      pauseEnds.set(hit.characterKey, end)
      pauseTotals.set(
        hit.characterKey,
        (pauseTotals.get(hit.characterKey) ?? 0) + (hit.animationPause ?? 0)
      )
      for (const task of characterTasks)
        if (task.member === hit.characterKey && task.end >= hit.t)
          task.end += hit.animationPause ?? 0
      // a triggered hitlag on the acting character pauses its current action too
      if (
        hit.extendsAction &&
        currentAction?.actor === hit.characterKey &&
        hit.t >= currentAction.start &&
        hit.t < now
      )
        now += hit.animationPause ?? 0
      kits[hit.characterKey]?.onHitlag?.(
        ctxAt(hit.t, hit.characterKey),
        states.get(hit.characterKey),
        hit.animationPause ?? 0
      )
      // the enemy is frozen too (its aura decay and hitlag statuses pause) and its task queue
      // waits (gcsim: max(new, frozen) − frozen frames)
      const enemyEnd = Math.max(
        enemyFrozenUntil,
        hit.t + Math.ceil(hit.enemyAnimationPause ?? 0)
      )
      const ext = enemyEnd - Math.max(enemyFrozenUntil, hit.t)
      enemyFrozenUntil = enemyEnd
      if (ext > 0) for (const task of enemyTasks) task.end += ext
      reactions?.onHit(ctxAt(hit.t, hit.characterKey), hit)
      return
    }
    if (hit.path[0] === '_heal') {
      // (`healPercent`'s event: its heal is already done)
      if (health && hit.path[1] !== '_percent') {
        const source = hit.characterKey
        const value = calculateAt(hit.t, source, [
          'display',
          ...hit.path.slice(1),
        ])
        if (value !== undefined) {
          const outgoing = calculateAt(hit.t, source, ['total', 'heal_']) ?? 0
          const incoming =
            calculateAt(hit.t, source, ['total', 'incHeal_']) ?? 0
          const raw = value / (1 + outgoing + incoming)
          const targets =
            hit.healTargets ??
            ((hit.weight ?? 1) === members.length ? members : [onField])
          for (const target of targets)
            healAt(hit.t, source, target, raw, targets.length > 1)
        }
      }
      gearFx.onHit(ctxAt(hit.t, hit.characterKey), hit)
      return
    }
    const index = hits.length - 1
    for (const m of members)
      kits[m]?.onBeforeHit?.(ctxAt(hit.t, m), states.get(m), hit)
    const damageListeners = members.filter(
      (m) =>
        kits[m]?.onDamage &&
        (kits[m]?.observesDamage?.(ctxAt(hit.t, m), states.get(m), hit) ?? true)
    )
    // Capture before hit-triggered buffs change. Reaction assignment is resolved below.
    const damageAttack =
      damageListeners.length && !hit.path[0].startsWith('_')
        ? rotationAttacks(
            {
              hits: [hit],
              frames: 0,
              start: 0,
              buffWindows: windows,
              countedBuffs: members.flatMap((m) =>
                (
                  kits[m]?.countedBuffs?.(hits, constellations[m] ?? 0).buffs ??
                  []
                ).map((buff) => ({
                  ...buff,
                  hits: new Set(buff.hits.has(index) ? [0] : []),
                }))
              ),
              hitlagEvents: hits,
              notes: [],
              warnings: [],
              unsupported: [],
              actions: [],
            },
            () => '__timeline__'
          )[hit.characterKey]?.[0]
        : undefined
    for (const m of members) {
      const kit = kits[m]
      kit?.onHit?.(ctxAt(hit.t, m), states.get(m), hit, index)
    }
    reactions?.onHit(ctxAt(hit.t, hit.characterKey), hit)
    if (damageAttack) {
      damageAttack.reaction = hit.reaction
      damageAttack.bonusStats = hit.bonusStats
      const auraStates =
        hit.states?.filter((s) =>
          [
            'resonance.ShatteringIce',
            'BlizzardStrayer.state',
            'Lavawalker.state',
            'Thundersoother.state',
          ].includes(s.path.join('.'))
        ) ?? []
      if (auraStates.length)
        damageAttack.states = [
          ...(damageAttack.states ?? []).filter(
            (s) => !auraStates.some((a) => sameRef(a, s))
          ),
          ...auraStates,
        ]
      const outcomes = calculate?.damage?.(hit.characterKey, damageAttack)
      for (const m of damageListeners)
        kits[m]?.onDamage?.(ctxAt(hit.t, m), states.get(m), hit, outcomes)
    }
    gearFx.onHit(ctxAt(hit.t, hit.characterKey), hit)
    if (
      geoTeam &&
      geoResonance &&
      hit.characterKey === hit.onField &&
      !hit.path[0].startsWith('_')
    )
      ctxAt(hit.t, hit.characterKey).buff(
        'team',
        ['resonance', 'EnduringRockHit'],
        'on',
        1,
        900,
        { hitlag: 'recipient' }
      )
    if (
      natlan &&
      hit.element !== 'physical' &&
      !hit.path[0].startsWith('_') &&
      hit.t >= nightsoulReady
    ) {
      nightsoulReady = hit.t + nightsoulInterval
      ctxAt(hit.t, hit.characterKey).nightsoulBurst()
    }
  }

  /**
   * Runs every event before `t` (in time order); `inclusive`: also those at `t` (gcsim runs what is
   * queued for a frame before the action that starts on it, e.g. a hit landing on its swap frame)
   */
  /** The frame of the event being run (a zero-delay hit queued from it lands next, as gcsim's
   * QueueAttack with no delay applies at once, before other tasks queued for that frame) */
  let processingT: number | undefined
  const runUntil = (t: number, inclusive = false) => {
    for (;;) {
      let best = -1
      for (let i = 0; i < events.length; i++)
        if (
          (inclusive ? events[i].t <= t : events[i].t < t) &&
          (best < 0 ||
            events[i].t < events[best].t ||
            (events[i].t === events[best].t &&
              (events[i].priority < events[best].priority ||
                (events[i].priority === events[best].priority &&
                  events[i].seq < events[best].seq))))
        )
          best = i
      if (best < 0) return
      const [e] = events.splice(best, 1)
      processingT = e.t
      e.run()
      processingT = undefined
    }
  }

  for (const member of members) {
    const ctx = ctxAt(0, member)
    if (member.startsWith('Traveler')) {
      // Native TravelerStoryBuffs defaults to all completed quests/resonances.
      for (const name of [
        'bonusCanned',
        'bonusSkirk1',
        'bonusSkirk2',
        'bonusSkirk3',
        'lockedPassive',
        ...['anemo', 'geo', 'electro', 'dendro', 'hydro', 'pyro', 'cryo'].map(
          (e) => `traveler${e}`
        ),
      ])
        ctx.state(member, ['Traveler', name], 'on')
      ctx.note(
        'Traveler: story quest bonuses and all elemental resonances are assumed unlocked.'
      )
    }
    kits[member]?.onStart?.(ctx, states.get(member))
  }
  if (calculate) {
    health = new Health(
      (member) =>
        calculateAt(healthFrame, member, ['total', 'hp']) ?? Number.NaN
    )
    for (const member of members) health.ratio(member)
  }

  const flat: { characterKey: CharacterKey; action: RotationAction }[] = []
  for (const step of rotation.steps)
    for (const action of step.actions)
      flat.push({ characterKey: step.characterKey, action })
  const loopTo = rotation.loopsTo ?? rotation.steps[0]?.characterKey
  const openerFlat: typeof flat = (rotation.opener ?? []).flatMap((step) =>
    step.actions.map((action) => ({ characterKey: step.characterKey, action }))
  )

  const bounds: number[] = []
  const previousNightsoul = new Map<
    CharacterKey,
    { active: boolean; points: number }
  >()
  const nightsoulSpans: NonNullable<SimulationResult['nightsoulSpans']> = []
  const openNightsoul = new Map<CharacterKey, (typeof nightsoulSpans)[number]>()
  let resourcePolling = true
  const pollNightsoul = (frame: number) => {
    if (!resourcePolling) return
    for (const m of members) {
      const kit = kits[m]
      if (!kit?.nightsoul) continue
      const next = kit.nightsoul(nightsoulCtx(frame, m), states.get(m))
      const previous = previousNightsoul.get(m)
      if (
        previous?.active &&
        next.active &&
        next.points < previous.points - 1e-7
      ) {
        const amount = Math.max(
          0,
          previous.points - next.points - (reportedConsumption.get(m) ?? 0)
        )
        // (a draining blessing consumes points every frame: its hooks get a light context)
        if (amount > 0 && m === onField) codexConsumed(m, frame)
        for (const recipient of amount > 0 ? members : [])
          kits[recipient]?.onNightsoulConsume?.(
            nightsoulCtx(frame, recipient),
            states.get(recipient),
            m,
            amount
          )
      }
      if (previous !== undefined && next.points > previous.points + 1e-7) {
        const gain = next.points - previous.points
        for (const recipient of members)
          kits[recipient]?.onNightsoulGain?.(
            nightsoulCtx(frame, recipient),
            states.get(recipient),
            m,
            gain
          )
      }
      setState(
        frame,
        m,
        ['ObsidianCodex', '2NightsoulBlessing'],
        next.active && m === onField ? 'on' : ''
      )
      if (next.active && !previous?.active) {
        const span = {
          characterKey: m,
          start: frame,
          end: Number.MAX_SAFE_INTEGER,
        }
        nightsoulSpans.push(span)
        openNightsoul.set(m, span)
      } else if (!next.active && previous?.active) {
        const open = openNightsoul.get(m)
        if (open) open.end = frame
        openNightsoul.delete(m)
      }
      reportedConsumption.delete(m)
      previousNightsoul.set(m, next)
    }
    push(frame + 1, () => pollNightsoul(frame + 1))
  }
  if (natlan) {
    for (const m of members)
      ctxAt(0, m).buff(m, ['ObsidianCodex', '4NightsoulConsume'], '', 0, 0)
    push(0, () => pollNightsoul(0))
  }
  if (geoTeam) refreshGeoResonance(0)
  const actions: SimulationResult['actions'] = []
  const skillUses: NonNullable<SimulationResult['skillUses']> = []
  const optionalSkills: NonNullable<SimulationResult['optionalSkills']> = []
  const skippedOptionalBursts: NonNullable<
    SimulationResult['skippedOptionalBursts']
  > = []
  const waits: SimulationResult['actions'] = []
  const swaps: NonNullable<SimulationResult['swaps']> = []
  /** Waits for readiness: what waited, when it began, how long */
  const stalled: { label: string; t: number; frames: number }[] = []
  const actionData: NonNullable<SimulationResult['actionData']> = {}
  /** Groups ("[Q EEE]?"): whether each one's first action played this time */
  const groupsPlayed = new Map<number, boolean>()
  /** The action before a written wait: the action after the wait respects its cancels */
  let animationLock:
    | { start: number; result: ActionResult; actor: CharacterKey }
    | undefined
  // one written action: the opener's (played once before the loops) or the loop's
  const play = (
    list: typeof flat,
    i: number,
    r: number,
    opener: boolean,
    /** An optional action's alternative: what comes after it (the action after the optional) */
    alternative?: { next: (typeof flat)[number] | undefined }
  ) => {
    const { characterKey, action } = list[i]
    // (the rest of a group, "[Q EEE]?": only when its first action played)
    if (action.inGroup !== undefined && !groupsPlayed.get(action.inGroup))
      return
    if (action.group !== undefined) groupsPlayed.set(action.group, false)
    // (an alternative's own frames and timeline place: none of the written list's)
    const own = !opener && !alternative
    const kit = kits[characterKey]
    const recordOptionalSkill = (played: boolean) => {
      if (action.optional && action.kind === 'skill')
        optionalSkills.push({
          characterKey,
          text: action.text,
          t: now,
          rotationStart: bounds[r] ?? -1,
          played,
        })
    }
    // an action's alternative ("Q/N3": N3 when Q is not played), then on to what follows it
    const playOtherwise = (otherwise: RotationAction[]) => {
      // (a group's alternative is followed by what comes after the whole group)
      const after =
        list
          .slice(i + 1)
          .find(
            (x) =>
              action.group === undefined || x.action.inGroup !== action.group
          ) ??
        (alternative
          ? alternative.next
          : opener
            ? flat[0]
            : loopTo
              ? { characterKey: loopTo, action: flat[0]?.action }
              : undefined)
      const alt = otherwise.map((a) => ({ characterKey, action: a }))
      for (const j of alt.keys())
        play(alt, j, r, opener, { next: alt[j + 1] ?? after })
    }
    // (a triggered hitlag on the acting character can lengthen the previous action: settle it)
    for (let settled = -1; settled !== now; ) {
      settled = now
      runUntil(now, true)
    }
    // after a wait, the next action still waits for the action before the wait to allow it
    if (animationLock && action.kind !== 'wait') {
      const lock = animationLock
      animationLock = undefined
      const until =
        lock.start +
        kitFramesInto(
          lock.result,
          characterKey !== lock.actor ? 'swap' : action.kind
        )
      if (until > now) {
        now = until
        runUntil(now, true)
      }
    }
    if (characterKey !== onField) {
      const swapWaitStart = now
      for (;;) {
        const inReady = kit?.swapReadyAt?.(states.get(characterKey), now) ?? now
        const outReady =
          kits[onField]?.swapOutReadyAt?.(
            ctxAt(now, onField),
            states.get(onField)
          ) ?? now
        const until = Math.max(inReady, outReady)
        if (until <= now || now - swapWaitStart >= 30 * FPS) break
        now = Math.min(until, ...events.map((e) => e.t))
        runUntil(now, true)
      }
      if (now > swapWaitStart) {
        stalled.push({
          label: `swap ${characterKey}`,
          t: swapWaitStart,
          frames: now - swapWaitStart,
        })
        if (r === Math.min(1, repeats - 1))
          notes.add(
            `Waited ${((now - swapWaitStart) / FPS).toFixed(1)} s before swapping from ${onField} to ${characterKey}.`
          )
      }
      // Swapping has a 1 s cooldown. The old member stays active until the swap completes.
      const swapStart = Math.max(now, swapReadyAt)
      swaps.push({
        from: onField,
        to: characterKey,
        start: swapStart,
        frames: swapFrames,
        cooldown: swapStart - now,
      })
      now = swapStart + swapFrames
      runUntil(now, true)
      const prev = kits[onField]
      prev?.onSwapOut?.(ctxAt(now, onField), states.get(onField))
      gearFx.onSwap(now, onField, characterKey, ctxAt(now, onField))
      const from = onField
      onField = characterKey
      refreshGeoResonance(now)
      for (const member of members)
        kits[member]?.onPartySwap?.(
          ctxAt(now, member),
          states.get(member),
          from,
          onField
        )
      normalCounter = 0
      lastNormalActor = undefined
      swapReadyAt = now + FPS
      const entry = kit?.onSwapIn?.(
        ctxAt(now, characterKey),
        states.get(characterKey)
      )
      if (entry) {
        const frames = kitFramesInto(
          entry,
          action.kind === 'swap' ? 'swap' : action.kind
        )
        actions.push({ characterKey, text: 'Entry', start: now, frames })
        now += frames
        runUntil(now, true)
      } else if (
        (action.kind === 'swap' || action.kind === 'wait') &&
        r === Math.min(1, repeats - 1)
      ) {
        const why = kit?.noEntryReason?.(states.get(characterKey), now)
        if (why)
          notes.add(`${characterKey}: no entry action on this swap-in: ${why}.`)
      }
      // Zero-delay swap/entry tasks resolve before the new member's first
      // action. Otherwise a queued passive can observe a buff that the
      // following action creates and retroactively enable itself.
      runUntil(now, true)
    }
    if (!kit) return
    // a swap-only step: the swap (and any swap-in effect) was all of it
    if (action.kind === 'swap') {
      lastNormalActor = undefined
      return
    }
    if (action.kind === 'wait') {
      lastNormalActor = undefined
      // a walk ends the Normal Attack string (gcsim resets it on any action but an attack); idle
      // time does not
      if (action.walk) normalCounter = 0
      const defaultFrames = finiteFrames(Math.round((action.count ?? 0) * FPS))
      // (a length that is not a number would never end the wait: 0 instead)
      const frames = finiteFrames(
        Math.max(0, (own ? frameOverrides[i] : undefined) ?? defaultFrames)
      )
      waits.push({
        characterKey,
        text: action.text,
        start: now,
        frames,
        index: own ? i : undefined,
        ...(opener && !alternative && { openerIndex: i }),
        defaultFrames,
      })
      kit.onWait?.(ctxAt(now, characterKey), states.get(characterKey), frames)
      now += frames
      return
    }
    // A Burst every Nth rotation, not in this copy: only the member's short Burst plays (Varesa's
    // Volcanic Kablam, Flins' Thunderous Symphony, which spend part of the Energy); the full one is
    // left out
    if (action.kind === 'burst' && action.onlyShort) {
      const short = kit.shortBurstVariant
      const variant = short
        ? kit.variant?.(
            ctxAt(now, characterKey),
            states.get(characterKey),
            action
          )
        : undefined
      if (!short || variant?.key !== short) {
        if (action.optional)
          skippedOptionalBursts.push({ characterKey, t: now })
        // (its alternative, "Q/N1", instead: the Burst is not used in this rotation)
        if (action.otherwise?.length) {
          if (r === Math.min(1, repeats - 1) || keep !== 'middle')
            notes.add(
              `${characterKey}'s ${action.text}: ${action.otherwise.map((a) => a.text).join(' ')} was played in the rotations without the Burst.`
            )
          playOtherwise(action.otherwise)
        }
        return
      }
    }
    // Cooldowns and resource gates both wait, as native ActionReady does. A queued
    // reaction can fill a resource, expire a mode, or change the cooldown being checked.
    const waitStart = now
    const decided = decidedNotReady === action
    decidedNotReady = undefined
    for (;;) {
      const readyAt = decided
        ? Number.POSITIVE_INFINITY
        : actionReadyAt(characterKey, action, now)
      if (readyAt <= now) break
      // an optional action ("E?"): used when ready, else left out (as a sim's "if .skill.ready")
      if (action.optional) {
        recordOptionalSkill(false)
        if (action.kind === 'burst') {
          const short = kit.shortBurstVariant
          const variant = short
            ? kit.variant?.(
                ctxAt(now, characterKey),
                states.get(characterKey),
                action
              )
            : undefined
          if (!short || variant?.key !== short)
            skippedOptionalBursts.push({ characterKey, t: now })
        }
        if (action.otherwise?.length) {
          // its alternative instead ("Q?/N3"), then on to what follows it
          if (r === Math.min(1, repeats - 1) || keep !== 'middle')
            notes.add(
              `${characterKey}'s ${action.text}: ${action.otherwise.map((a) => a.text).join(' ')} was played when it was not ready.`
            )
          playOtherwise(action.otherwise)
          return
        }
        if (r === Math.min(1, repeats - 1) || keep !== 'middle')
          notes.add(
            `${characterKey}'s ${action.text} was left out when it was not ready.`
          )
        return
      }
      if (now - waitStart >= 30 * FPS) {
        warnings.push(
          `${characterKey}: ${action.text} could not become ready within 30 seconds.`
        )
        return
      }
      now = Math.min(readyAt, ...events.map((e) => e.t))
      runUntil(now, true)
    }
    if (now > waitStart) {
      stalled.push({
        label: `${characterKey} ${action.text}`,
        t: waitStart,
        frames: now - waitStart,
      })
      if (r === Math.min(1, repeats - 1)) {
        notes.add(
          `Waited ${((now - waitStart) / FPS).toFixed(1)} s for ${characterKey}'s ${action.text}.`
        )
        const why = kit.waitNote?.(
          states.get(characterKey),
          action,
          waitStart,
          list
            .slice(0, i)
            .some(
              (x) =>
                x.characterKey === characterKey && x.action.kind === action.kind
            )
        )
        if (why) notes.add(why)
      }
    }
    if (action.group !== undefined) groupsPlayed.set(action.group, true)
    const actCtx = ctxAt(now, characterKey)
    // a mode or stance's version of the action has its own frame data and edits
    const variant = kit.variant?.(actCtx, states.get(characterKey), action)
    const frameKey = actionFrameKey(action, variant)
    const edit = frameData[characterKey]?.[frameKey]
    gearFx.beforeAction(actCtx, characterKey, action)
    if (
      action.kind === 'plunge' &&
      (action.height || action.collision) &&
      !kit.plungeHeights
    )
      notes.add(
        `${characterKey}: high and low plunges and the collision hit are not modelled for this character; "${action.text}" played as the kit's usual plunge.`
      )
    // "N3-4": the string carries on from its 3rd hit, whatever came before
    if (action.kind === 'normal' && action.from) normalCounter = action.from - 1
    const kitResult = kit.act(
      edit?.hitDelay
        ? {
            ...actCtx,
            hit: (d, h) => actCtx.hit(d + edit.hitDelay!, h),
          }
        : actCtx,
      states.get(characterKey),
      action,
      list[i - 1]?.action
    )
    if (!kitResult.failed) {
      const data = (actionData[characterKey] ??= {})
      data[frameKey] ??= {
        frames: kitResult.frames,
        framesInto: { ...kitResult.framesInto },
        action: {
          kind: action.kind,
          count: action.count,
          hold: action.hold,
          text: action.text,
        },
        ...(variant && { variant }),
      }
    }
    // An edited length shifts the action's own cancels by as much (unless a cancel is edited)
    const shift =
      edit?.frames !== undefined ? edit.frames - kitResult.frames : 0
    const result: ActionResult = edit
      ? {
          ...kitResult,
          frames: edit.frames ?? kitResult.frames,
          ...(kitResult.walkFrames !== undefined && {
            walkFrames: Math.max(0, kitResult.walkFrames + shift),
          }),
          framesInto: {
            ...Object.fromEntries(
              Object.entries(kitResult.framesInto ?? {}).map(([k, v]) => [
                k,
                Math.max(0, (v ?? 0) + shift),
              ])
            ),
            ...edit.framesInto,
          },
        }
      : kitResult
    if (action.kind !== 'normal') normalCounter = 0
    if (result.failed) {
      if (
        keep === 'all' ||
        keep === 'play' ||
        (keep === 'last2' ? r >= repeats - 2 : r === Math.min(1, repeats - 1))
      )
        warnings.push(result.failed)
      return
    }
    // Moonsign: Ascendant Gleam. With two or more Moonsign members, a member who is not one
    // gives the party Lunar reaction DMG (from its own stats) for 20 s after its Skill or Burst;
    // one at a time, the latest one's (kqmsim: the newest replaces it)
    if (
      moonsign >= 2 &&
      !kits[characterKey]?.moonsign &&
      (action.kind === 'skill' || action.kind === 'burst')
    ) {
      for (const w of windows)
        if (
          w.path[1] === 'moonsignAfterSkillBurst' &&
          w.owner !== characterKey &&
          w.start <= now &&
          now < w.end
        )
          w.end = now
      addWindow({
        owner: characterKey,
        path: [characterKey, 'moonsignAfterSkillBurst'],
        value: 'on',
        start: now,
        end: now + 20 * FPS,
      })
    }
    lastNormalActor = action.kind === 'normal' ? characterKey : undefined
    if (result.cooldown) {
      const { key, frames, delay = 0, use } = result.cooldown
      const at = now + delay
      // (the Skill's cooldown: 'skill', or 'skill<n>' for a kit whose Burst resets it, Kazuha's and
      // Arlecchino's; not Cyno's 'skillB' or Xilonen's 'skillRecast', which kits set themselves)
      if (/^skill\d*$/.test(key) && use !== false)
        skillUses.push({ characterKey, t: at, hold: !!action.hold })
      const spend = () =>
        cooldowns.spend(
          `${characterKey}.${key}`,
          at,
          cooldownFrames(key, frames, characterKey, at)
        )
      if (delay) push(at, spend)
      else spend()
    }
    const next =
      list[i + 1] ??
      (alternative
        ? alternative.next
        : opener
          ? flat[0]
          : loopTo
            ? { characterKey: loopTo, action: flat[0]?.action }
            : undefined)
    const nextKind =
      next && next.characterKey !== characterKey ? 'swap' : next?.action?.kind
    gearFx.onAction(
      ctxAt(now, characterKey),
      characterKey,
      action,
      result.normalStarts
    )
    let frames = kitFramesInto(result, nextKind)
    let stateFrames = frames
    // gcsim queues the next item once the action reaches its earliest cancel (CanQueueAfter):
    // a written wait starts there, and the action after it is held until this one allows it
    if (
      nextKind === 'wait' &&
      (next?.action?.walk || result.walkFrames !== undefined)
    ) {
      // (a wait that is a walk: it starts at the action's walk cancel and ends it there, as an
      // action of its own)
      frames = result.walkFrames ?? result.frames
      stateFrames = frames
    } else if (nextKind === 'wait' && !result.duration) {
      frames = Math.min(
        result.frames,
        ...Object.values(result.framesInto ?? {}).filter(
          (n): n is number => n !== undefined
        )
      )
      animationLock = { start: now, result, actor: characterKey }
      // its state (e.g. a normal attack's) lasts through the wait to the animation's end (gcsim
      // ends it once the time passed exceeds AnimationLength: one frame after)
      stateFrames = Math.max(frames, result.frames) + 1
    }
    // Notify action watchers before a growing channel runs any events, so Raincutter/Oz
    // stop observing the previous normal-attack state immediately.
    for (const m of members)
      kits[m]?.onPartyAction?.(
        ctxAt(now, m),
        states.get(m),
        characterKey,
        action,
        frames,
        result.normalStarts,
        stateFrames
      )
    if (result.duration) {
      for (;;) {
        runUntil(now + frames, true)
        const updated = result.duration(nextKind)
        if (updated <= frames) break
        frames = updated
      }
    }
    // the next action is optional and has an alternative ("N2 D?/CA"): gcsim decides it when this
    // one can be cancelled, then cancels into what is played (the Charged Attack's frames)
    const alt = next?.action?.otherwise?.[0]
    if (
      next?.action?.optional &&
      alt &&
      nextKind === next.action.kind &&
      !result.duration
    ) {
      runUntil(now + frames, true)
      if (
        actionReadyAt(characterKey, next.action, now + frames) >
        now + frames
      ) {
        frames = kitFramesInto(result, alt.kind)
        decidedNotReady = next.action
      }
    }
    const defaultFrames = frames
    const edited = own ? frameOverrides[i] : undefined
    if (edited !== undefined && Number.isFinite(edited))
      frames = Math.max(1, Math.round(edited))
    actions.push({
      characterKey,
      // (an action with an alternative, "Q/N3", played as itself: shown as what was played, "Q")
      text: action.otherwise?.length
        ? action.text.slice(0, action.text.indexOf('/')).replace(/\?$/, '')
        : action.text,
      start: now,
      frames,
      index: own ? i : undefined,
      ...(opener && !alternative && { openerIndex: i }),
      defaultFrames,
      frameKey,
      ...(variant && { variant }),
      ...(action.optional && { optional: true }),
    })
    recordOptionalSkill(true)
    currentAction = { actor: characterKey, start: now }
    now += frames
    if (result.forcedSwap && result.forcedSwap !== onField) {
      swaps.push({
        from: onField,
        to: result.forcedSwap,
        start: now,
        frames: swapFrames,
        cooldown: 0,
        forced: true,
      })
      now += swapFrames
      runUntil(now, true)
      kits[onField]?.onSwapOut?.(ctxAt(now, onField), states.get(onField))
      gearFx.onSwap(now, onField, result.forcedSwap, ctxAt(now, onField))
      const from = onField
      onField = result.forcedSwap
      refreshGeoResonance(now)
      for (const member of members)
        kits[member]?.onPartySwap?.(
          ctxAt(now, member),
          states.get(member),
          from,
          onField
        )
      normalCounter = 0
      swapReadyAt = now + FPS
      const entry = kits[onField]?.onSwapIn?.(
        ctxAt(now, onField),
        states.get(onField)
      )
      if (entry) {
        now += kitFramesInto(
          entry,
          next?.characterKey === onField ? next.action.kind : 'swap'
        )
        runUntil(now, true)
      }
    }
  }
  const recordOmittedBursts = () => {
    if (!rotation.omittedOptionalBursts) return
    for (const [ck, count] of Object.entries(
      rotation.omittedOptionalBursts
    ) as [CharacterKey, number][])
      for (let k = 0; k < count; k++)
        skippedOptionalBursts.push({ characterKey: ck, t: now })
  }
  if (openerCounted && openerFlat.length) {
    // the opener as the first rotation, counted: the rotation's copies after it
    bounds.push(now)
    for (const i of openerFlat.keys()) play(openerFlat, i, 0, true)
    for (let r = 1; r < repeats; r++) {
      bounds.push(now)
      recordOmittedBursts()
      for (const i of flat.keys()) play(flat, i, r, false)
    }
  } else {
    // the opener: once, before the first loop (its effects carry into the loops)
    for (const i of openerFlat.keys()) play(openerFlat, i, -1, true)
    for (let r = 0; r < repeats; r++) {
      bounds.push(now)
      recordOmittedBursts()
      for (const i of flat.keys()) play(flat, i, r, false)
    }
  }
  bounds.push(now)
  // what is still scheduled lands (a summon's last ticks), up to 30 s after the last action
  runUntil(now + 30 * FPS)
  resourcePolling = false
  gearFx.end(now + 30 * FPS)

  // hits counted per buff (Illuga's Songs, Zibai's C1): their extra hits first, then the cover
  let all = [...hits].sort((a, b) => a.t - b.t)
  for (const m of members) {
    const kit = kits[m]
    if (!kit?.countedBuffs) continue
    const { extraHits } = kit.countedBuffs(all, constellations[m] ?? 0)
    if (extraHits.length) all = [...all, ...extraHits].sort((a, b) => a.t - b.t)
  }
  // the rotations counted: all, the last two (past the start, the steady pace), or the second
  const keptLoop = Math.min(1, repeats - 1)
  const whole = keep === 'all' || keep === 'play'
  const start =
    keep === 'play'
      ? 0
      : bounds[
          keep === 'all'
            ? 0
            : keep === 'last2'
              ? Math.max(0, repeats - 2)
              : keptLoop
        ]
  const end = bounds[whole || keep === 'last2' ? repeats : keptLoop + 1]
  const kept: SimHit[] = []
  const keptIndex = new Map<number, number>()
  all.forEach((hit, index) => {
    if (hit.t < start || hit.t >= end) return
    keptIndex.set(index, kept.length)
    kept.push(hit)
  })
  const countedBuffs: SimCountedBuff[] = []
  for (const m of members) {
    const kit = kits[m]
    if (!kit?.countedBuffs) continue
    for (const buff of kit.countedBuffs(all, constellations[m] ?? 0).buffs) {
      const hits = new Set<number>()
      for (const i of buff.hits) {
        const mapped = keptIndex.get(i)
        if (mapped !== undefined) hits.add(mapped)
      }
      if (hits.size) countedBuffs.push({ ...buff, hits })
    }
  }
  for (const m of unsupported)
    warnings.push(`${m}: no kit model yet (their actions were skipped)`)
  let auras: SimulationResult['auras']
  if (auraTimeline) {
    // (the engine follows the hits: played on to the end, so the last auras run out)
    reactions.burningAt?.(end)
    const before = auraLog.filter((a) => a.t <= start).pop()
    auras = [
      { t: start, auras: before?.auras ?? {} },
      ...auraLog.filter((a) => a.t > start && a.t < end),
    ]
  }
  const keptFrom = whole
    ? 0
    : keep === 'last2'
      ? Math.max(0, repeats - 2)
      : keptLoop
  const keptTo = whole || keep === 'last2' ? repeats : keptLoop + 1
  return {
    ...(auras && { auras }),
    hits: kept,
    frames: end - start,
    start,
    rotationStarts: bounds.slice(keptFrom, keptTo),
    rotationFrames: bounds.slice(1, repeats + 1).map((b, i) => b - bounds[i]),
    buffWindows: windows,
    countedBuffs,
    simOnlyBuffs: [
      ...members.flatMap((m) =>
        (kits[m]?.simOnlyBuffs?.(constellations[m] ?? 0) ?? []).map((path) => ({
          owner: m,
          path,
        }))
      ),
      ...(probing ? [] : kitBuffs(members, constellations, elements, kits)),
    ],
    nightsoulSpans,
    hitlagEvents: all.filter((h) => h.path.join('.') === '_marker.hitlag'),
    notes: [...notes],
    warnings,
    unsupported,
    actions: actions.filter((a) => a.start >= start && a.start < end),
    waits: waits.filter((a) => a.start >= start && a.start < end),
    skillUses: skillUses.filter((u) => u.t >= start && u.t < end),
    optionalSkills: optionalSkills.filter(
      (s) =>
        (keep === 'play' || s.rotationStart >= start) && s.rotationStart < end
    ),
    skippedOptionalBursts: skippedOptionalBursts.filter(
      (s) => s.t >= start && s.t < end
    ),
    swaps: swaps.filter((w) => w.start >= start && w.start < end),
    stalls: stalled
      .filter((w) => w.t >= start && w.t < end)
      .reduce<Record<string, number>>((out, w) => {
        out[w.label] = (out[w.label] ?? 0) + w.frames
        return out
      }, {}),
    stallSpans: stalled.filter((w) => w.t >= start && w.t < end),
    actionData,
  }
}

/**
 * The last of the kept rotations alone (what a timeline shows), from a run that kept several:
 * its hits (the counted buffs' hit indices remapped), actions, waits, swaps and auras; waits per
 * rotation (`stalls`, averaged). Each sample is cut the same way. A run that kept one: itself.
 */
export function lastRotation(sim: SimulationResult): SimulationResult {
  if (sim.samples?.length) {
    const samples = sim.samples.map(({ probability, result }) => ({
      probability,
      result: lastRotation(result),
    }))
    const first = samples[0].result
    return {
      ...sim,
      hits: first.hits,
      start: first.start,
      rotationStarts: first.rotationStarts,
      countedBuffs: first.countedBuffs,
      actions: first.actions,
      waits: first.waits,
      skillUses: first.skillUses,
      optionalSkills: first.optionalSkills,
      skippedOptionalBursts: first.skippedOptionalBursts,
      swaps: first.swaps,
      stallSpans: first.stallSpans,
      ...(first.auras && { auras: first.auras }),
      samples,
      frames: samples.reduce((n, s) => n + s.probability * s.result.frames, 0),
      stalls: samples.reduce<Record<string, number>>((out, s) => {
        for (const [label, frames] of Object.entries(s.result.stalls ?? {}))
          out[label] = (out[label] ?? 0) + s.probability * frames
        return out
      }, {}),
    }
  }
  const starts = sim.rotationStarts
  if (!starts || starts.length < 2) return sim
  let from = starts[starts.length - 1]
  let end = sim.start + sim.frames
  // A rotation that starts by waiting for a cooldown left from the one before (Odette EE alone):
  // shown from its first action, the wait at its end. (The one before it, played the same, from
  // its first action to the last one's.)
  const firstAt = (a: number, b: number) =>
    Math.min(
      ...[...sim.actions, ...(sim.waits ?? [])]
        .filter((x) => x.index === 0 && x.start >= a && x.start < b)
        .map((x) => x.start)
    )
  const prev = starts[starts.length - 2]
  const lastFirst = firstAt(from, end)
  const prevFirst = firstAt(prev, from)
  if (
    Number.isFinite(lastFirst) &&
    Number.isFinite(prevFirst) &&
    sim.stallSpans?.some((w) => w.t >= from && w.t < lastFirst)
  ) {
    from = prevFirst
    end = lastFirst
  }
  const within = (t: number) => t >= from && t < end
  const index = new Map<number, number>()
  const hits: SimHit[] = []
  sim.hits.forEach((h, i) => {
    if (!within(h.t)) return
    index.set(i, hits.length)
    hits.push(h)
  })
  const countedBuffs = sim.countedBuffs
    .map((b) => ({
      ...b,
      hits: new Set(
        [...b.hits].flatMap((i) => (index.has(i) ? [index.get(i)!] : []))
      ),
    }))
    .filter((b) => b.hits.size)
  const auras = sim.auras && [
    { t: from, auras: sim.auras.filter((a) => a.t <= from).pop()?.auras ?? {} },
    ...sim.auras.filter((a) => a.t > from && a.t < end),
  ]
  return {
    ...sim,
    ...(auras && { auras }),
    hits,
    start: from,
    frames: end - from,
    rotationStarts: [from],
    countedBuffs,
    actions: sim.actions.filter((a) => within(a.start)),
    waits: sim.waits?.filter((a) => within(a.start)),
    skillUses: sim.skillUses?.filter((u) => within(u.t)),
    optionalSkills: sim.optionalSkills?.filter(
      (s) => s.rotationStart === from || (from !== starts.at(-1) && within(s.t))
    ),
    skippedOptionalBursts: sim.skippedOptionalBursts?.filter((s) =>
      within(s.t)
    ),
    swaps: sim.swaps?.filter((w) => within(w.start)),
    stallSpans: sim.stallSpans?.filter((w) => within(w.t)),
    stalls: Object.fromEntries(
      Object.entries(sim.stalls ?? {}).map(([label, frames]) => [
        label,
        frames / starts.length,
      ])
    ),
  }
}

/**
 * The samples a team's rotation is played with: the most any member's kit needs
 * (`KitModel.sampled`: true is 64, a number its own), at most `requested`. A sample is a whole
 * play of the rotation, so a kit whose randomness is small (Citlali's 30-frame delay) asks for few.
 */
export function rotationSamples(
  members: readonly CharacterKey[],
  kits: Partial<Record<CharacterKey, KitModel>> = kitModels,
  requested?: number,
  gear?: Partial<Record<CharacterKey, SimGear>>,
  constellations: Partial<Record<CharacterKey, number>> = {}
) {
  const need = Math.max(
    members.some((member) => isSacrificialWeapon(gear?.[member]?.weapon))
      ? 16
      : 1,
    ...members.map((m) => {
      const own = kits[m]?.sampled
      const sampled =
        typeof own === 'function' ? own(constellations[m] ?? 0) : own
      return sampled === true ? 64 : typeof sampled === 'number' ? sampled : 1
    })
  )
  return requested === undefined ? need : Math.max(1, Math.min(requested, need))
}

type RotationSampleOptions = Parameters<typeof simulateRotation>[0]
type RotationSample = NonNullable<SimulationResult['samples']>[number]

/** Sample whole timelines so random extra hits retain their own aura and buff history. */
export function simulateRotationSamples(
  options: RotationSampleOptions,
  count = rotationSamples(
    options.members,
    options.kits ?? kitModels,
    undefined,
    options.sacrificial === false ? undefined : options.gear,
    options.constellations
  ),
  seed = 0x4b514d
): SimulationResult {
  const samples = [...rotationSampleRuns(options, count, seed)]
  return count === 1 ? samples[0].result : summarizeSamples(samples)
}

/** The editor can paint and take new input between whole samples. */
export async function simulateRotationSamplesAsync(
  options: RotationSampleOptions,
  count: number,
  isCancelled: () => boolean
) {
  const samples: RotationSample[] = []
  let frame = performance.now()
  for (const sample of rotationSampleRuns(options, count, 0x4b514d)) {
    samples.push(sample)
    if (samples.length < count && performance.now() - frame >= 10) {
      await new Promise((resolve) => setTimeout(resolve, 0))
      if (isCancelled()) return undefined
      frame = performance.now()
    }
  }
  return count === 1 ? samples[0].result : summarizeSamples(samples)
}

function* rotationSampleRuns(
  options: RotationSampleOptions,
  count: number,
  seed: number
): Generator<RotationSample> {
  if (!Number.isInteger(count) || count < 1 || count > 1024)
    throw new Error('Rotation samples must be an integer between 1 and 1024')
  if (count === 1) {
    yield { probability: 1, result: simulateRotation(options) }
    return
  }
  if (options.reactions || options.random || options.sacrificialRandom)
    throw new Error(
      'Sampled rotations require independent reaction and random state'
    )
  const randoms = stratifiedRandoms(count, seed)
  // Changing a weapon should not also change the random draws of the member's kit.
  const sacrificialRolls =
    options.sacrificial !== false &&
    options.members.some((m) => isSacrificialWeapon(options.gear?.[m]?.weapon))
      ? stratifiedRandoms(count, seed ^ 0x6a932e71)
      : []
  for (const [i, random] of randoms.entries())
    yield {
      probability: 1 / count,
      result: simulateRotation({
        ...options,
        random,
        sacrificialRandom: sacrificialRolls[i],
      }),
    }
}

function summarizeSamples(samples: RotationSample[]): SimulationResult {
  const unique = (key: 'notes' | 'warnings') => [
    ...new Set(samples.flatMap(({ result }) => result[key])),
  ]
  return {
    ...samples[0].result,
    samples,
    frames: samples.reduce(
      (sum, s) => sum + s.probability * s.result.frames,
      0
    ),
    notes: [...unique('notes'), `${samples.length} seeded rotation samples.`],
    warnings: unique('warnings'),
    stalls: samples.reduce<Record<string, number>>((out, s) => {
      for (const [label, frames] of Object.entries(s.result.stalls ?? {}))
        out[label] = (out[label] ?? 0) + s.probability * frames
      return out
    }, {}),
    unsupported: [
      ...new Set(samples.flatMap(({ result }) => result.unsupported)),
    ],
  }
}

/** gcsim's Lunar / Stellar Swirl contributor multipliers, by rank */
export const REACTION_NAMES: Record<string, string> = {
  vaporize: 'Vaporize',
  melt: 'Melt',
  aggravate: 'Aggravate',
  spread: 'Spread',
}

const sameRef = (
  a: { owner: string; path: string[] },
  b: { owner: string; path: string[] }
) => a.owner === b.owner && a.path.join('.') === b.path.join('.')
/** A buff's key: its owner and path (`sameRef` as one string) */
const refKey = (a: { owner: string; path: string[] }) =>
  `${a.owner}|${a.path.join('.')}`

/** A hitlag window's end so far, and the enemy's pause read last (`extendHitlagEnd`) */
type HitlagEnd = { end: number; enemyPauseEnd: number }
/**
 * A hitlag window's end for a character: lengthened by the pauses in it, read in order from the
 * `from`th (the character's own, or the enemy's for an enemy window). Updates `at` and returns it
 */
function extendHitlagEnd(
  window: SimBuffWindow,
  character: CharacterKey,
  pauses: readonly Pick<
    SimHit,
    'characterKey' | 't' | 'animationPause' | 'enemyAnimationPause'
  >[],
  from: number,
  at: HitlagEnd
) {
  for (let i = from; i < pauses.length; i++) {
    const pause = pauses[i]
    if (
      (window.hitlag === 'enemy' || pause.characterKey === character) &&
      pause.t >= window.start &&
      pause.t < at.end
    ) {
      if (window.hitlag === 'enemy') {
        const next =
          pause.t + (pause.enemyAnimationPause ?? pause.animationPause ?? 0)
        at.end += Math.max(0, next - Math.max(pause.t, at.enemyPauseEnd))
        at.enemyPauseEnd = Math.max(at.enemyPauseEnd, next)
      } else at.end += pause.animationPause ?? 0
    }
  }
  return at
}
/** A buff's state from its windows on at a moment ('' when none is) */
function windowsValue(path: string[], on: SimBuffWindow[]) {
  if (!on.length) return ''
  // stacking windows (e.g. Columbina's A1, one per Gravity Interference): the count
  if (
    on.every((w) => w.value === '1') &&
    (path[1]?.toLowerCase().includes('stack') ||
      on.some((w) => w.max !== undefined))
  )
    return `${Math.min(Math.max(...on.map((w) => w.max ?? 3)), on.length)}`
  return on.reduce((latest, w) => (w.start >= latest.start ? w : latest)).value
}

/** Every buff the simulation decides, and its state at each hit ('' when off) */
function buffStates(
  sim: SimulationResult,
  declared: { owner: SimBuffOwner; path: string[] }[] = [],
  /** The members' own states (`SimBuffWindow.offOnly` buffs count only where one is saved) */
  current?: (owner: SimBuffOwner, path: string[]) => string | undefined
) {
  const pauses =
    sim.hitlagEvents ??
    sim.hits.filter((h) => h.path.join('.') === '_marker.hitlag')
  const ends = new Map<SimBuffWindow, Map<CharacterKey, number>>()
  const endAt = (window: SimBuffWindow, character: CharacterKey) => {
    if (!window.hitlag) return window.end
    let byCharacter = ends.get(window)
    if (!byCharacter) ends.set(window, (byCharacter = new Map()))
    const cached = byCharacter.get(character)
    if (cached !== undefined) return cached
    const { end } = extendHitlagEnd(window, character, pauses, 0, {
      end: window.end,
      enemyPauseEnd: -1,
    })
    byCharacter.set(character, end)
    return end
  }
  // (every lookup by a buff's key, made once: a rotation has thousands of hits and windows)
  const refs = [...declared]
  const known = new Set(declared.map(refKey))
  for (const b of [
    ...(sim.simOnlyBuffs ?? []),
    ...sim.buffWindows,
    ...sim.countedBuffs,
    ...sim.hits.flatMap((h) => h.states ?? []),
  ]) {
    if (b.path[1]?.startsWith('_')) continue
    const key = refKey(b)
    if (known.has(key)) continue
    known.add(key)
    refs.push({ owner: b.owner, path: b.path })
  }
  const keys = refs.map(refKey)
  /** Each buff's entries, in the simulation's order */
  const byKey = <T extends { owner: string; path: string[] }>(list: T[]) => {
    const map = new Map<string, T[]>()
    for (const item of list) {
      const key = refKey(item)
      const entries = map.get(key)
      if (entries) entries.push(item)
      else map.set(key, [item])
    }
    return map
  }
  const windowsOf = byKey(sim.buffWindows)
  const countedOf = byKey(sim.countedBuffs)
  const blank = refs.map(
    (ref, r) =>
      !!windowsOf.get(keys[r])?.every((w) => w.offOnly) &&
      !current?.(ref.owner, ref.path)
  )
  const lateWindows = sim.buffWindows.filter((w) => w.late && w.end > w.start)
  /** The buffs with a window written after the fact (`SimBuffWindow.late`) on at `t` */
  const lateAt = (t: number, character: CharacterKey) => {
    const late = new Set<string>()
    for (const w of lateWindows)
      if (
        w.start <= t &&
        t < endAt(w, character) &&
        (!w.recipient || w.recipient === character)
      )
        late.add(refKey(w))
    return late
  }
  const stateAt = (hit: SimHit, index: number) => {
    // (the hit's own states by buff; the first one for a buff, as `find` took it)
    let snapshots: Map<string, string> | undefined
    if (hit.states?.length) {
      snapshots = new Map()
      for (const s of hit.states) {
        const key = refKey(s)
        if (!snapshots.has(key)) snapshots.set(key, s.value)
      }
    }
    return refs.map((ref, r) => {
      if (blank[r]) return ''
      const key = keys[r]
      const snapshot = snapshots?.get(key)
      if (snapshot !== undefined) return snapshot
      // counted buffs (one entry per cast or value): the entry that counts this hit
      const counted = countedOf.get(key)
      if (counted?.length)
        return counted.find((c) => c.hits.has(index))?.value ?? ''
      const on = (windowsOf.get(key) ?? []).filter(
        (w) =>
          w.start <= hit.t &&
          hit.t < endAt(w, hit.characterKey) &&
          (!w.recipient || w.recipient === hit.characterKey)
      )
      return windowsValue(ref.path, on)
    })
  }
  /** A list of states as each buff's value (the first one for a buff; '' if none) */
  const valuesFrom = (
    states: { owner: string; path: string[]; value: string }[]
  ) => {
    const by = new Map<string, string>()
    for (const s of states) {
      const key = refKey(s)
      if (!by.has(key)) by.set(key, s.value)
    }
    return keys.map((key) => by.get(key) ?? '')
  }
  return { refs, keys, stateAt, valuesFrom, lateAt }
}

/**
 * The state each buff the simulation decides is in for most of the rotation's damage (by hits),
 * among the hits it covers: the team's own conditional is set to it, so the buff shows on in
 * Team Optimize, and the attacks outside it turn it off.
 */
export function rotationBuffDefaults(
  sim: SimulationResult
): { owner: SimBuffOwner; path: string[]; value: string }[] {
  const refs: { owner: SimBuffOwner; path: string[] }[] = []
  const indexOf = new Map<string, number>()
  const weights: Map<string, number>[] = []
  for (const { result, probability } of sim.samples ?? [
    { result: sim, probability: 1 },
  ]) {
    const { refs: sampleRefs, keys, stateAt } = buffStates(result)
    const indices = sampleRefs.map((ref, r) => {
      const found = indexOf.get(keys[r])
      if (found !== undefined) return found
      indexOf.set(keys[r], refs.length)
      refs.push(ref)
      weights.push(new Map())
      return refs.length - 1
    })
    result.hits.forEach((hit, index) => {
      if (hit.path[0].startsWith('_')) return
      stateAt(hit, index).forEach((state, i) => {
        const weight = weights[indices[i]]
        if (state)
          weight.set(
            state,
            (weight.get(state) ?? 0) + probability * (hit.weight ?? 1)
          )
      })
    })
  }
  return refs.flatMap((ref, i) => {
    const best = [...weights[i]].sort((a, b) => b[1] - a[1])[0]
    return best ? [{ ...ref, value: best[0] }] : []
  })
}

/**
 * The simulation as Team Optimize attacks: hits of the same node, member on the field and buff
 * states are one attack; each modelled buff is set on (`states`) or off (a 0-hit `limits` entry)
 * for it, whatever the member's own conditional says.
 */
export function rotationAttacks(
  sim: SimulationResult,
  /**
   * The member's own state of a conditional (its loadout's): an attack only carries the buffs
   * whose state differs from it (on when it is off, off when it is on)
   */
  current: (owner: SimBuffOwner, path: string[]) => string | undefined = () =>
    undefined,
  declared: { owner: SimBuffOwner; path: string[] }[] = [],
  /**
   * Filled with each hit's attack (its member's attack at `index`), for a simulation without
   * samples: what a timeline reads a hit's damage from
   */
  hitAttacks?: Map<SimHit, { characterKey: CharacterKey; index: number }>
): Partial<Record<CharacterKey, TeamOptAttack[]>> {
  if (sim.samples) {
    // A buff that exists only in one sample must still be explicitly off in
    // the others, including when the saved loadout/default has it enabled.
    const refs = [...declared]
    const known = new Set(declared.map(refKey))
    for (const { result } of sim.samples)
      for (const ref of buffStates(result).refs) {
        const key = refKey(ref)
        if (known.has(key)) continue
        known.add(key)
        refs.push(ref)
      }
    const groups = new Map<
      string,
      { member: CharacterKey; attack: TeamOptAttack }
    >()
    for (const { probability, result } of sim.samples)
      for (const [member, attacks] of Object.entries(
        rotationAttacks(result, current, refs)
      ))
        for (const attack of attacks) {
          const key = JSON.stringify([member, { ...attack, hits: undefined }])
          const group = groups.get(key)
          if (group) group.attack.hits += attack.hits * probability
          else
            groups.set(key, {
              member: member as CharacterKey,
              attack: { ...attack, hits: attack.hits * probability },
            })
        }
    const out: Partial<Record<CharacterKey, TeamOptAttack[]>> = {}
    for (const { member, attack } of groups.values())
      (out[member] ??= []).push(attack)
    return out
  }
  const { refs, keys, stateAt, valuesFrom, lateAt } = buffStates(
    sim,
    declared,
    current
  )
  const groups = new Map<
    string,
    {
      hit: SimHit
      states: string[]
      count: number
      contributorStates?: TeamOptAttack['reactionContributorStates']
      /** The simulation's hits it stands for */
      sources: SimHit[]
    }
  >()
  const add = (hit: SimHit, states: string[], w: number, source: SimHit) => {
    const contributorStates = hit.contributors?.length
      ? Object.fromEntries(
          [...new Set(hit.contributors)].slice(0, 4).map((characterKey) => {
            const values = stateAt({ ...hit, characterKey }, -1)
            return [
              characterKey,
              refs.map((ref, i) => ({ ...ref, value: values[i] })),
            ]
          })
        )
      : undefined
    const key = [
      JSON.stringify(contributorStates ?? {}),
      hit.characterKey,
      hit.path.join('.'),
      hit.label,
      hit.element,
      JSON.stringify(hit.contributors ?? []),
      hit.onField,
      hit.reaction ?? '',
      JSON.stringify(hit.healing ?? []),
      snapshotKeys.get(hit) ?? JSON.stringify(hit.statSnapshots ?? []),
      hit.talentMultiplier ?? 1,
      JSON.stringify(hit.bonusStats ?? {}),
      ...states,
    ].join('|')
    const g = groups.get(key)
    if (g) {
      g.count += w
      g.sources.push(source)
    } else
      groups.set(key, {
        hit,
        states,
        count: w,
        contributorStates,
        sources: [source],
      })
  }
  /**
   * gcsim's snapshotDelay: a hit whose attacker's buffs changed between its snapshot and its
   * impact takes its offensive stats as they were at the snapshot (enemy debuffs at impact).
   */
  const snapshotKeys = new WeakMap<SimHit, string>()
  const withCastSnapshot = (
    hit: SimHit,
    states: string[],
    index: number
  ): SimHit => {
    if (hit.snapshotT === undefined) return hit
    const onField = hit.snapshotOnField ?? hit.onField ?? hit.characterKey
    const atSnapshot = () =>
      stateAt({ ...hit, t: hit.snapshotT!, onField, states: undefined }, index)
    // (a set's or weapon's window written after the snapshot, for frames before it: as it was)
    let snapshotStates = hit.snapshotStates
    if (snapshotStates) {
      const late = lateAt(hit.snapshotT, hit.characterKey)
      if (late.size) {
        const settled = atSnapshot()
        snapshotStates = [
          ...refs.flatMap((ref, i) =>
            late.has(keys[i]) ? [{ ...ref, value: settled[i] }] : []
          ),
          ...snapshotStates.filter((x) => !late.has(refKey(x))),
        ]
      }
    }
    const then = snapshotStates ? valuesFrom(snapshotStates) : atSnapshot()
    // (the hit's own snapshotted states stand at both times)
    const own = new Set(hit.states?.map(refKey))
    if (then.every((v, i) => v === states[i] || own.has(keys[i]))) return hit
    const move =
      hit.tag === 'plunge'
        ? 'plunging'
        : (['normal', 'charged', 'skill', 'burst'] as const).find(
            (m) => m === hit.tag
          )
    const stats = [
      'atk',
      'hp',
      'def',
      'eleMas',
      'critRate_',
      'critDMG_',
      'all_dmg_',
      `${hit.element}_dmg_`,
      ...(move ? [`${move}_dmg_`] : []),
    ] as InputPremodKey[]
    const out: SimHit = {
      ...hit,
      statSnapshots: [
        ...(hit.statSnapshots ?? []),
        ...stats
          .filter(
            (stat) =>
              !hit.statSnapshots?.some(
                (s) =>
                  (!s.characterKey || s.characterKey === hit.characterKey) &&
                  s.stat === stat &&
                  s.path.join('.') === `total.${stat}`
              )
          )
          .map((stat) => ({
            stat,
            path: ['total', stat],
            t: hit.snapshotT!,
            onField,
            // (the hit's own states hold at the snapshot too, unless it snapshotted another value)
            ...(snapshotStates
              ? {
                  states: [
                    ...snapshotStates,
                    ...(hit.states ?? []).filter(
                      (x) => !snapshotStates!.some((y) => sameRef(x, y))
                    ),
                  ],
                }
              : {}),
          })),
      ],
    }
    // (grouped by the buffs it snapshotted, not by its frame)
    snapshotKeys.set(
      out,
      `${onField}|${stats.join(',')}|${then.join('|')}|${JSON.stringify(hit.statSnapshots ?? [])}`
    )
    return out
  }
  sim.hits.forEach((h, index) => {
    if (h.path[0].startsWith('_')) return
    const states = stateAt(h, index)
    const hit = withCastSnapshot(h, states, index)
    const w = hit.weight ?? 1
    // (a reaction with contributors stays on its trigger: they roll crit independently before
    // ranking, so a static split of average damage cannot represent the native expectation)
    add(hit, states, w, h)
  })
  const out: Partial<Record<CharacterKey, TeamOptAttack[]>> = {}
  for (const {
    hit,
    states,
    count,
    contributorStates,
    sources,
  } of groups.values()) {
    const attack: TeamOptAttack = {
      path: hit.path,
      hits: Math.round(count * 100) / 100,
      hitMode: 'avgHit',
      element: hit.element,
      ...(hit.talentMultiplier !== undefined
        ? { talentMultiplier: hit.talentMultiplier }
        : {}),
      ...(hit.bonusStats ? { bonusStats: hit.bonusStats } : {}),
      ...(hit.contributors?.length
        ? {
            reactionContributors: [...new Set(hit.contributors)].slice(0, 4),
            reactionContributorStates: contributorStates,
          }
        : {}),
      ...(hit.onField ? { onField: hit.onField } : {}),
      ...(hit.reaction ? { reaction: hit.reaction } : {}),
      ...(hit.healing ? { healing: hit.healing } : {}),
      ...(hit.statSnapshots
        ? {
            statSnapshots: hit.statSnapshots.map((snapshot) => {
              const values = snapshot.states
                ? valuesFrom(snapshot.states)
                : stateAt(
                    {
                      ...hit,
                      characterKey: snapshot.characterKey ?? hit.characterKey,
                      t: snapshot.t,
                      onField: snapshot.onField,
                      states: undefined,
                    },
                    -1
                  )
              // Native attack modifiers stay live even when the attack's base stats snapshot.
              if (
                ['total', 'premod'].includes(snapshot.path[0]) &&
                (!snapshot.characterKey ||
                  snapshot.characterKey === hit.characterKey)
              )
                refs.forEach((ref, i) => {
                  if (
                    (snapshot.stat === 'critRate_' &&
                      [
                        'resonance.ShatteringIce',
                        'BlizzardStrayer.state',
                        'Lavawalker.state',
                        'Thundersoother.state',
                      ].includes(ref.path.join('.'))) ||
                    (snapshot.stat === 'all_dmg_' &&
                      ref.path.join('.') === 'Furina.burstFanfare')
                  )
                    values[i] = states[i]
                })
              return {
                ...(snapshot.characterKey
                  ? { characterKey: snapshot.characterKey }
                  : {}),
                ...(snapshot.recipient
                  ? { recipient: snapshot.recipient }
                  : {}),
                stat: snapshot.stat,
                path: snapshot.path,
                onField: snapshot.onField,
                states: refs.map((ref, i) => ({ ...ref, value: values[i] })),
              }
            }),
          }
        : {}),
      description: hit.reaction
        ? `${hit.label} (${REACTION_NAMES[hit.reaction]})`
        : hit.label,
    }
    const on = refs.flatMap((ref, i) =>
      states[i] && current(ref.owner, ref.path) !== states[i]
        ? [{ owner: ref.owner, path: ref.path, value: states[i] }]
        : []
    )
    const off = refs.flatMap((ref, i) =>
      !states[i] && current(ref.owner, ref.path)
        ? [{ owner: ref.owner, path: ref.path, hits: 0 }]
        : []
    )
    if (on.length) attack.states = on
    if (off.length) attack.limits = off
    const list = (out[hit.characterKey] ??= [])
    if (hitAttacks)
      for (const source of sources)
        hitAttacks.set(source, {
          characterKey: hit.characterKey,
          index: list.length,
        })
    list.push(attack)
  }
  return out
}

/** The actions whose frame data players can edit, in display order */
export const FRAME_ACTIONS: RotationAction[] = [
  { kind: 'skill', text: 'E' },
  { kind: 'skill', hold: true, text: 'hE' },
  { kind: 'burst', text: 'Q' },
  ...[1, 2, 3, 4, 5].map(
    (count): RotationAction => ({ kind: 'normal', count, text: `N${count}` })
  ),
  { kind: 'charged', text: 'CA' },
  { kind: 'plunge', text: 'P' },
  { kind: 'dash', text: 'D' },
  { kind: 'jump', text: 'J' },
]

/**
 * A member's own frame data for every editable action (each played alone, from a fresh state), by
 * `actionFrameKey`. Actions the kit cannot do on their own are left out.
 */
export function actionFrameDefaults(
  options: Omit<
    Parameters<typeof simulateRotation>[0],
    'rotation' | 'frameData' | 'frameOverrides' | 'repeats'
  >,
  member: CharacterKey,
  actions: RotationAction[] = FRAME_ACTIONS
): NonNullable<SimulationResult['actionData']>[CharacterKey] {
  const out: NonNullable<SimulationResult['actionData']>[CharacterKey] = {}
  for (const action of actions) {
    const key = actionFrameKey(action)
    if (out![key]) continue
    try {
      const sim = simulateRotation({
        ...options,
        rotation: {
          steps: [{ characterKey: member, actions: [action] }],
          loopsTo: member,
          warnings: [],
        },
        repeats: 1,
        keep: 'all',
      })
      const data = sim.actionData?.[member]?.[key]
      if (data) out![key] = data
    } catch {
      // (an action this kit cannot play alone)
    }
  }
  return out
}
