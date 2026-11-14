import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/chiori, main as of 2026-11-10. */

/** Normal attack string (gcsim attack.go): the cancels are its frame tables */
const chioriNormals: NormalHit[] = [
  {
    hitmarks: [17],
    hitlag: [6],
    toNormal: 19,
    toCharged: 22,
    toAbil: 17,
    frames: 22,
  },
  {
    hitmarks: [16],
    hitlag: [6],
    toNormal: 22,
    toCharged: 33,
    toAbil: 16,
    frames: 33,
  },
  {
    hitmarks: [24, 32],
    hitlag: [8, 0],
    worldTimeHits: true,
    toNormal: 41,
    toCharged: 42,
    toAbil: 32,
    frames: 42,
  },
  {
    hitmarks: [37],
    hitlag: [4],
    toNormal: 59,
    toCharged: 59,
    toAbil: 37,
    frames: 59,
  },
]

type Hit = Parameters<SimContext['hit']>[1]

/** Tamoto lasts 17.5 s and slashes every 3.6 s (each slash lands 5 frames after its tick) */
const TAMOTO_LIFE = 1050
const TAMOTO_INTERVAL = 216
/** A Kinu appears, then its attack lands 36 + 5 frames later */
const KINU_DELAY = 41
/** A1's Geo infusion (Tailoring) and Seize the Moment (Tapestry) */
const INFUSION = 300
const SEIZE = 480

interface ChioriState {
  /** Fluttering Hasode's A1 window (Tapestry or Tailoring still to come): its token while open */
  window?: number
  windowSeq: number
  /** Tailoring's Geo infusion lasts until this frame */
  infuseUntil: number
  /** Seize the Moment (Tapestry) lasts until this frame; its coordinated attacks so far, the next one's ICD */
  seizeUntil: number
  seizeCount: number
  seizeIcd: number
  /** C4: the team's Kinu window lasts until this frame (its count and ICD), then a 15 s lockout */
  c4Until: number
  c4Count: number
  c4Icd: number
  c4Lockout: number
  /** A hold Elemental Skill was the last action: a low plunge may follow */
  holdArmed: boolean
  /** Tamoto, the additional (construct) Tamoto and its construct checker: a newer one replaces
   * the older (gcsim kills the old ticker); the additional one's end */
  dollToken: number
  rockToken: number
  rockEnd: number
  checkToken: number
  /** A4: the Geo constructs counted at the last check (a rise is a new construct) */
  constructs: number
}

/** Fluttering Hasode's Geo hits: the sweep, Tamoto, Kinu and the coordinated attack share ICD group ChioriSkill */
const skillHit = (path: string[], label: string): Hit => ({
  path,
  tag: 'skill',
  element: 'geo',
  applies: true,
  durability: 25,
  icd: 'ChioriSkill',
  label,
})

/**
 * A Tamoto spawned now: its first slash `first` frames later, then every 3.6 s while it lasts
 * (17.5 s), as long as `alive` (a newer one of its kind has not replaced it)
 */
function tamoto(
  ctx: SimContext,
  first: number,
  label: string,
  alive: () => boolean
) {
  const end = ctx.now + TAMOTO_LIFE
  const tick = (c: SimContext) => {
    if (!alive() || c.now >= end) return
    c.hit(5, skillHit(['skill', 'turretDmg'], label))
    c.at(TAMOTO_INTERVAL, tick)
  }
  ctx.at(first, tick)
}

/** The additional Tamoto (a Geo construct nearby, or C1): it replaces an older one */
function rockDoll(ctx: SimContext, s: ChioriState, label: string) {
  const token = ++s.rockToken
  s.rockEnd = ctx.now + TAMOTO_LIFE
  tamoto(ctx, 72, label, () => s.rockToken === token)
}

/** A4: Geo DMG +20% for 20 s (Chiori's clock) */
const a4Buff = (ctx: SimContext) =>
  ctx.buff('Chiori', ['Chiori', 'a4Construct'], 'on', 0, 1201, {
    hitlag: 'recipient',
  })

/** C4: after an A1 trigger the team's NA/CA/plunge hits (of the active character) summon Kinu for 8 s, at most once per 15 s */
function c4Activate(ctx: SimContext, s: ChioriState) {
  if (ctx.constellation('Chiori') < 4 || ctx.now < s.c4Lockout) return
  s.c4Lockout = ctx.now + 900
  s.c4Until = ctx.now + 480
  s.c4Count = 0
  s.c4Icd = -1e9
}

/** C6: an A1 trigger (Tapestry or Tailoring) cuts Fluttering Hasode's cooldown by 12 s */
function c6Cut(ctx: SimContext) {
  if (ctx.constellation('Chiori') >= 6)
    ctx.reduceCooldown('skill', 720, 'Chiori')
}

/** A1 Tailoring: the Geo infusion for 5 s (and C4's window, C6's cut) */
function tailoring(ctx: SimContext, s: ChioriState) {
  s.infuseUntil = ctx.now + INFUSION
  // (gcsim's weapon infusion: 5 s on Chiori's clock)
  ctx.infuse('geo', 0, INFUSION + 1, 'Chiori')
  ctx.buff('Chiori', ['Chiori', 'a1Infusion'], 'on', 0, INFUSION + 1, {
    hitlag: 'recipient',
  })
  c4Activate(ctx, s)
  c6Cut(ctx)
}

/** An action that starts the A1 Tailoring (a normal attack or plunge in the window) */
function tryTailoring(ctx: SimContext, s: ChioriState) {
  if (s.window === undefined) return
  s.window = undefined
  tailoring(ctx, s)
}

export const kit: KitModel = {
  characterKey: 'Chiori',
  element: 'geo',
  source: `${GCSIM}/chiori`,
  init: (): ChioriState => ({
    windowSeq: 0,
    infuseUntil: -1,
    seizeUntil: -1,
    seizeCount: 0,
    seizeIcd: -1e9,
    c4Until: -1,
    c4Count: 0,
    c4Icd: -1e9,
    c4Lockout: -1,
    holdArmed: false,
    dollToken: 0,
    rockToken: 0,
    rockEnd: -1,
    checkToken: 0,
    constructs: 0,
  }),
  onStart(ctx, s: ChioriState) {
    // A4: a party member creating a Geo construct (a rise in the count, checked every 10 frames)
    const poll = (c: SimContext) => {
      if (c.constructs > s.constructs) a4Buff(c)
      s.constructs = c.constructs
      c.at(10, poll)
    }
    ctx.at(0, poll)
  },
  act(ctx, s: ChioriState, action, previous) {
    const armed = s.holdArmed
    s.holdArmed = false
    const c = ctx.constellation('Chiori')
    switch (action.kind) {
      case 'normal': {
        tryTailoring(ctx, s)
        const r = normalString(
          chioriNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${j ? ' (2nd hit)' : ''}`,
            }),
          ctx
        )
        // (C6's +235% DEF on normal attacks is a premod in the sheet, not a hit)
        return r
      }
      case 'charged': {
        const hits = [25, 26]
        hits.forEach((d, j) =>
          ctx.hit(d, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'normal',
            label: j ? 'Charged Attack (2nd hit)' : 'Charged Attack',
          })
        )
        return {
          frames: 44,
          framesInto: {
            normal: 39,
            skill: 39,
            burst: 39,
            dash: 26,
            jump: 26,
            swap: 26,
          },
        }
      }
      case 'plunge': {
        // gcsim has only the low plunge, and only right after a hold Elemental Skill
        if (!armed) {
          ctx.note(
            'Chiori: a plunge is only modelled as the low plunge after a hold Elemental Skill (gcsim); not modelled here'
          )
          return { frames: 30 }
        }
        tryTailoring(ctx, s)
        ctx.hit(41, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 69,
          framesInto: { normal: 54, skill: 53, burst: 54, dash: 44, swap: 56 },
        }
      }
      case 'skill': {
        if (s.window !== undefined) {
          // The second press in the window is Tapestry: Seize the Moment (8 s). Its forced swap is the rotation's
          s.window = undefined
          s.seizeUntil = ctx.now + SEIZE
          s.seizeCount = 0
          s.seizeIcd = -1e9
          c4Activate(ctx, s)
          c6Cut(ctx)
          // (gcsim's default swap delay: 1 frame)
          return {
            frames: 1,
            forcedSwap:
              ctx.members[
                (ctx.members.indexOf('Chiori') + 1) % ctx.members.length
              ],
          }
        }
        const hold = !!action.hold
        const spawn = hold ? 34 : 19
        const a1 = hold
          ? { start: 42, duration: 77 }
          : { start: 26, duration: 78 }
        s.holdArmed = hold
        ctx.hit(
          hold ? 37 : 21,
          skillHit(['skill', 'sweepDmg'], 'Fluttering Hasode (upward sweep)')
        )
        // Tamoto (a recast replaces it); with C1 and another Geo member, the additional Tamoto
        // and A4 at once; otherwise a check every 0.5 s while it lasts for a Geo construct (any
        // construct, and no additional Tamoto alive) that summons the additional one
        ctx.at(spawn, (c2) => {
          const token = ++s.dollToken
          tamoto(c2, 36, 'Tamoto', () => s.dollToken === token)
          const check = ++s.checkToken
          if (c >= 1 && c2.partyCount('geo') >= 2) {
            rockDoll(c2, s, 'Tamoto (C1)')
            a4Buff(c2)
            return
          }
          const end = c2.now + TAMOTO_LIFE
          const look = (c3: SimContext) => {
            if (s.checkToken !== check || c3.now >= end) return
            if (c3.now >= s.rockEnd && c3.constructs > 0) {
              rockDoll(c3, s, 'Tamoto (construct)')
              return
            }
            c3.at(30, look)
          }
          look(c2)
        })
        // A1's window: a normal attack or plunge makes Tailoring, a second press makes Tapestry; if neither, Tailoring at its end
        s.windowSeq++
        const token = s.windowSeq
        s.window = token
        ctx.at(a1.start + a1.duration - 1, (c2) => {
          if (s.window !== token) return
          s.window = undefined
          // the default Tailoring only "when on the field" (gcsim triggers it off the field too)
          if (c2.onField === 'Chiori') tailoring(c2, s)
        })
        const cooldown = { key: 'skill', frames: 960, delay: spawn }
        return hold
          ? {
              cooldown,
              frames: 88,
              framesInto: { skill: 44, plunge: 52, swap: 87 },
            }
          : {
              cooldown,
              frames: 51,
              framesInto: {
                normal: 42,
                skill: 30,
                burst: 43,
                dash: 42,
                jump: 42,
                swap: 49,
              },
            }
      }
      case 'burst': {
        ctx.hit(92, {
          path: ['burst', 'bloomDmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Hiyoku: Twin Blades',
        })
        if (c >= 2) {
          // C2: a Kinu every 3 s for 10 s from frame 91 (the first at 3 s after it)
          for (const k of [180, 360, 540])
            ctx.hit(91 + k + KINU_DELAY, {
              path: ['constellation2', 'dollDmg'],
              tag: 'skill',
              element: 'geo',
              applies: true,
              durability: 25,
              icd: 'ChioriSkill',
              label: 'Kinu (C2)',
            })
        }
        return {
          cooldown: { key: 'burst', frames: 810 },
          frames: 101,
          framesInto: { skill: 100, dash: 100, swap: 99 },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // Tapestry (the second press in the window) has no cooldown
  cooldownKey: (s: ChioriState, action) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill' && s.window === undefined
        ? 'skill'
        : undefined,
  onHit(ctx, s: ChioriState, hit) {
    if (hit.characterKey !== hit.onField) return
    if (hit.tag !== 'normal' && hit.tag !== 'charged' && hit.tag !== 'plunge')
      return
    // Seize the Moment: the active character's hits make a coordinated attack 1 frame later (2 per 8 s, 2 s ICD)
    if (hit.t < s.seizeUntil && s.seizeCount < 2 && hit.t >= s.seizeIcd) {
      s.seizeIcd = hit.t + 120
      s.seizeCount++
      if (s.seizeCount >= 2) s.seizeUntil = hit.t
      ctx.hit(1, {
        ...skillHit(
          ['passive1', 'dollDmg'],
          'Seize the Moment (coordinated attack)'
        ),
        characterKey: 'Chiori',
      })
    }
    // C4: the same hits summon a Kinu (up to 3, 1 s ICD)
    if (hit.t < s.c4Until && s.c4Count < 3 && hit.t >= s.c4Icd) {
      s.c4Icd = hit.t + 60
      s.c4Count++
      if (s.c4Count >= 3) s.c4Until = hit.t
      ctx.hit(KINU_DELAY, {
        ...skillHit(['constellation2', 'dollDmg'], 'Kinu (C4)'),
        characterKey: 'Chiori',
      })
    }
  },
  onSwapOut(_ctx, s: ChioriState) {
    s.holdArmed = false
  },
}
