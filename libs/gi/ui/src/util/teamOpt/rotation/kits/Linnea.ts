import { HARMONY_MARK } from '../lunarCrystallize'
import type { KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), pinned by KQMSIM. */

/*
 * Constellations follow the game text where the pinned kqmsim differs: C1's Field Catalog fills
 * to 18 on her Skill at C6 (kqmsim adds 6), and C6 consumes two stacks for 150% of the original
 * bonus (the sheet's numbers; kqmsim multiplies by both, 300%); C2's Hydro/Geo CRIT DMG reaches
 * every Hydro and Geo member (kqmsim stops at the first other element).
 */

/** gcsim attack.go: release at 17 / 12 / 27, 10 frames of travel; a normal waits for the walk
 * frames, an aimed shot (gcsim's aim) only for the release */
const normals: NormalHit[] = [
  { hitmarks: [27], toNormal: 21, toCharged: 17, toAbil: 17, frames: 21 },
  { hitmarks: [22], toNormal: 26, toCharged: 12, toAbil: 12, frames: 26 },
  { hitmarks: [37], toNormal: 43, toCharged: 27, toAbil: 27, frames: 43 },
]
interface LinneaState {
  end: number
  token: number
  recastEnd: number
  recasts: number
  recastToken: number
  standard: boolean
  index: number
  /** C1's Field Catalog stacks, until (her clock, 10 s) */
  c1Stacks: number
  c1End: number
}

/** C1: gain Field Catalog stacks (max 18, 10 s); C6 fills them */
function catalog(ctx: SimContext, s: LinneaState, stacks: number) {
  if (ctx.constellation('Linnea') < 1) return
  const f = ctx.characterFrame('Linnea')
  if (f >= s.c1End) s.c1Stacks = 0
  s.c1End = f + 600
  s.c1Stacks = Math.min(
    18,
    s.c1Stacks + (ctx.constellation('Linnea') >= 6 ? 18 : stacks)
  )
}

/** Lunar-Crystallize DMG: direct hits and the reaction's (Moondrift Harmony) */
const isLunarCrystallize = (hit: SimHit) =>
  hit.tag === 'directLunarCrystallize' ||
  hit.tag === 'reactionLunarCrystallize' ||
  (hit.path[0] === 'reaction' && hit.path[1] === 'lunarcrystallize')
const intervals = [111, 63, 144]
function lumiAttack(ctx: SimContext, s: LinneaState, token: number) {
  if (token !== s.token || ctx.now >= s.end) return
  if (!s.standard && s.index === 1) {
    ctx.hit(0, {
      path: ['skill', 'hammerDmg'],
      tag: 'directLunarCrystallize',
      element: 'geo',
      triggersHarmony: ctx.constellation('Linnea') >= 2 && ctx.moonsign >= 2,
      label: 'Lumi Heavy Overdrive Hammer (Lunar-Crystallize)',
    })
  } else {
    for (const delay of [0, 12])
      ctx.at(delay, (c) => {
        if (token !== s.token) return
        c.hit(0, {
          path: ['skill', 'pummelerDmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          icd: 'skill',
          label: `Lumi Pound-Pound Pummeler ${delay ? 2 : 1}`,
        })
      })
  }
  const delay = s.standard ? 340 : intervals[s.index]
  if (!s.standard) s.index = ctx.moondrifts > 0 ? (s.index + 1) % 3 : 0
  ctx.at(delay, (c) => lumiAttack(c, s, token))
}
function activate(
  ctx: SimContext,
  s: LinneaState,
  standard: boolean,
  first: number
) {
  const token = ++s.token
  s.standard = standard
  s.end = ctx.now + 1500
  if (!standard && ctx.moondrifts > 0) s.index = 1
  const shred = (c: SimContext) => {
    if (token !== s.token) return
    c.buff('Linnea', ['Linnea', 'a1Lumi'], 'on', 0, 120)
    // The pinned native A1 ticker is tied to the summon source, including its lingering tail.
    c.at(60, shred)
  }
  shred(ctx)
  ctx.at(first, (c) => lumiAttack(c, s, token))
}
function expireRecast(ctx: SimContext, s: LinneaState) {
  const token = ++s.recastToken
  s.recastEnd = ctx.now + 36
  ctx.at(36, (c) => {
    if (token !== s.recastToken) return
    activate(c, s, false, 78)
  })
}
export const kit: KitModel = {
  characterKey: 'Linnea',
  moonsign: 1,
  element: 'geo',
  source: `${KQMSIM}/linnea`,
  init: (): LinneaState => ({
    end: -1,
    token: 0,
    recastEnd: -1,
    recasts: 0,
    recastToken: 0,
    standard: false,
    index: 0,
    c1Stacks: 0,
    c1End: -1,
  }),
  cooldownKey: (s: LinneaState, action, now) =>
    action.kind === 'skill' && now < s.recastEnd
      ? undefined
      : action.kind === 'skill'
        ? 'skill'
        : action.kind === 'burst'
          ? 'burst'
          : undefined,
  onHit(ctx, s: LinneaState, hit) {
    const c = ctx.constellation('Linnea')
    if (hit.path[0] === HARMONY_MARK[0] && hit.path[1] === HARMONY_MARK[1]) {
      // C1: 6 Field Catalog stacks; C2: Hydro/Geo CRIT DMG for 8 s; C4: DEF for 5 s (the active
      // member's, and her own), each on its holder's hitlag clock
      catalog(ctx, s, 6)
      if (c >= 2)
        ctx.buff('Linnea', ['Linnea', 'c2Moondrift'], 'on', 0, 480, {
          hitlag: 'recipient',
        })
      if (c >= 4)
        ctx.buff('Linnea', ['Linnea', 'c4Moondrift'], 'on', 0, 300, {
          hitlag: 'recipient',
        })
      return
    }
    // C1: each Lunar-Crystallize DMG instance consumes a stack (2 at C6) for a DEF-based bonus;
    // Million Ton Crush consumes up to 5 (10) for its own larger one
    if (c < 1 || !isLunarCrystallize(hit)) return
    if (ctx.characterFrame('Linnea') >= s.c1End) s.c1Stacks = 0
    if (s.c1Stacks <= 0) return
    const crush = hit.characterKey === 'Linnea' && hit.path[1] === 'crushDmg'
    const used = Math.min(s.c1Stacks, (crush ? 5 : 1) * (c >= 6 ? 2 : 1))
    s.c1Stacks -= used
    hit.states = [
      ...(hit.states ?? []),
      crush
        ? {
            owner: 'Linnea',
            path: ['Linnea', 'c1LumiStacks'],
            value: `${used}`,
          }
        : { owner: 'Linnea', path: ['Linnea', 'c1TeamStacks'], value: 'on' },
    ]
  },
  act(ctx, s: LinneaState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          normals,
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
        ctx.hit(96, {
          path: ['charged', 'fullyAimed'],
          tag: 'charged',
          element: 'geo',
          applies: true,
          icd: 'none',
          label: 'Fully-Charged Aimed Shot',
        })
        return { frames: 94, framesInto: { dash: 86, jump: 86 } }
      case 'skill':
        if (ctx.now < s.recastEnd) {
          s.recasts++
          if (s.recasts === 3) {
            ++s.recastToken
            s.recastEnd = ctx.now
            s.index = 0
            activate(ctx, s, true, 98)
            ctx.hit(50, {
              path: ['skill', 'crushDmg'],
              tag: 'directLunarCrystallize',
              element: 'geo',
              triggersHarmony:
                ctx.constellation('Linnea') >= 2 && ctx.moonsign >= 2,
              label: 'Lumi Million Ton Crush (Lunar-Crystallize)',
            })
          } else expireRecast(ctx, s)
          return { frames: 10 }
        }
        s.recasts = 0
        s.end = ctx.now
        ++s.token
        expireRecast(ctx, s)
        // C1: the cast (not a recast) gives Field Catalog stacks
        catalog(ctx, s, 6)
        return {
          frames: 33,
          framesInto: {
            normal: 20,
            charged: 20,
            skill: 20,
            burst: 20,
            jump: 20,
            swap: 20,
          },
          cooldown: { key: 'skill', frames: 1080, delay: 1 },
        }
      case 'burst':
        ctx.at(92, (c) => {
          if (c.now < s.end) s.end = c.now + 1500
          else activate(c, s, false, 78)
        })
        ctx.hit(97, {
          path: ['_heal', 'burst', 'initialHeal'],
          tag: 'other',
          element: 'physical',
          weight: ctx.members.length,
          label: 'Survival Guide (Initial Heal)',
        })
        for (let i = 1; i <= 5; i++)
          ctx.hit(97 + i * 120, {
            path: ['_heal', 'burst', 'continuousHeal'],
            tag: 'other',
            element: 'physical',
            weight: ctx.members.length,
            label: 'Survival Guide (Heal)',
          })
        return {
          frames: 110,
          framesInto: { skill: 109, swap: 108 },
          cooldown: { key: 'burst', frames: 900 },
        }
      case 'dash':
        // gcsim's template dash for her body: 20 frames, 4 into a jump
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('girl', 'bow', previous, ctx)
      default:
        return {
          frames: 30,
          failed: `Linnea: ${action.kind} is not supported by the pinned native kit.`,
        }
    }
  },
}
