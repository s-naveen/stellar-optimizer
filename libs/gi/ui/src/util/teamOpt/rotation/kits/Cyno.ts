import type { KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/cyno, main as of 2026-11-10. */

/*
 * Follows upstream gcsim (b107b5d), which has the post-5.0 Revelation: Secret Rite outside
 * Pactsworn enters a 379-frame Pactsworn (no extensions, Endseer from 265 frames); inside a
 * Polestar Field (Stellar-Conduct radiance) Judication fires Duststalker Bolts - Starsame, C1
 * gives Together We Rise (EM, passed to the next character on swap), C2 adds its Stellar-Conduct
 * stacks and C6 fires Starsame bolts. The pinned kqmsim has none of this (E>E there waits for
 * Secret Rite's cooldown). Pactsworn, Endseer and the C1/C2/C6 timers run on Cyno's clock (they
 * are hitlag-extended in gcsim). Not modelled: C4 (energy), plunge collision and the airborne
 * check of plunges (plunges are the low plunge).
 */

const cynoNormals: NormalHit[] = [
  {
    hitmarks: [14],
    hitlag: [1],
    toNormal: 15,
    toCharged: 28,
    toAbil: 14,
    frames: 28,
  },
  {
    hitmarks: [17],
    hitlag: [4],
    toNormal: 22,
    toCharged: 23,
    toAbil: 17,
    frames: 23,
  },
  {
    hitmarks: [13, 22],
    hitlag: [0, 4],
    toNormal: 27,
    toCharged: 26,
    toAbil: 22,
    frames: 27,
  },
  {
    hitmarks: [27],
    hitlag: [4],
    toNormal: 58,
    toCharged: 58,
    toAbil: 27,
    frames: 58,
  },
]

/**
 * Pactsworn Pathclearer's normal attacks (their own string). gcsim's halt frames are raw frames
 * (0.01 to 0.05, not seconds): any pause rounds up to a frame; N5 adds the defense halt (3.6).
 * Hits are character tasks, so N4's second hit waits for the first's pause.
 */
const cynoPactNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [1],
    toNormal: 16,
    toCharged: 28,
    toAbil: 12,
    frames: 28,
  },
  {
    hitmarks: [14],
    hitlag: [1],
    toNormal: 31,
    toCharged: 35,
    toAbil: 14,
    frames: 35,
  },
  {
    hitmarks: [18],
    hitlag: [1],
    toNormal: 41,
    toCharged: 39,
    toAbil: 18,
    frames: 41,
  },
  {
    hitmarks: [5, 14],
    hitlag: [1, 1],
    toNormal: 27,
    toCharged: 36,
    toAbil: 14,
    frames: 36,
  },
  {
    hitmarks: [40],
    hitlag: [4],
    toNormal: 62,
    toCharged: 62,
    toAbil: 40,
    frames: 62,
  },
]

interface CynoState {
  /** Pactsworn Pathclearer is on (set and cleared by its expiry task) */
  pactActive: boolean
  /** Its end on Cyno's clock (hitlag-extended, as gcsim's status) */
  pactEnd: number
  /** Increments per Pactsworn; stale expiry tasks check it */
  pactId: number
  /** Mortuary Rite extensions left in this Pactsworn (2 per Sacred Rite, none after E's) */
  extensionsLeft: number
  /** A1: Endseer windows (84 frames, Cyno's clock) start here, then every 234 frames */
  endseerFrom: number
  /** A1: the Endseer windows extended by a dash (17 frames, once per window) */
  endseerDashed: Set<number>
  /** C1: Normal Attack SPD +20% until (Cyno's clock) */
  c1End: number
  /** C1 (Revelation): Together We Rise until (Cyno's clock, then the holder's) */
  togetherEnd: number
  togetherId: number
  /** C2: Electro DMG stacks, their end (Cyno's clock) and 0.1 s ICD */
  c2Stacks: number
  c2End: number
  c2Icd: number
  /** C2 (Revelation): Together We Rise holders' Stellar-Conduct stacks and 0.1 s ICD */
  c2TeamStacks: number
  c2TeamIcd: number
  /** C6: Day of the Jackal stacks, status end and 0.4 s bolt ICD (Cyno's clock) */
  c6Stacks: number
  c6End: number
  c6Icd: number
  /** C6: the current normal attack was queued with Day of the Jackal ready */
  c6Armed: boolean
  /** gcsim's two normal counters (Pactsworn's and the plain string) */
  pactCombo: number
  plainCombo: number
}

/**
 * Cyno's own clock (gcsim's hitlag-affected statuses and character tasks). gcsim's statuses are
 * active through their expiry frame, so the ends below are exclusive (+1).
 */
const clock = (ctx: SimContext) => ctx.characterFrame('Cyno')

/** Stellar-Conduct radiance: Cyno stands in a Polestar Field */
const stellar = (ctx: SimContext) => ctx.radiance === 'conduct'

/** A1: is an Endseer window up now */
function endseerOn(ctx: SimContext, s: CynoState) {
  const t = clock(ctx)
  if (!s.pactActive || t < s.endseerFrom) return false
  const k = Math.floor((t - s.endseerFrom) / 234)
  return t - (s.endseerFrom + 234 * k) <= 84 + (s.endseerDashed.has(k) ? 17 : 0)
}

/** Pactsworn's expiry task: it reschedules itself while extensions push the end back */
function pactExpiry(ctx: SimContext, s: CynoState, id: number) {
  if (id !== s.pactId || !s.pactActive) return
  const left = s.pactEnd - clock(ctx)
  if (left > 0) {
    ctx.atCharacter('Cyno', left, (c) => pactExpiry(c, s, id))
    return
  }
  endPact(ctx, s)
}

function endPact(ctx: SimContext, s: CynoState) {
  s.pactActive = false
  s.pactEnd = Math.min(s.pactEnd, clock(ctx))
  ctx.state('Cyno', ['Cyno', 'afterBurst'], '')
}

/** Enters Pactsworn for `dur` frames of Cyno's clock (the afterBurst conditional: EM +100) */
function enterPact(
  ctx: SimContext,
  s: CynoState,
  dur: number,
  extensions: number,
  endseerAfter: number
) {
  const id = ++s.pactId
  s.pactActive = true
  s.pactEnd = clock(ctx) + dur + 1
  s.extensionsLeft = extensions
  s.endseerFrom = clock(ctx) + endseerAfter
  s.endseerDashed = new Set()
  ctx.state('Cyno', ['Cyno', 'afterBurst'], 'on')
  ctx.atCharacter('Cyno', dur + 1, (c) => pactExpiry(c, s, id))
  // C1 (Revelation): Together We Rise for this Pactsworn, in a Polestar Field
  if (ctx.constellation('Cyno') >= 1 && stellar(ctx)) {
    s.c2TeamStacks = 0
    ctx.state('Cyno', ['Cyno', 'c2TeamHit'], '')
    setTogether(ctx, s, s.pactEnd)
  }
}

/** Pactsworn (and Together We Rise with it) lasts `by` more frames */
function extendPact(ctx: SimContext, s: CynoState, by: number) {
  s.pactEnd += by
  if (s.togetherEnd > clock(ctx)) setTogether(ctx, s, s.togetherEnd + by)
}

/** gcsim's PP slide: an action whose hitmark falls after Pactsworn's end keeps it up */
function ppSlide(ctx: SimContext, s: CynoState, hitmark: number) {
  // gcsim's StatusDuration: frames to the (inclusive) expiry
  const left = s.pactEnd - 1 - clock(ctx)
  if (s.pactActive && left > 0 && left < hitmark)
    extendPact(ctx, s, hitmark - left + 1)
}

/** C1 (Revelation): Together We Rise (the c1Together conditional) until `end` (Cyno's clock) */
function setTogether(ctx: SimContext, s: CynoState, end: number) {
  const id = ++s.togetherId
  s.togetherEnd = end
  ctx.state('Cyno', ['Cyno', 'c1Together'], 'on')
  const expire = (c: SimContext) => {
    if (id !== s.togetherId) return
    const left = s.togetherEnd - clock(c)
    if (left > 0) return c.atCharacter('Cyno', left, expire)
    c.state('Cyno', ['Cyno', 'c1Together'], '')
    c.state('Cyno', ['Cyno', 'c2TeamHit'], '')
  }
  ctx.atCharacter('Cyno', end - clock(ctx), expire)
}

/** C6: Day of the Jackal: +4 stacks (8 max) for 8 s */
function gainJackal(ctx: SimContext, s: CynoState) {
  if (ctx.constellation('Cyno') < 6) return
  s.c6Stacks = Math.min(8, s.c6Stacks + 4)
  s.c6End = clock(ctx) + 481
}

/** The Mortuary Rite / Secret Rite cooldowns: using either puts each one that is ready on CD */
function skillCooldowns(ctx: SimContext, delay: number) {
  ctx.at(delay, (c) => {
    if (c.cooldownReadyAt('skill', 'Cyno') <= c.now)
      c.setCooldown('skill', 450, 'Cyno')
    if (c.cooldownReadyAt('skillB', 'Cyno') <= c.now)
      c.setCooldown('skillB', 180, 'Cyno')
  })
}

/**
 * gcsim keeps separate normal counters for Pactsworn and the plain string (both reset by any
 * other action): the engine's shared counter only tells whether the combo continues. Returns a
 * context whose `normalSequence` gives this mode's position.
 */
function comboContext(
  ctx: SimContext,
  s: CynoState,
  pact: boolean,
  count: number
): SimContext {
  const n = Math.max(1, count)
  if (ctx.normalSequence(1e6, n) === 0) {
    s.pactCombo = 0
    s.plainCombo = 0
  }
  const length = pact ? cynoPactNormals.length : cynoNormals.length
  const first = pact ? s.pactCombo : s.plainCombo
  if (pact) s.pactCombo = (first + n) % length
  else s.plainCombo = (first + n) % length
  const wrapped = Object.create(ctx) as SimContext
  wrapped.normalSequence = () => first
  return wrapped
}

export const kit: KitModel = {
  characterKey: 'Cyno',
  element: 'electro',
  source: `${GCSIM}/cyno`,
  normalAnimationDelay: (_ctx, s: CynoState, kind) =>
    kind === 'xingqiu' ? (s.pactActive ? 12 : 10) : 0,
  init: (): CynoState => ({
    pactActive: false,
    pactEnd: -1e9,
    pactId: 0,
    extensionsLeft: 0,
    endseerFrom: -1e9,
    endseerDashed: new Set(),
    c1End: -1e9,
    togetherEnd: -1e9,
    togetherId: 0,
    c2Stacks: 0,
    c2End: -1e9,
    c2Icd: -1e9,
    c2TeamStacks: 0,
    c2TeamIcd: -1e9,
    c6Stacks: 0,
    c6End: -1e9,
    c6Icd: -1e9,
    c6Armed: false,
    pactCombo: 0,
    plainCombo: 0,
  }),
  onStart(ctx) {
    // Revelation is unlocked (gcsim's default)
    ctx.state('Cyno', ['Cyno', 'lockRevelation'], 'on')
  },
  // C1: Normal Attack SPD +20% while already in a normal attack (gcsim's NormalAttackState check)
  normalAttackSpeed: (ctx, s: CynoState, actor, alreadyNormal) =>
    actor === 'Cyno' && alreadyNormal && clock(ctx) < s.c1End ? 0.2 : 0,
  // In Pactsworn Pathclearer his normal, charged and plunging attacks and his E (Mortuary Rite)
  // have frames of their own
  variant(_ctx, s: CynoState, action) {
    if (!s.pactActive) return undefined
    const mode = 'Pactsworn Pathclearer'
    switch (action.kind) {
      case 'normal':
        return { key: 'pactsworn', label: 'Normal Attack', mode }
      case 'charged':
        return { key: 'pactsworn', label: 'Charged Attack', mode }
      case 'plunge':
        return { key: 'pactsworn', label: 'Plunging Attack', mode }
      case 'skill':
        return { key: 'pactsworn', label: 'Mortuary Rite', mode }
      default:
        return undefined
    }
  },
  act(ctx, s: CynoState, action, previous) {
    const c = ctx.constellation('Cyno')
    const pact = s.pactActive
    switch (action.kind) {
      case 'normal': {
        const combo = comboContext(ctx, s, pact, action.count ?? 1)
        if (!pact) {
          s.c6Armed = false
          return normalString(
            cynoNormals,
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
            combo
          )
        }
        // C6: the bolts need Day of the Jackal when the attack is queued
        s.c6Armed = c >= 6 && s.c6Stacks > 0 && clock(ctx) < s.c6End
        const result = normalString(
          cynoPactNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['burst', `normal_${i}`],
              tag: 'normal',
              element: 'electro',
              applies: true,
              icd: 'normal',
              label: `Pactsworn N${i + 1}`,
            }),
          combo
        )
        // Each step keeps Pactsworn up to its last hitmark (the PP slide), at its own start
        for (const step of result.normalStarts ?? []) {
          const hm = cynoPactNormals[step.index].hitmarks
          if (step.offset === 0) ppSlide(ctx, s, hm[hm.length - 1])
          else ctx.at(step.offset, (c2) => ppSlide(c2, s, hm[hm.length - 1]))
        }
        return result
      }
      case 'charged': {
        if (!pact) {
          ctx.hit(24, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'extra',
            icdGroup: 'PoleExtraAttack',
            label: 'Charged Attack',
          })
          return {
            frames: 63,
            framesInto: { burst: 62, dash: 24, jump: 24, swap: 61 },
          }
        }
        ppSlide(ctx, s, 27)
        ctx.hit(27, {
          path: ['burst', 'charged'],
          tag: 'charged',
          element: 'electro',
          applies: true,
          icd: 'extra',
          icdGroup: 'PoleExtraAttack',
          label: 'Pactsworn Charged Attack',
        })
        return {
          frames: 65,
          framesInto: { skill: 63, dash: 27, jump: 27, swap: 63 },
        }
      }
      case 'plunge': {
        if (!pact) {
          ctx.hit(44, {
            path: ['plunging', 'low'],
            tag: 'plunge',
            element: 'physical',
            applies: true,
            icd: 'none',
            label: 'Low Plunge',
          })
          return {
            frames: 72,
            framesInto: {
              normal: 58,
              skill: 58,
              burst: 58,
              dash: 59,
              jump: 59,
              swap: 61,
            },
          }
        }
        ctx.hit(47, {
          path: ['burst', 'plunging_low'],
          tag: 'plunge',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Pactsworn Low Plunge',
        })
        return {
          frames: 74,
          framesInto: {
            normal: 58,
            skill: 57,
            burst: 57,
            dash: 59,
            jump: 58,
            swap: 62,
          },
        }
      }
      case 'skill': {
        // gcsim has no hold for Cyno: a hold is modelled as the tap
        if (action.hold)
          ctx.note('Cyno: hold skill is not in gcsim; modelled as the tap')
        if (pact) {
          // Mortuary Rite (Pactsworn): extends a Sacred Rite's Pactsworn by 4 s, twice
          const endseer = endseerOn(ctx, s)
          ctx.hit(28, {
            path: ['skill', 'riteDmg'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            icd: 'none',
            label: 'Mortuary Rite',
          })
          if (endseer) {
            // A1 (Judication): +35% for this Mortuary Rite (1 s) and 3 Duststalker Bolts;
            // in a Polestar Field the bolts are Starsame (Stellar-Conduct DMG, no aura)
            ctx.buff('Cyno', ['Cyno', 'a1Judication'], 'on', 0, 60, {
              hitlag: 'recipient',
            })
            if (c >= 1 && clock(ctx) < s.c1End) s.c1End = clock(ctx) + 601
            gainJackal(ctx, s)
            const starsame = stellar(ctx)
            for (let j = 0; j < 3; j++)
              ctx.hit(
                28,
                starsame
                  ? {
                      path: ['passive1', 'boltStellarDmg'],
                      tag: 'directStellarConduct',
                      element: 'electro',
                      applies: false,
                      label: 'Duststalker Bolt - Starsame',
                      states: [
                        {
                          owner: 'Cyno',
                          path: ['Cyno', 'lockStellarRadianceSc'],
                          value: 'on',
                        },
                      ],
                    }
                  : {
                      path: ['passive1', 'boltDmg'],
                      tag: 'skill',
                      element: 'electro',
                      applies: true,
                      icd: 'CynoBolt',
                      label: 'Duststalker Bolt',
                    }
              )
          }
          if (s.extensionsLeft > 0) {
            s.extensionsLeft--
            extendPact(ctx, s, 240)
          }
          ppSlide(ctx, s, 28)
          skillCooldowns(ctx, 26)
          ctx.hit(28, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 2,
            label: 'Mortuary Rite hitlag',
          })
          // the Rite's own pause (0.03 s, factor 0.01)
          return withHitlag(
            {
              frames: 34,
              framesInto: { dash: 30, jump: 31, swap: 33 },
            },
            { hitmarks: [28], hitlag: [2] }
          )
        }
        // Secret Rite: Chasmic Soulfarer. Revelation: Pactsworn for 379 frames (no extension)
        ctx.hit(21, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Secret Rite: Chasmic Soulfarer',
        })
        enterPact(ctx, s, 379, 0, 265)
        skillCooldowns(ctx, 17)
        return {
          frames: 43,
          framesInto: { dash: 31, jump: 32, swap: 42 },
        }
      }
      case 'burst': {
        // Sacred Rite: Wolf's Swiftness: Pactsworn for 712 frames (no damage of its own)
        enterPact(ctx, s, 712, 2, 328)
        if (c >= 1) s.c1End = clock(ctx) + 601
        if (c >= 6) {
          s.c6Stacks = 0
          gainJackal(ctx, s)
        }
        return {
          cooldown: { key: 'burst', frames: 1200 },
          frames: 86,
          framesInto: { normal: 84, skill: 84, dash: 84, swap: 83 },
        }
      }
      case 'dash': {
        // A1: a dash in an Endseer window extends it by 17 frames (once per window)
        if (endseerOn(ctx, s)) {
          const k = Math.floor((clock(ctx) - s.endseerFrom) / 234)
          s.endseerDashed.add(k)
        }
        // template dash (Boy body)
        return { frames: 21, framesInto: { jump: 2 } }
      }
      case 'jump':
        // template jump (Boy body): 34 frames after a dash, else 31
        return templateJump('boy', 'polearm', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // Mortuary Rite (in Pactsworn) and Secret Rite have their own cooldowns
  cooldownKey: (s: CynoState, action) =>
    action.kind === 'skill'
      ? s.pactActive
        ? 'skillB'
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onHit(ctx, s: CynoState, hit) {
    ctx.state(
      'Cyno',
      ['Cyno', 'lockStellarRadianceSc'],
      stellar(ctx) ? 'on' : ''
    )
    if (hit.path[0].startsWith('_')) return
    const c = ctx.constellation('Cyno')
    // C2 (Revelation): Together We Rise holders' normal / charged hits: Stellar-Conduct stacks
    if (
      c >= 2 &&
      (hit.tag === 'normal' || hit.tag === 'charged') &&
      hit.characterKey === hit.onField &&
      ctx.hasBuff('Cyno', ['Cyno', 'c1Together']) &&
      hit.t >= s.c2TeamIcd
    ) {
      s.c2TeamIcd = hit.t + 7
      s.c2TeamStacks = Math.min(5, s.c2TeamStacks + 1)
      ctx.at(1, (c2) =>
        c2.state('Cyno', ['Cyno', 'c2TeamHit'], `${s.c2TeamStacks}`)
      )
    }
    if (hit.characterKey !== 'Cyno' || hit.tag !== 'normal') return
    const t = clock(ctx)
    // C2: each normal attack hit adds Electro DMG +10% (5 stacks, 4 s, 0.1 s ICD), after the hit
    if (c >= 2 && t >= s.c2Icd) {
      s.c2Icd = t + 7
      if (t >= s.c2End) s.c2Stacks = 0
      s.c2Stacks = Math.min(5, s.c2Stacks + 1)
      s.c2End = t + 241
      ctx.buff('Cyno', ['Cyno', 'c2NormHitStacks'], `${s.c2Stacks}`, 1, 240, {
        hitlag: 'recipient',
      })
    }
    // C6: a Pactsworn normal attack hit spends Day of the Jackal on a bolt (0.4 s ICD); with
    // Together We Rise it is a Starsame bolt
    if (c >= 6 && s.c6Armed && s.c6Stacks > 0 && t < s.c6End && t >= s.c6Icd) {
      s.c6Icd = t + 25
      s.c6Stacks--
      ctx.hit(
        0,
        t < s.togetherEnd
          ? {
              characterKey: 'Cyno',
              path: ['passive1', 'boltStellarDmg'],
              tag: 'directStellarConduct',
              element: 'electro',
              applies: false,
              label: 'Raiment: Just Scales (C6, Starsame)',
              states: [
                {
                  owner: 'Cyno',
                  path: ['Cyno', 'lockStellarRadianceSc'],
                  value: 'on',
                },
              ],
            }
          : {
              characterKey: 'Cyno',
              path: ['passive1', 'boltDmg'],
              tag: 'skill',
              element: 'electro',
              applies: true,
              icd: 'skill',
              label: 'Raiment: Just Scales (C6)',
            }
      )
    }
  },
  onSwapOut(ctx, s: CynoState) {
    // Pactsworn ends when Cyno leaves the field; Together We Rise passes to the incoming
    // character for its remaining duration
    if (s.pactActive) {
      s.pactId++
      endPact(ctx, s)
    }
    const left = s.togetherEnd - clock(ctx)
    if (left > 0) {
      const id = ++s.togetherId
      s.togetherEnd = clock(ctx)
      ctx.at(left, (c) => {
        if (id !== s.togetherId) return
        c.state('Cyno', ['Cyno', 'c1Together'], '')
        c.state('Cyno', ['Cyno', 'c2TeamHit'], '')
      })
    }
  },
}
