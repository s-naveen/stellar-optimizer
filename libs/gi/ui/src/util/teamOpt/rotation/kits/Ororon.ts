import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/ororon, main as of 2026-11-10. */

/** Spirit Vessel arrows: the damage lands 10 frames (the arrow's travel) after each hitmark */
const ororonNormals: NormalHit[] = [
  { hitmarks: [22], toNormal: 24, toCharged: 19, toAbil: 12, frames: 32 },
  { hitmarks: [20], toNormal: 27, toCharged: 19, toAbil: 10, frames: 53 },
  { hitmarks: [30], toNormal: 70, toCharged: 20, toAbil: 20, frames: 70 },
]

/** Dark Voices' Echo lasts 9 s from the burst */
const burstDuration = 9 * 60
/** C2 Spiritual Supersense: gcsim's 3 further 8% steps on top of the base 8% */
const C2_MAX_STACKS = 3

interface OroronState {
  points: number
  blessingEnd: number
  skillEnd: number
  gains: number
  gainReady: number
  damageReady: number
  burstHits: number
}
function hypersense(ctx: SimContext, c6 = false) {
  ctx.hit(12, {
    path: [c6 ? 'constellation6' : 'passive1', 'dmg'],
    tag: 'other',
    element: 'electro',
    nightsoul: true,
    applies: true,
    icd: 'none',
    label: c6 ? 'Hypersense (C6)' : 'Hypersense',
  })
  // the hit pauses Ororon 4 frames (gcsim's 3.6-frame defense halt), on or off the field
  ctx.hit(12, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: 4,
    // (a triggered one pauses whatever action Ororon is in; the C6 burst's own is already in the
    // burst's frames)
    extendsAction: !c6,
    label: 'Hypersense hitlag',
  })
  if (ctx.constellation('Ororon') >= 6)
    ctx.buff('Ororon', ['Ororon', 'c6Stacks'], '1', 0, 540, {
      max: 3,
      hitlag: 'recipient',
    })
}

export const kit: KitModel = {
  characterKey: 'Ororon',
  element: 'electro',
  source: `${GCSIM}/ororon`,
  init: (): OroronState => ({
    points: 0,
    blessingEnd: -1,
    skillEnd: -1,
    gains: 0,
    gainReady: -1,
    damageReady: -1,
    burstHits: 0,
  }),
  nightsoul: (ctx, s: OroronState) => ({
    active: ctx.now < s.blessingEnd,
    points: s.points,
  }),
  onNightsoulBurst(_ctx, s: OroronState) {
    s.points = Math.min(80, s.points + 40)
  },
  onHit(ctx, s: OroronState, hit) {
    if (hit.characterKey === 'Ororon') {
      if (
        hit.path[0] === 'skill' &&
        hit.path[1] === 'dmg' &&
        ctx.constellation('Ororon') >= 1
      )
        // C1 Nighttide: an enemy debuff (gcsim's AddStatus on the target, paused by its hitlag)
        ctx.buff('Ororon', ['Ororon', 'c1AfterSkillHit'], 'on', 0, 720, {
          hitlag: 'enemy',
        })
      if (hit.tag === 'burst' && ctx.constellation('Ororon') >= 2) {
        // The hit callback raises the bonus for subsequent hits (gcsim: +8% per burst hit, 32% in
        // all). The game text gives +8% per additional opponent hit, up to 32% more (40% in all,
        // skillParam): against one target that reads as the base 8% only. Kept at gcsim's
        // reading, as the text is ambiguous for a single target.
        hit.states = [
          ...(hit.states ?? []),
          {
            owner: 'Ororon',
            path: ['Ororon', 'c2BurstHitStack'],
            value: String(Math.min(C2_MAX_STACKS, s.burstHits)),
          },
        ]
        s.burstHits++
        ctx.state(
          'Ororon',
          ['Ororon', 'c2BurstHitStack'],
          String(Math.min(C2_MAX_STACKS, s.burstHits))
        )
      }
    } else if (
      !hit.path[0].startsWith('_') &&
      (hit.element === 'hydro' || hit.element === 'electro') &&
      ctx.now < s.skillEnd &&
      s.gains < 10 &&
      ctx.now >= s.gainReady
    ) {
      s.gains++
      // (0.3 s gain ICD; a gcsim status is still active on its expiry frame: +1)
      s.gainReady = ctx.now + 19
      s.points = Math.min(80, s.points + 5)
    }
    const reaction =
      hit.path[0] === '_reaction' &&
      ['electroCharged', 'lunarCharged'].includes(hit.path[1])
    const nightsoul = hit.nightsoul && hit.characterKey !== 'Ororon'
    if ((!reaction && !nightsoul) || s.points < 10 || ctx.now < s.damageReady)
      return
    // (1.8 s Hypersense ICD, active on its expiry frame as in gcsim: the next one from +109)
    s.damageReady = ctx.now + 109
    if (ctx.now >= s.blessingEnd) s.blessingEnd = ctx.now + 360
    s.points -= 10
    // the 10 points are spent as the blessing starts: report them (Mavuika's Fighting Spirit)
    ctx.consumeNightsoul(10, 'Ororon')
    hypersense(ctx)
  },
  act(ctx, s: OroronState, action, previous) {
    switch (action.kind) {
      case 'normal':
        // (gcsim has the normals as physical, with the normal attack ICD)
        return normalString(
          ororonNormals,
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
      case 'charged':
        // the rotation's CA: the Fully-Charged Aimed Shot (Electro), landing 10 frames after 84
        ctx.hit(94, {
          path: ['charged', 'fullyAimed'],
          tag: 'charged',
          element: 'electro',
          applies: true,
          label: 'Fully-Charged Aimed Shot',
        })
        return {
          frames: 85,
          framesInto: {
            normal: 85,
            charged: 85,
            skill: 85,
            burst: 85,
            dash: 84,
            jump: 84,
            swap: 85,
          },
        }
      case 'skill':
        s.skillEnd = ctx.now + 900
        s.gains = 0
        // Spirit Orb: one target (gcsim hits up to 3, or 5 with C1, when there are more enemies)
        ctx.hit(41, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          nightsoul: true,
          element: 'electro',
          applies: true,
          icd: 'skill',
          label: 'Spirit Orb',
        })
        return {
          cooldown: { key: 'skill', frames: 15 * 60, delay: 14 },
          frames: 31,
          framesInto: {
            normal: 30,
            charged: 31,
            skill: 31,
            burst: 30,
            dash: 31,
            jump: 30,
            swap: 29,
          },
        }
      case 'burst': {
        // Ritual at frame 36, then a Soundwave Collision every 60 frames (45 with C4) while it lasts
        ctx.hit(36, {
          path: ['burst', 'activationDmg'],
          tag: 'burst',
          nightsoul: true,
          element: 'electro',
          applies: true,
          label: 'Ritual',
        })
        const interval = ctx.constellation('Ororon') >= 4 ? 45 : 60
        const ticks: number[] = []
        for (let t = interval; t <= burstDuration; t += interval) ticks.push(t)
        for (const t of ticks)
          ctx.hit(t, {
            path: ['burst', 'soundwaveDmg'],
            tag: 'burst',
            nightsoul: true,
            element: 'electro',
            applies: true,
            icd: 'OroronElementalBurst',
            label: 'Soundwave Collision',
          })
        if (ctx.constellation('Ororon') >= 2) {
          s.burstHits = 0
          ctx.state('Ororon', ['Ororon', 'c2BurstHitStack'], '')
          ctx.buff(
            'Ororon',
            ['Ororon', 'c2Supersense'],
            'on',
            0,
            burstDuration,
            { hitlag: 'recipient' }
          )
        }
        const result = {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 62,
          framesInto: {
            normal: 62,
            charged: 62,
            skill: 62,
            dash: 59,
            jump: 60,
            swap: 61,
          },
        }
        // C6: the burst's Hypersense hits 12 frames in and pauses the burst's animation
        if (ctx.constellation('Ororon') >= 6) {
          hypersense(ctx, true)
          return withHitlag(result, { hitmarks: [12], hitlag: [4] })
        }
        return result
      }
      case 'plunge':
        // gcsim has no plunge for Ororon
        ctx.note('Ororon: plunge is not in gcsim, not modelled')
        return { frames: 30 }
      case 'dash':
        // the template dash (Ororon is a Male): 19 frames, a jump after 3
        return { frames: 19, framesInto: { jump: 3 } }
      case 'jump':
        // Male: 28 frames, 37 after a dash
        return templateJump('male', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
