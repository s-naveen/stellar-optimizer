import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { getCharStat } from '@genshin-optimizer/gi/stats'
import type { InputPremodKey } from '@genshin-optimizer/gi/wr-types'
import { Cooldowns } from './cooldowns'
import { gearEffects } from './gearEffects'
import { Health } from './health'
import { kitFramesInto, kitModels } from './kits/index'
import { NORMAL_START_DELAYS } from './normalDelays'
import type { ParsedRotation, RotationAction } from './parse'
import { rotationRandom } from './random'
import {
  type AuraTrace,
  elementalReactions,
  reactionEnablers,
} from './reactions'
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
  /** Bursts every live Dendro Core */
  ruptureCores?: (ctx: SimContext) => void
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
  buffWindows: SimBuffWindow[]
  countedBuffs: SimCountedBuff[]
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
    /** The kit's own frame count, before a `frameOverrides` edit */
    defaultFrames?: number
    /** Its frame-data key (`actionFrameKey`, with the version its kit played) */
    frameKey?: string
    /** The version its kit played (a mode or stance's), if not the ordinary one */
    variant?: ActionVariant
  }[]
  /** The kept rotation's written waits (W1.5), in the same form as `actions` */
  waits?: SimulationResult['actions']
  /**
   * The kept rotation's swaps: who to whom, when the swap began (frame), how long it took (swap
   * time and ping) and how long it first waited for the 1 s swap cooldown
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
 * Hu Tao, Gaming, Kuki), teammates' damage (Lohen), stat thresholds (Chongyun) and expected crits
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
]
export const needsRotationCalculation = (members: readonly CharacterKey[]) =>
  members.some((m) => ROTATION_CALCULATION_MEMBERS.includes(m))

/** Native queues run enemy tasks, character tasks, then core tasks each frame. */
type Event = { t: number; priority: number; seq: number; run: () => void }

/**
 * Plays a parsed rotation frame by frame with the members' kits: each action starts when the
 * previous one can be cancelled into it, periodic and triggered damage is scheduled, buffs are
 * windows in time. The rotation is played three times back to back and the middle one is kept,
 * so what carries over from the previous rotation (a summon still ticking, a buff still up) is
 * counted as it is in practice.
 */
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
  auraTrace,
  frameOverrides = {},
  frameData = {},
  pingFrames = 0,
}: {
  rotation: ParsedRotation
  members: CharacterKey[]
  constellations: Partial<Record<CharacterKey, number>>
  elements: Partial<Record<CharacterKey, HitElement>>
  reactions?: RotationReactions
  repeats?: number
  /** Benchmarks retain the same complete fixed-loop interval as the native reference. */
  keep?: 'middle' | 'all' | 'last2'
  kits?: Partial<Record<CharacterKey, KitModel>>
  /** Frames spent swapping, with the previous member still on field (gcsim's default: 12). */
  swapFrames?: number
  target?: { radius: number; distance: number; maxHp?: number }
  /** The members' artifact sets (pieces), for set effects the simulation plays (Thundering Fury) */
  gear?: Partial<Record<CharacterKey, SimGear>>
  calculate?: RotationCalculation
  random?: () => number
  /** Debugging: the reaction engine's aura trace (see `AuraTrace`) */
  auraTrace?: (entry: AuraTrace) => void
  /**
   * Player-edited timing: frames until the next action, by the action's position in the written
   * rotation (its actions in order). Hits keep their own timing; everything after shifts.
   */
  frameOverrides?: Partial<Record<number, number>>
  /** Player-edited character frame data, by member and `actionFrameKey` */
  frameData?: FrameData
  /** Input delay (ping) added to every action and swap, frames */
  pingFrames?: number
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
  const constructs: number[] = []
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
  reactions ??= elementalReactions({
    members,
    domainActive: (t) => windowOn('Columbina', 'burstDomain', t),
    // Nilou's A1 (Golden Chalice's Bounty) is on the whole party
    bountiful: (_m, t) => windowOn('Nilou', 'a1AfterSkill', t),
    trace: auraTrace,
  })
  let onField: CharacterKey =
    rotation.opener?.[0]?.characterKey ??
    rotation.steps[0]?.characterKey ??
    members[0]
  /** Whether a member is in their own Nightsoul's Blessing (their kit's state, else its windows) */
  const inNightsoulAt = (k: CharacterKey, t: number): boolean =>
    kits[k]?.nightsoul?.(ctxAt(t, k), states.get(k)).active ??
    windows.some(
      (w) =>
        w.owner === k &&
        /nightsoul|nsBlessing/i.test(w.path[1] ?? '') &&
        w.start <= t &&
        t < w.end
    )
  // set effects the simulation plays (gearEffects.ts)
  const gearFx = gearEffects({
    members,
    gear,
    inNightsoul: (k, t) => inNightsoulAt(k, t),
    onField,
    cooldown: (k, key, t) => cooldowns.readyAt(`${k}.${key}`, t) - t,
    window: (owner, path, value, start, end) =>
      windows.push({ owner, path, value, start, end }),
    reduceCooldown: (k, key, frames, t) => {
      cooldowns.reduce(`${k}.${key}`, t, frames)
    },
  })
  let now = 0
  /** The action being played (its actor and start), for triggered hitlag that lengthens it */
  let currentAction: { actor: CharacterKey; start: number } | undefined
  let swapReadyAt = 0
  const natlan = members.filter(
    (m) => getCharStat(m).region === 'natlan'
  ).length
  const nightsoulInterval = [0, 1080, 720, 540, 540][natlan] ?? 540
  const geoFromMoondrifts =
    members.filter((m) => elements[m] === 'geo').length >= 2 &&
    members.some((m) => reactionEnablers.lunarCrystallize.includes(m))
  let geoResonance = false
  let geoResonanceToken = 0
  const refreshGeoResonance = (frame: number) => {
    if (!geoFromMoondrifts) return
    const token = ++geoResonanceToken
    const tick = (t: number) => {
      if (token !== geoResonanceToken) return
      geoResonance = (reactions?.moondriftsAt?.(t) ?? 0) > 0
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
  const snapshotAt = (t: number, member: CharacterKey) => {
    const sim = {
      hits,
      buffWindows: windows,
      countedBuffs: [],
      hitlagEvents: hits,
    } as unknown as SimulationResult
    const { refs, stateAt } = buffStates(sim)
    const values = stateAt(
      {
        t,
        characterKey: member,
        onField,
        path: [],
        tag: 'other',
        element: 'physical',
        label: 'calculation',
      },
      -1
    )
    return {
      t,
      onField,
      states: refs.map((ref, i) => ({ ...ref, value: values[i] })),
    }
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
    ruptureDendroCores() {
      reactions?.ruptureCores?.(ctxAt(t, actor))
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
      const first = normalCounter % length
      normalCounter = (first + count) % length
      return first
    },
    target,
    attackSpeed: windows
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
    absorb: (priority) => reactions?.absorbAt?.(t, priority),
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
          (kits[m]?.nightsoul?.(ctxAt(t, m), states.get(m)).points ?? 0),
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
    constructs: constructs.filter((end) => end > t).length,
    construct: (duration) => constructs.push(t + duration),
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
      windows.push({
        owner,
        path,
        value,
        start,
        end: start + duration,
        ...opts,
      })
    },
    state(owner, path, value) {
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
      windows.push(next)
    },
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
      cooldowns.reduce(`${ck ?? actor}.${key}`, t, frames)
    },
    resetCooldown: (key, count, ck) =>
      cooldowns.reset(`${ck ?? actor}.${key}`, t, count),
    consumeNightsoul(amount, member = actor) {
      if (amount <= 0) return
      reportedConsumption.set(
        member,
        (reportedConsumption.get(member) ?? 0) + amount
      )
      if (member === onField)
        ctxAt(t, member).buff(
          member,
          ['ObsidianCodex', '4NightsoulConsume'],
          'on',
          0,
          360
        )
      for (const recipient of members)
        kits[recipient]?.onNightsoulConsume?.(
          ctxAt(t, recipient),
          states.get(recipient),
          member,
          amount
        )
    },
    sets: (ck) => gear[ck]?.sets ?? {},
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
      if (health) {
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
          ['resonance.ShatteringIce', 'BlizzardStrayer.state'].includes(
            s.path.join('.')
          )
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
      geoFromMoondrifts &&
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
  let resourcePolling = true
  const pollNightsoul = (frame: number) => {
    if (!resourcePolling) return
    for (const m of members) {
      const kit = kits[m]
      if (!kit?.nightsoul) continue
      const ctx = ctxAt(frame, m)
      const next = kit.nightsoul(ctx, states.get(m))
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
        if (amount > 0 && m === onField)
          ctx.buff(m, ['ObsidianCodex', '4NightsoulConsume'], 'on', 0, 360)
        for (const recipient of amount > 0 ? members : [])
          kits[recipient]?.onNightsoulConsume?.(
            ctxAt(frame, recipient),
            states.get(recipient),
            m,
            amount
          )
      }
      ctx.state(
        m,
        ['ObsidianCodex', '2NightsoulBlessing'],
        next.active && m === onField ? 'on' : ''
      )
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
  if (geoFromMoondrifts) refreshGeoResonance(0)
  const actions: SimulationResult['actions'] = []
  const waits: SimulationResult['actions'] = []
  const swaps: NonNullable<SimulationResult['swaps']> = []
  /** Waits for readiness: what waited, when it began, how long */
  const stalled: { label: string; t: number; frames: number }[] = []
  const actionData: NonNullable<SimulationResult['actionData']> = {}
  /** The action before a written wait: the action after the wait respects its cancels */
  let animationLock:
    | { start: number; result: ActionResult; actor: CharacterKey }
    | undefined
  // one written action: the opener's (played once before the loops) or the loop's
  const play = (list: typeof flat, i: number, r: number, opener: boolean) => {
    const { characterKey, action } = list[i]
    const kit = kits[characterKey]
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
        frames: swapFrames + pingFrames,
        cooldown: swapStart - now,
      })
      now = swapStart + swapFrames + pingFrames
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
        const frames = kitFramesInto(entry, action.kind)
        actions.push({ characterKey, text: 'Entry', start: now, frames })
        now += frames
        runUntil(now, true)
      }
      // Zero-delay swap/entry tasks resolve before the new member's first
      // action. Otherwise a queued passive can observe a buff that the
      // following action creates and retroactively enable itself.
      runUntil(now, true)
    }
    if (!kit) return
    if (action.kind === 'wait') {
      lastNormalActor = undefined
      const defaultFrames = Math.round((action.count ?? 0) * FPS)
      const frames = Math.max(
        0,
        (opener ? undefined : frameOverrides[i]) ?? defaultFrames
      )
      waits.push({
        characterKey,
        text: action.text,
        start: now,
        frames,
        index: opener ? undefined : i,
        defaultFrames,
      })
      kit.onWait?.(ctxAt(now, characterKey), states.get(characterKey), frames)
      now += frames
      return
    }
    // Cooldowns and resource gates both wait, as native ActionReady does. A queued
    // reaction can fill a resource, expire a mode, or change the cooldown being checked.
    const waitStart = now
    for (;;) {
      const cdKey = kit.cooldownKey
        ? kit.cooldownKey(states.get(characterKey), action, now)
        : action.kind === 'skill' || action.kind === 'burst'
          ? action.kind
          : undefined
      const cooldownReady = cdKey
        ? cooldowns.readyAt(`${characterKey}.${cdKey}`, now)
        : now
      const resourceReady =
        kit.actionReadyAt?.(
          ctxAt(now, characterKey),
          states.get(characterKey),
          action
        ) ?? now
      const readyAt = Math.max(cooldownReady, resourceReady)
      if (readyAt <= now) break
      // an optional action ("E?"): used when ready, else left out (as a sim's "if .skill.ready")
      if (action.optional) {
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
      if (r === Math.min(1, repeats - 1))
        notes.add(
          `Waited ${((now - waitStart) / FPS).toFixed(1)} s for ${characterKey}'s ${action.text}.`
        )
    }
    const actCtx = ctxAt(now, characterKey)
    // a mode or stance's version of the action has its own frame data and edits
    const variant = kit.variant?.(actCtx, states.get(characterKey), action)
    const frameKey = actionFrameKey(action, variant)
    const edit = frameData[characterKey]?.[frameKey]
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
        (keep === 'last2' ? r >= repeats - 2 : r === Math.min(1, repeats - 1))
      )
        warnings.push(result.failed)
      return
    }
    // Moonsign: Ascendant Gleam. With two or more Moonsign members, a member who is not one
    // gives the party Lunar reaction DMG (from its own stats) for 20 s after its Skill or Burst
    if (
      moonsign >= 2 &&
      !kits[characterKey]?.moonsign &&
      (action.kind === 'skill' || action.kind === 'burst')
    )
      windows.push({
        owner: characterKey,
        path: [characterKey, 'moonsignAfterSkillBurst'],
        value: 'on',
        start: now,
        end: now + 20 * FPS,
      })
    lastNormalActor = action.kind === 'normal' ? characterKey : undefined
    if (result.cooldown) {
      const { key, frames, delay = 0 } = result.cooldown
      const at = now + delay
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
      (opener
        ? flat[0]
        : loopTo
          ? { characterKey: loopTo, action: flat[0]?.action }
          : undefined)
    const nextKind =
      next && next.characterKey !== characterKey ? 'swap' : next?.action?.kind
    gearFx.onAction(ctxAt(now, characterKey), characterKey, action)
    let frames = kitFramesInto(result, nextKind)
    let stateFrames = frames
    // gcsim queues the next item once the action reaches its earliest cancel (CanQueueAfter):
    // a written wait starts there, and the action after it is held until this one allows it
    if (nextKind === 'wait' && !result.duration) {
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
    frames += pingFrames
    const defaultFrames = frames
    const edited = opener ? undefined : frameOverrides[i]
    if (edited !== undefined) frames = Math.max(1, Math.round(edited))
    actions.push({
      characterKey,
      text: action.text,
      start: now,
      frames,
      index: opener ? undefined : i,
      defaultFrames,
      frameKey,
      ...(variant && { variant }),
    })
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
  // the opener: once, before the first loop (its effects carry into the loops)
  for (const i of openerFlat.keys()) play(openerFlat, i, -1, true)
  for (let r = 0; r < repeats; r++) {
    bounds.push(now)
    for (const i of flat.keys()) play(flat, i, r, false)
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
  const start =
    bounds[
      keep === 'all'
        ? 0
        : keep === 'last2'
          ? Math.max(0, repeats - 2)
          : keptLoop
    ]
  const end =
    bounds[keep === 'all' || keep === 'last2' ? repeats : keptLoop + 1]
  const kept = all.filter((h) => h.t >= start && h.t < end)
  const countedBuffs: SimCountedBuff[] = []
  for (const m of members) {
    const kit = kits[m]
    if (!kit?.countedBuffs) continue
    // (indices into `kept`)
    countedBuffs.push(...kit.countedBuffs(kept, constellations[m] ?? 0).buffs)
  }
  for (const m of unsupported)
    warnings.push(`${m}: no kit model yet (their actions were skipped)`)
  return {
    hits: kept,
    frames: end - start,
    start,
    buffWindows: windows,
    countedBuffs,
    hitlagEvents: all.filter((h) => h.path.join('.') === '_marker.hitlag'),
    notes: [...notes],
    warnings,
    unsupported,
    actions: actions.filter((a) => a.start >= start && a.start < end),
    waits: waits.filter((a) => a.start >= start && a.start < end),
    swaps: swaps.filter((w) => w.start >= start && w.start < end),
    stalls: stalled
      .filter((w) => w.t >= start && w.t < end)
      .reduce<Record<string, number>>((out, w) => {
        out[w.label] = (out[w.label] ?? 0) + w.frames
        return out
      }, {}),
    actionData,
  }
}

/** Sample whole timelines so random extra hits retain their own aura and buff history. */
export function simulateRotationSamples(
  options: Parameters<typeof simulateRotation>[0],
  count = options.members.some((m) => (options.kits ?? kitModels)[m]?.sampled)
    ? 64
    : 1,
  seed = 0x4b514d
): SimulationResult {
  if (!Number.isInteger(count) || count < 1 || count > 1024)
    throw new Error('Rotation samples must be an integer between 1 and 1024')
  if (count === 1) return simulateRotation(options)
  if (options.reactions || options.random)
    throw new Error(
      'Sampled rotations require independent reaction and random state'
    )
  const samples = Array.from({ length: count }, (_, i) => ({
    probability: 1 / count,
    result: simulateRotation({
      ...options,
      random: rotationRandom(seed + Math.imul(i, 0x9e3779b9)),
    }),
  }))
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
    notes: [...unique('notes'), `${count} seeded rotation samples.`],
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

/** Every buff the simulation decides, and its state at each hit ('' when off) */
function buffStates(
  sim: SimulationResult,
  declared: { owner: SimBuffOwner; path: string[] }[] = []
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
    let end = window.end
    let enemyPauseEnd = -1
    for (const pause of pauses)
      if (
        (window.hitlag === 'enemy' || pause.characterKey === character) &&
        pause.t >= window.start &&
        pause.t < end
      ) {
        if (window.hitlag === 'enemy') {
          const next =
            pause.t + (pause.enemyAnimationPause ?? pause.animationPause ?? 0)
          end += Math.max(0, next - Math.max(pause.t, enemyPauseEnd))
          enemyPauseEnd = Math.max(enemyPauseEnd, next)
        } else end += pause.animationPause ?? 0
      }
    byCharacter.set(character, end)
    return end
  }
  const refs = [...declared]
  for (const b of [
    ...sim.buffWindows,
    ...sim.countedBuffs,
    ...sim.hits.flatMap((h) => h.states ?? []),
  ])
    if (!b.path[1]?.startsWith('_') && !refs.some((r) => sameRef(r, b)))
      refs.push({ owner: b.owner, path: b.path })
  const stateAt = (hit: SimHit, index: number) =>
    refs.map((ref) => {
      const snapshot = hit.states?.find((s) => sameRef(s, ref))
      if (snapshot) return snapshot.value
      // counted buffs (one entry per cast or value): the entry that counts this hit
      const counted = sim.countedBuffs.filter((c) => sameRef(c, ref))
      if (counted.length)
        return counted.find((c) => c.hits.has(index))?.value ?? ''
      const on = sim.buffWindows.filter(
        (w) =>
          sameRef(w, ref) &&
          w.start <= hit.t &&
          hit.t < endAt(w, hit.characterKey) &&
          (!w.recipient || w.recipient === hit.characterKey)
      )
      if (!on.length) return ''
      // stacking windows (e.g. Columbina's A1, one per Gravity Interference): the count
      if (
        on.every((w) => w.value === '1') &&
        (ref.path[1]?.toLowerCase().includes('stack') ||
          on.some((w) => w.max !== undefined))
      )
        return `${Math.min(Math.max(...on.map((w) => w.max ?? 3)), on.length)}`
      return on.reduce((latest, w) => (w.start >= latest.start ? w : latest))
        .value
    })
  return { refs, stateAt }
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
  const weights: Map<string, number>[] = []
  for (const { result, probability } of sim.samples ?? [
    { result: sim, probability: 1 },
  ]) {
    const { refs: sampleRefs, stateAt } = buffStates(result)
    const indices = sampleRefs.map((ref) => {
      const found = refs.findIndex((r) => sameRef(r, ref))
      if (found >= 0) return found
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
  declared: { owner: SimBuffOwner; path: string[] }[] = []
): Partial<Record<CharacterKey, TeamOptAttack[]>> {
  if (sim.samples) {
    // A buff that exists only in one sample must still be explicitly off in
    // the others, including when the saved loadout/default has it enabled.
    const refs = [...declared]
    for (const { result } of sim.samples)
      for (const ref of buffStates(result).refs)
        if (!refs.some((r) => sameRef(r, ref))) refs.push(ref)
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
  const { refs, stateAt } = buffStates(sim, declared)
  const groups = new Map<
    string,
    {
      hit: SimHit
      states: string[]
      count: number
      contributorStates?: TeamOptAttack['reactionContributorStates']
    }
  >()
  const add = (hit: SimHit, states: string[], w: number) => {
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
    if (g) g.count += w
    else groups.set(key, { hit, states, count: w, contributorStates })
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
    const then = hit.snapshotStates
      ? refs.map(
          (ref) =>
            hit.snapshotStates!.find((state) => sameRef(ref, state))?.value ??
            ''
        )
      : stateAt({ ...hit, t: hit.snapshotT, onField, states: undefined }, index)
    // (the hit's own snapshotted states stand at both times)
    if (
      then.every(
        (v, i) =>
          v === states[i] || hit.states?.some((x) => sameRef(x, refs[i]))
      )
    )
      return hit
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
            ...(hit.snapshotStates
              ? {
                  states: [
                    ...hit.snapshotStates,
                    ...(hit.states ?? []).filter(
                      (x) => !hit.snapshotStates!.some((y) => sameRef(x, y))
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
    if (!hit.contributors?.length) return add(hit, states, w)
    // Keep the reaction on its trigger. Its contributors roll crit independently before
    // ranking, so a static split of average damage cannot represent the native expectation.
    add(hit, states, w)
  })
  const out: Partial<Record<CharacterKey, TeamOptAttack[]>> = {}
  for (const { hit, states, count, contributorStates } of groups.values()) {
    const attack: TeamOptAttack = {
      path: hit.path,
      hits: Math.round(count * 100) / 100,
      hitMode: 'avgHit',
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
                ? refs.map(
                    (ref) =>
                      snapshot.states!.find((s) => sameRef(s, ref))?.value ?? ''
                  )
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
    ;(out[hit.characterKey] ??= []).push(attack)
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
    'rotation' | 'frameData' | 'frameOverrides' | 'pingFrames' | 'repeats'
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
