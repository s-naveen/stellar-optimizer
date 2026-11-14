import type { KitModel } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/ayaka, main as of 2026-11-10. */

const ayakaNormals: NormalHit[] = [
  {
    hitmarks: [8],
    hitlag: [6],
    toNormal: 9,
    toCharged: 22,
    toAbil: 8,
    frames: 22,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    toNormal: 19,
    toCharged: 20,
    toAbil: 10,
    frames: 20,
  },
  {
    hitmarks: [16],
    hitlag: [8],
    toNormal: 32,
    toCharged: 31,
    toAbil: 16,
    frames: 32,
  },
  {
    hitmarks: [8, 15, 22],
    hitlag: [0, 0, 6],
    toNormal: 22,
    toCharged: 23,
    toAbil: 22,
    frames: 23,
  },
  {
    hitmarks: [27],
    hitlag: [0],
    toNormal: 66,
    toCharged: 66,
    toAbil: 27,
    frames: 66,
  },
]

interface AyakaState {
  /** C1: recent eligible hits (frame, chance it reduced the cooldown), within the 0.1 s ICD */
  c1Recent: [number, number][]
  /** C1: expected cooldown reduction not yet applied (fractional frames) */
  c1Credit: number
  /** C6: her clock (characterFrame) at the Charged Attack hit that last used Usurahi Butou */
  c6Used: number
}

export const kit: KitModel = {
  characterKey: 'KamisatoAyaka',
  element: 'cryo',
  source: `${GCSIM}/ayaka`,
  init: (): AyakaState => ({
    c1Recent: [],
    c1Credit: 0,
    c6Used: Number.NEGATIVE_INFINITY,
  }),
  act(ctx, _s: AyakaState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          ayakaNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              // (N5 is its own ICD group in gcsim)
              icd: i === 4 ? 'PoleExtraAttack' : 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // three hits (one per spawned charge on a single target)
        for (const d of [27, 33, 39])
          ctx.hit(d, {
            path: ['charged', 'dmg1'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'AyakaExtraAttack',
            label: 'Charged Attack',
          })
        return {
          frames: 71,
          framesInto: { skill: 62, burst: 63, dash: 39, jump: 39, swap: 39 },
        }
      case 'skill': {
        ctx.hit(33, {
          path: ['skill', 'press'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          durability: 50,
          icd: 'skill',
          snapshotDelay: 0,
          label: 'Kamisato Art: Hyouka',
        })
        // A1: Normal and Charged Attacks +30% for 6 s
        ctx.buff(
          'KamisatoAyaka',
          ['KamisatoAyaka', 'afterSkillA1'],
          'afterSkill',
          0,
          360,
          { hitlag: 'recipient' }
        )
        if (ctx.constellation('KamisatoAyaka') >= 1)
          ctx.note(
            "Ayaka C1: Hyouka's cooldown is reduced by the expected value of the 50% chance (0.3 s, 0.1 s ICD) per Cryo Normal or Charged Attack hit."
          )
        return {
          cooldown: { key: 'skill', frames: 600 },
          frames: 49,
          framesInto: { burst: 48, dash: 30, jump: 32, swap: 48 },
        }
      }
      case 'burst': {
        const c = ctx.constellation('KamisatoAyaka')
        // Soumetsu: 19 cutting hits, 15 frames apart, from frame 104
        for (let i = 0; i < 19; i++)
          ctx.hit(104 + 15 * i, {
            path: ['burst', 'cutting'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'burst',
            snapshotDelay: 104,
            label: 'Soumetsu (cutting)',
          })
        // the bloom lands 300 frames after its hitmark
        ctx.hit(404, {
          path: ['burst', 'bloom'],
          tag: 'burst',
          element: 'cryo',
          applies: true,
          icd: 'burst',
          snapshotDelay: 104,
          label: 'Soumetsu (bloom)',
        })
        if (c >= 2) {
          // C2: two Mini-Frostflake Seki no To hits with each cut and with the bloom
          for (let i = 0; i < 19; i++)
            for (let k = 0; k < 2; k++)
              ctx.hit(104 + 15 * i, {
                path: ['constellation2', 'dmg'],
                tag: 'burst',
                element: 'cryo',
                applies: true,
                icd: 'burst',
                snapshotDelay: 104,
                label: 'Mini-Frostflake (C2, cutting)',
              })
          for (let k = 0; k < 2; k++)
            ctx.hit(404, {
              path: ['constellation2', 'bloom'],
              tag: 'burst',
              element: 'cryo',
              applies: true,
              icd: 'burst',
              snapshotDelay: 104,
              label: 'Mini-Frostflake (C2, bloom)',
            })
        }
        // (C4's DEF shred follows each Frostflake Seki no To hit: see onHit)
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 125,
          framesInto: { normal: 124, skill: 124, jump: 113, swap: 123 },
        }
      }
      case 'plunge':
        // the rotation does not say low or high: the low plunge is modelled (no collision)
        ctx.note(
          'Ayaka: a plunging attack is modelled as the low plunge (no collision)'
        )
        ctx.hit(46, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 73,
          framesInto: { normal: 57, skill: 58, burst: 58, dash: 57, swap: 61 },
        }
      case 'dash':
        // The zero-damage hit still applies Cryo and can freeze the target.
        ctx.hit(20, {
          path: ['_marker', 'application'],
          tag: 'other',
          element: 'cryo',
          applies: true,
          durability: 25,
          icd: 'dash',
          label: 'Ayaka Sprint',
        })
        // Her Normal, Charged and Plunging Attacks are Cryo for 5 s on her clock (gcsim's
        // hitlag-extended weapon infusion)
        ctx.infuse('cryo', 20, 300, 'KamisatoAyaka')
        ctx.buff(
          'KamisatoAyaka',
          ['KamisatoAyaka', 'afterSprint'],
          'afterSprint',
          20,
          300,
          { hitlag: 'recipient' }
        )
        // A4: that Cryo application gives +18% Cryo DMG for 10 s
        ctx.buff(
          'KamisatoAyaka',
          ['KamisatoAyaka', 'afterApplySprint'],
          'afterApplySprint',
          20,
          600,
          { hitlag: 'recipient' }
        )
        return { frames: 35, framesInto: { dash: 30, swap: 34 } }
      // template jump (Girl body): 34 frames after a dash, else 31
      case 'jump':
        return templateJump('girl', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: AyakaState, hit) {
    if (hit.characterKey !== 'KamisatoAyaka' || hit.path[0].startsWith('_'))
      return
    const c = ctx.constellation('KamisatoAyaka')
    // C1: a Cryo Normal or Charged Attack hit has a 50% chance to cut Hyouka's cooldown by 0.3 s,
    // at most once every 0.1 s (gcsim's 6-frame status, still active on its expiry frame). The
    // expected value: the chance it is not blocked by a success within the ICD, halved.
    if (
      c >= 1 &&
      (hit.tag === 'normal' || hit.tag === 'charged') &&
      hit.element === 'cryo'
    ) {
      s.c1Recent = s.c1Recent.filter(([t]) => ctx.now - t <= 6)
      const blocked = s.c1Recent.reduce((sum, [, p]) => sum + p, 0)
      const chance = 0.5 * Math.max(0, 1 - blocked)
      s.c1Recent.push([ctx.now, chance])
      s.c1Credit += 18 * chance
      const frames = Math.floor(s.c1Credit)
      if (frames > 0) {
        s.c1Credit -= frames
        ctx.reduceCooldown('skill', frames)
      }
    }
    // C4: each Frostflake Seki no To hit (cuts, bloom, C2's) lowers the enemy's DEF by 30% for 6 s,
    // from after that hit
    if (
      c >= 4 &&
      (hit.path[0] === 'burst' || hit.path[0] === 'constellation2')
    ) {
      hit.states = [
        ...(hit.states ?? []),
        {
          owner: 'KamisatoAyaka',
          path: ['KamisatoAyaka', 'afterBurst'],
          value: ctx.hasBuff('KamisatoAyaka', ['KamisatoAyaka', 'afterBurst'])
            ? 'c4'
            : '',
        },
      ]
      ctx.buff('KamisatoAyaka', ['KamisatoAyaka', 'afterBurst'], 'c4', 0, 360, {
        hitlag: 'enemy',
      })
    }
    // C6: Usurahi Butou (+298% Charged Attack DMG) is up from the start; a Charged Attack hit with
    // it clears it 0.5 s later, and it returns 10 s after that (gcsim's character tasks: her
    // clock, so hitlag delays them)
    if (c >= 6 && hit.tag === 'charged') {
      const clock = ctx.characterFrame('KamisatoAyaka')
      const ready = clock >= s.c6Used + 630
      const on = ready || clock < s.c6Used + 30
      if (ready) s.c6Used = clock
      hit.states = [
        ...(hit.states ?? []),
        {
          owner: 'KamisatoAyaka',
          path: ['KamisatoAyaka', 'C6'],
          value: on ? 'c6' : '',
        },
      ]
    }
  },
}
