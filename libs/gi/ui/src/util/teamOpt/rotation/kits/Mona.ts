import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { RotationAction } from '../parse'
import type { ActionResult, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/mona, main as of 2026-11-10. */

/*
 * Assumptions: Witch's Homework is complete (gcsim's default: her own Hexerei upgrades are on;
 * Secret Rite needs a second Hexerei member), A1 is unlocked, the Omen lasts 5 s (talent level 7+;
 * 4 to 4.5 s below), and enemies are within A1's 15 m. C2's 20% follow-up uses a deterministic
 * probability accumulator (expected rate, not a random trial). Not modelled: plunges (gcsim has
 * none).
 */

const monaNormals: NormalHit[] = [
  { hitmarks: [11], toNormal: 18, toCharged: 29, toAbil: 11, frames: 29 },
  { hitmarks: [14], toNormal: 23, toCharged: 30, toAbil: 14, frames: 30 },
  { hitmarks: [25], toNormal: 39, toCharged: 54, toAbil: 25, frames: 54 },
  { hitmarks: [27], toNormal: 67, toCharged: 67, toAbil: 27, frames: 67 },
]

interface MonaState {
  /** The bubble (Stellaris Phantasm) is on the enemy from `bubbleFrom` until `bubbleUntil` */
  bubbleFrom: number
  bubbleUntil: number
  /** Which bubble the time-out check belongs to */
  bubbleId: number
  /** The Omen debuff is on until this frame */
  omenUntil: number
  /** The Omen is on the enemy (cleared by its expiry on the enemy's clock) */
  omenActive: boolean
  omenId: number
  /** Illusory Torrent (the dash) is on: any other action of Mona's ends it */
  dashing: boolean
  /** Mona's animation ends at this frame (her state, for the Charged Attack's windup) */
  busyUntil: number
  /** C2 (Hexerei): the next normal attack hit before this frame makes a Charged Attack */
  c2PostUntil: number
  /** C2's 5 s internal cooldown ends at this frame (Mona's clock) */
  c2IcdEnd: number
  /** C2's 20% chance as an accumulated probability (a proc at 1) */
  c2Chance: number
  /** Illusory Torrent's state ends at this frame (its 500-frame animation) */
  dashEnd: number
  /** Hexerei: Omen refreshes left for this Omen (4) and the 0.5 s refresh ICD */
  omenRefreshes: number
  omenRefreshIcd: number
  /** Hexerei (Secret Rite): Astral Glow of Mercury stacks, their ICD and end (Mona's clock) */
  glow: number
  glowIcd: number
  glowEnd: number
  /** C6: Rhetorics of Calamitas stacks, their end (Mona's clock), the ticker and an Omen nearby */
  c6Stacks: number
  c6End: number
  c6Src: number
  c6Seq: number
  c6NearbyOmen: boolean
}

/** Hexerei: Secret Rite (2 Hexerei members in the party) */
const secretRite = (c: SimContext) =>
  c.members.filter((k) => HEXEREI_CHARACTERS.includes(k)).length >= 2

const clock = (c: SimContext) => c.characterFrame('Mona')

/**
 * The Omen ends `left` frames from now, on the enemy's clock (gcsim's hitlag-affected status,
 * active through its expiry frame): its condition and flag clear then. A refresh reschedules it.
 */
function omenExpiry(ctx: SimContext, s: MonaState, left: number) {
  const id = ++s.omenId
  s.omenUntil = ctx.now + left
  ctx.atEnemy(left + 1, (at) => {
    if (s.omenId !== id) return
    s.omenActive = false
    s.omenUntil = at.now
    at.state('Mona', ['Mona', 'Omen'], '')
  })
}

/** The bubble pops: the Omen starts, and the explosion lands 1 frame later */
function popBubble(ctx: SimContext, s: MonaState) {
  s.bubbleUntil = ctx.now
  s.omenRefreshes = 4
  s.omenActive = true
  ctx.state('Mona', ['Mona', 'Omen'], 'on')
  omenExpiry(ctx, s, 5 * 60)
  ctx.hit(1, {
    characterKey: 'Mona',
    path: ['burst', 'dmg'],
    tag: 'burst',
    element: 'hydro',
    applies: true,
    durability: 50,
    icd: 'burst',
    label: 'Illusory Bubble (explosion)',
  })
}

/** A1: each check (while dashing) queues a phantom that explodes 2 s later, and checks again */
const a1Check = (s: MonaState) => (ctx: SimContext) => {
  // gcsim: Mona on the field and still in Illusory Torrent (its state lasts 500 frames)
  if (!s.dashing || ctx.onField !== 'Mona' || ctx.now >= s.dashEnd) return
  ctx.hit(120, {
    characterKey: 'Mona',
    path: ['passive1', 'dmg'],
    tag: 'skill',
    element: 'hydro',
    applies: true,
    icd: 'none',
    label: 'Mirror Reflection of Doom (A1 phantom)',
  })
  ctx.at(120, a1Check(s))
}

/** C6: Rhetorics of Calamitas: a stack per second (first after 59 frames), Mona's clock */
function c6Start(ctx: SimContext, s: MonaState) {
  if (ctx.constellation('Mona') < 6 || s.c6Src >= 0) return
  const src = ++s.c6Seq
  s.c6Src = src
  ctx.atCharacter('Mona', 59, (c) => c6Tick(c, s, src))
}

function c6Tick(c: SimContext, s: MonaState, src: number) {
  if (s.c6Src !== src) return
  const dashing = c.onField === 'Mona' && s.dashing && c.now < s.dashEnd
  if (!dashing && !s.c6NearbyOmen) {
    s.c6Src = -1
    return
  }
  if (clock(c) > s.c6End) s.c6Stacks = 0
  c.atCharacter('Mona', 60, (c2) => c6Tick(c2, s, src))
  if (c.onField !== 'Mona') return
  s.c6Stacks = Math.min(3, s.c6Stacks + 1)
  s.c6End = clock(c) + 480
  c.state('Mona', ['Mona', 'RhetoricsOfCalamitas'], `${s.c6Stacks}`)
  const end = s.c6End
  c.atCharacter('Mona', 481, (c2) => {
    if (s.c6End !== end) return
    s.c6Stacks = 0
    c2.state('Mona', ['Mona', 'RhetoricsOfCalamitas'], '')
  })
}

/** C6 (Hexerei): every 0.3 s, an Omen (or bubble) nearby keeps the stack ticker going */
function c6OmenTicker(c: SimContext, s: MonaState) {
  c.atCharacter('Mona', 18, (c2) => c6OmenTicker(c2, s))
  const omen = (c.now >= s.bubbleFrom && c.now < s.bubbleUntil) || s.omenActive
  s.c6NearbyOmen = omen
  if (omen) return c6Start(c, s)
  if (!(c.onField === 'Mona' && s.dashing && c.now < s.dashEnd)) s.c6Src = -1
}

function monaAct(
  ctx: SimContext,
  s: MonaState,
  action: RotationAction,
  previous: RotationAction | undefined
): ActionResult {
  const now = ctx.now
  const c = ctx.constellation('Mona')
  switch (action.kind) {
    case 'normal':
      return normalString(
        monaNormals,
        action.count ?? 1,
        (i, d) =>
          ctx.hit(d, {
            path: ['normal', `${i}`],
            tag: 'normal',
            element: 'hydro',
            applies: true,
            icd: 'MonaWaterDamage',
            label: `N${i + 1}`,
          }),
        ctx
      )
    case 'charged': {
      // the windup (14 frames) when Mona is still in her previous action's animation
      const windup = now <= s.busyUntil ? 14 : 0
      ctx.hit(66 - windup, {
        path: ['charged', 'dmg'],
        tag: 'charged',
        element: 'hydro',
        applies: true,
        icd: 'none',
        label: 'Charged Attack',
      })
      return windup
        ? {
            frames: 113 - windup,
            framesInto: {
              charged: 105 - windup,
              skill: 92 - windup,
              burst: 68 - windup,
              dash: 72 - windup,
              jump: 64 - windup,
              swap: 54 - windup,
            },
          }
        : {
            frames: 113,
            framesInto: {
              charged: 105,
              skill: 92,
              burst: 68,
              dash: 72,
              jump: 64,
              swap: 54,
            },
          }
    }
    case 'skill': {
      // Mirror Reflection of Doom: 4 DoT ticks every 59 frames, then the explosion 243 frames
      // after the first tick's hitmark
      const first = action.hold ? 101 : 86
      for (let t = first; t < 300; t += 59)
        ctx.hit(t, {
          path: ['skill', 'dot'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'skill',
          label: 'Mirror Reflection of Doom (DoT)',
          statSnapshots: [
            {
              stat: 'atk',
              path: ['total', 'atk'],
              t: now,
              onField: ctx.onField,
            },
          ],
        })
      ctx.hit(first + 243, {
        path: ['skill', 'dmg'],
        tag: 'skill',
        element: 'hydro',
        applies: true,
        icd: 'none',
        // gcsim snapshots her stats at the cast (ATK here) but applies attack mods such as the
        // Omen's DMG bonus at impact, so the other stats are left to the impact
        label: 'Mirror Reflection of Doom (explosion)',
        statSnapshots: [
          { stat: 'atk', path: ['total', 'atk'], t: now, onField: ctx.onField },
        ],
      })
      return action.hold
        ? {
            cooldown: { key: 'skill', frames: 12 * 60, delay: 24 },
            frames: 80,
            framesInto: {
              charged: 76,
              burst: 58,
              dash: 66,
              jump: 59,
              swap: 73,
            },
          }
        : {
            cooldown: { key: 'skill', frames: 12 * 60, delay: 24 },
            frames: 50,
            framesInto: {
              charged: 46,
              burst: 28,
              dash: 36,
              jump: 28,
              swap: 43,
            },
          }
    }
    case 'burst': {
      // Stellaris Phantasm: the bubble (8 s) starts with the 0-DMG hit at 107 frames; it pops on
      // the next hit on the enemy, or at its end (frame 587)
      const id = ++s.bubbleId
      s.bubbleFrom = now + 107
      s.bubbleUntil = now + 107 + 481
      ctx.at(107, (at) => {
        if (s.bubbleId !== id) return
        at.state('Mona', ['Mona', 'Omen'], 'on')
        at.hit(0, {
          path: ['_application', 'bubble'],
          tag: 'other',
          element: 'hydro',
          applies: true,
          durability: 25,
          icd: 'burst',
          label: 'Illusory Bubble (Initial)',
        })
      })
      ctx.at(107 + 480, (c2) => {
        if (s.bubbleId === id && c2.now < s.bubbleUntil) popBubble(c2, s)
      })
      // C2 (Hexerei): the next normal attack within 5 s makes a Charged Attack
      if (c >= 2) s.c2PostUntil = now + 5 * 60
      return {
        cooldown: { key: 'burst', frames: 15 * 60 },
        frames: 127,
        framesInto: {
          normal: 121,
          charged: 118,
          skill: 115,
          dash: 115,
          jump: 104,
        },
      }
    }
    case 'dash':
      // Illusory Torrent: a 0-DMG Hydro application at 20 frames (its own ICD tag); its
      // phantoms (A1) start after 2 s; C6 stacks while dashing
      ctx.hit(20, {
        path: ['_application', 'dash'],
        tag: 'other',
        element: 'hydro',
        applies: true,
        durability: 25,
        icd: 'MonaDash',
        label: 'Illusory Torrent (Hydro)',
      })
      s.dashEnd = now + 500
      ctx.at(120, a1Check(s))
      c6Start(ctx, s)
      // gcsim: a jump after Illusory Torrent is illegal (500 frames)
      return {
        frames: 500,
        framesInto: {
          normal: 42,
          charged: 36,
          skill: 35,
          burst: 21,
          dash: 30,
          swap: 34,
        },
      }
    case 'jump':
      // template jump (Girl body): 34 frames after a dash, else 31
      return templateJump('girl', 'catalyst', previous, ctx)
    default:
      return { frames: 30 }
  }
}

export const kit: KitModel = {
  characterKey: 'Mona',
  element: 'hydro',
  source: `${GCSIM}/mona`,
  init: (): MonaState => ({
    bubbleFrom: -1e9,
    bubbleUntil: -1e9,
    bubbleId: 0,
    omenUntil: -1e9,
    omenActive: false,
    omenId: 0,
    dashing: false,
    busyUntil: -1e9,
    c2PostUntil: -1e9,
    c2IcdEnd: -1e9,
    c2Chance: 0.5,
    dashEnd: -1e9,
    omenRefreshes: 0,
    omenRefreshIcd: -1e9,
    glow: 0,
    glowIcd: -1e9,
    glowEnd: -1e9,
    c6Stacks: 0,
    c6End: -1e9,
    c6Src: -1,
    c6Seq: 0,
    c6NearbyOmen: false,
  }),
  onStart(ctx, s: MonaState) {
    // Witch's Homework completed (gcsim's default): Mona's own Hexerei upgrades
    ctx.state('Mona', ['Mona', 'lockHomework'], 'on')
    if (ctx.constellation('Mona') >= 6) c6OmenTicker(ctx, s)
  },
  act(ctx, s: MonaState, action, previous) {
    s.dashing = action.kind === 'dash'
    const r = monaAct(ctx, s, action, previous)
    s.busyUntil = ctx.now + r.frames
    return r
  },
  onHit(ctx, s: MonaState, hit) {
    const c = ctx.constellation('Mona')
    // Hexerei (Secret Rite): another member's Vaporize consumes the Astral Glow stacks (they
    // count for that Vaporize: cleared a frame later)
    if (
      hit.path[0] === '_reaction' &&
      hit.path[1] === 'vaporize' &&
      hit.characterKey !== 'Mona' &&
      s.glow > 0
    ) {
      s.glow = 0
      ctx.at(1, (c2) => c2.state('Mona', ['Mona', 'lockStacks'], ''))
    }
    const omen = s.omenActive
    // C1: a hit on an Omen-affected enemy enhances the Hydro reactions for 8 s (from 1 frame later)
    if (c >= 1 && omen)
      ctx.buff('Mona', ['Mona', 'ProphecyOfSubmersion'], 'on', 1, 8 * 60)
    const marker = hit.path[0]?.startsWith('_') ?? false
    const own =
      !marker &&
      hit.characterKey === 'Mona' &&
      (hit.tag === 'normal' || hit.tag === 'charged')
    // Hexerei (Secret Rite): Mona's normal / charged hits extend the Omen by 2 s (0.5 s ICD, 4
    // times per Omen), before the bubble check (hits that pop it do not extend)
    if (
      own &&
      secretRite(ctx) &&
      omen &&
      s.omenRefreshes > 0 &&
      hit.t >= s.omenRefreshIcd
    ) {
      s.omenRefreshes--
      s.omenRefreshIcd = hit.t + 31
      omenExpiry(ctx, s, Math.max(0, s.omenUntil - ctx.now) + 120)
    }
    // the bubble pops on a hit that lands on the enemy while it is up (not on engine reaction marks)
    const impulse = !ctx.isFrozen || (hit.blunt && (hit.poiseDamage ?? 0) > 0)
    if (!marker && impulse && hit.t >= s.bubbleFrom && hit.t < s.bubbleUntil)
      popBubble(ctx, s)
    if (!own) return
    // Hexerei (Secret Rite): Astral Glow of Mercury, a stack per hit (0.1 s ICD, 3 max, 8 s)
    if (secretRite(ctx) && hit.t >= s.glowIcd) {
      s.glowIcd = hit.t + 7
      s.glow = Math.min(3, (clock(ctx) >= s.glowEnd ? 0 : s.glow) + 1)
      s.glowEnd = clock(ctx) + 480
      const end = s.glowEnd
      ctx.state('Mona', ['Mona', 'lockStacks'], `${s.glow}`)
      ctx.atCharacter('Mona', 480, (c2) => {
        if (s.glowEnd !== end) return
        s.glow = 0
        c2.state('Mona', ['Mona', 'lockStacks'], '')
      })
    }
    if (hit.tag === 'charged') {
      // C2 (Hexerei): a Charged Attack hit gives the party +80 EM for 12 s
      if (c >= 2)
        ctx.buff('Mona', ['Mona', 'lockC2Charged'], 'on', 1, 720, {
          hitlag: 'recipient',
        })
      // C6: the Charged Attack hit spends the Rhetorics of Calamitas stacks
      if (c >= 6 && s.c6Stacks > 0) {
        s.c6Stacks = 0
        s.c6End = -1e9
        ctx.at(1, (c2) =>
          c2.state('Mona', ['Mona', 'RhetoricsOfCalamitas'], '')
        )
      }
      return
    }
    // C2: a normal attack hit has a 20% chance (certain within 5 s after the burst, Hexerei) to
    // be followed by a Charged Attack, 53 frames later; once per 5 s
    if (c < 2) return
    if (clock(ctx) < s.c2IcdEnd) return
    const post = hit.t < s.c2PostUntil
    if (!post) {
      s.c2Chance += 0.2
      if (s.c2Chance < 1) return
      s.c2Chance -= 1
    }
    s.c2PostUntil = -1e9
    s.c2IcdEnd = clock(ctx) + 301
    ctx.hit(53, {
      characterKey: 'Mona',
      path: ['charged', 'dmg'],
      tag: 'charged',
      element: 'hydro',
      applies: true,
      icd: 'none',
      label: 'Charged Attack (C2)',
    })
  },
  onSwapOut(_ctx, s: MonaState) {
    s.dashing = false
  },
}
