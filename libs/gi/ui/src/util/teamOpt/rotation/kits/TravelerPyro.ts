import type { HitElement, KitModel, SimContext, SimHit } from '../types'
import { GCSIM, type NormalHit, normalString } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/traveler/pyro/lumine (Lumine's female frames), main as of 2026-11-10. */

/** Lumine's normal attack string (gcsim's common/pyro/attack.go, female table) */
const pyroNormals: NormalHit[] = [
  {
    hitmarks: [16],
    hitlag: [6],
    worldTimeHits: true,
    toNormal: 24,
    toCharged: 32,
    toAbil: 16,
    frames: 32,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    worldTimeHits: true,
    toNormal: 21,
    toCharged: 23,
    toAbil: 10,
    frames: 23,
  },
  {
    hitmarks: [19],
    hitlag: [8],
    worldTimeHits: true,
    toNormal: 27,
    toCharged: 39,
    toAbil: 19,
    frames: 39,
  },
  {
    hitmarks: [23],
    hitlag: [8],
    worldTimeHits: true,
    toNormal: 38,
    toCharged: 45,
    toAbil: 23,
    frames: 45,
  },
  {
    hitmarks: [14],
    hitlag: [10],
    worldTimeHits: true,
    toNormal: 64,
    toCharged: 64,
    toAbil: 14,
    frames: 64,
  },
]

/** Native drains 0.7 points every six character frames, with a 12-second cap. */
interface PyroState {
  points: number
  active: boolean
  token: number
  armed: boolean
  scorchReady: boolean
  scorchToken: number
  /** C2: points from party Pyro reactions until this frame (12 s after E), at most twice */
  c2Until: number
  c2Count: number
  /** Foreign Starfire: Blade of the Sacred Flame stacks, and when Inferno is next ready */
  blades: number
  infernoReady: number
}

/** Nightsoul points: at most 80 */
const NS_MAX = 80
/** C2: the Pyro reactions that restore points (gcsim's event list) */
const C2_REACTIONS = [
  'burning',
  'vaporize',
  'melt',
  'overloaded',
  'pyroSwirl',
  'crystallize',
]
function sync(ctx: SimContext, s: PyroState) {
  ctx.state(
    'TravelerPyro',
    ['TravelerPyro', 'c1SkillActive'],
    s.active ? 'on' : ''
  )
  ctx.state('TravelerPyro', ['TravelerPyro', 'c6InNs'], s.active ? 'on' : '')
}
function exit(ctx: SimContext, s: PyroState) {
  s.active = false
  s.points = 0
  s.armed = false
  sync(ctx, s)
}
function enter(ctx: SimContext, s: PyroState, token: number) {
  s.points = 42 + (s.active ? 0 : s.points)
  s.active = true
  sync(ctx, s)
  const drain = (at: SimContext) => {
    if (!s.active || s.token !== token) return
    const used = Math.min(0.7, s.points)
    s.points = Math.max(0, s.points - used)
    at.consumeNightsoul(used)
    if (s.points < 0.00001) exit(at, s)
    else at.atCharacter('TravelerPyro', 6, drain)
  }
  ctx.atCharacter('TravelerPyro', 6, drain)
  ctx.atCharacter('TravelerPyro', 720, (at) => {
    if (s.token === token) exit(at, s)
  })
}

/** Nightsoul (C6): a normal, charged or plunging attack made in the blessing is Pyro */
function nightsoulEle(ctx: SimContext, s: PyroState): HitElement {
  return ctx.constellation('TravelerPyro') >= 6 && s.active
    ? 'pyro'
    : 'physical'
}

export const kit: KitModel = {
  characterKey: 'TravelerPyro',
  element: 'pyro',
  source: `${GCSIM}/traveler/pyro`,
  init: (): PyroState => ({
    points: 0,
    active: false,
    token: 0,
    armed: false,
    scorchReady: true,
    scorchToken: 0,
    c2Until: -1,
    c2Count: 0,
    blades: 0,
    infernoReady: -1,
  }),
  nightsoul: (_ctx, s: PyroState) => ({ active: s.active, points: s.points }),
  onStart(ctx, s: PyroState) {
    sync(ctx, s)
    ctx.state('TravelerPyro', ['TravelerPyro', 'c1Ns'], '')
    ctx.note(
      'TravelerPyro: A4 energy refunds are not validated by the damage simulation.'
    )
  },
  act(ctx, s: PyroState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          pyroNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: nightsoulEle(ctx, s),
              nightsoul: ctx.constellation('TravelerPyro') >= 6 && s.active,
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged': {
        // Foreign Starfire (the locked passive, when the Traveler has it: the sheet's condition):
        // with 2 Blade of the Sacred Flame stacks the Charged Attack is Inferno (15 s cooldown),
        // Nightsoul-aligned Pyro with +200% ATK per hit. gcsim has no Inferno: its frames are
        // the Charged Attack's.
        const inferno =
          s.blades >= 2 &&
          ctx.now >= s.infernoReady &&
          // (the simulation turns the story/resonance condition on for every Traveler)
          ctx.hasBuff('TravelerPyro', ['Traveler', 'lockedPassive'])
        if (inferno) {
          s.blades = 0
          s.infernoReady = ctx.now + 15 * 60
        }
        // C6 in the blessing: Pyro and Nightsoul-aligned, on the enhanced Charged Attack's ICD
        const c6 = ctx.constellation('TravelerPyro') >= 6 && s.active
        // Charged Attack: two hits, 14 and 25 frames in
        ;[14, 25].forEach((d, i) =>
          ctx.hit(d, {
            path: [inferno ? 'lockedPassive' : 'charged', `dmg${i + 1}`],
            tag: 'charged',
            element: inferno ? 'pyro' : nightsoulEle(ctx, s),
            nightsoul: inferno || c6,
            applies: true,
            icd: inferno || c6 ? 'travelerEnhancedCA' : 'normal',
            label: `${inferno ? 'Charged Attack: Inferno' : 'Charged Attack'} (${i + 1})`,
          })
        )
        return {
          frames: 58,
          framesInto: { skill: 34, burst: 35, dash: 25, jump: 25, swap: 25 },
        }
      }
      case 'skill': {
        // C2 Ever-Lit Candle: for 12 s, party Pyro reactions restore 14 points (twice at most)
        s.c2Until = ctx.now + 12 * 60
        s.c2Count = 0
        if (action.hold) {
          // Flowfire Blade (hold): a Nightsoul blessing from frame 48, and Scorching Threshold
          // armed until it ends (the hold's own hit is the first trigger)
          s.armed = true
          const token = ++s.token
          ctx.atCharacter('TravelerPyro', 48, (at) => enter(at, s, token))
          ctx.hit(50, {
            path: ['skill', 'scorchingInstantDmg'],
            tag: 'skill',
            element: 'pyro',
            nightsoul: true,
            applies: true,
            icd: 'holdDmg',
            label: 'Flowfire Blade (hold)',
          })
          return {
            cooldown: { key: 'skill', frames: 1080, delay: 48 },
            frames: 81,
            framesInto: {
              normal: 61,
              burst: 59,
              skill: 77,
              dash: 60,
              jump: 61,
              swap: 59,
            },
          }
        }
        // Tap: a Nightsoul blessing from frame 19 (42 points), and a Blazing Threshold every 66
        // frames from frame 24 while it lasts. A tap E disarms Scorching Threshold
        s.armed = false
        const token = ++s.token
        ctx.atCharacter('TravelerPyro', 19, (at) => enter(at, s, token))
        const blaze = (c2: SimContext) => {
          if (s.token !== token || !s.active) return
          if (
            c2.target.distance <=
            c2.target.radius + (s.points >= 20 ? 3 : 0.5)
          )
            c2.hit(0, {
              path: ['skill', 'blazingDmg'],
              tag: 'skill',
              element: 'pyro',
              nightsoul: true,
              applies: true,
              icd: 'blazing',
              label: 'Blazing Threshold',
            })
          c2.atCharacter('TravelerPyro', 66, blaze)
        }
        ctx.atCharacter('TravelerPyro', 24, blaze)
        return {
          cooldown: { key: 'skill', frames: 1080, delay: 19 },
          frames: 49,
          framesInto: { dash: 31, jump: 31, swap: 48 },
        }
      }
      case 'burst': {
        // Plains Scorcher at 40 frames; 7 Nightsoul points at 42, 94, 153 and 212 frames;
        // C4: Pyro DMG +20% for 9 s
        ctx.hit(40, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'pyro',
          nightsoul: true,
          applies: true,
          icd: 'none',
          label: 'Plains Scorcher',
        })
        for (const d of [42, 94, 153, 212])
          ctx.atCharacter('TravelerPyro', d, () => {
            s.points = Math.min(NS_MAX, s.points + 7)
          })
        if (ctx.constellation('TravelerPyro') >= 4)
          ctx.buff(
            'TravelerPyro',
            ['TravelerPyro', 'c4AfterBurst'],
            'on',
            0,
            9 * 60
          )
        return {
          cooldown: { key: 'burst', frames: 1080 },
          frames: 49,
          framesInto: { skill: 48, swap: 47 },
        }
      }
      case 'plunge':
        // gcsim's low plunge (Lumine): the impact at 47 frames (the same numbers as Cryo's)
        ctx.hit(47, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: nightsoulEle(ctx, s),
          nightsoul: ctx.constellation('TravelerPyro') >= 6 && s.active,
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 74,
          framesInto: { normal: 58, skill: 58, burst: 58, dash: 47, swap: 61 },
        }
      case 'dash':
        // Lumine's dash (gcsim's template for a Girl body): 20 frames, 4 to the jump
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // gcsim's template: 31 frames, 34 right after a dash; a sword's plunge after 5
        return {
          frames: previous?.kind === 'dash' ? 34 : 31,
          framesInto: { plunge: 5 },
        }
      default:
        return { frames: 30 }
    }
  },
  onNightsoulBurst(_ctx, s: PyroState) {
    // Foreign Starfire: a Blade of the Sacred Flame stack per party Nightsoul Burst (max 2)
    s.blades = Math.min(2, s.blades + 1)
  },
  onBeforeHit(ctx, s: PyroState, hit: SimHit) {
    // C1: while the Traveler's blessing is up, the active member deals +6% DMG, and +9% more if
    // they are in their own Nightsoul's Blessing (gcsim's c1Init: at the hit)
    if (
      ctx.constellation('TravelerPyro') < 1 ||
      hit.path[0].startsWith('_') ||
      hit.characterKey !== ctx.onField
    )
      return
    const own =
      hit.characterKey === 'TravelerPyro'
        ? s.active
        : ctx.inNightsoul(hit.characterKey)
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'TravelerPyro',
        path: ['TravelerPyro', 'c1Ns'],
        value: own ? 'on' : '',
      },
    ]
  },
  onHit(ctx, s: PyroState, hit: SimHit) {
    // C2: a party Pyro reaction within 12 s of E restores 14 points (twice per E)
    if (
      ctx.constellation('TravelerPyro') >= 2 &&
      ctx.now < s.c2Until &&
      s.c2Count < 2 &&
      ((hit.path[0] === '_reaction' &&
        C2_REACTIONS.includes(hit.path[1]) &&
        (hit.path[1] !== 'crystallize' || hit.element === 'pyro')) ||
        hit.path.join('.') === 'reaction.burgeon')
    ) {
      s.c2Count++
      s.points = Math.min(NS_MAX, s.points + 14)
    }
    // Native listens to damage, including transformative hits, but excludes Burning,
    // Hydro Swirl, heals, reaction notifications and other zero-damage markers. The game text
    // has only the active character's damage trigger it (gcsim: anyone's).
    if (
      hit.path[0].startsWith('_') ||
      !s.armed ||
      !s.active ||
      !s.scorchReady ||
      hit.characterKey !== ctx.onField
    )
      return
    if (
      hit.path[0] === 'reaction' &&
      ['burning', 'hydroSwirl'].includes(hit.path[1])
    )
      return
    s.scorchReady = false
    const token = ++s.scorchToken
    ctx.atCharacter('TravelerPyro', 180, () => {
      if (s.scorchToken === token) s.scorchReady = true
    })
    if (ctx.target.distance > ctx.target.radius + (s.points >= 20 ? 4 : 1.5))
      return
    ctx.hit(12, {
      characterKey: 'TravelerPyro',
      path: ['skill', 'scorchingDmg'],
      tag: 'skill',
      element: 'pyro',
      nightsoul: true,
      applies: true,
      icd: 'scorching',
      label: 'Scorching Threshold',
    })
  },
}
