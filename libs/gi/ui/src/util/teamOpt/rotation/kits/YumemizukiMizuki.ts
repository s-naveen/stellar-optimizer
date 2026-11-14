import type { RotationAction } from '../parse'
import type {
  ActionResult,
  KitModel,
  SimContext,
  SimHit,
  SimSnapshot,
} from '../types'
import { GCSIM, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/mizuki, main as of 2026-11-10. */

/** Normal attacks: the hit is the hitmark + the arrow's 10f travel; the cancels are from the hitmark */
const TRAVEL = 10
interface MizukiNormal {
  hit: number
  toNormal: number
  toCharged: number
  skill: number
  burst: number
  dash: number
  jump: number
  swap: number
  /** Default (nothing queued) */
  frames: number
}
const mizukiNormals: MizukiNormal[] = [
  {
    hit: 7 + TRAVEL,
    toNormal: 18,
    toCharged: 20,
    skill: 10,
    burst: 9,
    dash: 10,
    jump: 7,
    swap: 13,
    frames: 34,
  },
  {
    hit: 19 + TRAVEL,
    toNormal: 37,
    toCharged: 36,
    skill: 21,
    burst: 20,
    dash: 21,
    jump: 21,
    swap: 21,
    frames: 38,
  },
  {
    hit: 37 + TRAVEL,
    toNormal: 73,
    toCharged: 98,
    skill: 41,
    burst: 40,
    dash: 41,
    jump: 41,
    swap: 41,
    frames: 98,
  },
]

/** Dreamdrifter lasts 5 s; its clouds launch every 44f from 18f (each hits 30f later) */
const DREAM = 300
const CLOUD_FIRST = 18
const CLOUD_INTERVAL = 44
const CLOUD_TRAVEL = 30
/** A1: a Swirl in Dreamdrifter extends it by 2.5 s (0.3 s ICD, twice per Dreamdrifter) */
const A1_EXTEND = 150
const A1_ICD = 18
const A1_MAX = 2
/** A4: others' Pyro/Hydro/Electro/Cryo hits give her EM +100 for 4 s (0.3 s ICD) */
const A4_ICD = 18
const A4_DURATION = 240
/** Revelation: a Swirl she triggers on the field enhances her next cloud (2.5 s ICD) */
const REVELATION_ICD = 150
/** C1: Twenty-Three Nights' Awaiting: 3 s every 3.5 s, from 4f */
const C1_FIRST = 4
const C1_INTERVAL = 210
const C1_DURATION = 180
/** Burst: a Yumemi Style Special Snack every 1.5 s from the hit (93f) for 12 s */
const BURST_HIT = 93
const SNACK_INTERVAL = 90
/** A snack can be picked up 0.3 s after it spawns (the active character stands at the enemy) */
const SNACK_PICKUP = 18
/** Below this HP the snack heals instead of dealing DMG (C4: both) */
const SNACK_HEAL_BELOW = 0.7
/** gcsim's CA windup, skipped when the CA starts from idle */
const CA_WINDUP = 14

const SWIRLS = [
  'pyroSwirl',
  'hydroSwirl',
  'electroSwirl',
  'cryoSwirl',
  'stellarSwirl',
]
/** Swirl DMG hits (Twenty-Three Nights' Awaiting is spent on one that deals DMG) */
const SWIRL_DMG = [
  'pyroSwirl',
  'hydroSwirl',
  'electroSwirl',
  'cryoSwirl',
  'stellarswirl',
]

interface MizukiState {
  /** Dreamdrifter is up until this frame (undefined: not in it); A1 extends it */
  dreamEnd?: number
  /** The running Dreamdrifter (its clouds, C1 ticks and timer): a new one starts a new id */
  src: number
  /** A1: extensions left in this Dreamdrifter, and its ICD */
  a1Left: number
  a1IcdUntil: number
  /** A4: the ICD of its EM buff (hits by others) */
  a4IcdUntil: number
  /** Revelation: the next cloud is enhanced, and its ICD */
  revelation: boolean
  revelationIcdUntil: number
  /** C1: the enemy has Twenty-Three Nights' Awaiting (id of the current application) */
  c1Gen: number
  c1On: boolean
  /** The current action's animation end (gcsim's AnimationLength): a CA before it skips windup */
  animEnd: number
  /** The clouds' stats, snapshotted at the activation (gcsim's cloudSnap) */
  cloudSnapshot?: NonNullable<SimHit['statSnapshots']>
}

const CLOUD_STATS = [
  'atk',
  'critRate_',
  'critDMG_',
  'all_dmg_',
  'anemo_dmg_',
  'skill_dmg_',
] as const

const dreaming = (s: MizukiState, now: number) =>
  s.dreamEnd !== undefined && now < s.dreamEnd

function setDream(c: SimContext, on: boolean) {
  c.state(
    'YumemizukiMizuki',
    ['YumemizukiMizuki', 'skillDream'],
    on ? 'on' : ''
  )
}

/** Dreamdrifter ends (E again, leaving the field, or its timer) */
function endDream(c: SimContext, s: MizukiState) {
  if (s.dreamEnd === undefined) return
  s.dreamEnd = undefined
  s.src = -1
  // Revelation's pending enhancement is lost with the state
  s.revelation = false
  setDream(c, false)
  setC1(c, s, false)
}

/** The Dreamdrifter's timer: rechecks the (extendable) end */
function dreamTimer(c: SimContext, s: MizukiState, src: number) {
  if (s.src !== src || s.dreamEnd === undefined) return
  if (c.now >= s.dreamEnd) endDream(c, s)
  else c.at(s.dreamEnd - c.now, (c2) => dreamTimer(c2, s, src))
}

function setC1(c: SimContext, s: MizukiState, on: boolean) {
  if (s.c1On === on) return
  s.c1On = on
  s.c1Gen++
  c.state(
    'YumemizukiMizuki',
    ['YumemizukiMizuki', 'c1Awaiting'],
    on ? 'on' : ''
  )
}

/** A cloud launches (while the Dreamdrifter lasts) and the next one 44f later */
function cloud(c: SimContext, s: MizukiState, src: number) {
  if (s.src !== src || !dreaming(s, c.now)) return
  // Revelation: the cloud after a Swirl deals +1000% EM (and, in Stellar Swirl radiance, an extra
  // Stellar Swirl hit when it lands)
  const enhanced = s.revelation
  s.revelation = false
  c.hit(CLOUD_TRAVEL, {
    path: enhanced ? ['lockedPassive', 'skillContDmg'] : ['skill', 'contDmg'],
    tag: 'skill',
    element: 'anemo',
    applies: true,
    icd: 'Mizuki_Eart_Attack',
    icdGroup: 'MizukiSkill',
    label: enhanced
      ? 'Dreamdrifter Continuous Attack (Revelation)'
      : 'Dreamdrifter Continuous Attack',
    statSnapshots: s.cloudSnapshot,
  })
  if (enhanced)
    c.at(CLOUD_TRAVEL, (c2) => {
      if (c2.radiance !== 'swirl' && !c2.hasStellarSwirl) return
      c2.hit(2, {
        path: ['lockedPassive', 'skillContSsDmg'],
        tag: 'directStellarSwirl',
        element: 'anemo',
        applies: false,
        label: 'Mizuki Revelation: Radiance (Stellar Swirl)',
        states: [
          {
            owner: 'YumemizukiMizuki',
            path: ['YumemizukiMizuki', 'lockStellarRadiance'],
            value: 'ss',
          },
        ],
      })
    })
  c.atCharacter('YumemizukiMizuki', CLOUD_INTERVAL, (c2) => cloud(c2, s, src))
}

/** C1: the debuff on the enemies, every 3.5 s while the Dreamdrifter lasts */
function c1Awaiting(c: SimContext, s: MizukiState, src: number) {
  if (s.src !== src || !dreaming(s, c.now)) return
  setC1(c, s, false)
  setC1(c, s, true)
  const gen = s.c1Gen
  c.at(C1_DURATION, (c2) => {
    if (s.c1Gen === gen) setC1(c2, s, false)
  })
  c.atCharacter('YumemizukiMizuki', C1_INTERVAL, (c2) => c1Awaiting(c2, s, src))
}

export const kit: KitModel = {
  characterKey: 'YumemizukiMizuki',
  element: 'anemo',
  source: `${GCSIM}/mizuki`,
  init: (): MizukiState => ({
    src: -1,
    a1Left: 0,
    a1IcdUntil: -1,
    a4IcdUntil: -1,
    revelation: false,
    revelationIcdUntil: -1,
    c1Gen: 0,
    c1On: false,
    animEnd: -1,
  }),
  onStart(ctx) {
    // Revelation (Vast Be the Dream) is on, as gcsim's default
    ctx.state('YumemizukiMizuki', ['YumemizukiMizuki', 'lockRevelation'], 'on')
  },
  act(ctx, s: MizukiState, action, previous) {
    const result = act(ctx, s, action, previous)
    if (!result.failed) s.animEnd = ctx.now + result.frames
    return result
  },
  // In Dreamdrifter only E (which ends it), dash, swap and the burst are possible: other actions
  // wait for it to end (gcsim's ActionReady)
  actionReadyAt: (ctx, s: MizukiState, action) =>
    (action.kind === 'normal' ||
      action.kind === 'charged' ||
      action.kind === 'jump' ||
      action.kind === 'plunge') &&
    dreaming(s, ctx.now)
      ? s.dreamEnd!
      : ctx.now,
  // The Dreamdrifter's E is a cancel (no cooldown); the cooldown is on the activation
  cooldownKey: (s: MizukiState, action, now) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && !dreaming(s, now)
        ? 'skill'
        : undefined,
  onHit(ctx, s: MizukiState, hit) {
    if (hit.path[0] === '_reaction') {
      if (!SWIRLS.includes(hit.path[1])) return
      if (hit.characterKey !== 'YumemizukiMizuki' || !dreaming(s, hit.t)) return
      // A1: her Swirl extends the Dreamdrifter by 2.5 s
      if (s.a1Left > 0 && hit.t >= s.a1IcdUntil) {
        s.a1IcdUntil = hit.t + A1_ICD
        s.a1Left--
        s.dreamEnd! += A1_EXTEND
      }
      // Revelation: her Swirl on the field enhances her next cloud
      if (hit.onField === 'YumemizukiMizuki' && hit.t >= s.revelationIcdUntil) {
        s.revelationIcdUntil = hit.t + REVELATION_ICD
        s.revelation = true
      }
      return
    }
    // C1: a Swirl (by anyone) that deals DMG to the enemy with Twenty-Three Nights' Awaiting gets
    // +1100% EM (the sheet's condition), then the effect is spent. Revelation: Mizuki also launches
    // an extra attack on it (1000% EM, or 400% EM Stellar Swirl DMG in Stellar Swirl radiance).
    if (
      hit.path[0] === 'reaction' &&
      SWIRL_DMG.includes(hit.path[1]) &&
      s.c1On &&
      ctx.constellation('YumemizukiMizuki') >= 1
    ) {
      // spent: no other Swirl gets it; the condition closes after this frame (this hit has it)
      s.c1On = false
      s.c1Gen++
      ctx.at(1, (c2) => {
        if (!s.c1On)
          c2.state('YumemizukiMizuki', ['YumemizukiMizuki', 'c1Awaiting'], '')
      })
      const ss = ctx.radiance === 'swirl' || ctx.hasStellarSwirl
      ctx.hit(3, {
        path: ['constellation1', ss ? 'ssDmg' : 'dmg'],
        tag: ss ? 'directStellarSwirl' : 'other',
        element: 'anemo',
        applies: !ss,
        durability: 25,
        icd: 'none',
        label: ss ? 'Mizuki C1 (Stellar Swirl)' : 'Mizuki C1',
        states: [
          {
            owner: 'YumemizukiMizuki',
            path: ['YumemizukiMizuki', 'lockStellarRadiance'],
            value: ss ? 'ss' : '',
          },
        ],
      })
      return
    }
    // A4: other party members' Pyro, Hydro, Cryo or Electro hits in the Dreamdrifter give her EM
    // +100 for 4 s (the 0.3 s ICD is spent by any hit by others)
    if (hit.path[0].startsWith('_')) return
    if (!dreaming(s, hit.t)) return
    if (hit.characterKey === 'YumemizukiMizuki') return
    if (hit.t < s.a4IcdUntil) return
    s.a4IcdUntil = hit.t + A4_ICD
    if (
      hit.element === 'pyro' ||
      hit.element === 'hydro' ||
      hit.element === 'cryo' ||
      hit.element === 'electro'
    )
      ctx.buff(
        'YumemizukiMizuki',
        ['YumemizukiMizuki', 'a4Phec'],
        'on',
        0,
        A4_DURATION
      )
  },
  onSwapOut(ctx, s: MizukiState) {
    // leaving the field ends the Dreamdrifter
    endDream(ctx, s)
  },
  onSwapIn(ctx, s: MizukiState) {
    // the swap's own animation is still on when her first action starts (not idle: a CA then
    // has its windup)
    s.animEnd = ctx.now + 1
    return undefined
  },
}

function act(
  ctx: SimContext,
  s: MizukiState,
  action: RotationAction,
  previous: RotationAction | undefined
): ActionResult {
  const c = ctx.constellation('YumemizukiMizuki')
  switch (action.kind) {
    case 'normal': {
      // the arrow-like orbs are deployable: no hitlag; a written wait starts at the hitmark
      const n = Math.max(1, action.count ?? 1)
      const first = ctx.normalSequence(mizukiNormals.length, n)
      let start = 0
      const normalStarts: { offset: number; index: number }[] = []
      for (let step = 0; step < n; step++) {
        const i = (first + step) % mizukiNormals.length
        normalStarts.push({ offset: start, index: i })
        ctx.hit(start + mizukiNormals[i].hit, {
          path: ['normal', `${i}`],
          tag: 'normal',
          element: 'anemo',
          applies: true,
          icd: 'normal',
          label: `N${i + 1}`,
        })
        if (step < n - 1) start += mizukiNormals[i].toNormal
      }
      const last = mizukiNormals[(first + n - 1) % mizukiNormals.length]
      return {
        normalStarts,
        frames: start + last.frames,
        framesInto: {
          normal: start + last.toNormal,
          charged: start + last.toCharged,
          skill: start + last.skill,
          burst: start + last.burst,
          dash: start + last.dash,
          jump: start + last.jump,
          swap: start + last.swap,
          wait: start + last.hit - TRAVEL,
        },
      }
    }
    case 'charged': {
      // gcsim: the CA's windup (14f) is skipped only when it starts from idle (the previous
      // action's animation, or the swap's, is over)
      const windup = ctx.now < s.animEnd ? CA_WINDUP : 0
      ctx.hit(39 - windup, {
        path: ['charged', 'dmg'],
        tag: 'charged',
        element: 'anemo',
        applies: true,
        icd: 'none',
        label: 'Charged Attack',
      })
      return {
        frames: 81 - windup,
        framesInto: {
          normal: 62 - windup,
          charged: 62 - windup,
          skill: 62 - windup,
          burst: 60 - windup,
          dash: 37 - windup,
          jump: 37 - windup,
          swap: 64 - windup,
        },
      }
    }
    case 'skill': {
      if (dreaming(s, ctx.now)) {
        // E again: it ends the Dreamdrifter (no damage, no cooldown)
        endDream(ctx, s)
        return { frames: 50, framesInto: { burst: 34, swap: 30 } }
      }
      // Aisa Utamakura Pilgrimage (hit at 2f), then the Dreamdrifter
      const src = ctx.now
      s.src = src
      s.dreamEnd = ctx.now + DREAM
      s.a1Left = A1_MAX
      s.revelation = false
      setDream(ctx, true)
      ctx.at(DREAM, (c2) => dreamTimer(c2, s, src))
      ctx.hit(2, {
        path: ['skill', 'skillDmg'],
        tag: 'skill',
        element: 'anemo',
        applies: true,
        icd: 'none',
        label: 'Aisa Utamakura Pilgrimage',
      })
      // the clouds' damage snapshots at the activation
      const snapshot = ctx.snapshot('YumemizukiMizuki')
      s.cloudSnapshot = CLOUD_STATS.map((stat) => ({
        stat,
        path: ['total', stat],
        ...snapshot,
      }))
      ctx.atCharacter('YumemizukiMizuki', CLOUD_FIRST, (c2) =>
        cloud(c2, s, src)
      )
      if (c >= 1)
        ctx.atCharacter('YumemizukiMizuki', C1_FIRST, (c2) =>
          c1Awaiting(c2, s, src)
        )
      return {
        cooldown: { key: 'skill', frames: 900, delay: 23 },
        frames: 50,
        framesInto: { burst: 34, swap: 30 },
      }
    }
    case 'burst': {
      // Anraku Secret Spring Therapy: the hit at 93f (durability 50)
      ctx.hit(BURST_HIT, {
        path: ['burst', 'skillDmg'],
        tag: 'burst',
        element: 'anemo',
        applies: true,
        durability: 50,
        icd: 'none',
        label: 'Anraku Secret Spring Therapy',
      })
      // Yumemi Style Special Snacks: one every 1.5 s from the hit (8 in 12 s). As in gcsim's
      // geometry the active character is next to the enemy, so each is picked up 0.3 s after it
      // spawns: a Munen Shockwave when the active character is above 70% HP, else a heal (twice
      // as much on Mizuki); C4: both, and (Revelation) a heal for the lowest-HP member. The
      // shockwave's stats snapshot at the spawn. (C4's Energy is not modelled.)
      for (let k = 1; k <= 8; k++)
        ctx.at(BURST_HIT + SNACK_INTERVAL * k, (c2) => {
          const snapshot = c2.snapshot('YumemizukiMizuki')
          c2.at(SNACK_PICKUP, (c3) => snackPickup(c3, snapshot))
        })
      return {
        cooldown: { key: 'burst', frames: 900, delay: 1 },
        frames: 94,
        framesInto: {
          normal: 93,
          charged: 92,
          skill: 93,
          dash: 91,
          jump: 93,
        },
      }
    }
    case 'dash':
      // template dash (Girl body); it can be used in Dreamdrifter
      return { frames: 20, framesInto: { jump: 4 } }
    case 'jump':
      return templateJump('girl', 'catalyst', previous, ctx)
    case 'plunge':
      // gcsim has no plunging attack for Mizuki
      ctx.note('Mizuki: plunging attacks are not in gcsim; not modelled.')
      return { frames: 30 }
    default:
      return { frames: 30 }
  }
}

/** A Yumemi Style Special Snack is picked up by the active character */
function snackPickup(c: SimContext, snapshot: SimSnapshot) {
  const cons = c.constellation('YumemizukiMizuki')
  const healthy =
    !c.healthTracked || (c.hpRatio(c.onField) ?? 1) > SNACK_HEAL_BELOW
  if (healthy || cons >= 4)
    c.hit(0, {
      path: ['burst', 'shockwaveDmg'],
      tag: 'burst',
      element: 'anemo',
      applies: true,
      icd: 'burst',
      label: 'Munen Shockwave',
      statSnapshots: CLOUD_STATS.map((stat) => ({
        stat: stat === 'skill_dmg_' ? 'burst_dmg_' : stat,
        path: ['total', stat === 'skill_dmg_' ? 'burst_dmg_' : stat],
        ...snapshot,
      })),
    })
  if (!healthy || cons >= 4)
    for (let i = 0; i < (c.onField === 'YumemizukiMizuki' ? 2 : 1); i++)
      c.hit(0, {
        path: ['_heal', 'burst', 'snackHeal'],
        tag: 'other',
        element: 'anemo',
        healTargets: [c.onField],
        label: 'Snack Pick-Up (Heal)',
      })
  if (cons >= 4 && c.healthTracked) {
    const lowest = c.members.reduce((low, m) =>
      (c.hpRatio(m) ?? 1) < (c.hpRatio(low) ?? 1) ? m : low
    )
    c.hit(0, {
      path: ['_heal', 'constellation4', 'heal'],
      tag: 'other',
      element: 'anemo',
      healTargets: [lowest],
      label: 'Snack Pick-Up (C4 Heal)',
    })
  }
}
