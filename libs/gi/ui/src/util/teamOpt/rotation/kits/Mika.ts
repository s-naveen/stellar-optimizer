import { allStats } from '@genshin-optimizer/gi/stats'
import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/mika, main as of 2026-11-10. */

/** The polearm normal attack string (gcsim's attackHitmarks and attackFrames) */
const mikaNormals: NormalHit[] = [
  {
    hitmarks: [20],
    hitlag: [2],
    toNormal: 23,
    toCharged: 28,
    toAbil: 20,
    frames: 35,
  },
  {
    hitmarks: [14],
    hitlag: [5],
    toNormal: 19,
    toCharged: 19,
    toAbil: 14,
    frames: 28,
  },
  {
    hitmarks: [16],
    hitlag: [2],
    toNormal: 34,
    toCharged: 39,
    toAbil: 16,
    frames: 41,
  },
  {
    hitmarks: [15, 24],
    hitlag: [4, 4],
    toNormal: 32,
    toCharged: 40,
    toAbil: 24,
    frames: 48,
  },
  {
    hitmarks: [30],
    hitlag: [6],
    toNormal: 71,
    toCharged: 71,
    toAbil: 30,
    frames: 71,
  },
]

/** Starfrost Swirl's Soulwind: 12 s */
const SOULWIND = 720

interface MikaState {
  /** Eagleplume (the burst's healing state) lasts until this frame */
  healUntil: number
  /** Each member's next Eagleplume heal (frame) */
  healReady: Record<string, number>
  /** The current Soulwind: from `soulwindStart` to `soulwindEnd` (frames) */
  soulwindStart: number
  soulwindEnd: number
  /** Soulwind's ATK SPD ends at this frame of Mika's own clock (hitlag extends it) */
  soulwindClockEnd: number
  /** Soulwind's ATK SPD bonus (by the skill's level) */
  soulwindSpeed: number
  /** A4's Detector stack has been gained in this Soulwind */
  a4Used: boolean
}

/**
 * The Soulwind state, from `from` frames on: the team's ATK SPD (the skill's conditional), and
 * for C6 the active member's Physical CRIT DMG
 */
function soulwind(ctx: SimContext, s: MikaState, from: number, c: number) {
  // ATK SPD by Starfrost Swirl's level (C5 raises it; gcsim's TalentLvlSkill)
  const index =
    ctx.calculate('Mika', ['total', 'skillIndex']) ?? (c >= 5 ? 12 : 9)
  s.soulwindSpeed = allStats.char.skillParam.Mika.skill[3][index]
  s.soulwindStart = ctx.now + from
  s.soulwindEnd = ctx.now + from + SOULWIND
  s.a4Used = false
  // (gcsim: modifiers with hitlag, each on its member's clock)
  ctx.buff('Mika', ['Mika', 'inSoulwind'], 'on', from, SOULWIND, {
    hitlag: 'recipient',
  })
  if (c >= 6)
    ctx.buff('Mika', ['Mika', 'c6Crit'], 'on', from, SOULWIND, {
      hitlag: 'recipient',
    })
  const speed = s.soulwindSpeed
  ctx.at(from, (at) => {
    s.soulwindClockEnd = at.characterFrame('Mika') + SOULWIND
    for (const member of at.members)
      at.modifyAttackSpeed('MikaSoulwind', speed, SOULWIND, member)
  })
}

export const kit: KitModel = {
  characterKey: 'Mika',
  element: 'cryo',
  source: `${GCSIM}/mika`,
  init: (): MikaState => ({
    healUntil: -1,
    healReady: {},
    soulwindStart: -1,
    soulwindEnd: -1,
    soulwindClockEnd: -1,
    soulwindSpeed: 0,
    a4Used: false,
  }),
  act(ctx, s: MikaState, action, previous) {
    ctx.note(
      "Mika: Rimestar Shards (other enemies) and Detector stacks from more than one enemy are not modelled; A4's stack assumes the active member's first hit under Eagleplume and Soulwind is a CRIT Hit."
    )
    const c = ctx.constellation('Mika')
    switch (action.kind) {
      case 'normal': {
        // gcsim reads ATK SPD as each normal starts: a step that starts after Soulwind ends (on
        // her clock) loses its bonus, though the string started under it
        const clock0 = ctx.characterFrame('Mika')
        const covered = clock0 < s.soulwindClockEnd
        let stepStart = 0
        let paused = 0
        let stepHitlag = 0
        const speedCtx: SimContext = {
          ...ctx,
          normalAttackSpeed: (continuing) => {
            const speed = ctx.normalAttackSpeed(continuing)
            return covered && clock0 + stepStart - paused >= s.soulwindClockEnd
              ? speed - s.soulwindSpeed
              : speed
          },
        }
        return normalString(
          mikaNormals,
          action.count ?? 1,
          (i, d, j) => {
            if (j === 0) {
              stepStart = d - mikaNormals[i].hitmarks[0]
              paused += stepHitlag
              stepHitlag = (mikaNormals[i].hitlag ?? []).reduce(
                (a, b) => a + b,
                0
              )
            }
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
          },
          speedCtx
        )
      }
      case 'charged':
        ctx.hit(26, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'PoleExtraAttack',
          label: 'Charge Attack',
        })
        return {
          frames: 66,
          framesInto: {
            normal: 63,
            skill: 62,
            burst: 62,
            dash: 26,
            jump: 26,
            swap: 61,
          },
        }
      case 'skill':
        if (action.hold) {
          // Rimestar Flare: hit 12 frames in, 3 frames of travel; Soulwind starts 12 frames in
          ctx.hit(15, {
            path: ['skill', 'flareDmg'],
            tag: 'skill',
            element: 'cryo',
            applies: true,
            icd: 'ElementalArt',
            label: 'Rimestar Flare',
          })
          soulwind(ctx, s, 12, c)
          // C2: a Detector stack from the first hit of the skill
          if (c >= 2)
            ctx.buff(
              'Mika',
              ['Mika', 'a1DetectorStacks'],
              '1',
              15,
              12 + SOULWIND - 15
            )
          return {
            cooldown: { key: 'skill', frames: 900, delay: 12 },
            frames: 46,
            framesInto: { normal: 38, burst: 37, dash: 30, jump: 30 },
          }
        }
        // Flowfrost Arrow: hit 17 frames in, 1 frame of travel; Soulwind starts 16 frames in
        ctx.hit(18, {
          path: ['skill', 'arrowDmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          label: 'Flowfrost Arrow',
        })
        soulwind(ctx, s, 16, c)
        if (c >= 2)
          ctx.buff(
            'Mika',
            ['Mika', 'a1DetectorStacks'],
            '1',
            18,
            16 + SOULWIND - 18,
            { hitlag: 'recipient' }
          )
        // (the arrow's defense halt pauses her; a wait starts at gcsim's CanQueueAfter, the walk)
        ctx.hit(18, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 4,
          label: 'Mika skill hitlag',
        })
        return withHitlag(
          {
            cooldown: { key: 'skill', frames: 900, delay: 16 },
            frames: 39,
            framesInto: { dash: 34, jump: 35, swap: 37, wait: 19 },
          },
          { hitmarks: [18], hitlag: [4] }
        )
      case 'burst':
        ctx.at(51, (c) => {
          s.healUntil = c.now + 900
        })
        ctx.hit(51, {
          path: ['_heal', 'burst', 'castHeal'],
          tag: 'other',
          element: 'cryo',
          weight: ctx.members.length,
          label: 'Skyfeather Song (heal)',
        })
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 61,
          framesInto: { skill: 60, jump: 60, swap: 59 },
        }
      case 'dash':
        // the template's dash (Boy body)
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // the template's jump (Boy body): longer right after a dash
        return templateJump('boy', 'polearm', previous, ctx)
      default:
        // gcsim has no plunge for Mika: no damage
        return { frames: 30 }
    }
  },
  onHit(ctx, s: MikaState, hit) {
    if (hit.characterKey === 'Mika' && hit.tag === 'skill')
      ctx.hit(100, {
        path: ['_particle', 'cryo'],
        tag: 'other',
        element: 'cryo',
        weight: 4,
        label: 'Starfrost Swirl (particles)',
      })
    if (hit.path[0].startsWith('_')) return
    const soulwindOn = ctx.now >= s.soulwindStart && ctx.now < s.soulwindEnd
    // A4: the active member's CRIT Hit (assumed: the first hit) under both Eagleplume and Soulwind
    // gains 1 Detector stack, once per Soulwind (from after that hit)
    if (
      !s.a4Used &&
      soulwindOn &&
      ctx.now < s.healUntil &&
      hit.characterKey === ctx.onField
    ) {
      s.a4Used = true
      ctx.buff(
        'Mika',
        ['Mika', 'a1DetectorStacks'],
        '1',
        1,
        s.soulwindEnd - ctx.now - 1,
        { hitlag: 'recipient' }
      )
    }
    if (
      hit.tag !== 'normal' ||
      ctx.now >= s.healUntil ||
      ctx.now < (s.healReady[hit.characterKey] ?? -1)
    )
      return
    // C1: under Soulwind, Eagleplume's 2.5 s interval is shortened by Soulwind's ATK SPD bonus (the
    // game text; gcsim shortens it always)
    s.healReady[hit.characterKey] =
      ctx.now +
      (ctx.constellation('Mika') >= 1 && soulwindOn
        ? Math.trunc(150 * (1 - s.soulwindSpeed))
        : 150)
    ctx.hit(0, {
      path: ['_heal', 'burst', 'plumeHeal'],
      tag: 'other',
      element: 'cryo',
      label: 'Eagleplume (heal)',
    })
  },
}
