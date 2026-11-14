import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/lyney, main as of 2026-11-10. */

// Normal hits land `travel` (10) frames after their release (the arrow's flight): the hitmarks
// below are release + 10, the cancels are from the release.
const lyneyNormals: NormalHit[] = [
  { hitmarks: [27], toNormal: 22, toCharged: 22, toAbil: 17, frames: 32 },
  { hitmarks: [22], toNormal: 24, toCharged: 12, toAbil: 12, frames: 34 },
  { hitmarks: [30, 39], toNormal: 39, toCharged: 81, toAbil: 29, frames: 86 },
  { hitmarks: [39], toNormal: 59, toCharged: 29, toAbil: 29, frames: 66 },
]

interface Hat {
  alive: boolean
  /** Its Prop Arrow drained HP: A1 (+80% ATK on its Pyrotechnic Strike) */
  drained: boolean
}

interface LyneyState {
  /** Prop Surplus stacks (max 5), spent by Bewildering Lights */
  prop: number
  /** HP ratio without HP tracking: drained by Prop Arrows, healed by Bewildering Lights */
  hp: number
  /** Grin-Malkin Hats: alive ones explode, expire or are killed */
  hats: Hat[]
  /** Miracle Parade is up (its firework is due): from 100 frames after the cast */
  burstOn: boolean
  /** The cast that started the Miracle Parade (a newer one owns the firework) */
  burstTok: number
  /** C1: the next Prop Arrow's extra stack and hat (15 s ICD) */
  c1Ready: number
  /** Spiritbreath Thorn ICD (6 s) */
  thornReady: number
  /** Off the field since its last action: its next action is a swap-in */
  away: boolean
  /** C2: the on-field session; undefined off the field */
  c2Tok?: number
  c2Stacks: number
}

/** C4: the enemy's Pyro RES -20% for 6 s after a charged hit */
const c4 = (c: SimContext, delay: number) => {
  if (c.constellation('Lyney') >= 4)
    c.buff('Lyney', ['Lyney', 'c4Hit'], 'on', delay, 360)
}

/** A Pyrotechnic Strike from a hat, `delay` frames from now (the hat is gone) */
function hatPyro(c: SimContext, hat: Hat, delay: number, label: string) {
  hat.alive = false
  // A1: the drained hat's strike has +80% ATK (a conditional on until the hit)
  if (hat.drained) c.buff('Lyney', ['Lyney', 'a1DrainHp'], 'on', 0, delay + 1)
  c.hit(delay, {
    path: ['charged', 'pyrotechnic'],
    tag: 'charged',
    element: 'pyro',
    applies: true,
    icd: 'lyneyExtra',
    label,
  })
  c4(c, delay)
}

/** A hat: at the limit (2 with C1) the oldest is killed (its strike); it expires after `life` */
function spawnHat(
  c: SimContext,
  s: LyneyState,
  life: number,
  drained: boolean
) {
  const max = c.constellation('Lyney') >= 1 ? 2 : 1
  let alive = s.hats.filter((h) => h.alive)
  while (alive.length >= max) {
    hatPyro(c, alive[0], 36, 'Pyrotechnic Strike (hat killed)')
    alive = alive.slice(1)
  }
  const hat: Hat = { alive: true, drained }
  s.hats = [...alive, hat]
  c.at(life, (c2) => {
    if (hat.alive) hatPyro(c2, hat, 36, 'Pyrotechnic Strike (hat expired)')
  })
}

/** Prop Surplus: +1 (max 5) */
const addProp = (s: LyneyState) => {
  s.prop = Math.min(5, s.prop + 1)
}

/** His HP ratio: the party's tracked HP, or the kit's own */
const hpRatio = (c: SimContext, s: LyneyState) =>
  c.healthTracked ? (c.hpRatio('Lyney') ?? 1) : s.hp

/** The Prop Arrow's HP drain: 20% of max HP (down to 60%) for a stack, while above 60% */
function drainHp(c: SimContext, s: LyneyState): boolean {
  const ratio = hpRatio(c, s)
  if (ratio <= 0.6 + 1e-7) return false
  const amount = Math.min(0.2, ratio - 0.6)
  if (c.healthTracked) c.drainHp('Lyney', amount)
  else s.hp = Math.max(0.6, s.hp - amount)
  return true
}

/** C2: a Crisp Focus stack every 2 s on the field (3 max; a character task), cleared on leaving */
function c2Start(c: SimContext, s: LyneyState) {
  const tok = (s.c2Tok = c.now)
  s.c2Stacks = 0
  const tick = (c2: SimContext) => {
    if (s.c2Tok !== tok || s.c2Stacks >= 3) return
    s.c2Stacks++
    c2.state('Lyney', ['Lyney', 'c2Stacks'], `${s.c2Stacks}`)
    c2.atCharacter('Lyney', 120, tick)
  }
  c.atCharacter('Lyney', 120, tick)
}

/** Explosive Firework: the Miracle Parade ends (the firework, a hat and a Prop Surplus stack) */
function firework(c: SimContext, s: LyneyState) {
  if (!s.burstOn) return
  s.burstOn = false
  c.hit(6, {
    path: ['burst', 'fireworkDmg'],
    tag: 'burst',
    element: 'pyro',
    applies: true,
    icd: 'none',
    label: 'Explosive Firework',
  })
  spawnHat(c, s, 245, false)
  addProp(s)
}

export const kit: KitModel = {
  characterKey: 'Lyney',
  element: 'pyro',
  source: `${GCSIM}/lyney`,
  init: (): LyneyState => ({
    prop: 0,
    hp: 1,
    hats: [],
    burstOn: false,
    burstTok: -1,
    c1Ready: 0,
    thornReady: 0,
    away: false,
    c2Stacks: 0,
  }),
  act(ctx, s: LyneyState, action, previous) {
    // C2: the Crisp Focus stacks run while he is on the field (from the swap-in, or from the start
    // when he starts on it: gcsim only starts them on a swap)
    s.away = false
    if (ctx.constellation('Lyney') >= 2 && s.c2Tok === undefined)
      c2Start(ctx, s)
    switch (action.kind) {
      case 'normal':
        return normalString(
          lyneyNormals,
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
      case 'charged': {
        // Fully-Charged Aimed Shot (gcsim's default: the Prop Arrow). Release at 103 frames, the
        // arrow lands 10 frames later; the hat and the Thorn follow at that frame.
        ctx.at(103, (c1) => {
          const drained = drainHp(c1, s)
          if (drained) addProp(s)
          c1.hit(10, {
            path: ['charged', 'prop'],
            tag: 'charged',
            element: 'pyro',
            applies: true,
            icd: 'none',
            label: 'Fully-Charged Aimed Shot (Prop Arrow)',
          })
          c4(c1, 10)
          if (c1.constellation('Lyney') >= 6) {
            c1.hit(10, {
              path: ['constellation6', 'dmg'],
              tag: 'charged',
              element: 'pyro',
              applies: true,
              icd: 'lyneyExtra',
              label: 'Pyrotechnic Strike: Reprised (C6)',
            })
            c4(c1, 10)
          }
          c1.at(10, (c2) => {
            // C1: an extra Prop Surplus stack and a second hat, once per 15 s
            let hats = 1
            if (c2.constellation('Lyney') >= 1 && c2.now >= s.c1Ready) {
              addProp(s)
              hats = 2
              s.c1Ready = c2.now + 900
            }
            for (let i = 0; i < hats; i++) spawnHat(c2, s, 238, drained)
            // Spiritbreath Thorn (Arkhe): 42 frames later, 6 s ICD, no element application
            if (c2.now >= s.thornReady) {
              s.thornReady = c2.now + 360
              c2.hit(42, {
                path: ['charged', 'spiritbreath'],
                tag: 'charged',
                element: 'pyro',
                applies: false,
                icd: 'none',
                label: 'Spiritbreath Thorn',
              })
              c4(c2, 42)
            }
          })
        })
        return { frames: 111, framesInto: { dash: 103, jump: 103 } }
      }
      case 'skill': {
        // during Miracle Parade: Bewildering Lights explodes the firework now
        if (s.burstOn) {
          firework(ctx, s)
          return {
            frames: 39,
            framesInto: {
              normal: 14,
              charged: 14,
              skill: 14,
              dash: 8,
              jump: 7,
              swap: 28,
            },
          }
        }
        // the Prop Surplus stacks at the cast (its damage at 18 frames)
        const stacks = s.prop
        s.prop = 0
        for (let k = 0; k < stacks; k++)
          ctx.buff('Lyney', ['Lyney', 'propStacks'], '1', 0, 19, 5)
        ctx.hit(18, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'pyro',
          applies: true,
          durability: 25,
          icd: 'none',
          label: stacks
            ? `Bewildering Lights (${stacks} Prop Surplus)`
            : 'Bewildering Lights',
        })
        // the hats present at 18 frames explode 13 frames later (their strike, no expiry)
        ctx.at(18, (c) => {
          for (const h of s.hats)
            if (h.alive)
              hatPyro(c, h, 13, 'Pyrotechnic Strike (Bewildering Lights)')
        })
        // its heal (18 frames in): 20% of his Max HP per Prop Surplus stack, the active character
        if (stacks)
          ctx.at(18, (c) => {
            if (c.healthTracked)
              c.healPercent('Lyney', 0.2 * stacks, [c.onField])
            else if (c.onField === 'Lyney')
              s.hp = Math.min(1, s.hp + 0.2 * stacks)
          })
        return {
          cooldown: { key: 'skill', frames: 900, delay: 15 },
          frames: 43,
          framesInto: {
            normal: 42,
            charged: 42,
            skill: 42,
            burst: 42,
            jump: 42,
            swap: 41,
          },
        }
      }
      case 'burst': {
        const tok = ctx.now
        // Miracle Parade: on from 100 frames; one tick (an enemy in 4 m is marked for the whole
        // burst, so one hit) at 112; the firework at 282 unless Bewildering Lights set it off
        ctx.at(100, (c1) => {
          s.burstOn = true
          s.burstTok = tok
          c1.at(12, (c2) => {
            if (!s.burstOn || s.burstTok !== tok) return
            c2.hit(0, {
              path: ['burst', 'dmg'],
              tag: 'burst',
              element: 'pyro',
              applies: true,
              icd: 'none',
              label: 'Wondrous Trick: Miracle Parade',
            })
          })
          c1.at(182, (c2) => {
            if (s.burstTok === tok) firework(c2, s)
          })
        })
        return {
          cooldown: { key: 'burst', frames: 900 },
          frames: 321,
          framesInto: {
            normal: 297,
            charged: 297,
            skill: 101,
            dash: 287,
            jump: 285,
            swap: 283,
          },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Lyney (its HighPlungeAttack is not implemented)
        ctx.note(
          'Lyney: the plunge is not in gcsim (not modelled: no damage, default frames).'
        )
        return { frames: 30 }
      case 'dash':
        // Boy body: a 21-frame dash, which can jump after 2 frames
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // Boy body: 31 frames, 34 after a dash
        return templateJump('boy', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onSwapOut(ctx, s: LyneyState) {
    s.away = true
    if (s.c2Tok !== undefined) {
      s.c2Tok = undefined
      s.c2Stacks = 0
      ctx.state('Lyney', ['Lyney', 'c2Stacks'], '')
    }
  },
  // A4: his DMG against an enemy affected by Pyro: the enemy's aura when the hit lands (before
  // its own application, as gcsim's attack modifiers see it)
  onBeforeHit(ctx, _s, hit) {
    if (hit.characterKey !== 'Lyney' || hit.path[0].startsWith('_')) return
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Lyney',
        path: ['Lyney', 'a4AffectedByPyro'],
        value: ctx.absorb(['pyro']) === 'pyro' ? 'on' : '',
      },
    ]
  },
}
