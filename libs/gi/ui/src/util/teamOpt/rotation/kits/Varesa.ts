import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/varesa, main as of 2026-11-10. */

/** The Electro normal string */
const varesaNormals: NormalHit[] = [
  {
    hitmarks: [23],
    hitlag: [4],
    toNormal: 33,
    toCharged: 23,
    toAbil: 23,
    frames: 49,
  },
  {
    hitmarks: [7],
    hitlag: [4],
    toNormal: 30,
    toCharged: 17,
    toAbil: 7,
    frames: 30,
  },
  {
    hitmarks: [33],
    hitlag: [6],
    toNormal: 45,
    toCharged: 32,
    toAbil: 33,
    frames: 59,
  },
]

/** Fiery Passion: the same string in the Nightsoul Blessing */
const varesaFieryNormals: NormalHit[] = [
  {
    hitmarks: [17],
    hitlag: [6],
    toNormal: 29,
    toCharged: 31,
    toAbil: 17,
    frames: 39,
  },
  {
    hitmarks: [29],
    hitlag: [6],
    toNormal: 39,
    toCharged: 25,
    toAbil: 29,
    frames: 47,
  },
  {
    hitmarks: [37],
    hitlag: [6],
    toNormal: 63,
    toCharged: 37,
    toAbil: 37,
    frames: 63,
  },
]

/** The first attack of a string starts `windup` frames early (gcsim's windup) */
/**
 * gcsim's normal-attack cancels into a charged attack that come before the hit lands (N3: 32,
 * Fiery Passion N2: 25), and its CanQueueAfter (attackCQA / fieryAttackCQA): normalString keeps
 * every cancel at or after the hit, so these are applied to its result.
 */
const earlyCharged = (fiery: boolean, i: number) =>
  fiery ? (i === 1 ? 25 : undefined) : i === 2 ? 32 : undefined
const queueAfter = (fiery: boolean, i: number) =>
  fiery ? [17, 25, 37][i] : [23, 7, 32][i]

const withWindup = (h: NormalHit, w: number): NormalHit => ({
  ...h,
  hitmarks: h.hitmarks.map((x) => x - w),
  toNormal: h.toNormal - w,
  toCharged: h.toCharged - w,
  toAbil: h.toAbil - w,
  frames: h.frames - w,
})

/** Plunges: gcsim's hitmark, the sheet node, frames and cancels of each variant */
const plunges = {
  high: {
    hitmark: 37,
    node: 'high',
    label: 'High Plunge',
    frames: 72,
    into: {
      normal: 40,
      charged: 47,
      skill: 40,
      burst: 40,
      dash: 40,
      jump: 51,
      swap: 37,
    },
  },
  fieryHigh: {
    hitmark: 41,
    node: 'fphigh',
    label: 'Fiery Passion High Plunge',
    frames: 90,
    into: {
      normal: 47,
      charged: 46,
      skill: 47,
      burst: 47,
      dash: 40,
      jump: 79,
      swap: 45,
    },
  },
  low: {
    hitmark: 37,
    node: 'low',
    label: 'Low Plunge',
    frames: 75,
    into: {
      normal: 40,
      charged: 39,
      skill: 39,
      burst: 39,
      dash: 37,
      jump: 50,
      swap: 38,
    },
  },
  fieryLow: {
    hitmark: 40,
    node: 'fplow',
    label: 'Fiery Passion Low Plunge',
    frames: 91,
    into: {
      normal: 46,
      charged: 45,
      skill: 45,
      burst: 46,
      dash: 40,
      jump: 76,
      swap: 46,
    },
  },
}

const NS_MAX = 40
/** Nightsoul Blessing: 15 s */
const BLESSING = 900
/** Apex Drive: 140 frames */
const APEX = 140
/** Follow-Up Strike window after a Rush: 5 s */
const FOLLOW_UP = 300
/** Rush: 9 s per charge, 2 charges */
const RUSH_CD = 540

interface VaresaState {
  /** Nightsoul points (0–40) */
  points: number
  /** The Nightsoul Blessing (fiery attacks); the token tells a live blessing's timer from an old one */
  blessed: boolean
  blessToken: number
  /** The blessing's first Rush is free (no cooldown, no charge) */
  freeSkill: boolean
  /** A Fiery Passion plunge spent the points: the blessing ends at the next action */
  exitNS: boolean
  /** Follow-Up Strike: the next charged attack is the quick one, until this frame */
  followUntil: number
  /** Apex Drive (the Volcanic Kablam is ready), with its token */
  apex: boolean
  apexToken: number
  /**
   * The last action was a Volcanic Kablam: gcsim's attack windup checks for the burst state, but
   * the Kablam's state is a plunge, so the next normal attack keeps the full 6-frame windup
   */
  lastKablam: boolean
  /** The last action was a charged attack (a Follow-Up Strike included): a plunge is the high one */
  lastCharged: boolean
  /** A1 Rainbow Crash and C4 Diligent Refinement last until these frames (or their first impact) */
  a1Until: number
  c4Until: number
  /** Rush charges, and when the next one comes back */
  charges: number
  restoreAt?: number
}

/** Charges come back one at a time, RUSH_CD frames each */
function settleCharges(s: VaresaState, t: number) {
  while (s.restoreAt !== undefined && s.restoreAt <= t) {
    s.charges++
    s.restoreAt = s.charges < 2 ? s.restoreAt + RUSH_CD : undefined
  }
}

/** Nightsoul Blessing starts: 15 s, and the next Rush is free */
function enterBlessing(ctx: SimContext, s: VaresaState) {
  s.blessed = true
  s.freeSkill = true
  const token = ++s.blessToken
  ctx.at(BLESSING, () => {
    if (s.blessToken === token) {
      s.blessed = false
      s.freeSkill = false
    }
  })
}

/** The blessing ends (at the next action after a Fiery Passion plunge) */
function exitBlessing(s: VaresaState) {
  s.blessed = false
  s.freeSkill = false
  s.exitNS = false
  s.blessToken++
}

/** Nightsoul points; a full gauge from a plunge or a Flying Kick starts the blessing */
function gainPoints(
  ctx: SimContext,
  s: VaresaState,
  amount: number,
  enter: boolean
) {
  s.points = Math.min(NS_MAX, s.points + amount)
  if (enter && s.points >= NS_MAX && !s.blessed) enterBlessing(ctx, s)
}

/** Apex Drive: from a plunge at C2+, or in the blessing */
function startApex(ctx: SimContext, s: VaresaState) {
  s.apex = true
  const token = ++s.apexToken
  ctx.at(APEX, () => {
    if (s.apexToken === token) s.apex = false
  })
}

/**
 * A plunge impact's flat bonuses, read at the cast and spent when the impact hits (gcsim's
 * a1PlungeBonus / c4FlatBonus in FlatDmg, a1Cancel / c4CB on the hit): A1 Rainbow Crash and C4
 * Diligent Refinement (not the Kablam's). C4's +100% DMG goes to this burst instance only when
 * Fiery Passion or Apex Drive is up as it is used (the game text; gcsim checks at the hit, so its
 * Flying Kick outside the blessing gets both).
 */
function impactStates(
  ctx: SimContext,
  s: VaresaState,
  hitmark: number,
  kablam: boolean
) {
  const a1 = ctx.now < s.a1Until
  const c4 = !kablam && ctx.now < s.c4Until
  ctx.at(hitmark, () => {
    s.a1Until = -1
    if (!kablam) s.c4Until = -1
  })
  return [
    {
      owner: 'Varesa' as const,
      path: ['Varesa', 'a1Rainbow'],
      value: a1 ? 'on' : '',
    },
    {
      owner: 'Varesa' as const,
      path: ['Varesa', 'c4Diligent'],
      value: c4 ? 'on' : '',
    },
    {
      owner: 'Varesa' as const,
      path: ['Varesa', 'c4FpApex'],
      value: kablam && ctx.constellation('Varesa') >= 4 ? 'on' : '',
    },
  ]
}

function endApex(s: VaresaState) {
  s.apex = false
  s.apexToken++
}

/** A normal attack string, `offset` frames into the action (after a Follow-Up Strike) */
function normalAttack(
  ctx: SimContext,
  count: number,
  fiery: boolean,
  windup: number,
  offset: number
): ActionResult {
  const table = fiery ? varesaFieryNormals : varesaNormals
  const hits = table.map((h, i) => (i === 0 ? withWindup(h, windup) : h))
  const result = normalString(
    hits,
    count,
    (i, d) =>
      ctx.hit(offset + d, {
        path: ['normal', `${fiery ? 'fp' : ''}${i}`],
        tag: 'normal',
        element: 'electro',
        applies: true,
        icd: 'normal',
        label: fiery ? `Fiery Passion N${i + 1}` : `N${i + 1}`,
      }),
    ctx
  )
  // gcsim's cancel into a charged attack before the last hit lands, and its CanQueueAfter
  const last = result.normalStarts?.[result.normalStarts.length - 1]
  if (last && result.framesInto) {
    const w = last.index === 0 ? windup : 0
    const early = earlyCharged(fiery, last.index)
    if (early !== undefined) result.framesInto.charged = last.offset + early - w
    result.framesInto.wait = last.offset + queueAfter(fiery, last.index) - w
  }
  return result
}

/**
 * Charged attack: 69 frames, or 11 as a Follow-Up Strike (after a Rush), whose only shorter
 * cancel is into the plunge. Its hit pauses Varesa 6 frames (0.03 s halt + the 3.6-frame defense
 * halt); a following wait starts at the hit (gcsim's CanQueueAfter).
 */
function chargedAttack(ctx: SimContext, s: VaresaState): ActionResult {
  const fiery = s.blessed
  const followUp = ctx.now < s.followUntil
  s.followUntil = -1
  s.lastCharged = true
  const hitmark = followUp ? 11 : 69
  const name = fiery ? 'Fiery Passion Charged Attack' : 'Charged Attack'
  ctx.hit(hitmark, {
    path: ['charged', fiery ? 'fpDmg' : 'dmg'],
    tag: 'charged',
    element: 'electro',
    applies: true,
    icd: 'varesaCycle',
    nightsoul: true,
    label: followUp ? `${name} (Follow-Up Strike)` : name,
  })
  const into: ActionResult['framesInto'] = fiery
    ? {
        normal: 142,
        charged: 143,
        skill: 141,
        burst: 141,
        dash: 142,
        jump: 143,
        swap: 138,
        plunge: followUp ? 23 : 81,
        wait: hitmark,
      }
    : {
        normal: 142,
        charged: 141,
        skill: 142,
        burst: 143,
        dash: 143,
        jump: 143,
        swap: 139,
        plunge: followUp ? 20 : 77,
        wait: hitmark,
      }
  return withHitlag(
    { frames: 143, framesInto: into },
    { hitmarks: [hitmark], hitlag: [6] }
  )
}

export const kit: KitModel = {
  characterKey: 'Varesa',
  element: 'electro',
  source: `${GCSIM}/varesa`,
  nightsoul(_ctx, s: VaresaState) {
    return { active: s.blessed, points: s.points }
  },
  onNightsoulBurst(ctx) {
    ctx.buff('Varesa', ['Varesa', 'a4NsBurst'], '1', 1, 720, 2)
  },
  init: (): VaresaState => ({
    points: 0,
    blessed: false,
    blessToken: 0,
    freeSkill: false,
    exitNS: false,
    followUntil: -1,
    apex: false,
    apexToken: 0,
    lastKablam: false,
    lastCharged: false,
    a1Until: -1,
    c4Until: -1,
    charges: 2,
  }),
  // In Fiery Passion (the blessing) her normal and charged attacks, Rush and plunges have frames
  // of their own; after a Rush her normal or charged attack is the quick Follow-Up Strike; in Apex
  // Drive her Q is the Volcanic Kablam
  variant(ctx, s: VaresaState, action) {
    // (act ends the blessing first at the action after a Fiery Passion plunge, a burst excepted)
    const fiery = s.blessed && !(s.exitNS && action.kind !== 'burst')
    const mode = 'Fiery Passion'
    switch (action.kind) {
      case 'normal':
      case 'charged':
        if (ctx.now < s.followUntil)
          return fiery
            ? {
                key: 'fieryFollowUp',
                label: 'Fiery Passion Follow-Up Strike',
                mode,
              }
            : { key: 'followUp', label: 'Follow-Up Strike' }
        if (!fiery) return undefined
        return action.kind === 'normal'
          ? { key: 'fiery', label: 'Fiery Passion Normal Attack', mode }
          : { key: 'fiery', label: 'Fiery Passion Charged Attack', mode }
      case 'skill':
        return fiery
          ? { key: 'fiery', label: 'Fiery Passion Rush', mode }
          : undefined
      case 'plunge':
        return fiery
          ? { key: 'fiery', label: 'Fiery Passion Plunging Attack', mode }
          : undefined
      case 'burst':
        return s.apex
          ? { key: 'apex', label: 'Volcanic Kablam', mode: 'Apex Drive' }
          : undefined
      default:
        return undefined
    }
  },
  act(ctx, s: VaresaState, action, previous) {
    // the blessing ends at the next action after a Fiery Passion plunge (a burst keeps it)
    if (s.exitNS && action.kind !== 'burst') exitBlessing(s)
    const lastKablam = s.lastKablam
    s.lastKablam = false
    const afterCharged = s.lastCharged
    s.lastCharged = false
    const fiery = s.blessed
    const c = ctx.constellation('Varesa')
    switch (action.kind) {
      case 'normal': {
        // Follow-Up Strike: pressing Normal Attack unleashes the quick charged attack instead
        // (gcsim's Attack() calls ChargeAttack while the follow-up status is active); the rest
        // of a grouped string then starts from N1 after the charged attack's cancel
        if (ctx.now < s.followUntil) {
          const ca = chargedAttack(ctx, s)
          const n = (action.count ?? 1) - 1
          if (n <= 0) return ca
          const offset = ca.framesInto!.normal!
          s.lastCharged = false
          const rest = normalAttack(ctx, n, fiery, 6, offset)
          return {
            frames: offset + rest.frames,
            framesInto: Object.fromEntries(
              Object.entries(rest.framesInto!).map(([k, v]) => [k, offset + v!])
            ),
          }
        }
        // gcsim's windup: the first attack starts early, by how it's reached (in Fiery Passion:
        // none from a normal attack, 4 frames from the Flying Kick; a Follow-Up Strike leaves
        // her in the charged attack's state)
        const prev = previous?.kind
        let windup = 6
        if (fiery) {
          if (prev === 'normal' && !afterCharged) windup = 0
          else if (prev === 'burst' && !lastKablam) windup = 4
        }
        return normalAttack(ctx, action.count ?? 1, fiery, windup, 0)
      }
      case 'charged':
        return chargedAttack(ctx, s)
      case 'skill': {
        if (action.hold)
          ctx.note(
            'Varesa: a held Rush is modelled as a tap (gcsim has no hold).'
          )
        // a free Rush (the blessing's first) has no cooldown and no charge
        const free = s.freeSkill
        if (free) s.freeSkill = false
        else {
          settleCharges(s, ctx.now)
          if (s.charges <= 0)
            return { frames: 0, failed: 'Varesa: no Rush charge ready' }
          s.charges--
          if (s.restoreAt === undefined) s.restoreAt = ctx.now + RUSH_CD
        }
        if (s.apex) endApex(s)
        s.followUntil = ctx.now + FOLLOW_UP
        ctx.hit(fiery ? 2 : 5, {
          path: ['skill', fiery ? 'fpRushDmg' : 'rushDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'varesaCycle',
          nightsoul: true,
          label: fiery ? 'Fiery Passion Rush' : 'Rush',
        })
        // the Rush adds 20 points 5 frames in (it does not start the blessing)
        ctx.at(5, (c2) => gainPoints(c2, s, 20, false))
        // A1 Rainbow Crash: 5 s, spent by the next plunge impact (impactStates)
        s.a1Until = ctx.now + 300
        // the Rush pauses Varesa 4 frames on hit (gcsim's 3.6-frame defense halt)
        const result: ActionResult = withHitlag(
          {
            frames: fiery ? 52 : 43,
            framesInto: fiery
              ? {
                  normal: 23,
                  charged: 23,
                  skill: 22,
                  burst: 22,
                  dash: 38,
                  jump: 39,
                  swap: 21,
                }
              : {
                  normal: 22,
                  charged: 22,
                  burst: 22,
                  dash: 37,
                  jump: 37,
                  swap: 21,
                },
          },
          { hitmarks: [fiery ? 2 : 5], hitlag: [4] }
        )
        if (!free && s.charges === 0 && s.restoreAt !== undefined)
          result.cooldown = { key: 'skill', frames: s.restoreAt - ctx.now }
        return result
      }
      case 'burst': {
        // C4: a burst used with neither Fiery Passion nor Apex Drive gives Diligent Refinement
        // (15 s, spent by the next plunge impact); with either, this burst deals +100% DMG
        const c4Boost = c >= 4 && (fiery || s.apex)
        if (c >= 4 && !fiery && !s.apex) s.c4Until = ctx.now + 900
        if (s.apex) {
          // Volcanic Kablam (a short burst, no cooldown): plunge damage at 42 frames, ends the apex.
          // C1: it gains Rainbow Crash itself (and spends it on its impact)
          if (c >= 1) s.a1Until = ctx.now + 300
          ctx.hit(42, {
            path: ['burst', 'volcanoDmg'],
            tag: 'plunge',
            element: 'electro',
            applies: true,
            icd: 'varesaCycle',
            nightsoul: true,
            label: 'Volcanic Kablam',
            states: impactStates(ctx, s, 42, true),
          })
          ctx.at(42, () => endApex(s))
          s.lastKablam = true
          return {
            frames: 47,
            framesInto: { normal: 46, skill: 45, dash: 43, swap: 42 },
          }
        }
        // Flying Kick: 88 frames; its points (3 frames in) fill the gauge and start the blessing
        ctx.hit(88, {
          path: ['burst', fiery ? 'fpKickDmg' : 'kickDmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'none',
          nightsoul: true,
          label: fiery ? 'Fiery Passion Flying Kick' : 'Flying Kick',
          states: [
            {
              owner: 'Varesa',
              path: ['Varesa', 'c4FpApex'],
              value: c4Boost ? 'on' : '',
            },
          ],
        })
        ctx.at(3, (c2) => gainPoints(c2, s, NS_MAX, true))
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 122,
          framesInto: { normal: 93, skill: 90, dash: 93, swap: 90 },
        }
      }
      case 'plunge': {
        // a plunge after a charged attack is the High Plunge; otherwise the Low Plunge
        const variant = afterCharged
          ? fiery
            ? plunges.fieryHigh
            : plunges.high
          : fiery
            ? plunges.fieryLow
            : plunges.low
        ctx.hit(variant.hitmark, {
          path: ['plunging', variant.node],
          tag: 'plunge',
          element: 'electro',
          applies: true,
          icd: 'none',
          nightsoul: true,
          label: variant.label,
          states: impactStates(ctx, s, variant.hitmark, false),
        })
        if (fiery) {
          // a Fiery Passion plunge spends the points; the blessing ends at the next action
          s.exitNS = true
          ctx.at(2, () => {
            s.points = 0
          })
        } else ctx.at(variant.hitmark, (c2) => gainPoints(c2, s, 25, true))
        // Apex Drive: at C2+, or in the blessing
        if (c >= 2 || fiery) startApex(ctx, s)
        // a following wait starts at the dash cancel (gcsim's CanQueueAfter)
        return {
          frames: variant.frames,
          framesInto: { ...variant.into, wait: variant.into.dash },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  cooldownKey: (s: VaresaState, action) => {
    // the Volcanic Kablam (Apex Drive) is not on the burst's cooldown
    if (action.kind === 'burst') return s.apex ? undefined : 'burst'
    // a Rush waits for a charge (a free one doesn't)
    if (action.kind === 'skill' && !s.freeSkill && s.charges <= 0)
      return 'skill'
    return undefined
  },
}
