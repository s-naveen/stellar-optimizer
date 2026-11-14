import type {
  AdditiveReactionKey,
  AmpReactionKey,
  CharacterKey,
} from '@genshin-optimizer/gi/consts'
import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import type { InputPremodKey } from '@genshin-optimizer/gi/wr-types'
import type { RotationAction } from './parse'

/** Frames per second: every time in the simulation is a frame count (as in the game and gcsim) */
export const FPS = 60

export interface SimGear {
  sets?: Partial<Record<string, number>>
  weapon?: string
  refinement?: number
}

/** How the game tags a damage instance (what buffs and mechanics key on) */
export type HitTag =
  | 'normal'
  | 'charged'
  | 'plunge'
  | 'skill'
  | 'burst'
  /** Direct Lunar-Crystallize damage (counted as a Lunar-Crystallize reaction, no DMG%) */
  | 'directLunarCrystallize'
  /** Lunar-Crystallize reaction damage */
  | 'reactionLunarCrystallize'
  | 'directStellarSwirl'
  | 'directStellarConduct'
  | 'other'

export type HitElement =
  | 'physical'
  | 'geo'
  | 'hydro'
  | 'electro'
  | 'dendro'
  | 'pyro'
  | 'cryo'
  | 'anemo'

/** One damage instance in the timeline */
export interface SimHit {
  /** Frame it lands */
  t: number
  /** Who deals it */
  characterKey: CharacterKey
  /** Its node in the character's sheet (e.g. ['skill', 'stride2Dmg']) */
  path: string[]
  tag: HitTag
  element: HitElement
  /** Applies its element (durability > 0): can trigger reactions */
  applies?: boolean
  /** Its element application's durability (default 25) */
  durability?: number
  /** Its ICD tag: 'none' (always applies) or a name; hits of one tag share a counter */
  icd?: string
  /**
   * Its gcsim ICD group (reset time and application pattern, see icdGroups.ts), when not the
   * default (2.5 s, every 3rd hit); otherwise taken from `icd` when that names a group
   */
  icdGroup?: string
  /** How many hits it counts as (expected extra hits: 1.33) */
  weight?: number
  /** This instance's pause of the attacker's character-task clock. */
  animationPause?: number
  /**
   * A hitlag marker from a triggered effect (not part of the action's own frames): when it lands
   * during its character's current action, that action lasts this much longer (gcsim pauses the
   * actor's animation)
   */
  extendsAction?: boolean
  /** Full target pause, before overlapping pauses on the attacker are deduplicated. */
  enemyAnimationPause?: number
  poiseDamage?: number
  blunt?: boolean
  /** Native AttackTagNightsoul, independent of the ordinary attack tag. */
  nightsoul?: boolean
  /** Sea-Dyed Foam: the healing nodes and how often they contributed to this bubble. */
  healing?: { path: string[]; count: number }[]
  /** Explicit recipients for a heal; otherwise active/whole-party defaults apply. */
  healTargets?: CharacterKey[]
  /** Talent that triggered a reaction marker, for source-specific passives. */
  reactionSource?: { path: string[]; label: string }
  /**
   * gcsim's snapshotDelay: the attacker's own stats are taken this many frames after the hit is
   * queued (0: at the cast), not when it lands; enemy debuffs still count at impact.
   */
  snapshotDelay?: number
  /** (set by the simulation) frame and active member of that snapshot */
  snapshotT?: number
  snapshotOnField?: CharacterKey
  /** Actual queue-event conditions; later same-frame procs cannot change this capture. */
  snapshotStates?: SimSnapshot['states']
  /** Specific conditions snapshotted when a resource-consuming hit is queued. */
  states?: { owner: SimBuffOwner; path: string[]; value: string }[]
  statSnapshots?: (SimSnapshot & {
    characterKey?: CharacterKey
    recipient?: CharacterKey
    stat: InputPremodKey
    path: string[]
  })[]
  talentMultiplier?: number
  bonusStats?: TeamOptAttack['bonusStats']
  /** It triggers Moondrift Harmony itself (Linnea C2: Lumi's Hammer) */
  triggersHarmony?: boolean
  /** Who is on the field when it lands */
  onField?: CharacterKey
  /** The amplifying or additive reaction it triggers (set by the simulation's reactions) */
  reaction?: AmpReactionKey | AdditiveReactionKey
  /**
   * A Lunar or Stellar Swirl reaction hit: the members contributing to it. Each one's own node
   * counts 0.6 / 0.3 / 0.05 / 0.05 of a hit, by rank (gcsim's contributor multipliers)
   */
  contributors?: CharacterKey[]
  /** Readable name, for the breakdown */
  label: string
}

/** Whose conditional a buff is: a member's, or the team's own (reactions: `['reaction', …]`) */
export type SimBuffOwner = CharacterKey | 'team'

/** Conditions captured at a queue event, before a hit can grant new buffs on the same frame. */
export interface SimSnapshot {
  t: number
  onField: CharacterKey
  states?: { owner: SimBuffOwner; path: string[]; value: string }[]
}

/** A conditional (buff) that is on during [start, end) */
export interface SimBuffWindow {
  owner: SimBuffOwner
  /** The conditional's path in the owner's sheet (e.g. ['Zibai', 'a1Moonfall']) */
  path: string[]
  /** The state it has while on */
  value: string
  start: number
  end: number
  /** Stacking buffs: the most stacks counted (default 3) */
  max?: number
  /** A recipient-specific effect; other members do not inherit it. */
  recipient?: CharacterKey
  /** Buff duration uses the recipient's character clock rather than world time. */
  hitlag?: 'recipient' | 'enemy'
}

/**
 * A buff that covers a number of hits rather than a time (e.g. Illuga's 21 Nightingale's Songs):
 * the hits it covered, by index into the run's hits
 */
export interface SimCountedBuff {
  owner: CharacterKey
  path: string[]
  value: string
  hits: Set<number>
}

/** What a character's action does to the timeline */
export interface ActionResult {
  /** Frames until the next action can start (by default; see `framesInto`) */
  frames: number
  /** Actual starts of the individual normal states in a grouped N string. */
  normalStarts?: NormalStateStart[]
  /**
   * Frames until a specific next action can start (cancels); swap = the next action is another
   * member's
   */
  framesInto?: Partial<Record<RotationAction['kind'] | 'swap', number>>
  /** The action could not be done (e.g. not enough Phase Shift Radiance): why */
  failed?: string
  /** The cooldown it starts: `delay` frames after the action starts, lasting `frames` */
  cooldown?: { key: string; frames: number; delay?: number }
  /** Channel duration can grow when resource events land during the action (Mitya). */
  duration?: (next?: RotationAction['kind'] | 'swap') => number
  /** A kit-driven swap (Chiori's Tapestry), which bypasses the ordinary swap cooldown. */
  forcedSwap?: CharacterKey
}

/** The simulation, as a character's kit sees it */
export interface SimContext {
  /** Frame the current action started */
  readonly now: number
  /** Who is on the field now */
  readonly onField: CharacterKey
  readonly members: readonly CharacterKey[]
  /** Independent draws in [0, 1); injectable for mechanics tests. */
  random(): number
  readonly constellation: (characterKey: CharacterKey) => number
  /** Number of party members of an element */
  readonly partyCount: (element: HitElement) => number
  /** Continue the current normal combo, wrapping at its length. Non-normal actions reset it. */
  normalSequence(length: number, count: number): number
  readonly attackSpeed: number
  /** Normal-only buffs may require an already active normal state. Later steps
   * in one grouped string pass `continuing`, like separate native attacks. */
  normalAttackSpeed(continuing: boolean): number
  normalAnimationDelay(
    characterKey: CharacterKey,
    kind: 'xingqiu' | 'yelan'
  ): number
  readonly target: { radius: number; distance: number; maxHp?: number }
  /** The enemy's current absorbable aura, in Pyro > Hydro > Electro > Cryo priority. */
  absorb(priority?: readonly HitElement[]): HitElement | undefined
  hasBuff(owner: SimBuffOwner, path: string[]): boolean
  /** Emit an additional Nightsoul Burst (e.g. Xilonen A4), independent of the team cooldown. */
  nightsoulBurst(): void
  /** Report an explicit resource spend, including one that immediately exits the blessing. */
  consumeNightsoul(amount: number, actor?: CharacterKey): void
  readonly teamNightsoul: number
  /** Active Geo constructs, rather than just Geo members in the roster. */
  readonly healthTracked: boolean
  readonly damageTracked: boolean
  hpRatio(characterKey: CharacterKey): number | undefined
  drainHp(
    characterKey: CharacterKey,
    fraction: number,
    threshold?: number
  ): number
  healPercent(
    source: CharacterKey,
    fraction: number,
    targets?: readonly CharacterKey[]
  ): void
  calculate(characterKey: CharacterKey, path: string[]): number | undefined
  /** Capture the current conditions for offensive stat snapshots, including event order. */
  snapshot(characterKey?: CharacterKey): SimSnapshot
  /** Shared Verdant + Moonridge Dew; Lauma and Columbina consume the same party resource. */
  readonly dew: number
  consumeDew(amount: number): number
  addMoonridgeDew(): void
  /** Whether a member is in their own Nightsoul's Blessing now */
  inNightsoul(member: CharacterKey): boolean
  /** Verdant Dew accrues `rate` times faster for `duration` frames from now */
  boostDew(duration: number, rate: number): void
  /** Bursts every Dendro Core now (Kaveh): each blooms a frame later, owned by its creator */
  ruptureDendroCores(): void
  readonly isBurning: boolean
  readonly isFrozen: boolean
  readonly moondrifts: number
  readonly constructs: number
  construct(duration: number): void
  /** Moonsign level of the party */
  readonly moonsign: number
  /** The Stellar Radiance currently active on the party (Conduct takes precedence). */
  readonly radiance: 'conduct' | 'swirl' | undefined
  /** Swirl radiance can coexist with Conduct, even when a kit gives Conduct priority. */
  readonly hasStellarSwirl: boolean
  /** Schedule a hit `delay` frames from now */
  hit(
    delay: number,
    hit: Omit<SimHit, 't' | 'characterKey' | 'onField'> & {
      characterKey?: CharacterKey
    }
  ): void
  /** Turn a conditional on for `duration` frames from `delay` frames from now */
  buff(
    owner: SimBuffOwner,
    path: string[],
    value: string,
    delay: number,
    duration: number,
    /** Stacking buffs: the most stacks (default 3) */
    options?:
      | number
      | {
          max?: number
          recipient?: CharacterKey
          hitlag?: 'recipient' | 'enemy'
        }
  ): void
  /** Replace a continuously tracked conditional at this frame, closing its previous interval. */
  state(owner: SimBuffOwner, path: string[], value: string): void
  /**
   * Infuse the on-field Sword, Claymore and Polearm users' Physical normal, charged and plunge hits
   * with `element` for `duration` frames from `delay` (Chongyun's field, Candace's burst, Bennett
   * C6: gcsim's AddWeaponInfuse on the active character). Hits a kit gives an element keep it.
   */
  infuse(
    element: HitElement,
    delay: number,
    duration: number,
    recipient?: CharacterKey
  ): void
  /**
   * Run `fn` at `delay` frames from now. Same-frame tasks run in the order they were scheduled
   * (gcsim's task queue): a callback scheduled after a same-frame `hit` runs after it.
   */
  at(delay: number, fn: (ctx: SimContext) => void): void
  /**
   * On the enemy's task queue (gcsim's QueueEnemyTask): enemy hitlag (frozen frames) pushes it
   * back, e.g. Burning ticks, Blood Blossom
   */
  atEnemy(delay: number, fn: (ctx: SimContext) => void): void
  /** A character's task clock pauses during that character's hitlag. */
  atCharacter(
    characterKey: CharacterKey,
    delay: number,
    fn: (ctx: SimContext) => void
  ): void
  /** Elapsed frames on a member's clock, excluding its hitlag pauses. */
  characterFrame(characterKey: CharacterKey): number
  /**
   * A cooldown of a member (default: the one acting) is ready `frames` from now, e.g. Xilonen's skill
   * from the moment she leaves the field
   */
  setCooldown(key: string, frames: number, characterKey?: CharacterKey): void
  /** Consume a charge when a character task reaches its recharge start. */
  spendCooldown(key: string, frames: number, characterKey?: CharacterKey): void
  /** Restart an active recharge and start recharging all currently ready charges. */
  restartCooldown(
    key: string,
    frames: number,
    characterKey?: CharacterKey
  ): void
  cooldownReadyAt(key: string, characterKey?: CharacterKey): number
  /** Refresh one additive modifier on a recipient's hitlag-paused clock. */
  modifyCooldown(
    source: string,
    amount: number,
    duration: number,
    recipient?: CharacterKey
  ): void
  modifyAttackSpeed(
    source: string,
    amount: number,
    duration: number,
    recipient?: CharacterKey
  ): void
  /** Shorten a member's running cooldown by `frames` (e.g. Thundering Fury) */
  reduceCooldown(key: string, frames: number, characterKey?: CharacterKey): void
  /** Restore charges immediately (one per consumed Sakura for Yae's A1). */
  resetCooldown(key: string, count?: number, characterKey?: CharacterKey): void
  /** A member's artifact set pieces in the build being simulated (empty when not known) */
  readonly sets: (characterKey: CharacterKey) => Partial<Record<string, number>>
  /** Note shown with the result (e.g. an assumption) */
  note(text: string): void
  warn(text: string): void
}

export interface NormalStateStart {
  offset: number
  /** Zero-based position in the character's normal string. */
  index: number
}

export interface DamageOutcome {
  damage: number
  probability: number
}
export type RotationCalculation = ((
  characterKey: CharacterKey,
  path: string[],
  states: NonNullable<TeamOptAttack['states']>,
  onField: CharacterKey
) => number | undefined) & {
  damage?: (
    characterKey: CharacterKey,
    attack: TeamOptAttack
  ) => DamageOutcome[] | undefined
}
export interface HpChange {
  kind: 'heal' | 'drain'
  characterKey: CharacterKey
  source: CharacterKey
  amount: number
  ratio: number
  overheal: number
  party: boolean
}

/** A character's kit: what its actions do, and what it reacts to */
/**
 * A version of an action that a member's state makes it: a mode or stance doing something else with
 * the same button (Zibai's E in Lunar Phase Shift is Spirit Steed's Stride). Its frame data and
 * frame edits are its own (`actionFrameKey(action, variant)`).
 */
export interface ActionVariant {
  /** Short id, unique for the kit: the frame-data key's suffix (`skill@stride`) */
  key: string
  /** What the action is in this version ("Spirit Steed's Stride") */
  label: string
  /** The mode or stance it belongs to ("Lunar Phase Shift") */
  mode?: string
}

export interface KitModel {
  characterKey: CharacterKey
  /**
   * Its timeline has random parts (ctx.random): rotations with it are averaged over seeded samples
   * (simulateRotationSamples), as the reference simulators average over trials
   */
  sampled?: boolean
  /** Moonsign levels it adds to the party */
  moonsign?: number
  element: HitElement
  /** Where its frame data comes from (credited in the UI) */
  source: string
  /** Per-character state for one run (fresh each simulation) */
  init?: () => unknown
  onStart?: (ctx: SimContext, state: any) => void
  onHpChange?: (ctx: SimContext, state: any, change: HpChange) => void
  /** Shared sequential recharge queues; single-charge cooldowns remain the default. */
  charges?: (constellation: number) => Record<string, number>
  normalAttackSpeed?: (
    ctx: SimContext,
    state: any,
    attacker: CharacterKey,
    alreadyNormal: boolean
  ) => number
  normalAnimationDelay?: (
    ctx: SimContext,
    state: any,
    kind: 'xingqiu' | 'yelan'
  ) => number | undefined
  act(
    ctx: SimContext,
    state: any,
    action: RotationAction,
    previous: RotationAction | undefined
  ): ActionResult
  /**
   * The version an action is in the member's current state, asked just before it is played (no
   * side effects): undefined for the ordinary one
   */
  variant?: (
    ctx: SimContext,
    state: any,
    action: RotationAction
  ) => ActionVariant | undefined
  /** Next possible frame for a resource-gated action; rechecked as queued events land. */
  actionReadyAt?: (
    ctx: SimContext,
    state: any,
    action: RotationAction
  ) => number
  /** Evaluate impact-dependent conditions before capturing the damage context. */
  onBeforeHit?: (ctx: SimContext, state: any, hit: SimHit) => void
  /** Called for every hit that lands (anyone's), in time order: for triggered mechanics */
  onHit?: (ctx: SimContext, state: any, hit: SimHit, index: number) => void
  /** Shared reactions snapshot before their delayed damage; hit-count pools spend on impact. */
  onReactionSnapshot?: (ctx: SimContext, state: any, hit: SimHit) => void
  onHitlag?: (ctx: SimContext, state: any, frames: number) => void
  /** After reactions resolve, with the pre-hit buff context and actual crit outcomes. */
  onDamage?: (
    ctx: SimContext,
    state: any,
    hit: SimHit,
    outcomes: DamageOutcome[] | undefined
  ) => void
  observesDamage?: (ctx: SimContext, state: any, hit: SimHit) => boolean
  onNightsoulBurst?: (ctx: SimContext, state: any) => void
  /** Read the actual resource at this frame without changing the kit state. */
  nightsoul?: (
    ctx: SimContext,
    state: any
  ) => { active: boolean; points: number }
  onNightsoulConsume?: (
    ctx: SimContext,
    state: any,
    actor: CharacterKey,
    amount: number
  ) => void
  /**
   * The cooldown an action waits for (default: 'skill' / 'burst' for those kinds); undefined:
   * none (e.g. Zibai's Stride, gated by radiance instead)
   */
  cooldownKey?: (
    state: any,
    action: RotationAction,
    /** The frame the action would start */
    now: number
  ) => string | undefined
  /** Called when the member swaps out */
  onSwapOut?: (ctx: SimContext, state: any) => void
  /**
   * Called when the member waits (a W step), before its `frames` pass: what the time does for the
   * kit (e.g. Mualani walking on Sharky in her blessing, gcsim's walk)
   */
  onWait?: (ctx: SimContext, state: any, frames: number) => void
  /**
   * First frame this (on-field) character can be swapped out, e.g. not while airborne; the swap
   * waits for it and it is rechecked as queued events land
   */
  swapOutReadyAt?: (ctx: SimContext, state: any) => number
  /** Notify all kits when a party member changes, including forced swaps. */
  onPartySwap?: (
    ctx: SimContext,
    state: any,
    from: CharacterKey,
    to: CharacterKey
  ) => void
  /** An automatic entry action, before the requested action (Danica's entry / Triumph). */
  onSwapIn?: (ctx: SimContext, state: any) => ActionResult | undefined
  /** Earliest frame this member can be swapped in; rechecked as queued events run. */
  swapReadyAt?: (state: any, now: number) => number
  /**
   * Called when any member acts, itself included (at the action's start, after its `act`, with
   * how long it lasts before the next action): for mechanics that watch the active character
   * (Xingqiu's Raincutter on normal attacks: see `watchAction` in kits/common.ts)
   */
  onPartyAction?: (
    ctx: SimContext,
    state: any,
    actor: CharacterKey,
    action: RotationAction,
    frames: number,
    normalStarts?: readonly NormalStateStart[],
    /**
     * How long the action's state lasts: when a wait follows, to the end of its animation
     * (gcsim keeps e.g. NormalAttackState through `wait()`), otherwise `frames`
     */
    stateFrames?: number
  ) => void
  /** Hits it adds to the counted buffs (Illuga's Songs): run after the timeline */
  countedBuffs?: (
    hits: readonly SimHit[],
    constellation: number
  ) => { buffs: SimCountedBuff[]; extraHits: SimHit[] }
}
