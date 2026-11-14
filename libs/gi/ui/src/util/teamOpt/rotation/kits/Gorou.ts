import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/gorou, main as of 2026-11-10. */

/**
 * Normal attack string (gcsim attack.go): the arrows land 10 frames (travel) after their hitmark;
 * the cancels use the hitmark. Its aim cancel (toCharged) is the hitmark too.
 */
const gorouNormals: NormalHit[] = [
  { hitmarks: [27], toNormal: 21, toCharged: 17, toAbil: 17, frames: 21 },
  { hitmarks: [22], toNormal: 26, toCharged: 12, toAbil: 12, frames: 26 },
  { hitmarks: [37], toNormal: 43, toCharged: 27, toAbil: 27, frames: 43 },
  { hitmarks: [41], toNormal: 55, toCharged: 31, toAbil: 31, frames: 55 },
]

interface GorouState {
  /** General's Glory (Juuga's field) lasts until this frame: no War Banner then */
  gloryEnd: number
  gloryToken: number
  /** The War Banner lasts until this frame */
  bannerEnd: number
  /** The field whose ticks are current (a newer field replaces the older one's ticks) */
  fieldToken: number
  /** C1: its 10 s cooldown */
  c1Ready: number
  /** C2: seconds of extension so far (3 at most) and its 0.1 s ICD */
  c2Ext: number
  c2Ready: number
  /** Crystallize shards on the field (for Crystal Collapse's pull: C2) */
  shards: { t: number; end: number }[]
}

/** General's Glory: 9 s */
const GLORY = 540

/**
 * A field's buff ticks (gcsim): from 17 frames after the field starts, every 18 frames while it
 * lasts, each giving the active member the buff for 2 s; the buff runs on from the last tick
 */
function fieldTicks(
  ctx: SimContext,
  s: GorouState,
  token: number,
  glory: boolean
) {
  const tick = (c: SimContext) => {
    if (s.fieldToken !== token) return
    const end = glory ? s.gloryEnd : s.bannerEnd
    if (c.now >= end) return
    c.buff('Gorou', ['Gorou', 'inField'], 'inField', 0, 121, {
      recipient: c.onField,
      hitlag: 'recipient',
    })
    c.at(18, tick)
  }
  ctx.at(17, tick)
}

/** C2: General's Glory +1 s (once per 0.1 s, 3 s at most) */
function c2Extend(ctx: SimContext, s: GorouState) {
  if (
    ctx.constellation('Gorou') < 2 ||
    ctx.now >= s.gloryEnd ||
    s.c2Ext >= 3 ||
    ctx.now < s.c2Ready
  )
    return
  s.c2Ext++
  s.c2Ready = ctx.now + 6
  s.gloryEnd += 60
}

export const kit: KitModel = {
  characterKey: 'Gorou',
  element: 'geo',
  source: `${GCSIM}/gorou`,
  init: (): GorouState => ({
    gloryEnd: -1,
    gloryToken: 0,
    bannerEnd: -1,
    fieldToken: 0,
    c1Ready: -1,
    c2Ext: 0,
    c2Ready: -1,
    shards: [],
  }),
  onHit(ctx, s: GorouState, hit) {
    const fieldUp = ctx.now < s.bannerEnd || ctx.now < s.gloryEnd
    // C1: another member's Geo DMG in the field cuts Inuzaka's cooldown by 2 s, once per 10 s
    if (
      ctx.constellation('Gorou') >= 1 &&
      fieldUp &&
      hit.characterKey !== 'Gorou' &&
      hit.element === 'geo' &&
      !hit.path[0].startsWith('_') &&
      ctx.now >= s.c1Ready
    ) {
      s.c1Ready = ctx.now + 600
      ctx.reduceCooldown('skill', 120, 'Gorou')
    }
    if (hit.path[0] !== '_reaction') return
    // a Crystallize leaves a shard (15 s) for Crystal Collapse to pull in
    if (hit.path[1] === 'crystallize')
      s.shards.push({ t: hit.t, end: hit.t + 900 })
    // C2: the active member's Lunar-Crystallize extends General's Glory by 1 s
    if (hit.path[1] === 'lunarCrystallize' && hit.characterKey === ctx.onField)
      c2Extend(ctx, s)
  },
  act(ctx, s: GorouState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          gorouNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // The rotation's charged attack for a bow is the fully-charged Aimed Shot (arrow lands 10 frames after its hitmark at 86)
        ctx.hit(96, {
          path: ['charged', 'fully'],
          tag: 'charged',
          element: 'geo',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Fully-Charged Aimed Shot',
        })
        return { frames: 94, framesInto: { dash: 86, jump: 86 } }
      case 'skill': {
        ctx.hit(34, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Inuzaka All-Round Defense',
        })
        // The War Banner (10 s from the hit, a world task at 34), but not while General's
        // Glory is up
        ctx.at(34, (c) => {
          if (c.now < s.gloryEnd) return
          s.bannerEnd = c.now + 600
          fieldTicks(c, s, ++s.fieldToken, false)
        })
        // C6: from just after the hit (gcsim adds it once the hit has landed)
        if (ctx.constellation('Gorou') >= 6)
          ctx.buff(
            'Gorou',
            ['Gorou', 'afterSkillBurst'],
            'afterSkillBurst',
            35,
            721,
            { hitlag: 'recipient' }
          )
        return {
          cooldown: { key: 'skill', frames: 600, delay: 32 },
          frames: 47,
          framesInto: { dash: 33, jump: 33, swap: 46 },
        }
      }
      case 'burst': {
        ctx.hit(31, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          durability: 25,
          icd: 'none',
          label: 'Juuga: Forward Unto Victory',
        })
        // General's Glory: 9 s from the hit (a world task at 31), replacing the War Banner;
        // Crystal Collapse every 1.5 s while it lasts (the first at 1.5 s), each pulling in a
        // Crystallize shard (C2: +1 s); C4: a heal every 1.5 s with 2+ Geo members
        ctx.at(31, (c) => {
          s.bannerEnd = -1
          s.gloryEnd = c.now + GLORY
          s.c2Ext = 0
          const token = ++s.gloryToken
          fieldTicks(c, s, ++s.fieldToken, true)
          const collapse = (c2: SimContext) => {
            if (s.gloryToken !== token || c2.now >= s.gloryEnd) return
            c2.hit(1, {
              path: ['burst', 'crystalCollapse'],
              tag: 'burst',
              element: 'geo',
              applies: true,
              durability: 25,
              icd: 'burst',
              label: 'Crystal Collapse',
            })
            // the nearest shard (~3 m: 8 frames' travel) once it can be picked up
            s.shards = s.shards.filter((x) => x.end > c2.now)
            const shard = s.shards.find((x) => x.t + 31 <= c2.now + 8)
            if (shard) {
              s.shards = s.shards.filter((x) => x !== shard)
              c2.at(8, (c3) => c2Extend(c3, s))
            }
            c2.at(90, collapse)
          }
          c.at(90, collapse)
          if (c.constellation('Gorou') >= 4 && c.partyCount('geo') > 1) {
            const heal = (c2: SimContext) => {
              if (s.gloryToken !== token || c2.now >= s.gloryEnd) return
              c2.hit(0, {
                path: ['_heal', 'constellation4', 'heal'],
                tag: 'other',
                element: 'geo',
                healTargets: [c2.onField],
                label: 'Lapping Hound (C4 heal)',
              })
              c2.at(90, heal)
            }
            c.at(90, heal)
          }
        })
        // A1: the party's DEF +25% for 12 s (from just after the hit: gcsim adds it once the
        // hit has landed); C6 likewise
        ctx.buff('Gorou', ['Gorou', 'afterBurst'], 'afterBurst', 32, 721, {
          hitlag: 'recipient',
        })
        if (ctx.constellation('Gorou') >= 6)
          ctx.buff(
            'Gorou',
            ['Gorou', 'afterSkillBurst'],
            'afterSkillBurst',
            32,
            721,
            { hitlag: 'recipient' }
          )
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 56,
          framesInto: { normal: 53, dash: 42, jump: 43, swap: 55 },
        }
      }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('boy', 'bow', previous, ctx)
      case 'plunge':
        ctx.note(
          'Gorou: plunge is not modelled (gcsim has no plunge frames for Gorou)'
        )
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
}
