import type { KitModel } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/flins, main as of 2026-11-10. */

const flinsNormals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [5],
    toNormal: 14,
    toCharged: 25,
    toAbil: 11,
    frames: 31,
  },
  {
    hitmarks: [11],
    hitlag: [5],
    toNormal: 16,
    toCharged: 27,
    toAbil: 11,
    frames: 31,
  },
  {
    hitmarks: [16],
    hitlag: [6],
    toNormal: 23,
    toCharged: 25,
    toAbil: 16,
    frames: 45,
  },
  { hitmarks: [20, 29], toNormal: 40, toCharged: 67, toAbil: 29, frames: 67 },
  {
    hitmarks: [29],
    hitlag: [8],
    toNormal: 68,
    toCharged: 68,
    toAbil: 29,
    frames: 68,
  },
]

interface FlinsState {
  /** Manifest Flame (E) is up until flameEnd (cleared by a callback at its end, or on swap out) */
  flame: boolean
  flameEnd: number
  /** Thunderous Symphony (6 s after Northland Spearstorm): the next Q is the symphony */
  symphony: boolean
  symphonyEnd: number
  /** C2 (The Devil's Wall): armed by Northland Spearstorm, spent by the first flame normal hit */
  c2Armed: boolean
  c2Until: number
  /** C2 (Moonsign: Ascendant Gleam): the enemy's Electro RES shred lasts until this frame */
  c2ShredUntil: number
  /** A Lunar-Charged reaction's thundercloud is up until this frame (gcsim's LcKey status) */
  lcUntil: number
  plungeNoted: boolean
}

/** gcsim's Lunar-Charged thundercloud lasts this long after the last trigger (reactions.ts) */
const LC_FRAMES = 330
/** C2's Electro RES shred lasts 7 s */
const C2_SHRED = 7 * 60

export const kit: KitModel = {
  characterKey: 'Flins',
  moonsign: 1,
  element: 'electro',
  source: `${GCSIM}/flins`,
  init: (): FlinsState => ({
    flame: false,
    flameEnd: -1,
    symphony: false,
    symphonyEnd: -1,
    c2Armed: false,
    c2Until: -1,
    c2ShredUntil: -1,
    lcUntil: -1,
    plungeNoted: false,
  }),
  // In Manifest Flame his E is Northland Spearstorm, and after it his Q is Thunderous Symphony,
  // each with frames of its own (his normal and charged attacks keep theirs)
  variant(_ctx, s: FlinsState, action) {
    if (action.kind === 'skill' && s.flame)
      return {
        key: 'manifestFlame',
        label: 'Northland Spearstorm',
        mode: 'Manifest Flame',
      }
    if (action.kind === 'burst' && s.symphony)
      return { key: 'symphony', label: 'Thunderous Symphony' }
    return undefined
  },
  act(ctx, s: FlinsState, action, previous) {
    const c = ctx.constellation('Flins')
    switch (action.kind) {
      case 'normal':
        if (!s.flame)
          return normalString(
            flinsNormals,
            action.count ?? 1,
            (i, d) =>
              ctx.hit(d, {
                path: ['normal', `${i}`],
                tag: 'normal',
                element: 'physical',
                applies: true,
                icd: 'normal',
                label: `N${i + 1}`,
              }),
            ctx
          )
        // Manifest Flame: the normal attacks are Electro, with their own damage table
        return normalString(
          flinsNormals,
          action.count ?? 1,
          (i, d) => {
            ctx.hit(d, {
              path: ['skill', `na${i + 1}`],
              tag: 'normal',
              element: 'electro',
              applies: true,
              icd: 'normal',
              label: `N${i + 1} (Manifest Flame)`,
            })
            // C2: the next flame normal hit (any in the string) within 6 s of Northland
            // Spearstorm adds a Lunar-Charged hit 20 frames later
            if (c >= 2)
              ctx.at(d, (c2) => {
                if (!s.c2Armed || c2.now >= s.c2Until) return
                s.c2Armed = false
                c2.hit(20, {
                  path: ['constellation2', 'dmg'],
                  tag: 'other',
                  element: 'electro',
                  label: "The Devil's Wall (C2, Lunar-Charged)",
                })
              })
          },
          ctx
        )
      case 'charged':
        if (s.flame)
          ctx.hit(28, {
            path: ['skill', 'ca'],
            tag: 'charged',
            element: 'electro',
            applies: true,
            icd: 'none',
            label: 'Charged Attack (Manifest Flame)',
          })
        else
          ctx.hit(28, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'none',
            label: 'Charged Attack',
          })
        return {
          frames: 60,
          framesInto: { skill: 28, burst: 28, dash: 28, jump: 28, swap: 43 },
        }
      case 'skill': {
        if (s.flame) {
          // Northland Spearstorm: its own 6 s cooldown (4 s at C1), then Thunderous Symphony
          ctx.hit(23, {
            path: ['skill', 'spearDmg'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            icd: 'none',
            label: 'Northland Spearstorm',
          })
          s.symphony = true
          s.symphonyEnd = ctx.now + 360
          ctx.atCharacter('Flins', 360, (c2) => {
            if (c2.now >= s.symphonyEnd) s.symphony = false
          })
          if (c >= 2) {
            s.c2Armed = true
            s.c2Until = ctx.now + 360
          }
          return {
            cooldown: { key: 'spearstorm', frames: c >= 1 ? 240 : 360 },
            frames: 42,
            framesInto: { normal: 28, burst: 28, dash: 26, jump: 26 },
          }
        }
        // Starts Manifest Flame (10 s). gcsim's first hit (Arcane Light) deals no damage: not modelled.
        s.flame = true
        s.flameEnd = ctx.now + 619
        ctx.atCharacter('Flins', 619, (c2) => {
          if (c2.now >= s.flameEnd) s.flame = false
        })
        return {
          cooldown: { key: 'skill', frames: 960, delay: 19 },
          frames: 44,
          framesInto: {
            normal: 19,
            skill: 22,
            burst: 19,
            dash: 17,
            jump: 18,
            swap: 17,
          },
        }
      }
      case 'burst': {
        if (s.symphony) {
          s.symphony = false
          ctx.hit(44, {
            path: ['burst', 'thunderDmg'],
            tag: 'other',
            element: 'electro',
            label: 'Thunderous Symphony (Lunar-Charged)',
          })
          // Moonsign 2: an additional hit if a Lunar-Charged thundercloud is up at the cast
          if (ctx.moonsign >= 2 && ctx.now < s.lcUntil)
            ctx.hit(62, {
              path: ['burst', 'thunderAddlDmg'],
              tag: 'other',
              element: 'electro',
              label: 'Thunderous Symphony (additional)',
            })
          // the symphony has no cooldown
          return {
            frames: 81,
            framesInto: { normal: 53, skill: 53, dash: 51, jump: 50 },
          }
        }
        ctx.hit(93, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Cometh the Night (initial)',
        })
        // Lunar-Charged hits (no durability, so no Electro application); 4 middle hits at Moonsign 2
        const middle = ctx.moonsign >= 2 ? [17, 26, 35, 44] : [17, 26]
        for (const m of middle)
          ctx.hit(93 + m, {
            path: ['burst', 'middleLunarDmg'],
            tag: 'other',
            element: 'electro',
            label: 'Cometh the Night (middle, Lunar-Charged)',
          })
        ctx.hit(93 + 71, {
          path: ['burst', 'finalLunarDmg'],
          tag: 'other',
          element: 'electro',
          label: 'Cometh the Night (final, Lunar-Charged)',
        })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 130,
          framesInto: {
            normal: 102,
            skill: 103,
            dash: 103,
            jump: 103,
            swap: 91,
          },
        }
      }
      case 'plunge':
        // gcsim has no plunging attack for Flins: not modelled
        if (!s.plungeNoted) {
          s.plungeNoted = true
          ctx.note(
            'Flins: plunging attack not modelled (gcsim has none for Flins).'
          )
        }
        return { frames: 30 }
      case 'dash':
        // a Male's dash (gcsim's template by body type)
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('male', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // While Manifest Flame is up, E is Northland Spearstorm (its own cooldown); the symphony has none
  cooldownKey(s: FlinsState, action) {
    if (action.kind === 'skill') return s.flame ? 'spearstorm' : 'skill'
    if (action.kind === 'burst') return s.symphony ? undefined : 'burst'
    return undefined
  },
  onHit(ctx, s: FlinsState, hit) {
    if (hit.path[0] === '_reaction') {
      // any member's Lunar-Charged reaction keeps the thundercloud up
      if (hit.path[1] === 'lunarCharged') s.lcUntil = hit.t + LC_FRAMES
      return
    }
    // C2 (Moonsign: Ascendant Gleam): while Flins is on the field, his Electro DMG shreds the
    // enemy's Electro RES by 25% for 7 s (the sheet's condition)
    if (
      hit.characterKey !== 'Flins' ||
      hit.element !== 'electro' ||
      hit.path[0].startsWith('_') ||
      hit.onField !== 'Flins' ||
      ctx.constellation('Flins') < 2 ||
      ctx.moonsign < 2
    )
      return
    // (from the next frame: the hit that applies it does not get it)
    const from = Math.max(hit.t + 1, s.c2ShredUntil)
    const until = hit.t + 1 + C2_SHRED
    if (until > from)
      ctx.buff(
        'Flins',
        ['Flins', 'c2AfterElectro'],
        'on',
        from - hit.t,
        until - from
      )
    s.c2ShredUntil = Math.max(s.c2ShredUntil, until)
  },
  onSwapOut(_ctx, s: FlinsState) {
    s.flame = false
    s.symphony = false
  },
  onHitlag(ctx, s: FlinsState, frames) {
    if (s.flame && ctx.now < s.flameEnd) s.flameEnd += frames
    if (s.symphony && ctx.now < s.symphonyEnd) s.symphonyEnd += frames
    if (s.c2Armed && ctx.now < s.c2Until) s.c2Until += frames
  },
}
