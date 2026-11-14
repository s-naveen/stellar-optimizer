import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/kinich, main as of 2026-11-10. */

/** Normal attack string N1..N3 (gcsim's attackFrames) */
const kinichNormals: NormalHit[] = [
  {
    hitmarks: [21],
    hitlag: [8],
    toNormal: 30,
    toCharged: 47,
    toAbil: 21,
    frames: 47,
  },
  {
    hitmarks: [22],
    hitlag: [9],
    toNormal: 41,
    toCharged: 48,
    toAbil: 22,
    frames: 48,
  },
  {
    hitmarks: [44],
    hitlag: [11],
    toNormal: 75,
    toCharged: 79,
    toAbil: 44,
    frames: 79,
  },
]

/** Loop Shot (the normal attack in the blessing): two hits, the two shots in turn */
const LOOP_HITMARKS = [
  [30, 38],
  [31, 38],
]
const LOOP_FRAMES = 53
/** Into the next Loop Shot */
const LOOP_TO_LOOP = 40
/**
 * Frames into the next action, by shot (gcsim's skillAttackFrames for N1(E) / N2(E)); the
 * earliest cancel, where a written wait starts (gcsim's CanQueueAfter), is the dash
 */
const loopInto = [
  { charged: 38, skill: 33, burst: 35, dash: 26, jump: 32, swap: 53 },
  { charged: 38, skill: 33, burst: 32, dash: 21, jump: 34, swap: 53 },
]

/** Nightsoul Blessing: 610 frames, from 9 frames into the cast; the Skill goes on cooldown then */
const BLESSING_START = 9
const BLESSING_DUR = 610
const SKILL_CD = 18 * 60
/** Points: 1 every 30 frames in the blessing (from 30 frames in), 3 per Loop Shot, max 20 */
const POINTS_MAX = 20
const POINTS_TICK = 30
const POINTS_PER_SHOT = 3
/** The blind spot: entered by a Loop Shot for 4 points (the shot that crosses it) */
const BLIND_POINTS = 4
/** A burst extends the blessing by 1.7 s */
const BURST_EXTEND = 102

interface KinichState {
  /** The blessing ends at this frame (undefined: not in it) */
  blessingEnd?: number
  /** Nightsoul points as of `pointsAt` */
  points: number
  pointsAt: number
  /** Points build from this frame (the blessing's first tick) */
  buildFrom: number
  /** A blind spot is up from this frame (undefined: none) */
  blindAt?: number
  /** The next Loop Shot (0 or 1) */
  shot: number
  /** C2: the first Scalespiker Cannon of this blessing has its +100% DMG */
  c2FirstUsed: boolean
  /** A1: the enemy is in Desolation (from a Skill hit in the blessing, until it ends) */
  desolation: boolean
  a1Ready: number
  a4Stacks: number
  a4End: number
}

/**
 * Brings the points up to frame `t`: in the blessing, +1 every 30 frames from its start (gcsim's
 * timePassGenerateNSPoints ticks, 39, 69, … frames into the cast)
 */
function settle(s: KinichState, t: number) {
  if (s.blessingEnd === undefined) {
    s.pointsAt = Math.max(s.pointsAt, t)
    return
  }
  const until = Math.min(t, s.blessingEnd)
  const from = Math.max(s.pointsAt, s.buildFrom)
  if (until > from) {
    const ticks =
      Math.floor((until - s.buildFrom) / POINTS_TICK) -
      Math.floor((from - s.buildFrom) / POINTS_TICK)
    s.points = Math.min(POINTS_MAX, s.points + ticks)
  }
  s.pointsAt = Math.max(s.pointsAt, until)
}

/** The blessing's time limit: it ends (its points with it) when the time comes */
function kinichExit(c: SimContext, s: KinichState) {
  if (s.blessingEnd === undefined) return
  if (c.now < s.blessingEnd) {
    c.at(s.blessingEnd - c.now, (c2) => kinichExit(c2, s))
    return
  }
  settle(s, c.now)
  s.blessingEnd = undefined
  s.points = 0
  s.blindAt = undefined
  s.desolation = false
}

export const kit: KitModel = {
  characterKey: 'Kinich',
  element: 'dendro',
  source: `${GCSIM}/kinich`,
  nightsoul(ctx, state: KinichState) {
    const s = { ...state }
    settle(s, ctx.now)
    return {
      active: s.blessingEnd !== undefined && ctx.now < s.blessingEnd,
      points: s.points,
    }
  },
  onNightsoulBurst(ctx, s: KinichState) {
    s.a4Stacks = Math.min(2, (ctx.now < s.a4End ? s.a4Stacks : 0) + 1)
    s.a4End = ctx.now + 900
  },
  onHit(ctx, s: KinichState, hit) {
    const blessed = s.blessingEnd !== undefined && ctx.now < s.blessingEnd
    // A1: his Skill's hits (Loop Shots, the Cannon) in the blessing put the enemy in Desolation,
    // which lasts until this blessing ends
    if (
      hit.characterKey === 'Kinich' &&
      hit.tag === 'skill' &&
      !hit.path[0].startsWith('_') &&
      blessed
    )
      s.desolation = true
    // Burning or Burgeon DMG on a Desolation enemy restores 7 points (0.8 s ICD)
    if (
      ['reaction.burning', 'reaction.burgeon'].includes(hit.path.join('.')) &&
      s.desolation &&
      blessed &&
      ctx.now >= s.a1Ready
    ) {
      settle(s, ctx.now)
      s.points = Math.min(20, s.points + 7)
      s.a1Ready = ctx.now + 48
    }
  },
  init: (): KinichState => ({
    points: 0,
    pointsAt: 0,
    buildFrom: 0,
    shot: 0,
    c2FirstUsed: false,
    desolation: false,
    a1Ready: -1,
    a4Stacks: 0,
    a4End: -1,
  }),
  actionReadyAt(ctx, state: KinichState, action) {
    const s = { ...state }
    settle(s, ctx.now)
    return action.kind === 'skill' &&
      s.blessingEnd !== undefined &&
      ctx.now < s.blessingEnd &&
      s.points < POINTS_MAX
      ? ctx.now + 1
      : ctx.now
  },
  // In the blessing his normal attacks are Loop Shots and his E is the Scalespiker Cannon (their own
  // frames)
  variant(_ctx, s: KinichState, action) {
    if (s.blessingEnd === undefined) return undefined
    const mode = "Nightsoul's Blessing"
    return action.kind === 'normal'
      ? { key: 'nightsoul', label: 'Loop Shot', mode }
      : action.kind === 'skill'
        ? { key: 'nightsoul', label: 'Scalespiker Cannon', mode }
        : undefined
  },
  act(ctx, s: KinichState, action, previous) {
    const c = ctx.constellation('Kinich')
    switch (action.kind) {
      case 'normal': {
        if (s.blessingEnd !== undefined) {
          // Loop Shots: each one is a normal attack of the blessing (count = shots)
          let start = 0
          let last = s.shot
          for (let i = 0; i < (action.count ?? 1); i++) {
            const k = s.shot
            last = k
            const t = ctx.now + start
            settle(s, t)
            if (s.blindAt !== undefined && t >= s.blindAt) {
              s.points = Math.min(POINTS_MAX, s.points + BLIND_POINTS)
              s.blindAt = undefined
            }
            s.points = Math.min(POINTS_MAX, s.points + POINTS_PER_SHOT)
            for (const hitAt of LOOP_HITMARKS[k]) {
              ctx.hit(start + hitAt, {
                path: ['skill', 'shotDmg'],
                tag: 'skill',
                nightsoul: true,
                element: 'dendro',
                applies: true,
                icd: 'loopShot',
                icdGroup: 'KinichLoopShot',
                label: 'Loop Shot',
              })
              // C2: the enemy's Dendro RES -30% for 6 s after its hits (from the hit's callback,
              // so the hit itself does not benefit; an enemy debuff, paused by its hitlag)
              if (c >= 2)
                ctx.buff(
                  'Kinich',
                  ['Kinich', 'c2Hit'],
                  'on',
                  start + hitAt + 1,
                  6 * 60,
                  { hitlag: 'enemy' }
                )
            }
            s.shot = 1 - k
            if (i < (action.count ?? 1) - 1) start += LOOP_TO_LOOP
          }
          return {
            frames: start + LOOP_FRAMES,
            framesInto: Object.fromEntries(
              Object.entries({
                normal: LOOP_TO_LOOP,
                ...loopInto[last],
              }).map(([kind, v]) => [kind, start + v])
            ),
          }
        }
        return normalString(
          kinichNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              label: `N${i + 1}`,
            }),
          ctx
        )
      }
      case 'charged':
        // gcsim: no Charged Attack in the Nightsoul Blessing
        if (s.blessingEnd !== undefined)
          return {
            frames: 0,
            failed: 'Kinich: no Charged Attack in the Nightsoul Blessing',
          }
        // three hits (the sheet's charged node, x3)
        for (const hitAt of [71, 95, 119])
          ctx.hit(hitAt, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            label: 'Charged Attack',
          })
        return {
          frames: 87,
          framesInto: { dash: 71, jump: 71, swap: 71 },
        }
      case 'plunge':
        // gcsim has no plunge for Kinich (its low_plunge is not implemented): no damage here
        ctx.note('Kinich: plunge is not in gcsim, so no damage is modelled.')
        return { frames: 30 }
      case 'skill': {
        if (s.blessingEnd !== undefined) {
          // Scalespiker Cannon: needs the full points; a hold releases 17 frames in, a tap 35
          settle(s, ctx.now)
          if (s.points < POINTS_MAX)
            return {
              frames: 0,
              failed: `Kinich: Scalespiker Cannon needs ${POINTS_MAX} Nightsoul points (${Math.floor(s.points)} now)`,
            }
          const hold = !!action.hold
          const release = hold ? 17 : 35
          // the points are spent 1 frame after the release, then 12 frames of travel
          const hitAt = release + 1 + 12
          // A4 (Hunter's Experience, all stacks consumed) and C2 (the blessing's first Cannon:
          // +100% DMG) are fixed at the shot; the C6 bounce shares them (game text; gcsim's shared
          // snapshot)
          const first = c >= 2 && !s.c2FirstUsed
          if (first) s.c2FirstUsed = true
          const states = [
            {
              owner: 'Kinich' as const,
              path: ['Kinich', 'a4Stacks'],
              value: ctx.now < s.a4End ? `${s.a4Stacks}` : '',
            },
            {
              owner: 'Kinich' as const,
              path: ['Kinich', 'c2FirstHit'],
              value: first ? 'on' : '',
            },
          ]
          ctx.hit(hitAt, {
            path: ['skill', 'cannonDmg'],
            tag: 'skill',
            nightsoul: true,
            element: 'dendro',
            applies: true,
            icd: 'scalespikerCannon',
            icdGroup: 'KinichScalespikerCannon',
            label: hold ? 'Scalespiker Cannon (hold)' : 'Scalespiker Cannon',
            states,
          })
          s.a4Stacks = 0
          if (c >= 2)
            ctx.buff('Kinich', ['Kinich', 'c2Hit'], 'on', hitAt + 1, 6 * 60, {
              hitlag: 'enemy',
            })
          // C6: a bounce to another enemy, 50 frames after the cannon's hit
          if (c >= 6)
            ctx.hit(hitAt + 50, {
              path: ['constellation6', 'dmg'],
              tag: 'skill',
              nightsoul: true,
              element: 'dendro',
              applies: true,
              icd: 'scalespikerCannon',
              icdGroup: 'KinichScalespikerCannon',
              label: 'Scalespiker Cannon (C6)',
              states,
            })
          // the points are spent; the blind spot comes back 5 frames (tap) or 30 (hold) later
          s.points = 0
          s.pointsAt = ctx.now + release + 1
          s.blindAt = ctx.now + release + 1 + (hold ? 30 : 5)
          return hold
            ? {
                frames: 117,
                framesInto: {
                  normal: 41,
                  burst: 41,
                  dash: 49,
                  jump: 49,
                  swap: 82,
                  wait: 41,
                },
              }
            : {
                frames: 135,
                framesInto: {
                  normal: 59,
                  burst: 59,
                  dash: 67,
                  jump: 67,
                  swap: 100,
                  wait: 59,
                },
              }
        }
        // enter the Nightsoul Blessing (a hold is gcsim's shortest hold: the same as a tap)
        const now = ctx.now
        s.blessingEnd = now + BLESSING_START + BLESSING_DUR
        s.points = 0
        s.pointsAt = now + BLESSING_START
        s.buildFrom = now + BLESSING_START
        s.desolation = false
        // the blind spot appears 21 frames after the blessing starts
        s.blindAt = now + 30
        s.c2FirstUsed = false
        ctx.at(BLESSING_START + BLESSING_DUR, (c2) => kinichExit(c2, s))
        return {
          cooldown: { key: 'skill', frames: SKILL_CD, delay: BLESSING_START },
          frames: 42,
          framesInto: { normal: 29, burst: 27 },
        }
      }
      case 'burst': {
        // a burst in the blessing extends it
        if (s.blessingEnd !== undefined) s.blessingEnd += BURST_EXTEND
        // Hail to the Almighty Dragonlord: the blast at 161, then six Dragon Breath lasers from
        // 253 frames on, 145 or 150 frames apart (the average, 147.5, is used)
        ctx.hit(161, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          nightsoul: true,
          element: 'dendro',
          applies: true,
          icd: 'burst',
          label: 'Hail to the Almighty Dragonlord',
        })
        for (let k = 0; k < 6; k++)
          ctx.hit(253 + Math.round(147.5 * k), {
            path: ['burst', 'laserDmg'],
            tag: 'burst',
            nightsoul: true,
            element: 'dendro',
            applies: true,
            icd: 'burst',
            label: 'Dragon Breath',
          })
        return {
          cooldown: { key: 'burst', frames: 18 * 60, delay: 1 },
          frames: 126,
          framesInto: { normal: 125, dash: 124 },
        }
      }
      case 'dash':
        // the template's dash (boy body)
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // the template's jump: longer right after a dash
        return templateJump('boy', 'claymore', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // the Scalespiker Cannon (in the blessing) has no cooldown: the Skill's is set when it enters
  cooldownKey: (s: KinichState, action) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && s.blessingEnd === undefined
        ? 'skill'
        : undefined,
  onSwapOut(_ctx, s: KinichState) {
    // the blessing ends when Kinich leaves the field (and with it, A1's Desolation)
    s.blessingEnd = undefined
    s.points = 0
    s.blindAt = undefined
    s.desolation = false
  },
}
