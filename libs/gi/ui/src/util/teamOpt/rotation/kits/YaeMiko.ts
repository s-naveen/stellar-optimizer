import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/yaemiko, main as of 2026-11-10. */

/** A normal attack's projectile travels 10f (gcsim's default `travel`) before it hits */
const TRAVEL = 10

const yaeNormals: NormalHit[] = [
  {
    hitmarks: [14 + TRAVEL],
    toNormal: 16,
    toCharged: 28,
    toAbil: 14,
    frames: 28,
  },
  {
    hitmarks: [22 + TRAVEL],
    toNormal: 36,
    toCharged: 40,
    toAbil: 22,
    frames: 40,
  },
  {
    hitmarks: [33 + TRAVEL],
    toNormal: 79,
    toCharged: 74,
    toAbil: 33,
    frames: 79,
  },
]

/** A Sesshou Sakura (kitsune) totem: gone once popped or expired */
interface Totem {
  expires: number
  gone: boolean
}

interface YaeState {
  /** Yae was on the field at the last action */
  onField: boolean
  totems: Totem[]
  /** Revelation: the next Sakura lightning is enhanced until (Yae's clock; 8 s after the reaction) */
  revelationUntil: number
  /** Revelation's 2.5 s ICD (Yae's clock) */
  revelationIcd: number
}

/** Yae's own clock (gcsim's hitlag-affected statuses, active through their expiry frame) */
const clock = (c: SimContext) => c.characterFrame('YaeMiko')

/** Radiance: Stellar-Conduct (inside a Polestar Field) */
const stellar = (c: SimContext) => c.radiance === 'conduct'

const RADIANCE_SC = {
  owner: 'YaeMiko' as const,
  path: ['YaeMiko', 'lockStellarRadianceSc'],
}

/** The Sesshou Sakura out at `now` (popped or expired ones leave the list) */
const alive = (s: YaeState, now: number) =>
  s.totems.filter((t) => !t.gone && t.expires > now)

/** C2 (Revelation): EM for Yae and the active character by the Sakura level (2 to 4) */
function c2Level(c: SimContext, s: YaeState) {
  if (c.constellation('YaeMiko') < 2) return
  const count = alive(s, c.now).length
  c.state('YaeMiko', ['YaeMiko', 'c2'], count ? `${count + 1}` : '')
}

/** C1 (Revelation): +50% Electro and Stellar-Conduct DMG for the party, 10 s, after the hit */
function c1Buff(c: SimContext) {
  if (c.constellation('YaeMiko') >= 1)
    c.buff('YaeMiko', ['YaeMiko', 'c1'], 'on', 1, 600)
}

/** Sesshou Sakura's ticks: one per totem every 176f from 120f (E's start), on a random target */
function sakuraTick(c: SimContext, s: YaeState, totem: Totem, c2: boolean) {
  if (totem.gone || c.now >= totem.expires) return
  // The level is the number of Sesshou Sakura out (+1 at C2)
  const level = alive(s, c.now).length + (c2 ? 1 : 0)
  // Revelation: after a Superconduct / Stellar-Conduct, the next lightning deals +80% ATK
  // (2.5 s ICD); in Stellar-Conduct radiance it also strikes for 200% ATK (Stellar-Conduct DMG)
  const t = clock(c)
  const enhanced = t < s.revelationUntil && t >= s.revelationIcd
  if (enhanced) {
    s.revelationIcd = t + 151
    s.revelationUntil = -1
  }
  c.hit(1, {
    path: [enhanced ? 'lockedPassive' : 'skill', `dmg${level}`],
    tag: 'skill',
    element: 'electro',
    applies: true,
    icd: 'ElementalArt',
    label: `Sesshou Sakura (level ${level}${enhanced ? ', enhanced' : ''})`,
  })
  if (enhanced && stellar(c)) {
    c.hit(13, {
      path: ['lockedPassive', 'dmg'],
      tag: 'directStellarConduct',
      element: 'electro',
      applies: false,
      label: 'Sesshou Sakura (Stellar-Conduct)',
      states: [{ ...RADIANCE_SC, value: 'on' }],
    })
    c.at(13, c1Buff)
  }
  // C4: a lightning hit gives the team +20% Electro DMG for 5 s
  if (c.constellation('YaeMiko') >= 4)
    c.buff('YaeMiko', ['YaeMiko', 'c4'], 'hit', 1, 5 * 60)
  c.at(176, (c3) => sakuraTick(c3, s, totem, c2))
}

/** Yakan Evocation: a Sesshou Sakura set up (34f into the skill), popping the oldest at 3 */
function makeSakura(c: SimContext, s: YaeState) {
  s.totems = alive(s, c.now)
  if (s.totems.length === 3) {
    s.totems.shift()!.gone = true
    // A1 (Revelation): popping one with 3 out sets off an extra lightning (40% ATK, no aura),
    // 64f later; in Stellar-Conduct radiance 50% ATK as Stellar-Conduct DMG
    const starsame = stellar(c)
    c.hit(64, {
      path: ['passive1', starsame ? 'stellarDmg' : 'dmg'],
      tag: starsame ? 'directStellarConduct' : 'other',
      element: 'electro',
      applies: false,
      icd: 'none',
      label: starsame
        ? 'Yae A1 (3 Sesshou Sakura, Stellar-Conduct)'
        : 'Yae A1 (3 Sesshou Sakura)',
      states: [
        { owner: 'YaeMiko', path: ['YaeMiko', 'lockRevelation'], value: 'on' },
        { ...RADIANCE_SC, value: starsame ? 'on' : '' },
      ],
    })
    if (starsame) c.at(64, c1Buff)
  }
  // The totem lasts 15 s, and 25 s with Revelation (on: gcsim's default)
  const totem: Totem = { expires: c.now + 1466, gone: false }
  s.totems.push(totem)
  c2Level(c, s)
  c.at(1466, (c2) => c2Level(c2, s))
  // First tick 86f after it is set up (120f from the skill's start), then every 176f
  c.at(86, (c2) => sakuraTick(c2, s, totem, c.constellation('YaeMiko') >= 2))
}

export const kit: KitModel = {
  characterKey: 'YaeMiko',
  element: 'electro',
  source: `${GCSIM}/yaemiko`,
  charges: () => ({ skill: 3 }),
  init: (): YaeState => ({
    onField: false,
    totems: [],
    revelationUntil: -1,
    revelationIcd: -1e9,
  }),
  onStart(ctx) {
    // Revelation is unlocked (gcsim's default): longer Sakura, enhanced lightning, C1/C2/C4/C6
    ctx.state('YaeMiko', ['YaeMiko', 'lockRevelation'], 'on')
  },
  act(ctx, s: YaeState, action, previous) {
    const swappedIn = !s.onField
    s.onField = true
    switch (action.kind) {
      case 'normal':
        return normalString(
          yaeNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'electro',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged': {
        // The windup (14f) is skipped after a normal attack
        const windup = !swappedIn && previous?.kind === 'normal' ? 14 : 0
        // Five 2 m boxes, 9f apart from 90f, each 1.65 m further ahead (from the player to
        // 1.65 m, 3.3 m, ...): only those that reach the target's disk hit
        for (let i = 0; i < 5; i++) {
          if (1.65 * (i + 1) >= ctx.target.distance + ctx.target.radius) break
          ctx.hit(90 + 9 * i - windup, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'electro',
            applies: true,
            icd: 'YaeCharged',
            label: `Charged Attack (${i + 1})`,
          })
        }
        return {
          frames: 96 - windup,
          framesInto: {
            charged: 95 - windup,
            dash: 46 - windup,
            jump: 47 - windup,
            swap: 94 - windup,
          },
        }
      }
      case 'skill': {
        // Yakan Evocation: a totem set up at 34f, with its first tick at 120f
        ctx.at(34, (c2) => makeSakura(c2, s))
        return {
          cooldown: { key: 'skill', frames: 4 * 60, delay: 16 },
          frames: 37,
          framesInto: {
            charged: 36,
            burst: 36,
            dash: 20,
            jump: 20,
            swap: 20,
          },
        }
      }
      case 'burst': {
        // Great Secret Art: Tenko Kenshin at 100f, then one Tenko Thunderbolt per totem out
        ctx.hit(100, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Great Secret Art: Tenko Kenshin',
        })
        // Revelation: the Sakura are not destroyed; each still resets a skill charge (A1)
        const totems = alive(s, ctx.now).length
        ctx.resetCooldown('skill', totems)
        for (let i = 0; i < totems; i++)
          ctx.hit(154 + 24 * i, {
            path: ['burst', 'tenkoDmg'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            icd: 'none',
            label: 'Tenko Thunderbolt',
          })
        return {
          cooldown: { key: 'burst', frames: 22 * 60 },
          frames: 114,
          framesInto: {
            normal: 112,
            skill: 113,
            dash: 103,
            jump: 104,
            swap: 101,
          },
        }
      }
      case 'plunge':
        // gcsim's low plunge (it only allows it after Xianyun's burst: not checked here)
        ctx.hit(46, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 66,
          framesInto: {
            normal: 58,
            charged: 48,
            skill: 58,
            burst: 58,
            dash: 46,
            swap: 50,
          },
        }
      case 'dash':
        // Lady body: 22f, and 3f into a jump
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // Lady body: 37f after a dash, 32f otherwise
        return templateJump('lady', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(_ctx, s: YaeState) {
    s.onField = false
  },
  onHit(ctx, s: YaeState, hit) {
    ctx.state(
      'YaeMiko',
      ['YaeMiko', 'lockStellarRadianceSc'],
      stellar(ctx) ? 'on' : ''
    )
    if (hit.path[0] !== '_reaction') return
    if (hit.path[1] !== 'superconduct' && hit.path[1] !== 'stellarConduct')
      return
    // Revelation: a party member's Superconduct / Stellar-Conduct enhances the next lightning
    s.revelationUntil = clock(ctx) + 481
    // C1: Yae's own Superconduct / Stellar-Conduct
    if (hit.characterKey === 'YaeMiko') c1Buff(ctx)
  },
}
