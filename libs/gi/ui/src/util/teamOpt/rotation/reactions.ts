import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle, getCharStat } from '@genshin-optimizer/gi/stats'
import { icdGroups } from './icdGroups'
import type { RotationReactions } from './simulate'
import type { SimContext, SimHit } from './types'

/*
 * Elemental reactions on one enemy, ported from gcsim's reactable (pkg/reactable,
 * internal/template/dendrocore, internal/characters/nilou/bountifulcore.go,
 * pkg/core/player/verdantdew.go; AGPLv3, main as of 2026-11-10; this project is AGPLv3 too).
 *
 * - Auras: durability per element and per contributing member, decaying every frame (gcsim's Tick:
 *   normal decay, Dendro/Quicken faster while burning, Frozen's accelerating decay).
 * - A hit reacts only when it applies its element (elemental, durability > 0, through its ICD), in
 *   gcsim's order per element; what is left of it attaches as an aura if it did not react.
 * - Amplifying (Vaporize, Melt) and additive (Aggravate, Spread) reactions flag the hit itself.
 * - Transformative reactions are hits of their own on the trigger's `reaction` node: Overloaded,
 *   Superconduct, Electro-Charged ticks, Swirl, Shattered, Burning ticks, Bloom (dendro cores: 5 at
 *   most, 5 s), Hyperbloom and Burgeon (an Electro / Pyro hit on the cores), Nilou's Bountiful Cores.
 * - Lunar reactions (when a member enables them): Lunar-Charged (instead of Electro-Charged, a hit
 *   every 2 s while both auras last), Lunar-Bloom (Verdant Dew instead of… alongside the cores, as
 *   gcsim), Lunar-Crystallize (Moondrifts and Moondrift Harmony). Their hits carry `contributors`:
 *   each one's node counts 0.6 / 0.3 / 0.05 / 0.05 of a hit by rank (see `rotationAttacks`).
 * - Stellar reactions (Sandrone, Odette or the Cryo Traveler in the party): Stellar-Conduct (instead
 *   of Superconduct, the Polestar Field and its stacks) and Stellar Swirl (Anemo on Cryo: a hit,
 *   stacks and the vortex's detonation).
 * One enemy, no positions: every Electro or Pyro hit that applies reaches the dendro cores, and the
 * party stands in the Polestar Field. Not modelled: crystallize shards (shields), poise.
 */

type Mod =
  | 'electro'
  | 'pyro'
  | 'cryo'
  | 'hydro'
  | 'burningFuel'
  | 'dendro'
  | 'quicken'
  | 'frozen'
  | 'burning'
const MODS: Mod[] = [
  'electro',
  'pyro',
  'cryo',
  'hydro',
  'burningFuel',
  'dendro',
  'quicken',
  'frozen',
  'burning',
]
/** The element a mod counts as (gcsim's modifierElement) */
const MOD_ELEMENT: Record<Mod, string> = {
  electro: 'electro',
  pyro: 'pyro',
  cryo: 'cryo',
  hydro: 'hydro',
  burningFuel: 'dendro',
  dendro: 'dendro',
  quicken: 'quicken',
  frozen: 'frozen',
  burning: 'pyro',
}
const ZERO = 1e-11
const FRZ_DELTA = 2.5 / 3600
const FRZ_DECAY_CAP = 10 / 60

/** Members that turn a reaction into its Lunar or Stellar version (gcsim's enable flags) */
export const reactionEnablers = {
  lunarCharged: ['Ineffa', 'Columbina', 'Flins'] as CharacterKey[],
  lunarBloom: ['Columbina', 'Lauma'] as CharacterKey[],
  lunarCrystallize: ['Columbina', 'Zibai', 'Linnea'] as CharacterKey[],
  stellarConduct: [
    'Sandrone',
    'Odette',
    'TravelerCryo',
    'Danica',
    'Anastasya',
    'Mitya',
  ] as CharacterKey[],
  stellarSwirl: [
    'Sandrone',
    'Odette',
    'TravelerCryo',
    'Anastasya',
    'Vesna',
  ] as CharacterKey[],
}

/** Polestar stacks a member adds to each Polestar Field record (one entry per line: the
 * released-only build drops unreleased characters' lines) */
const polestarBonus: Partial<Record<CharacterKey, number>> = {
  Anastasya: 2,
}

/**
 * Marker hits (no damage) the kits can react to in `onHit`: path ['_reaction', <reaction>], the
 * trigger as `characterKey`, at the reaction's frame. Reactions: vaporize, melt, aggravate, spread,
 * overloaded, superconduct, electroCharged, lunarCharged, frozen, shattered, quicken, burning,
 * bloom, lunarBloom, crystallize, lunarCrystallize, moondriftHarmony, moondrift, stellarConduct,
 * stellarSwirl, and <element>Swirl (pyroSwirl, hydroSwirl, electroSwirl, cryoSwirl).
 */
export const reactionMark = (reaction: string) => ['_reaction', reaction]
export const REACTION_MARK = reactionMark('lunarCrystallize')
export const HARMONY_MARK = reactionMark('moondriftHarmony')
export const MOONDRIFT_MARK = reactionMark('moondrift')

const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, '')
const groupByName = new Map(
  Object.keys(icdGroups).map((g) => [norm(g), g] as const)
)
const ALIASES: Record<string, string> = {
  poleextra: 'PoleExtraAttack',
  poleextraattack: 'PoleExtraAttack',
}
/** The gcsim ICD group of a hit: its `icdGroup`, or its `icd` name when that names a group */
export function icdGroupOf(hit: SimHit): string {
  if (hit.icdGroup && icdGroups[hit.icdGroup]) return hit.icdGroup
  const n = norm(hit.icd ?? '')
  return ALIASES[n] ?? groupByName.get(n) ?? 'Default'
}

/**
 * gcsim's element application ICD (pkg/target/icd.go): one counter per character, ICD tag and
 * group; its timer starts at the first hit and resets the counter after the group's time; past
 * the group's pattern, its last value.
 */
export function icdTracker() {
  const icds = new Map<string, { start: number; count: number }>()
  return (hit: SimHit, characterKey: string = hit.characterKey) => {
    const tag = hit.icd ?? 'none'
    if (tag === 'none') return true
    const group = icdGroupOf(hit)
    const { reset, apply } = icdGroups[group]
    const key = `${characterKey}.${tag}.${group}`
    let icd = icds.get(key)
    // (gcsim resets the counter reset - 1 frames after the timer starts)
    if (!icd || hit.t - icd.start >= reset - 1) {
      icd = { start: hit.t, count: 0 }
      icds.set(key, icd)
    }
    const v = apply[Math.min(icd.count, apply.length - 1)]
    icd.count++
    return v > 0
  }
}

/** An attack landing on the enemy, as gcsim's AttackEvent (the part reactions read) */
interface Attack {
  hit: SimHit
  element: string
  dur: number
  reacted: boolean
}

export interface ReactionOptions {
  members: CharacterKey[]
  /** Whether Columbina's Lunar Domain is up at a frame (a 33% extra Lunar hit, counted 1.33) */
  domainActive?: (t: number) => boolean
  /** Whether a member has Nilou's Golden Chalice's Bounty (Bountiful Cores) at a frame */
  bountiful?: (characterKey: CharacterKey, t: number) => boolean
  /**
   * Debugging: every hit that applies its element (after its ICD), with the auras before and after
   * (gcsim's "application" log entries)
   */
  trace?: (entry: AuraTrace) => void
}

export interface AuraTrace {
  t: number
  characterKey: CharacterKey
  label: string
  element: string
  durability: number
  reacted: boolean
  existing: Record<string, number>
  after: Record<string, number>
}

export function elementalReactions({
  members,
  domainActive = () => false,
  bountiful = () => false,
  trace,
}: ReactionOptions): RotationReactions & {
  moondriftsAt: (t: number) => number
  verdantDewAt: (t: number) => number
} {
  const has = (list: CharacterKey[]) => members.some((m) => list.includes(m))
  const lunarCharged = has(reactionEnablers.lunarCharged)
  const lunarBloom = has(reactionEnablers.lunarBloom)
  const lunarCrystallize = has(reactionEnablers.lunarCrystallize)
  const stellarConductEnabled = has(reactionEnablers.stellarConduct)
  const stellarSwirlEnabled = has(reactionEnablers.stellarSwirl)
  const passesIcd = icdTracker()
  const weight = (t: number) => (domainActive(t) ? 1.33 : 1)

  // ---- auras (gcsim's Reactable) ----
  const dur = Object.fromEntries(
    MODS.map((m) => [m, new Map<CharacterKey, number>()])
  ) as Record<Mod, Map<CharacterKey, number>>
  const decay = Object.fromEntries(MODS.map((m) => [m, 0])) as Record<
    Mod,
    number
  >
  decay.frozen = FRZ_DECAY_CAP
  let frame = 0
  const aura = (m: Mod) => Math.max(0, ...dur[m].values())
  const auraSnapshot = () =>
    Object.fromEntries(
      MODS.filter((m) => aura(m) > ZERO).map((m) => [m, aura(m)])
    )
  const set = (m: Mod, d: number, src: CharacterKey) => dur[m].set(src, d)
  const add = (m: Mod, d: number, src: CharacterKey) =>
    dur[m].set(src, (dur[m].get(src) ?? 0) + d)
  const reduceMod = (m: Mod, amt: number) => {
    for (const [k, v] of dur[m]) dur[m].set(k, v - Math.min(amt, v))
  }
  const removeMod = (m: Mod) => {
    dur[m].clear()
    decay[m] = 0
  }
  /** Reduce the auras of an element by `d·factor` at most; what it used, in the attack's units */
  const reduce = (element: string, d: number, factor: number) => {
    const max = d * factor
    let reduced = 0
    for (const m of MODS) {
      if (MOD_ELEMENT[m] !== element || aura(m) < ZERO) continue
      const red = Math.min(max, aura(m))
      reduceMod(m, red)
      reduced = Math.max(reduced, red)
    }
    return reduced / factor
  }
  const attachOverlap = (
    m: Mod,
    amt: number,
    length: number,
    src: CharacterKey
  ) => {
    if (aura(m) > ZERO) {
      const a = Math.max(amt - (dur[m].get(src) ?? 0), 0)
      if (a > 0) add(m, a, src)
    } else {
      set(m, amt, src)
      if (length > ZERO) decay[m] = amt / length
    }
  }
  const attachOverlapRefresh = (
    m: Mod,
    amt: number,
    length: number,
    src: CharacterKey
  ) => {
    if (amt < aura(m)) return
    set(m, amt, src)
    if (amt < aura(m)) return
    decay[m] = amt / length
  }
  const attachNormal = (m: Mod, d: number, src: CharacterKey) => {
    const amt = 0.8 * d
    if (m === 'pyro') attachOverlapRefresh(m, amt, 6 * d + 420, src)
    else attachOverlap(m, amt, 6 * d + 420, src)
  }
  const attachBurningFuel = (d: number, mult: number, src: CharacterKey) => {
    removeMod('burningFuel')
    set('burningFuel', mult * d, src)
    decay.burningFuel = Math.max((mult * d) / (6 * d + 420), 10 / 60)
  }

  // ---- per-frame decay (gcsim's Tick) ----
  let burningTickSrc = -1
  let ecTickSrc = -1
  const checkEc = () => {
    if (aura('electro') < ZERO || aura('hydro') < ZERO) ecTickSrc = -1
  }
  const tick = () => {
    for (const m of [
      'electro',
      'pyro',
      'cryo',
      'hydro',
      'burningFuel',
    ] as Mod[])
      if (decay[m] !== 0 && aura(m) > ZERO) {
        reduceMod(m, decay[m])
        if (aura(m) <= ZERO) decay[m] = 0
      }
    if (burningTickSrc > -1 && aura('burningFuel') < ZERO) {
      burningTickSrc = -1
      removeMod('burning')
      removeMod('dendro')
      removeMod('quicken')
    }
    for (const m of ['dendro', 'quicken'] as Mod[]) {
      if (aura(m) < ZERO) continue
      let rate = decay[m]
      if (aura('burningFuel') > ZERO) {
        rate = decay.burningFuel
        if (m === 'dendro') rate = Math.max(rate, decay[m] * 2)
      }
      reduceMod(m, rate)
      if (aura(m) <= ZERO) decay[m] = 0
    }
    if (aura('frozen') > ZERO) {
      decay.frozen += FRZ_DELTA
      reduceMod('frozen', decay.frozen)
    } else if (decay.frozen > FRZ_DECAY_CAP) {
      decay.frozen = Math.max(FRZ_DECAY_CAP, decay.frozen - FRZ_DELTA * 2)
    }
    checkEc()
  }
  /**
   * Enemy hitlag (gcsim's Enemy.ApplyHitlag): the enemy skips its ticks (aura decay) for these
   * frames, and its hitlag-affected statuses (the Lunar-Charged ICD) last that much longer
   */
  let frozenFrames = 0
  const advance = (t: number) => {
    // (catch up at most 2 minutes of frames: the auras are long gone by then)
    if (t - frame > 7200) frame = t - 7200
    for (; frame < t; frame++)
      if (frozenFrames > 0) frozenFrames--
      else tick()
  }
  const enemyHitlag = (t: number, frames: number) => {
    advance(t)
    const before = frozenFrames
    frozenFrames = Math.max(frozenFrames, Math.ceil(frames))
    const ext = frozenFrames - before
    if (ext > 0 && lcIcdUntil > t) lcIcdUntil += ext
  }

  // ---- reaction hits ----
  const transformative = (
    ctx: SimContext,
    delay: number,
    owner: CharacterKey,
    node: string,
    element: SimHit['element'],
    label: string,
    extra: Partial<SimHit> = {}
  ) =>
    ctx.hit(delay, {
      characterKey: owner,
      path: ['reaction', node],
      tag: 'other',
      element,
      label,
      ...extra,
    })
  const mark = (
    ctx: SimContext,
    owner: CharacterKey,
    reaction: string,
    /** The aura element it consumed, where it matters (crystallize) */
    element: SimHit['element'] = 'physical',
    source?: SimHit
  ) =>
    ctx.hit(0, {
      characterKey: owner,
      path: reactionMark(reaction),
      ...(source
        ? { reactionSource: { path: source.path, label: source.label } }
        : {}),
      tag: 'other',
      element,
      label: reaction,
    })
  const gcd: Record<string, number> = {}
  const offGcd = (key: string, t: number, length: number) => {
    if (gcd[key] !== undefined && t < gcd[key]) return false
    gcd[key] = t + length
    return true
  }
  const owners = (m: Mod) =>
    [...dur[m]].filter(([, v]) => v > ZERO).map(([k]) => k)

  // Burning
  let burningOwner: CharacterKey | undefined
  const burningCheck = () => {
    if (aura('burning') < ZERO && aura('burningFuel') > ZERO) {
      burningTickSrc = -1
      removeMod('burningFuel')
    }
  }
  const burningTick = (ctx: SimContext, src: number, counter: number) => {
    if (burningTickSrc !== src) return
    if (aura('burningFuel') < ZERO || aura('burning') < ZERO) return
    if (counter !== 9 && burningOwner)
      transformative(ctx, 0, burningOwner, 'burning', 'pyro', 'Burning', {
        applies: true,
        durability: 25,
        icd: 'BurningDamage',
        icdGroup: 'Burning',
      })
    ctx.atEnemy(15, (c) => burningTick(c, src, counter + 1))
  }

  // Electro-Charged
  let ecAttack:
    | { owner: CharacterKey; t: number; onField: CharacterKey }
    | undefined
  const ecTick = (ctx: SimContext, src: number) => {
    advance(ctx.now)
    if (ecTickSrc !== src) return
    if (aura('electro') < ZERO || aura('hydro') < ZERO) return
    ecHit(ctx)
    ctx.at(60, (c) => ecTick(c, src))
  }
  const ecHit = (ctx: SimContext, attack = ecAttack) => {
    if (!attack) return
    advance(ctx.now)
    // ReactionB damage is once per 30f per owner (the native counter resets after 29f).
    if (!offGcd(`ec.damage.${attack.owner}`, ctx.now, 29)) return
    transformative(
      ctx,
      0,
      attack.owner,
      'electrocharged',
      'electro',
      'Electro-Charged',
      {
        statSnapshots: (['eleMas', 'electrocharged_dmg_'] as const).map(
          (stat) => ({
            stat,
            path: ['total', stat],
            t: attack.t,
            onField: attack.onField,
          })
        ),
      }
    )
    if (aura('electro') < ZERO || aura('hydro') < ZERO) return
    ctx.at(6, () => {
      reduceMod('electro', 10)
      reduceMod('hydro', 10)
      checkEc()
    })
  }

  // Lunar-Charged
  let lcOwner: CharacterKey | undefined
  let lcUntil = -1
  let lcSrc = -1
  let lcIcdUntil = -1
  const lcTick = (ctx: SimContext, src: number) => {
    if (lcSrc !== src || ctx.now >= lcUntil) return
    advance(ctx.now)
    if (
      // (gcsim: a status is still active on its expiry frame)
      ctx.now > lcIcdUntil &&
      aura('electro') > ZERO &&
      aura('hydro') > ZERO &&
      lcOwner
    ) {
      lcIcdUntil = ctx.now + 120
      const contributors = members.filter(
        (m) =>
          (dur.hydro.get(m) ?? 0) > ZERO || (dur.electro.get(m) ?? 0) > ZERO
      )
      transformative(
        ctx,
        0,
        lcOwner,
        'lunarcharged',
        'electro',
        'Lunar-Charged',
        {
          contributors,
          weight: weight(ctx.now),
        }
      )
      ctx.at(0, () => {
        reduceMod('electro', 10)
        reduceMod('hydro', 10)
      })
    }
    ctx.at(6, (c) => lcTick(c, src))
  }

  // Dendro cores (Bloom, Hyperbloom, Burgeon) and Bountiful Cores
  interface Core {
    owner: CharacterKey
    born: number
    alive: boolean
  }
  let cores: Core[] = []
  const explodeCore = (ctx: SimContext, core: Core, delay: number) => {
    if (!core.alive) return
    core.alive = false
    transformative(ctx, delay, core.owner, 'bloom', 'dendro', 'Bloom')
  }
  const addCore = (ctx: SimContext, owner: CharacterKey) => {
    ctx.at(30, (c) => {
      if (bountiful(owner, c.now)) {
        // Nilou: a Bountiful Core bursts 0.4 s later and cannot Hyperbloom or Burgeon
        transformative(
          c,
          25,
          owner,
          'bloom',
          'dendro',
          'Bloom (Bountiful Core)'
        )
        return
      }
      cores = cores.filter((x) => x.alive)
      if (cores.length >= 5) explodeCore(c, cores[0], 1)
      const core: Core = { owner, born: c.now, alive: true }
      cores.push(core)
      c.at(300, (c2) => explodeCore(c2, core, 1))
    })
  }
  const hitCores = (ctx: SimContext, a: Attack) => {
    // (the cores are their own targets: no enemy ICD, the attack's own durability)
    if (a.element !== 'electro' && a.element !== 'pyro') return
    for (const core of cores) {
      if (!core.alive) continue
      core.alive = false
      if (a.element === 'electro')
        transformative(
          ctx,
          60,
          a.hit.characterKey,
          'hyperbloom',
          'dendro',
          'Hyperbloom'
        )
      else
        transformative(
          ctx,
          1,
          a.hit.characterKey,
          'burgeon',
          'dendro',
          'Burgeon'
        )
    }
    cores = cores.filter((x) => x.alive)
  }

  // Lunar-Bloom's Verdant Dew (gcsim: a dew per 146 frames during the 149 after a Lunar-Bloom)
  let dewUntil = -1
  let dewPartial = 0
  let dew = 0
  let moonridgeDew = 0
  let dewFrame = 0
  /** Faster Verdant Dew gain (Nefer's C4: 25% faster), as [from, until, rate] windows */
  const dewBoosts: [number, number, number][] = []
  const dewRate = (f: number) =>
    dewBoosts.reduce(
      (r, [from, until, rate]) => (f >= from && f < until ? r * rate : r),
      1
    )
  const dewAt = (t: number) => {
    for (; dewFrame < t; dewFrame++)
      if (dew < 3 && dewFrame <= dewUntil) {
        dewPartial += dewRate(dewFrame)
        if (dewPartial >= 146) {
          dew++
          dewPartial = 0
        }
      }
    return dew
  }

  // Lunar-Crystallize (Moondrifts, Moondrift Harmony)
  let lcrCount = 0
  let harmonyReady = -1
  let moondrifts: number[] = []
  const lcrContributors = new Set<CharacterKey>()
  const alive = (t: number) => moondrifts.filter((end) => end > t).length
  const harmony = (ctx: SimContext, owner: CharacterKey) => {
    mark(ctx, owner, 'moondriftHarmony')
    const contributors = [...lcrContributors]
    lcrContributors.clear()
    for (const d of [13, 25, 37])
      transformative(
        ctx,
        d,
        owner,
        'lunarcrystallize',
        'geo',
        'Lunar-Crystallize (Moondrift Harmony)',
        { contributors, weight: weight(ctx.now) }
      )
    moondrifts = moondrifts.map((end) => (end > ctx.now ? ctx.now + 540 : end))
  }
  const tryLunarCrystallize = (ctx: SimContext, a: Attack) => {
    if (aura('hydro') <= ZERO || a.dur < ZERO) return false
    lcrCount = Math.min(6, lcrCount + 1)
    lcrContributors.add(a.hit.characterKey)
    for (const m of owners('hydro')) lcrContributors.add(m)
    mark(ctx, a.hit.characterKey, 'lunarCrystallize')
    const near = alive(a.hit.t)
    if (near < 3) {
      for (let i = near; i < 3; i++) moondrifts.push(a.hit.t + 540)
      ctx.hit(0, {
        characterKey: a.hit.characterKey,
        path: MOONDRIFT_MARK,
        tag: 'other',
        element: 'geo',
        weight: 3 - near,
        label: 'Moondrifts',
      })
    } else if (lcrCount >= 3 && a.hit.t >= harmonyReady) {
      lcrCount -= 3
      harmonyReady = a.hit.t + 37
      harmony(ctx, a.hit.characterKey)
    }
    a.dur = Math.max(0, a.dur - reduce('hydro', a.dur, 0.5))
    a.reacted = true
    return true
  }

  // Stellar-Conduct (the Polestar Field)
  let fieldEnd = -1
  let fieldThink = -1
  let polestarRecord = 0
  const stackIcd = new Map<CharacterKey, number>()
  const polestarThink = (ctx: SimContext, id: number) => {
    if (id !== fieldThink || ctx.now >= fieldEnd) return
    const stacks = Math.min(
      12,
      polestarRecord + members.reduce((n, m) => n + (polestarBonus[m] ?? 0), 0)
    )
    polestarRecord = 0
    ctx.buff('team', ['reaction', 'polestarStacks'], `${stacks}`, 0, 241, {
      hitlag: 'recipient',
    })
    ctx.buff('team', ['reaction', 'oppInsidePole'], 'on', 0, 241, {
      hitlag: 'enemy',
    })
    ctx.at(240, (c) => polestarThink(c, id))
  }
  const stellarConduct = (ctx: SimContext, owner: CharacterKey) => {
    mark(ctx, owner, 'stellarConduct')
    if (ctx.now < fieldEnd) {
      fieldEnd = ctx.now + 360
      return
    }
    fieldEnd = ctx.now + 360
    fieldThink = ctx.now
    polestarThink(ctx, fieldThink)
  }

  // Stellar Swirl (and its vortex)
  let sswStacks = 0
  let sswEnd = -1
  let sswOwner: CharacterKey | undefined
  let vortexId = 0
  let vortexAlive = false
  const sswContributors = new Set<CharacterKey>()
  const detonate = (ctx: SimContext, id: number) => {
    if (id !== vortexId || !vortexAlive || !sswOwner) return
    vortexAlive = false
    const stacks = Math.min(sswStacks, 6)
    const contributors = [...sswContributors]
    sswContributors.clear()
    sswStacks = 0
    transformative(
      ctx,
      0,
      sswOwner,
      stacks >= 3 ? 'stellarswirl_vortex2' : 'stellarswirl_vortex1',
      'cryo',
      `Stellar Swirl Detonation (${stacks} stacks)`,
      { contributors, applies: true, durability: 25, icd: 'none' }
    )
  }
  const stellarSwirl = (ctx: SimContext, a: Attack) => {
    // The pinned Vodyanitsa passive sets this party flag at initialization.
    sswEnd = ctx.now + 480 + (members.includes('Vodyanitsa') ? 240 : 0)
    const owner = a.hit.characterKey
    const contributors = [
      ...new Set([
        owner,
        ...owners('cryo'),
        ...owners('frozen').filter((k) => getCharEle(k) === 'cryo'),
      ]),
    ]
    transformative(ctx, 3, owner, 'stellarswirl', 'anemo', 'Stellar Swirl', {
      contributors,
    })
    for (const k of contributors) sswContributors.add(k)
    sswOwner = owner
    sswStacks = Math.min(6, sswStacks + 1)
    if (!vortexAlive) {
      vortexAlive = true
      const id = ++vortexId
      ctx.at(181, (c) => detonate(c, id))
    }
    if (sswStacks >= 6) detonate(ctx, vortexId)
  }

  // ---- gcsim's React, per element ----
  const tryVaporize = (a: Attack) => {
    if (a.dur < ZERO) return
    let consumed: number
    if (a.element === 'pyro') {
      if (aura('hydro') < ZERO || aura('frozen') > ZERO) return
      consumed = reduce('hydro', a.dur, 0.5)
    } else if (a.element === 'hydro') {
      if (aura('pyro') < ZERO && aura('burning') < ZERO) return
      consumed = reduce('pyro', a.dur, 2)
      burningCheck()
    } else return
    a.dur = Math.max(0, a.dur - consumed)
    a.reacted = true
    a.hit.reaction = 'vaporize'
  }
  const tryMelt = (a: Attack) => {
    if (a.dur < ZERO) return
    let consumed = 0
    if (a.element === 'pyro') {
      if (aura('cryo') < ZERO && aura('frozen') < ZERO) return
      consumed = Math.max(reduce('cryo', a.dur, 2), reduce('frozen', a.dur, 2))
    } else if (a.element === 'cryo') {
      if (aura('pyro') < ZERO && aura('burning') < ZERO) return
      reduce('pyro', a.dur, 0.5)
      burningCheck()
    } else return
    a.dur = Math.max(0, a.dur - consumed)
    a.reacted = true
    a.hit.reaction = 'melt'
  }
  const tryOverload = (ctx: SimContext, a: Attack) => {
    if (a.dur < ZERO) return
    let consumed: number
    if (a.element === 'electro') {
      if (aura('pyro') < ZERO && aura('burning') < ZERO) return
      consumed = reduce('pyro', a.dur, 1)
      burningCheck()
    } else if (a.element === 'pyro') {
      if (aura('electro') < ZERO) return
      consumed = reduce('electro', a.dur, 1)
    } else return
    a.dur = Math.max(0, a.dur - consumed)
    a.reacted = true
    mark(ctx, a.hit.characterKey, 'overloaded')
    if (offGcd('overload', a.hit.t, 6))
      transformative(
        ctx,
        1,
        a.hit.characterKey,
        'overloaded',
        'pyro',
        'Overloaded'
      )
  }
  const superconductHit = (ctx: SimContext, owner: CharacterKey) => {
    if (stellarConductEnabled) return stellarConduct(ctx, owner)
    mark(ctx, owner, 'superconduct')
    ctx.buff('team', ['reaction', 'superconduct'], 'on', 0, 720)
    if (offGcd('superconduct', ctx.now, 6))
      transformative(ctx, 1, owner, 'superconduct', 'cryo', 'Superconduct')
  }
  const trySuperconduct = (ctx: SimContext, a: Attack) => {
    if (a.dur < ZERO || aura('frozen') >= ZERO) return
    let consumed: number
    if (a.element === 'electro') {
      if (aura('cryo') < ZERO) return
      consumed = reduce('cryo', a.dur, 1)
    } else if (a.element === 'cryo') {
      if (aura('electro') < ZERO) return
      consumed = reduce('electro', a.dur, 1)
    } else return
    a.dur = Math.max(0, a.dur - consumed)
    a.reacted = true
    superconductHit(ctx, a.hit.characterKey)
  }
  const tryFrozenSuperconduct = (ctx: SimContext, a: Attack) => {
    if (a.dur < ZERO || aura('frozen') < ZERO || a.element !== 'electro') return
    a.dur -= reduce('cryo', a.dur, 1)
    reduce('frozen', a.dur, 1)
    a.dur = 0
    a.reacted = true
    superconductHit(ctx, a.hit.characterKey)
  }
  const tryElectroCharged = (ctx: SimContext, a: Attack) => {
    if (a.dur < ZERO || aura('frozen') > ZERO) return
    if (a.element === 'hydro') {
      if (aura('electro') < ZERO) return
      if (!a.reacted) attachNormal('hydro', a.dur, a.hit.characterKey)
    } else if (a.element === 'electro') {
      if (aura('hydro') < ZERO) return
      if (!a.reacted) attachNormal('electro', a.dur, a.hit.characterKey)
    } else return
    a.reacted = true
    if (lunarCharged) {
      mark(ctx, a.hit.characterKey, 'lunarCharged')
      lcOwner = a.hit.characterKey
      if (ctx.now >= lcUntil) {
        lcSrc = ctx.now
        const src = lcSrc
        ctx.at(9, (c) => lcTick(c, src))
      }
      lcUntil = ctx.now + 330
      return
    }
    mark(ctx, a.hit.characterKey, 'electroCharged')
    ecAttack = { owner: a.hit.characterKey, t: ctx.now, onField: ctx.onField }
    if (ecTickSrc === -1) {
      ecTickSrc = ctx.now
      const src = ecTickSrc
      const first = ecAttack
      ctx.at(10, (c) => ecHit(c, first))
      ctx.at(70, (c) => ecTick(c, src))
    }
  }
  const tryFreeze = (ctx: SimContext, a: Attack) => {
    if (a.dur < ZERO) return
    let consumed: number
    if (a.element === 'hydro') {
      const srcs = owners('cryo')
      if (!srcs.length) return
      consumed = Math.min(aura('cryo'), a.dur)
      // Freeze records its trigger. Only Cryo triggers can later contribute via Frozen.
      attachOverlap('frozen', 2 * consumed, 0, a.hit.characterKey)
      reduceMod('cryo', consumed)
    } else if (a.element === 'cryo') {
      if (aura('hydro') < ZERO) return
      consumed = Math.min(aura('hydro'), a.dur)
      attachOverlap('frozen', 2 * consumed, 0, a.hit.characterKey)
      reduceMod('hydro', consumed)
    } else return
    a.reacted = true
    a.dur = Math.max(0, a.dur - consumed)
    mark(ctx, a.hit.characterKey, 'frozen')
  }
  const tryQuicken = (ctx: SimContext, a: Attack) => {
    if (a.dur < ZERO) return
    let consumed = 0
    if (a.element === 'dendro') {
      if (aura('electro') < ZERO) return
      consumed = reduce('electro', a.dur, 1)
    } else if (a.element === 'electro') {
      if (aura('dendro') < ZERO) return
      consumed = reduce('dendro', a.dur, 1)
    } else return
    a.dur = Math.max(0, a.dur - consumed)
    a.reacted = true
    mark(ctx, a.hit.characterKey, 'quicken')
    attachOverlapRefresh(
      'quicken',
      consumed,
      12 * consumed + 360,
      a.hit.characterKey
    )
    // gcsim: Quicken with Hydro on the enemy blooms from the Quicken aura, in a task after this
    // hit (so the hit's own Bloom with the Hydro comes first; tryQuickenBloom)
    if (aura('hydro') >= ZERO) pendingQuickenBloom = a.hit.characterKey
  }
  /** gcsim's tryQuickenBloom, run after the hit that made the Quicken */
  let pendingQuickenBloom: CharacterKey | undefined
  const tryQuickenBloom = (ctx: SimContext) => {
    const owner = pendingQuickenBloom
    pendingQuickenBloom = undefined
    if (!owner || aura('quicken') < ZERO || aura('hydro') < ZERO) return
    const consumed = reduce('hydro', aura('quicken'), 2)
    reduceMod('quicken', consumed)
    bloom(ctx, owner)
  }
  const tryAggravate = (a: Attack) => {
    if (a.dur < ZERO || aura('quicken') < ZERO) return
    a.hit.reaction = 'aggravate'
  }
  const trySpread = (a: Attack) => {
    if (a.dur < ZERO || aura('quicken') < ZERO) return
    a.hit.reaction = 'spread'
  }
  const tryBurning = (ctx: SimContext, a: Attack) => {
    if (a.dur < ZERO) return
    let dendroDur = aura('dendro')
    if (a.element === 'pyro') {
      if (aura('dendro') < ZERO && aura('quicken') < ZERO) return
    } else if (a.element === 'dendro') {
      if (aura('pyro') < ZERO && aura('burning') < ZERO) return
      dendroDur = Math.max(dendroDur, a.dur * 0.8)
    } else return
    burningOwner = a.hit.characterKey
    if (aura('burningFuel') < ZERO) {
      attachBurningFuel(
        Math.max(dendroDur, aura('quicken')),
        1,
        a.hit.characterKey
      )
      removeMod('burning')
      set('burning', 50, a.hit.characterKey)
      mark(ctx, a.hit.characterKey, 'burning')
      a.reacted = true
      if (burningTickSrc === -1) {
        burningTickSrc = ctx.now
        const src = burningTickSrc
        ctx.atEnemy(15, (c) => burningTick(c, src, 1))
      }
      return
    }
    if (a.element === 'dendro')
      attachBurningFuel(a.dur, 0.8, a.hit.characterKey)
  }
  const bloom = (ctx: SimContext, owner: CharacterKey) => {
    if (lunarBloom) {
      mark(ctx, owner, 'lunarBloom')
      dewAt(ctx.now)
      const end = ctx.now + 149
      ctx.at(1, () => {
        dewAt(ctx.now + 1)
        dewUntil = end
      })
    } else mark(ctx, owner, 'bloom')
    addCore(ctx, owner)
  }
  const tryBloom = (ctx: SimContext, a: Attack) => {
    if (a.dur < ZERO) return
    let consumed: number
    if (a.element === 'hydro') {
      if (
        aura('dendro') <= ZERO &&
        aura('quicken') <= ZERO &&
        aura('burningFuel') <= ZERO
      )
        return
      consumed = Math.max(
        reduce('dendro', a.dur, 0.5),
        reduce('quicken', a.dur, 0.5)
      )
    } else if (a.element === 'dendro') {
      if (aura('hydro') < ZERO) return
      consumed = reduce('hydro', a.dur, 2)
    } else return
    a.dur = Math.max(0, a.dur - consumed)
    a.reacted = true
    bloom(ctx, a.hit.characterKey)
  }
  const trySwirl = (ctx: SimContext, a: Attack, m: Mod) => {
    if (a.dur < ZERO || aura(m) < ZERO) return
    if (stellarSwirlEnabled && (m === 'cryo' || m === 'frozen')) {
      a.reacted = true
      mark(ctx, a.hit.characterKey, 'stellarSwirl', 'cryo', a.hit)
      stellarSwirl(ctx, a)
      a.dur -= reduce(MOD_ELEMENT[m], a.dur, 0.5)
      return
    }
    const element = m === 'frozen' ? 'cryo' : MOD_ELEMENT[m]
    const rd = reduce(MOD_ELEMENT[m], a.dur, 0.5)
    a.dur -= rd
    a.reacted = true
    if (m === 'pyro') burningCheck()
    mark(
      ctx,
      a.hit.characterKey,
      `${element}Swirl`,
      element as SimHit['element'],
      a.hit
    )
    if (offGcd(`swirl${element}`, a.hit.t, 6))
      transformative(
        ctx,
        1,
        a.hit.characterKey,
        `${element}Swirl`,
        element as SimHit['element'],
        `Swirl (${element[0].toUpperCase()}${element.slice(1)})`
      )
    if (m === 'electro' && a.dur > ZERO && aura('hydro') > ZERO) {
      trySwirl(ctx, a, 'hydro')
      // Native cleans up immediately after double Swirl. The target can still be in hitlag;
      // waiting for its next decay tick lets a later Electro refill revive the old EC chain.
      checkEc()
    }
  }
  const tryCrystallize = (ctx: SimContext, a: Attack, m: Mod) => {
    if (m === 'hydro' && lunarCrystallize) return tryLunarCrystallize(ctx, a)
    if (aura(m) <= ZERO || a.dur < ZERO) return false
    if (!offGcd('crystallize', a.hit.t, 60)) return false
    a.dur = Math.max(0, a.dur - reduce(MOD_ELEMENT[m], a.dur, 0.5))
    a.reacted = true
    if (m === 'pyro') burningCheck()
    mark(
      ctx,
      a.hit.characterKey,
      'crystallize',
      (m === 'frozen' ? 'cryo' : MOD_ELEMENT[m]) as SimHit['element']
    )
    if (m === 'electro' && aura('hydro') > ZERO) checkEc()
    return true
  }

  /** gcsim's Shatter: a Frozen enemy hit by a blunt attack or Geo */
  let shatterGcd = -1
  const blunt = (hit: SimHit) =>
    hit.blunt ||
    hit.element === 'geo' ||
    (hit.tag === 'plunge' && hit.durability !== 0) ||
    ((hit.tag === 'normal' || hit.tag === 'charged') &&
      getCharStat(hit.characterKey).weaponType === 'claymore')
  const shatterCheck = (ctx: SimContext, hit: SimHit) => {
    if (aura('frozen') < ZERO || !blunt(hit)) return
    // Native PoiseDMGCheck runs before ShatterCheck and may already remove Frozen.
    reduceMod(
      'frozen',
      0.15 * (hit.poiseDamage ?? (hit.tag === 'plunge' ? 150 : 0))
    )
    if (aura('frozen') < ZERO) return
    reduceMod('frozen', 200)
    mark(ctx, hit.characterKey, 'shattered')
    if (hit.t >= shatterGcd) {
      shatterGcd = hit.t + 12
      transformative(
        ctx,
        0,
        hit.characterKey,
        'shattered',
        'physical',
        'Shattered'
      )
    }
  }

  const react = (ctx: SimContext, a: Attack) => {
    switch (a.element) {
      case 'electro':
        tryAggravate(a)
        tryOverload(ctx, a)
        tryElectroCharged(ctx, a)
        tryFrozenSuperconduct(ctx, a)
        trySuperconduct(ctx, a)
        tryQuicken(ctx, a)
        break
      case 'pyro':
        tryOverload(ctx, a)
        tryVaporize(a)
        tryMelt(a)
        tryBurning(ctx, a)
        break
      case 'cryo':
        trySuperconduct(ctx, a)
        tryMelt(a)
        tryFreeze(ctx, a)
        break
      case 'hydro':
        tryVaporize(a)
        tryFreeze(ctx, a)
        tryBloom(ctx, a)
        tryElectroCharged(ctx, a)
        break
      case 'anemo':
        trySwirl(ctx, a, 'electro')
        trySwirl(ctx, a, 'pyro')
        trySwirl(ctx, a, 'hydro')
        trySwirl(ctx, a, 'cryo')
        trySwirl(ctx, a, 'frozen')
        break
      case 'geo':
        tryCrystallize(ctx, a, 'electro')
        tryCrystallize(ctx, a, 'hydro')
        tryCrystallize(ctx, a, 'cryo')
        tryCrystallize(ctx, a, 'pyro')
        tryCrystallize(ctx, a, 'frozen')
        break
      case 'dendro':
        trySpread(a)
        tryQuicken(ctx, a)
        tryBurning(ctx, a)
        tryBloom(ctx, a)
        break
    }
  }
  const attachOrRefill = (a: Attack) => {
    if (a.dur < ZERO || a.reacted) return
    const m = (
      {
        pyro: 'pyro',
        electro: 'electro',
        hydro: 'hydro',
        cryo: 'cryo',
        dendro: 'dendro',
      } as Record<string, Mod>
    )[a.element]
    if (m) attachNormal(m, a.dur, a.hit.characterKey)
  }

  return {
    absorbAt(t, priority = ['pyro', 'hydro', 'electro', 'cryo']) {
      advance(t)
      return priority.find(
        (element) =>
          (['pyro', 'hydro', 'electro', 'cryo'].includes(element) &&
            aura(element as Mod) > ZERO) ||
          (element === 'cryo' && aura('frozen') > ZERO)
      )
    },
    radianceAt: (t) =>
      t < fieldEnd ? 'conduct' : t < sswEnd ? 'swirl' : undefined,
    stellarSwirlAt: (t) => t < sswEnd,
    moondriftsAt: alive,
    burningAt(t) {
      advance(t)
      return aura('burning') > ZERO
    },
    frozenAt(t) {
      advance(t)
      return aura('frozen') > ZERO
    },
    verdantDewAt: dewAt,
    dewAt: (t: number) => dewAt(t) + moonridgeDew,
    addMoonridgeDew: () => {
      moonridgeDew = Math.min(3, moonridgeDew + 1)
    },
    boostDew: (from: number, until: number, rate: number) => {
      dewBoosts.push([from, until, rate])
    },
    // gcsim's ruptureDendroCores: a core's duration drops to 1, so it blooms on the next frame
    ruptureCores: (ctx: SimContext) => {
      for (const core of cores) explodeCore(ctx, core, 1)
      cores = cores.filter((x) => x.alive)
    },
    consumeDewAt(t: number, amount: number) {
      dewAt(t)
      const requested = Math.max(0, Math.trunc(amount))
      const verdant = Math.min(dew, requested)
      const moon = Math.min(moonridgeDew, requested - verdant)
      dew -= verdant
      moonridgeDew -= moon
      return verdant + moon
    },
    onHit(ctx, hit) {
      // (reaction markers are not attacks; kit markers that apply an element are, e.g. Xingqiu's
      // orbital)
      if (hit.path[0] === '_reaction') return
      // a hit's hitlag also freezes the enemy (the kits mark it with ['_marker', 'hitlag'])
      if (hit.path[0] === '_marker' && hit.path[1] === 'hitlag') {
        enemyHitlag(hit.t, hit.enemyAnimationPause ?? hit.animationPause ?? 0)
        return
      }
      advance(hit.t)
      // These are enemy-aura conditions at damage time, not assumptions from team elements. gcsim
      // evaluates attack modifiers (Cryo resonance's CRIT Rate, Blizzard Strayer) before the hit
      // reacts (enemy.attack runs after ApplyAttackMods), so the hit itself sees the aura it lands
      // on: a hit that Swirls or melts the Cryo away still counts it, one that freezes the enemy
      // does not count it Frozen yet. Later hits see the aura after the reaction.
      const auraValues = () => {
        const frozen = aura('frozen') > ZERO
        const cryo = aura('cryo') > ZERO || frozen
        const strayer =
          (ctx.sets(hit.characterKey)['BlizzardStrayer'] ?? 0) >= 4
        return {
          cryo: cryo ? 'on' : '',
          strayer: frozen ? 'frozen' : cryo ? 'cryo' : '',
          hasStrayer: strayer,
        }
      }
      // the team's state from now on (after this hit's reaction)
      const auraStates = () => {
        const v = auraValues()
        ctx.state('team', ['resonance', 'ShatteringIce'], v.cryo)
        if (v.hasStrayer)
          ctx.state(hit.characterKey, ['BlizzardStrayer', 'state'], v.strayer)
      }
      // this hit's own attack modifiers: the aura before its reaction
      {
        const v = auraValues()
        const states: NonNullable<SimHit['states']> = [
          {
            owner: 'team',
            path: ['resonance', 'ShatteringIce'],
            value: v.cryo,
          },
        ]
        if (v.hasStrayer)
          states.push({
            owner: hit.characterKey,
            path: ['BlizzardStrayer', 'state'],
            value: v.strayer,
          })
        // These attack modifiers belong to this damage event, not the last aura state later
        // in the frame (ordinary attachments are deferred until damage callbacks).
        hit.states = [
          ...(hit.states ?? []).filter(
            (s) =>
              !states.some(
                (a) =>
                  a.owner === s.owner && a.path.join('.') === s.path.join('.')
              )
          ),
          ...states,
        ]
      }
      // Linnea C2: Lumi's Hammer triggers a Harmony
      if (lunarCrystallize && hit.triggersHarmony && alive(hit.t) >= 1)
        harmony(ctx, hit.characterKey)
      shatterCheck(ctx, hit)
      if (!hit.applies) return auraStates()
      // Physical hits with durability count in their ICD tag too (gcsim), but don't react
      if (hit.element === 'physical') {
        if ((hit.durability ?? 25) > 0) passesIcd(hit)
        return auraStates()
      }
      const a: Attack = {
        hit,
        element: hit.element,
        dur: hit.durability ?? 25,
        reacted: false,
      }
      if (a.dur <= 0) return auraStates()
      hitCores(ctx, a)
      if (!passesIcd(hit)) return auraStates()
      // the Polestar Field's stacks: Cryo/Electro applications (0.1 s ICD per member)
      if (
        hit.t < fieldEnd &&
        (a.element === 'cryo' || a.element === 'electro') &&
        ctx.characterFrame(hit.characterKey) >=
          (stackIcd.get(hit.characterKey) ?? -1)
      ) {
        stackIcd.set(hit.characterKey, ctx.characterFrame(hit.characterKey) + 6)
        polestarRecord = Math.min(12, polestarRecord + 1)
      }
      const existing = trace ? auraSnapshot() : {}
      react(ctx, a)
      // (amplifying and additive reactions flag the hit itself; kits still see them as marks)
      if (hit.reaction) mark(ctx, hit.characterKey, hit.reaction)
      auraStates()
      const application = (before: Record<string, number>) => {
        attachOrRefill(a)
        // (gcsim logs the application before its delay-0 quicken-bloom task runs)
        const after = trace ? auraSnapshot() : {}
        tryQuickenBloom(ctx)
        trace?.({
          t: hit.t,
          characterKey: hit.characterKey,
          label: hit.label,
          element: hit.element,
          durability: hit.durability ?? 25,
          reacted: a.reacted,
          existing: before,
          after,
        })
      }
      if (a.reacted) application(existing)
      else {
        // Enemy.applyDamage attaches unreacted elements in a delay-0 damage callback.
        // Other hits already queued at this frame must react before this attachment.
        ctx.at(0, () => application(trace ? auraSnapshot() : {}))
      }
    },
  }
}
