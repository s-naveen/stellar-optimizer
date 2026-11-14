import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import {
  KQMSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/odette. */

const odetteNormals: NormalHit[] = [
  {
    hitmarks: [9],
    hitlag: [6],
    toNormal: 17,
    toCharged: 25,
    toAbil: 9,
    frames: 19,
  },
  {
    hitmarks: [9],
    hitlag: [6],
    toNormal: 19,
    toCharged: 21,
    toAbil: 9,
    frames: 23,
  },
  {
    hitmarks: [16, 31],
    hitlag: [0, 2],
    toNormal: 54,
    toCharged: 69,
    toAbil: 31,
    frames: 63,
  },
  {
    hitmarks: [15],
    hitlag: [3],
    toNormal: 53,
    toCharged: 73,
    toAbil: 15,
    frames: 85,
  },
  {
    hitmarks: [15],
    hitlag: [4],
    toNormal: 62,
    toCharged: 70,
    toAbil: 15,
    frames: 70,
  },
]

/** Solo Dance Double: 21 s; its moves alternate, Plume (then Wing 109 frames later), Wing (Plume 125 later) */
const DANCE_DURATION = 1262
type DanceMove = 'plume' | 'wing'
const NEXT_MOVE: Record<DanceMove, DanceMove> = { plume: 'wing', wing: 'plume' }
const MOVE_GAP: Record<DanceMove, number> = { plume: 109, wing: 125 }
/** Coda at Dawn's Tolling replaces Adagio for 6 s after Adagio (394 frames) or Presto (361) */
const CODA_WINDOW_E = 394
const CODA_WINDOW_Q = 361

interface OdetteState {
  /** The Dance Double runs until this frame */
  danceEnd: number
  /** Each summon or Coda cancels the earlier dance chain (its ticks check this) */
  danceVersion: number
  /** The move the dance does next (a new Presto summon carries on from it) */
  danceNext?: DanceMove
  /** Coda is available (its window: 394 or 361 frames) */
  codaOpen: boolean
  codaWindow: number
  noted: boolean
  splendorSelf: number
  splendorOthers: number
  splendorToken: number
  upgradeEnd: number
  /** C4 coordinated attack: ready again at this frame of Odette's clock */
  c4Ready: number
}

const radianceValue = (c: SimContext) =>
  c.radiance === 'conduct' ? 'sc' : c.radiance === 'swirl' ? 'ss' : ''
/** Stellar Glimmer damage (native C4 trigger tags: direct Conduct/Swirl and shared Stellar Swirl) */
const stellarDamage = (hit: SimHit) =>
  hit.tag === 'directStellarConduct' ||
  hit.tag === 'directStellarSwirl' ||
  (hit.path[0] === 'reaction' && hit.path[1].startsWith('stellarswirl'))

function summonDance(
  ctx: SimContext,
  s: OdetteState,
  first: DanceMove,
  firstDelay: number,
  refresh = false
) {
  s.danceEnd = ctx.now + DANCE_DURATION
  ctx.at(DANCE_DURATION, (c) => {
    if (c.now < s.danceEnd) return // a burst refreshed the summon
    c.state('Odette', ['Odette', 'a1TeamSplendor'], '')
  })
  if (!refresh) {
    s.splendorSelf = ctx.constellation('Odette') >= 1 ? 6 : 4
    s.splendorOthers = 0
    const token = ++s.splendorToken
    const max = s.splendorSelf
    const tick = (c: SimContext, count: number) => {
      if (s.splendorToken !== token || c.now >= s.danceEnd) return
      if (
        c.onField !== 'Odette' &&
        s.splendorSelf > 0 &&
        s.splendorOthers < max
      ) {
        const take = Math.min(
          s.splendorSelf,
          c.constellation('Odette') >= 1 ? 2 : 1
        )
        // C6: granting Marvelous Splendor no longer removes Odette's own stacks.
        if (c.constellation('Odette') < 6) s.splendorSelf -= take
        s.splendorOthers = Math.min(max, s.splendorOthers + take)
      }
      c.state('Odette', ['Odette', 'a1TeamSplendor'], `${s.splendorOthers}`)
      c.atCharacter(
        'Odette',
        Math.floor(59.25 * (count + 1)) - Math.floor(59.25 * count),
        (c2) => tick(c2, count + 1)
      )
    }
    tick(ctx, 0)
  }
  const version = ++s.danceVersion
  ctx.at(firstDelay, (c2) => danceTick(c2, s, version, first))
}

/** One Dance Double move; the next one is scheduled after this one */
function danceTick(
  ctx: SimContext,
  s: OdetteState,
  version: number,
  move: DanceMove
) {
  if (version !== s.danceVersion || ctx.now >= s.danceEnd) return
  ctx.hit(0, {
    path: ['skill', move === 'plume' ? 'plumeDmg' : 'wingDmg'],
    tag: 'skill',
    element: 'cryo',
    applies: true,
    icd: 'none',
    label: move === 'plume' ? '"Plume" Dance Move' : '"Wing" Dance Move',
  })
  s.danceNext = NEXT_MOVE[move]
  if (ctx.radiance && ctx.now < s.upgradeEnd) {
    const conduct = ctx.radiance === 'conduct'
    ctx.hit(0, {
      path: [
        'skill',
        `${move}${conduct ? 'Stellarconduct' : 'Stellarswirl'}Dmg`,
      ],
      tag: conduct ? 'directStellarConduct' : 'directStellarSwirl',
      element: 'cryo',
      applies: false,
      durability: 0,
      label: `${move === 'plume' ? '"Plume"' : '"Wing"'} Dance Move (Stellar-${conduct ? 'Conduct' : 'Swirl'})`,
      states: [
        {
          owner: 'Odette',
          path: ['Odette', 'a0StellarRadiance'],
          value: conduct ? 'sc' : 'ss',
        },
      ],
    })
  }
  ctx.at(MOVE_GAP[move], (c2) => danceTick(c2, s, version, NEXT_MOVE[move]))
}

function openCoda(
  ctx: SimContext,
  s: OdetteState,
  frames: number,
  hitlag = false
) {
  s.codaOpen = true
  const id = ++s.codaWindow
  const close = () => {
    if (s.codaWindow === id) s.codaOpen = false
  }
  if (hitlag) ctx.atCharacter('Odette', frames, close)
  else ctx.at(frames, close)
}

/**
 * Coda at Dawn's Tolling: a DoT of 3 hits, then the final Stellar-Conduct hit (the no-Radiance
 * variant; the Stellar-Swirl one needs Radiance); C1 adds its own hit; the dance restarts
 * with a Plume 114 frames in
 */
function coda(ctx: SimContext, s: OdetteState): ActionResult {
  s.codaOpen = false
  const version = ++s.danceVersion
  ctx.at(114, (c2) => danceTick(c2, s, version, 'plume'))
  for (const d of [11, 20, 28])
    ctx.hit(d, {
      path: ['skill', 'codaDotDmg'],
      tag: 'skill',
      element: 'cryo',
      applies: true,
      icd: 'danceDuo',
      icdGroup: 'OdetteDanceDuo',
      label: "Coda at Dawn's Tolling (DoT)",
    })
  ctx.atCharacter('Odette', 62, (c) => {
    s.upgradeEnd = c.now + 1200
    const swirl = c.radiance === 'swirl'
    c.hit(0, {
      path: ['skill', swirl ? 'codaStellarswirlDmg' : 'codaStellarconductDmg'],
      tag: swirl ? 'directStellarSwirl' : 'directStellarConduct',
      element: 'cryo',
      applies: false,
      durability: 0,
      label: `Coda at Dawn's Tolling (Stellar-${swirl ? 'Swirl' : 'Conduct'})`,
      states: [
        {
          owner: 'Odette',
          path: ['Odette', 'a0StellarRadiance'],
          value: swirl ? 'ss' : 'sc',
        },
      ],
    })
    c.hit(0, {
      path: ['_marker', 'hitlag'],
      tag: 'other',
      element: 'physical',
      animationPause: 3,
      label: 'Odette Coda final hitlag',
    })
    // C1: an extra hit at the duet's end, of the same Stellar type as the final hit (native
    // c1OnSkillRecast: Stellar-Conduct 300% / Stellar Swirl 450% ATK).
    if (c.constellation('Odette') >= 1)
      c.hit(0, {
        path: [
          'constellation1',
          swirl ? 'stellarswirl_dmg' : 'stellarconduct_dmg',
        ],
        tag: swirl ? 'directStellarSwirl' : 'directStellarConduct',
        element: 'cryo',
        applies: false,
        durability: 0,
        label: `Daybreak Finale (C1, Stellar-${swirl ? 'Swirl' : 'Conduct'})`,
        states: [
          {
            owner: 'Odette',
            path: ['Odette', 'a0StellarRadiance'],
            value: swirl ? 'ss' : 'sc',
          },
        ],
      })
  })
  return withHitlag(
    {
      cooldown: { key: 'coda', frames: 900 },
      frames: 76,
      framesInto: {
        normal: 75,
        charged: 76,
        skill: 76,
        burst: 76,
        dash: 74,
        jump: 75,
        swap: 74,
      },
    },
    { hitmarks: [62], hitlag: [3] }
  )
}

export const kit: KitModel = {
  characterKey: 'Odette',
  element: 'cryo',
  source: `${KQMSIM}/odette`,
  init: (): OdetteState => ({
    danceEnd: -1,
    danceVersion: 0,
    codaOpen: false,
    codaWindow: 0,
    noted: false,
    splendorSelf: 0,
    splendorOthers: 0,
    splendorToken: 0,
    upgradeEnd: -1,
    c4Ready: -1,
  }),
  act(ctx, s: OdetteState, action, previous) {
    switch (action.kind) {
      case 'normal': {
        // hits 3 and 4 of N3 are its two instances (3.1 and 3.2)
        return normalString(
          odetteNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${i < 2 ? i : i === 2 ? 2 + j : i + 1}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      }
      case 'charged':
        ctx.hit(30, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        return {
          frames: 82,
          framesInto: {
            normal: 83,
            charged: 83,
            skill: 57,
            burst: 58,
            dash: 30,
            jump: 30,
            swap: 30,
          },
        }
      case 'skill': {
        if (s.codaOpen) return coda(ctx, s)
        // Adagio: Phantom Night Dancers, and the Solo Dance Double is summoned 23 frames in
        ctx.hit(23, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'cryo',
          applies: true,
          icd: 'none',
          label: 'Adagio: Phantom Night Dancers',
        })
        ctx.atCharacter('Odette', 23, (c2) => summonDance(c2, s, 'plume', 134))
        openCoda(ctx, s, CODA_WINDOW_E, true)
        return {
          cooldown: { key: 'skill', frames: 15 * 60, delay: 14 },
          frames: 42,
          framesInto: {
            normal: 41,
            charged: 42,
            skill: 41,
            burst: 41,
            dash: 40,
            jump: 42,
            swap: 40,
          },
        }
      }
      case 'burst': {
        // Presto: Bluebird Finale: 3 slashes, then the final slash
        for (const d of [112, 128, 140])
          ctx.atCharacter('Odette', d, (at) => {
            at.hit(0, {
              path: ['burst', 'slashDmg'],
              tag: 'burst',
              element: 'cryo',
              applies: true,
              icd: 'burst',
              label: 'Presto: Bluebird Finale (Slash)',
            })
          })
        ctx.atCharacter('Odette', 144, (at) => {
          at.hit(0, {
            path: ['burst', 'finalDmg'],
            tag: 'burst',
            element: 'cryo',
            applies: true,
            icd: 'burst',
            label: 'Presto: Bluebird Finale (Final)',
          })
          // Snow Swan's Dream lasts 20 s on Odette's clock, including after swapping out.
          at.buff('Odette', ['Odette', 'burst'], 'on', 0, 20 * 60, {
            hitlag: 'recipient',
            recipient: 'Odette',
          })
          // C4: the other members gain 50% of it (the sheet reads the same condition for them),
          // each on their own hitlag clock as native c4OnBurst.
          if (at.constellation('Odette') >= 4)
            for (const m of at.members)
              if (m !== 'Odette')
                at.buff('Odette', ['Odette', 'burst'], 'on', 0, 20 * 60, {
                  hitlag: 'recipient',
                  recipient: m,
                })
        })
        // the Dance Double is summoned 1 frame in; a live one carries on with its next move
        ctx.atCharacter('Odette', 1, (c2) => {
          const live = c2.now < s.danceEnd
          summonDance(c2, s, (live && s.danceNext) || 'plume', 252, live)
        })
        openCoda(ctx, s, CODA_WINDOW_Q)
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 126,
          framesInto: {
            normal: 108,
            charged: 126,
            skill: 107,
            burst: 126,
            dash: 108,
            jump: 109,
            swap: 106,
          },
        }
      }
      case 'dash':
        // Girl body (gcsim's template): 20 frames, 4 to a jump
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Girl body: 31 frames, 34 after a dash
        return templateJump('girl', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: OdetteState, hit) {
    if (hit.path[0].startsWith('_')) return
    const cons = ctx.constellation('Odette')
    // C2: while the Dance Double is out and Odette is in a Radiance, nearby opponents lose 20%
    // Cryo RES and Electro (Conduct) / Anemo (Swirl) RES. The sheet keys both on her Radiance.
    if (cons >= 2 && ctx.now < s.danceEnd && ctx.radiance) {
      const own = hit.states?.some(
        (x) => x.owner === 'Odette' && x.path[1] === 'a0StellarRadiance'
      )
      hit.states = [
        ...(hit.states ?? []),
        { owner: 'Odette', path: ['Odette', 'c2NearOpponent'], value: 'on' },
        ...(own
          ? []
          : [
              {
                owner: 'Odette' as const,
                path: ['Odette', 'a0StellarRadiance'],
                value: radianceValue(ctx),
              },
            ]),
      ]
    }
    // C4: any member's Stellar Glimmer damage makes Odette join with a coordinated attack 5 frames
    // later (3.5 s cooldown on her clock): Stellar Swirl in Radiance: Stellar Swirl, else Conduct.
    if (
      cons >= 4 &&
      stellarDamage(hit) &&
      ctx.characterFrame('Odette') >= s.c4Ready
    ) {
      s.c4Ready = ctx.characterFrame('Odette') + 210
      const swirl = ctx.radiance === 'swirl'
      ctx.hit(5, {
        path: [
          'constellation4',
          swirl ? 'stellarswirl_dmg' : 'stellarconduct_dmg',
        ],
        tag: swirl ? 'directStellarSwirl' : 'directStellarConduct',
        element: 'cryo',
        applies: false,
        durability: 0,
        characterKey: 'Odette',
        label: `Odette C4 (Stellar-${swirl ? 'Swirl' : 'Conduct'})`,
        states: [
          {
            owner: 'Odette',
            path: ['Odette', 'a0StellarRadiance'],
            value: radianceValue(ctx),
          },
        ],
      })
    }
  },
  cooldownKey: (s: OdetteState, action) =>
    action.kind === 'burst'
      ? 'burst'
      : action.kind === 'skill'
        ? s.codaOpen
          ? 'coda'
          : 'skill'
        : undefined,
}
