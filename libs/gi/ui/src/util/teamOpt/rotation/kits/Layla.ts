import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/layla, main as of 2026-11-10. */

const laylaNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 19,
    toCharged: 31,
    toAbil: 13,
    frames: 33,
  },
  {
    hitmarks: [12],
    hitlag: [6],
    toNormal: 36,
    toCharged: 37,
    toAbil: 12,
    frames: 50,
  },
  {
    hitmarks: [31],
    hitlag: [8],
    toNormal: 65,
    toCharged: 74,
    toAbil: 31,
    frames: 74,
  },
]

/** Curtain of Slumber (the shield) lasts 12 s */
const SHIELD = 12 * 60

interface LaylaState {
  /** The Curtain of Slumber is up until this frame */
  shieldUntil: number
  /** Night Stars held (4 fires the Shooting Stars) */
  stars: number
  /** The star ticks' chain: a new chain replaces the old one */
  tickGen: number
  /** Shooting Stars are fired until this frame: no stars are gained meanwhile */
  shootingUntil: number
  /** The ICDs of the star gains: from the Elemental Skill (0.3 s), from the Burst (0.5 s) */
  skillIcdUntil: number
  burstIcdUntil: number
  /** Dawn Star expires independently on each recipient's character clock. */
  c4Until: Map<CharacterKey, number>
}

/** One Night Star every 1.5 s while the Curtain is up (1.2 s at C6) */
const tickInterval = (c: number) => (c >= 6 ? 72 : 90)

/** Gains `count` Night Stars (gcsim's addNightStars: ICD, cap at 4) */
const addStars = (
  ctx: SimContext,
  s: LaylaState,
  count: number,
  from: 'skill' | 'burst'
) => {
  const now = ctx.now
  if (now < s.shootingUntil) return
  if (from === 'skill') {
    if (now < s.skillIcdUntil) return
    s.skillIcdUntil = now + 18
  } else {
    if (now < s.burstIcdUntil) return
    s.burstIcdUntil = now + 30
  }
  s.stars = Math.min(s.stars + count, 4)
  if (s.stars === 4) shootStars(ctx, s)
}

/** The star tick chain: a Night Star per interval while the Curtain is up */
const startTicks = (ctx: SimContext, s: LaylaState) => {
  if (ctx.now >= s.shieldUntil) return
  s.tickGen++
  const gen = s.tickGen
  const interval = tickInterval(ctx.constellation('Layla'))
  const tick = (c: SimContext) => {
    if (gen !== s.tickGen || c.now >= s.shieldUntil) return
    addStars(c, s, 1, 'skill')
    c.at(interval, tick)
  }
  ctx.at(interval, tick)
}

/**
 * Four Shooting Stars: the first 36 frames after the 4th star (the target is found 0.1 s in, then
 * 0.5 s), then every 27 frames. Each one's travel shortens as the stars go.
 */
const shootStars = (ctx: SimContext, s: LaylaState) => {
  s.shootingUntil = ctx.now + 117
  s.tickGen++
  const shots: [number, number][] = [
    [36, 35],
    [63, 33],
    [90, 30],
    [117, 28],
  ]
  shots.forEach(([at, travel], i) => {
    ctx.hit(at + travel, {
      path: ['skill', 'starDmg'],
      tag: 'skill',
      element: 'cryo',
      applies: true,
      icd: 'layla',
      label: `Shooting Star ${i + 1}`,
    })
  })
  // C4 is granted at launch, before the first star reaches its target.
  if (ctx.constellation('Layla') >= 4)
    ctx.at(36, (c) => {
      for (const member of c.members) {
        s.c4Until.set(member, c.characterFrame(member) + 180)
        c.buff('Layla', ['Layla', 'c4Active'], 'on', 0, 180, {
          recipient: member,
          hitlag: 'recipient',
        })
      }
    })
  // the last shot clears the stars and restarts the ticks
  ctx.at(117, (c) => {
    s.stars = 0
    startTicks(c, s)
  })
}

export const kit: KitModel = {
  characterKey: 'Layla',
  element: 'cryo',
  source: `${GCSIM}/layla`,
  init: (): LaylaState => ({
    shieldUntil: -1,
    stars: 0,
    tickGen: 0,
    shootingUntil: -1,
    skillIcdUntil: -1,
    burstIcdUntil: -1,
    c4Until: new Map(),
  }),
  onPartyAction(ctx, s: LaylaState, _actor, action) {
    if (action.kind === 'skill' && ctx.now < s.shieldUntil)
      addStars(ctx, s, 2, 'skill')
  },
  onBeforeHit(ctx, s: LaylaState, hit) {
    if (ctx.constellation('Layla') < 4 || hit.path[0].startsWith('_')) return
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Layla',
        path: ['Layla', 'c4Active'],
        value:
          ctx.characterFrame(hit.characterKey) <
          (s.c4Until.get(hit.characterKey) ?? -1)
            ? 'on'
            : '',
      },
    ]
  },
  onHit(ctx, s: LaylaState, hit) {
    if (
      ctx.constellation('Layla') < 4 ||
      hit.path[0].startsWith('_') ||
      !['normal', 'charged'].includes(hit.tag) ||
      ctx.characterFrame(hit.characterKey) >=
        (s.c4Until.get(hit.characterKey) ?? -1)
    )
      return
    const recipient = hit.characterKey
    // Native queues removal on Layla's clock, three frames after the hit.
    // Other recipients retain their own Dawn Star; hits in this grace period
    // still receive it, including closely spaced instances of one attack.
    ctx.atCharacter('Layla', 3, (c) => {
      s.c4Until.delete(recipient)
      c.buff('Layla', ['Layla', 'c4Active'], '', 0, 180, {
        recipient,
        hitlag: 'recipient',
      })
    })
  },
  act(ctx, s: LaylaState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          laylaNormals,
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
        ctx.hit(16, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (1)',
        })
        ctx.hit(27, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (2)',
        })
        return {
          frames: 49,
          framesInto: { skill: 34, burst: 34, dash: 27, jump: 27, swap: 29 },
        }
      case 'skill': {
        ctx.hit(32, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: 'Nights of Formal Focus',
        })
        // the Curtain of Slumber 19 frames in (refreshed if it is up); the star ticks start with it
        ctx.at(19, (c) => {
          if (c.now >= s.shieldUntil && c.now >= s.shootingUntil) s.stars = 0
          s.shieldUntil = c.now + SHIELD
          startTicks(c, s)
        })
        return {
          cooldown: { key: 'skill', frames: 720, delay: 19 },
          frames: 43,
          framesInto: { normal: 41, skill: 42, swap: 41 },
        }
      }
      case 'burst': {
        // eight Starlight Slugs: every 1.5 s for 12 s, from 36 frames in, each 78 frames after its tick
        for (let delay = 36; delay < 12 * 60 + 36; delay += 90) {
          ctx.hit(delay + 78, {
            path: ['burst', 'slugDmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'burst',
            label: 'Starlight Slug',
          })
          // a Slug that lands while the Curtain is up gains a Night Star
          ctx.at(delay + 78, (c) => {
            if (c.now < s.shieldUntil) addStars(c, s, 1, 'burst')
          })
        }
        return {
          cooldown: { key: 'burst', frames: 720 },
          frames: 79,
          framesInto: { normal: 65, skill: 66, dash: 67, jump: 66, swap: 65 },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // the template's jump (Girl body): longer right after a dash
        return templateJump('girl', 'sword', previous, ctx)
      case 'plunge':
        return {
          frames: 0,
          failed: 'Layla: plunge not implemented in gcsim',
        }
      default:
        return { frames: 30 }
    }
  },
}
