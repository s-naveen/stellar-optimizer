import { MOONDRIFT_MARK } from '../lunarCrystallize'
import type { HitTag, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/illuga, main as of 2026-11-10. */

const illugaNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 14,
    toCharged: 21,
    toAbil: 13,
    frames: 30,
  },
  {
    hitmarks: [16],
    hitlag: [6],
    toNormal: 21,
    toCharged: 21,
    toAbil: 16,
    frames: 33,
  },
  {
    hitmarks: [20, 32],
    hitlag: [8, 0],
    toNormal: 45,
    toCharged: 52,
    toAbil: 32,
    frames: 57,
  },
  {
    hitmarks: [43],
    hitlag: [9],
    toNormal: 66,
    toCharged: 80,
    toAbil: 43,
    frames: 80,
  },
]

/** Hit tags that spend a Nightingale's Song (Geo, by the member on the field) */
const songTags: HitTag[] = [
  'normal',
  'charged',
  'plunge',
  'skill',
  'burst',
  'directLunarCrystallize',
]

interface IllugaState {
  end: number
  songs: number
  extra: number
  spent: number
  token: number
}

export const kit: KitModel = {
  characterKey: 'Illuga',
  moonsign: 1,
  element: 'geo',
  source: `${GCSIM}/illuga`,
  init: (): IllugaState => ({
    end: -1,
    songs: 0,
    extra: 0,
    spent: 0,
    token: 0,
  }),
  onHit(ctx, s: IllugaState, hit) {
    if (ctx.now >= s.end || s.songs <= 0) return
    if (
      hit.path[0] === MOONDRIFT_MARK[0] &&
      hit.path[1] === MOONDRIFT_MARK[1]
    ) {
      const gained = Math.min(s.extra, 5 * (hit.weight ?? 1))
      s.extra -= gained
      s.songs += gained
    }
    if (
      hit.element !== 'geo' ||
      hit.characterKey !== ctx.onField ||
      !songTags.includes(hit.tag)
    )
      return
    hit.states = [
      ...(hit.states ?? []),
      { owner: 'Illuga', path: ['Illuga', 'burstSong'], value: 'on' },
    ]
    s.songs--
    s.spent++
    if (ctx.constellation('Illuga') >= 2 && s.spent % 7 === 0)
      ctx.hit(50, {
        path: ['constellation2', 'dmg'],
        tag: 'burst',
        element: 'geo',
        applies: true,
        icd: 'none',
        blunt: true,
        poiseDamage: 75,
        label: 'Aedon (C2)',
        statSnapshots: [
          {
            stat: 'eleMas',
            path: ['premod', 'eleMas'],
            t: ctx.now,
            onField: ctx.onField,
          },
          {
            stat: 'def',
            path: ['premod', 'def'],
            t: ctx.now,
            onField: ctx.onField,
          },
        ],
      })
    if (s.songs <= 0) s.end = ctx.now
  },
  act(ctx, s: IllugaState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          illugaNormals,
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
      case 'charged':
        ctx.hit(23, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          label: 'Charged Attack',
        })
        return {
          frames: 66,
          framesInto: {
            normal: 63,
            skill: 64,
            burst: 64,
            dash: 23,
            jump: 23,
            swap: 61,
          },
        }
      case 'skill': {
        const hold = !!action.hold
        ctx.hit(hold ? 36 : 27, {
          path: ['skill', hold ? 'holdDmg' : 'pressDmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          label: hold ? 'Dawnbearing Songbird (hold)' : 'Dawnbearing Songbird',
        })
        // A1: Lightkeeper's Oath for the others, 20 s (each holder's copy keeps its hitlag clock)
        ctx.buff(
          'Illuga',
          ['Illuga', 'a1AfterSkillBurst'],
          'on',
          hold ? 33 : 24,
          1200,
          { hitlag: 'recipient' }
        )
        const cooldown = { key: 'skill', frames: 900, delay: hold ? 33 : 24 }
        return hold
          ? {
              cooldown,
              frames: 58,
              framesInto: {
                normal: 50,
                burst: 50,
                dash: 50,
                jump: 49,
                swap: 49,
              },
            }
          : {
              cooldown,
              frames: 47,
              framesInto: {
                normal: 38,
                burst: 38,
                dash: 37,
                jump: 39,
                swap: 36,
              },
            }
      }
      case 'burst':
        // Establish the quill pool before the initial hit, which consumes one too.
        ctx.at(48, (c) => {
          s.end = c.now + 1200
          s.spent = 0
          const existing = Math.min(3, c.moondrifts + c.constructs)
          s.extra = 15 - 5 * existing
          s.songs = 21 + 5 * existing
          const token = ++s.token
          const c4 = (next: SimContext) => {
            if (token !== s.token || next.now >= s.end) return
            if (next.constellation('Illuga') >= 4)
              next.buff('Illuga', ['Illuga', 'c4Recipient'], 'on', 0, 66, {
                recipient: next.onField,
                hitlag: 'recipient',
              })
            next.at(60, c4)
          }
          c4(c)
        })
        ctx.buff('Illuga', ['Illuga', 'burstSong'], '', 0, 0)
        ctx.hit(48, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          label: 'Shadowless Reflection',
          // gcsim snapshots the hit before C4's DEF ticker starts on the same frame
          states: [
            { owner: 'Illuga', path: ['Illuga', 'c4Recipient'], value: '' },
          ],
        })
        ctx.buff('Illuga', ['Illuga', 'a1AfterSkillBurst'], 'on', 0, 1200, {
          hitlag: 'recipient',
        })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 65,
          framesInto: { dash: 64, jump: 64, swap: 62 },
        }
      case 'dash':
        // gcsim's template dash for his body: 21 frames, 2 into a jump
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('boy', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
