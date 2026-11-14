import type { KitModel, SimContext } from '../types'
import {
  annulusHitChance,
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/emilie, main as of 2026-11-10. */

const emilieNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [8],
    toNormal: 20,
    toCharged: 20,
    toAbil: 11,
    frames: 28,
  },
  {
    hitmarks: [16],
    hitlag: [8],
    toNormal: 19,
    toCharged: 22,
    toAbil: 16,
    frames: 32,
  },
  {
    hitmarks: [33],
    hitlag: [8],
    toNormal: 40,
    toCharged: 46,
    toAbil: 33,
    frames: 49,
  },
  {
    hitmarks: [34],
    hitlag: [9],
    toNormal: 70,
    toCharged: 71,
    toAbil: 34,
    frames: 71,
  },
]

interface EmilieState {
  /** Lumidouce Case generation: a new case stops the ticks of the one before */
  level: number
  scents: number
  scentReady: number
  scentReset: number
  prevLevel: number
  gen: number
  /** The Lumidouce Case lasts until this frame */
  caseEnd: number
  /** The Level 3 Lumidouce (burst) lasts until this frame */
  lvl3End: number
  /** Spiritbreath Thorn is ready from this frame */
  thornReady: number
  /** C6: its window ends at this frame, with this many Normal / Charged Attacks left in it */
  c6End: number
  c6Left: number
  /** C6: its 12 s internal cooldown ends at this frame */
  c6IcdEnd: number
  burstMarkedUntil: number
  collateralCredit: number
  /** C1's extra Scent: its 2.9 s ICD ends (frame) */
  c1Ready: number
  /** The burst's current enemy mark */
  markId: number
}

/** C2: the enemy's Dendro RES -30% for 10 s (an enemy modifier, active on its expiry frame) */
const c2Shred = (ctx: SimContext, delay: number) => {
  if (ctx.constellation('Emilie') >= 2)
    ctx.buff('Emilie', ['Emilie', 'c2Hit'], 'on', delay, 601, {
      hitlag: 'enemy',
    })
}

/** Native places missed targeted shots in the annulus around the case, 2.1 m ahead. */
export function emilieCollateralChance(targetRadius: number, distance: number) {
  return annulusHitChance(targetRadius, distance - 2.1, 0.5, 12, 2.5)
}

/** C6: whether an attack created at frame `t` is covered by the window (and uses one of its 4) */
function c6Covers(s: EmilieState, t: number): boolean {
  if (t >= s.c6End || s.c6Left <= 0) return false
  s.c6Left--
  return true
}

/** C6: Fragrance Extraction or Aromatic Explication opens the window (5 s, 4 attacks, 12 s ICD) */
function c6Trigger(ctx: SimContext, s: EmilieState) {
  if (ctx.constellation('Emilie') < 6 || ctx.now < s.c6IcdEnd) return
  s.c6End = ctx.now + 300
  s.c6Left = 4
  s.c6IcdEnd = ctx.now + 720
}

/**
 * A Lumidouce Case (Level 1) from now for `duration` frames: a tick every 1.5 s, each hit 5 frames
 * after its tick (the case's travel time)
 */
function spawnCase(
  ctx: SimContext,
  s: EmilieState,
  duration: number,
  level = 1,
  afterBurst = false
) {
  const gen = ++s.gen
  s.caseEnd = ctx.now + duration
  s.level = level
  if (!afterBurst) {
    s.scents = 0
    s.scentReset = ctx.now + 480
  }
  const collect = (c: SimContext) => {
    if (gen !== s.gen || c.now > s.caseEnd) return
    if (c.now > s.scentReset && s.level > 1) {
      s.level = 1
      s.scents = 0
    }
    if (s.scents >= 2) {
      s.scents -= 2
      if (s.level < 2) s.level++
      else
        c.hit(18, {
          path: ['passive1', 'dmg'],
          tag: 'other',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Cleardew Cologne (A1)',
        })
      c2Shred(c, 18)
    }
  }
  const scent = (c: SimContext) => {
    if (gen !== s.gen || c.now > s.caseEnd) return
    // (native statuses are active on their expiry frame: the 0.5 s check after the 2 s cooldown
    // still sees it, so scents come every 2.5 s)
    if (c.isBurning && c.now > s.scentReady) {
      s.scents += 1
      s.scentReady = c.now + 120
      s.scentReset = c.now + 480
    }
    collect(c)
    c.atCharacter('Emilie', 30, scent)
  }
  // (the case's attacks, scents and collection are character tasks: Emilie's hitlag delays them)
  const tick = (c: SimContext) => {
    if (gen !== s.gen || c.now > s.caseEnd) return
    for (const delay of s.level === 2 ? [5, 23] : [5])
      c.hit(delay, {
        path: ['skill', s.level === 2 ? 'level2Dmg' : 'level1Dmg'],
        tag: 'skill',
        element: 'dendro',
        applies: true,
        icd: 'EmilieLumidouce',
        icdGroup: 'EmilieLumidouce',
        label: `Lumidouce Case (Level ${s.level})`,
      })
    collect(c)
    c.atCharacter('Emilie', 90, tick)
  }
  ctx.atCharacter('Emilie', 30, scent)
  ctx.atCharacter('Emilie', 90, tick)
}

export const kit: KitModel = {
  characterKey: 'Emilie',
  element: 'dendro',
  source: `${GCSIM}/emilie`,
  init: (): EmilieState => ({
    gen: 0,
    level: 1,
    scents: 0,
    scentReady: -1,
    scentReset: -1,
    prevLevel: 1,
    caseEnd: -1e9,
    lvl3End: -1e9,
    thornReady: -1e9,
    c6End: -1e9,
    c6Left: 0,
    c6IcdEnd: -1e9,
    burstMarkedUntil: -1,
    collateralCredit: 0,
    c1Ready: -1,
    markId: 0,
  }),
  // her hitlag extends the case's hitlag-affected statuses (gcsim's AddStatus(…, true))
  onHitlag(ctx, s: EmilieState, frames) {
    if (frames <= 0) return
    if (ctx.now <= s.caseEnd) s.caseEnd += frames
    if (ctx.now < s.lvl3End) s.lvl3End += frames
    if (ctx.now <= s.scentReset) s.scentReset += frames
    if (ctx.now <= s.scentReady) s.scentReady += frames
  },
  onHit(ctx, s: EmilieState, hit) {
    // C1: a member triggers Burning, or deals Dendro DMG to a Burning enemy: an extra Scent (2.9 s
    // ICD, a hitlag-affected status on Emilie)
    if (
      ctx.constellation('Emilie') >= 1 &&
      ctx.now >= s.c1Ready &&
      ((hit.path[0] === '_reaction' && hit.path[1] === 'burning') ||
        (!hit.path[0].startsWith('_') &&
          hit.path[0] !== 'reaction' &&
          hit.element === 'dendro' &&
          ctx.isBurning))
    ) {
      s.c1Ready = ctx.now + 175
      s.scents++
    }
    if (hit.characterKey !== 'Emilie' || hit.path[0].startsWith('_')) return
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Emilie',
        path: ['Emilie', 'a4Burning'],
        value: ctx.isBurning ? 'on' : '',
      },
    ]
  },
  act(ctx, s: EmilieState, action, previous) {
    const c = ctx.constellation('Emilie')
    switch (action.kind) {
      case 'normal':
        return normalString(
          emilieNormals,
          action.count ?? 1,
          (i, d) => {
            // C6: the attack is created at its hit's start (the Normal Attack before it)
            const start = d - emilieNormals[i].hitmarks[0]
            const covered = c6Covers(s, ctx.now + start)
            if (covered) {
              ctx.buff('Emilie', ['Emilie', 'c6Fragrance'], 'on', d, 1)
              // its hit generates a Scent
              ctx.at(d, () => {
                s.scents++
              })
            }
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: covered ? 'dendro' : 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
          },
          ctx
        )
      case 'charged': {
        // C6: a Charged Attack created in the window is Dendro (and uses one of its 4)
        const covered = c6Covers(s, ctx.now)
        if (covered) {
          ctx.buff('Emilie', ['Emilie', 'c6Fragrance'], 'on', 26, 1)
          ctx.at(26, () => {
            s.scents++
          })
        }
        ctx.hit(26, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: covered ? 'dendro' : 'physical',
          applies: true,
          icd: 'ExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 50,
          framesInto: { normal: 39, skill: 42, burst: 39, swap: 47 },
        }
      }
      case 'skill': {
        // Fragrance Extraction: the summon's hit
        ctx.hit(37, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Fragrance Extraction',
        })
        // C2: Fragrance Extraction's hit (the text names it, Aromatic Explication and Cleardew
        // Cologne; gcsim also gives it to the Spiritbreath Thorn)
        c2Shred(ctx, 37)
        // the Lumidouce Case appears 16 frames in (not while a Level 3 one is up: that one only
        // refreshes its timer); C6's window opens with it
        ctx.at(16, (c2) => {
          if (c2.now >= s.lvl3End) spawnCase(c2, s, 1320)
          c6Trigger(c2, s)
        })
        // Spiritbreath Thorn: 10 s apart, its hit 62 frames in
        if (ctx.now >= s.thornReady) {
          s.thornReady = ctx.now + 600
          ctx.hit(62, {
            path: ['skill', 'thornDmg'],
            tag: 'skill',
            element: 'dendro',
            applies: false,
            icd: 'none',
            label: 'Spiritbreath Thorn',
          })
        }
        return {
          cooldown: { key: 'skill', frames: 840 },
          frames: 37,
          framesInto: { normal: 28, burst: 24, dash: 23, jump: 24, swap: 34 },
        }
      }
      case 'burst': {
        // C4: +2 s
        const ext = c >= 4 ? 120 : 0
        // Aromatic Explication: a Level 3 Lumidouce Case from frame 96 (2.8 s), a tick every
        // 0.3 s, each hit 12 frames after its tick
        ctx.atCharacter('Emilie', 96, (c2) => {
          c6Trigger(c2, s)
          s.prevLevel = s.level
          const gen = ++s.gen
          s.lvl3End = c2.now + 168 + ext
          s.caseEnd = s.lvl3End
          const tick = (c3: SimContext) => {
            if (gen !== s.gen || c3.now >= s.lvl3End) return
            // the enemy's 0.7 s mark (0.4 s at C4) is an enemy status: its hitlag extends it, and it
            // is active on its expiry frame
            const targeted = c3.now >= s.burstMarkedUntil
            if (targeted) {
              const mark = ++s.markId
              s.burstMarkedUntil = Number.POSITIVE_INFINITY
              c3.atEnemy((c >= 4 ? 24 : 42) + 1, (c4) => {
                if (mark === s.markId) s.burstMarkedUntil = c4.now
              })
            } else
              s.collateralCredit += emilieCollateralChance(
                c3.target.radius,
                c3.target.distance
              )
            const collateral = !targeted && s.collateralCredit >= 1
            if (collateral) s.collateralCredit--
            if (targeted || collateral)
              c3.hit(12, {
                path: ['burst', 'level3Dmg'],
                tag: 'burst',
                element: 'dendro',
                applies: true,
                icd: 'burst',
                label: 'Lumidouce Case (Level 3)',
              })
            if (targeted || collateral) c2Shred(c3, 12)
            c3.atCharacter('Emilie', 18, tick)
          }
          c2.atCharacter('Emilie', 18, tick)
        })
        // after the burst, a Level 1 case again (frame 306, or 426 with C4)
        ctx.atCharacter('Emilie', 306 + ext, (c2) =>
          spawnCase(c2, s, 1320, s.prevLevel, true)
        )
        ctx.note(
          'Emilie: burst targeting respects the 0.7 s target mark. Collateral shots accumulate the native annulus hit probability for reproducible single-target timing; this is not an exact random trial.'
        )
        return {
          cooldown: { key: 'burst', frames: 810 },
          frames: 111,
          framesInto: { normal: 108, dash: 97, jump: 98, swap: 105 },
        }
      }
      case 'plunge':
        ctx.note(
          'Emilie: a plunging attack is modelled as the low plunge (no collision)'
        )
        ctx.hit(47, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 78,
          framesInto: { normal: 61, skill: 60, burst: 60, dash: 76, swap: 73 },
        }
      // template dash (Girl body)
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      // template jump (Girl body): 34 frames after a dash, else 31
      case 'jump':
        return templateJump('girl', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
