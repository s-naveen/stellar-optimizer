import type { HitElement, KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/keqing, main as of 2026-11-10. */

const keqingNormals: NormalHit[] = [
  {
    hitmarks: [10],
    hitlag: [6],
    // (gcsim: N1 into a charged attack counts world time)
    normalizedInto: ['charged'],
    toNormal: 15,
    toCharged: 19,
    toAbil: 10,
    frames: 19,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    toNormal: 16,
    toCharged: 24,
    toAbil: 10,
    frames: 24,
  },
  {
    hitmarks: [14],
    hitlag: [8],
    toNormal: 27,
    toCharged: 36,
    toAbil: 14,
    frames: 36,
  },
  {
    hitmarks: [11, 21],
    hitlag: [0, 6],
    toNormal: 31,
    toCharged: 58,
    toAbil: 21,
    frames: 58,
  },
  { hitmarks: [22], toNormal: 66, toCharged: 66, toAbil: 22, frames: 66 },
]

/** C6's Electro stacks: one per source, each 8 s from its last use */
type C6Source = 'attack' | 'charge' | 'skill' | 'burst'

interface KeqingState {
  /** The Lightning Stiletto is up (until `stilettoEnd`): the next E is a recast */
  stiletto: boolean
  stilettoEnd: number
  /** A1: the weapon's Electro infusion runs until this frame of her clock (hitlag extends it) */
  infuseEnd: number
  /** C6: each source's stack runs until this frame */
  c6Until: Record<C6Source, number>
}

/** Normal, charged and plunging attacks are Electro while the A1 infusion is up (at the hit) */
const attackElement = (c: SimContext, s: KeqingState): HitElement =>
  c.characterFrame('Keqing') < s.infuseEnd ? 'electro' : 'physical'

type Hit = Parameters<SimContext['hit']>[1]
/** A hit whose element (the A1 infusion) is decided when it lands */
const infusableHit = (
  ctx: SimContext,
  s: KeqingState,
  delay: number,
  hit: Omit<Hit, 'element'>
) => ctx.at(delay, (c) => c.hit(0, { ...hit, element: attackElement(c, s) }))

/** C6: a source's Electro stack, from `at` for 8 s (extending its stack if it is still up) */
function c6Use(ctx: SimContext, s: KeqingState, src: C6Source, at: number) {
  if (ctx.constellation('Keqing') < 6) return
  const from = Math.max(at, s.c6Until[src])
  // (four independent sources: up to 4 stacks)
  if (at + 480 > from)
    ctx.buff(
      'Keqing',
      ['Keqing', 'c6Stack'],
      '1',
      from - ctx.now,
      at + 480 - from,
      4
    )
  s.c6Until[src] = at + 480
}

/** C4's Electro-related reactions (marked on the hit that triggers them) */
const C4_REACTIONS = new Set([
  'overloaded',
  'electroCharged',
  'lunarCharged',
  'superconduct',
  'stellarConduct',
  'quicken',
  'aggravate',
])

export const kit: KitModel = {
  characterKey: 'Keqing',
  element: 'electro',
  source: `${GCSIM}/keqing`,
  init: (): KeqingState => ({
    stiletto: false,
    stilettoEnd: -1e9,
    infuseEnd: -1e9,
    c6Until: { attack: -1e9, charge: -1e9, skill: -1e9, burst: -1e9 },
  }),
  // a recast (the Stiletto is up) does not wait for the skill's cooldown
  cooldownKey: (s: KeqingState, action) =>
    action.kind === 'skill'
      ? s.stiletto
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  act(ctx, s: KeqingState, action, previous) {
    const c = ctx.constellation('Keqing')
    switch (action.kind) {
      case 'normal':
        return normalString(
          keqingNormals,
          action.count ?? 1,
          (i, d, j) => {
            // C6: each Normal Attack refreshes its stack when it starts
            if (j === 0)
              c6Use(
                ctx,
                s,
                'attack',
                ctx.now + d - keqingNormals[i].hitmarks[0]
              )
            // the 4th Normal Attack has two hits: the sheet's nodes 3 and 4
            const node = i < 3 ? i : i === 3 ? 3 + j : 5
            infusableHit(ctx, s, d, {
              path: ['normal', `${node}`],
              tag: 'normal',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${i === 3 ? ` (${j + 1})` : ''}`,
            })
          },
          ctx
        )
      case 'charged': {
        c6Use(ctx, s, 'charge', ctx.now)
        // Thunderclap Slash: with the Stiletto up, it is spent for two Electro hits
        const thunderclap = s.stiletto
        s.stiletto = false
        for (const [node, d] of [
          ['dmg1', 21],
          ['dmg2', 24],
        ] as const) {
          infusableHit(ctx, s, d, {
            path: ['charged', node],
            tag: 'charged',
            applies: true,
            icd: 'normal',
            label: 'Charged Attack',
          })
          if (thunderclap)
            ctx.hit(d, {
              path: ['skill', 'thunderclap'],
              tag: 'skill',
              element: 'electro',
              applies: true,
              durability: 50,
              icd: 'skill',
              label: 'Thunderclap Slash',
            })
        }
        return {
          frames: 36,
          framesInto: { skill: 35, burst: 35, dash: 24, jump: 24, swap: 24 },
        }
      }
      case 'skill': {
        if (s.stiletto) {
          // Stellar Restoration recast: C1's two hits, then the slash (no cooldown)
          if (c >= 1)
            for (const d of [3, 16])
              ctx.hit(d, {
                path: ['constellation1', 'dmg'],
                tag: 'skill',
                element: 'electro',
                applies: true,
                icd: 'skill',
                label: 'Stellar Restoration (C1)',
              })
          ctx.hit(16, {
            path: ['skill', 'slash'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            durability: 50,
            icd: 'skill',
            label: 'Stellar Restoration (slash)',
          })
          // A1: the Electro infusion "for 5s" from the recast (game text; gcsim has 5.33 s) (modelled
          // as on: the sheet needs ascension 1+)
          ctx.note(
            'Keqing: the A1 infusion after a recast is modelled as on (ascension 1+)'
          )
          ctx.buff('Keqing', ['Keqing', 'afterRecast'], 'afterRecast', 0, 300, {
            recipient: 'Keqing',
            hitlag: 'recipient',
          })
          s.infuseEnd = ctx.characterFrame('Keqing') + 300
          s.stiletto = false
          // C6: the recast is an Elemental Skill too (game text: "when initiating ... Elemental
          // Skill"; gcsim only counts the first cast)
          c6Use(ctx, s, 'skill', ctx.now)
          return {
            frames: 43,
            framesInto: { normal: 42, dash: 16, jump: 16, swap: 42 },
          }
        }
        // Stellar Restoration: the Lightning Stiletto stays 5.3 s; the skill's cooldown starts
        // 20 frames in
        ctx.hit(25, {
          path: ['skill', 'stiletto'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: 'Stellar Restoration',
        })
        // C6: the first skill (not the recast) gives a stack
        c6Use(ctx, s, 'skill', ctx.now)
        s.stiletto = true
        s.stilettoEnd = ctx.now + 320
        ctx.at(320, (c2) => {
          if (c2.now >= s.stilettoEnd) s.stiletto = false
        })
        return {
          cooldown: { key: 'skill', frames: 450, delay: 20 },
          frames: 37,
          framesInto: { normal: 36, skill: 35, dash: 21, jump: 21, swap: 28 },
        }
      }
      case 'burst': {
        c6Use(ctx, s, 'burst', ctx.now)
        // A4: CRIT Rate and Energy Recharge for 8 s (her hitlag extends it)
        ctx.buff('Keqing', ['Keqing', 'afterBurst'], 'afterBurst', 0, 480, {
          recipient: 'Keqing',
          hitlag: 'recipient',
        })
        // Starward Sword: the initial hit, 8 slashes 11 frames apart from frame 82, the final hit
        ctx.hit(56, {
          path: ['burst', 'initial'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'burst',
          label: 'Starward Sword (initial)',
        })
        for (let t = 82; t < 162; t += 11)
          ctx.hit(t, {
            path: ['burst', 'slash'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            icd: 'burst',
            label: 'Starward Sword (slash)',
          })
        ctx.hit(197, {
          path: ['burst', 'final'],
          tag: 'burst',
          element: 'electro',
          applies: true,
          icd: 'burst',
          label: 'Starward Sword (final)',
        })
        return {
          cooldown: { key: 'burst', frames: 720, delay: 52 },
          frames: 124,
          framesInto: { normal: 123, skill: 123, swap: 122 },
        }
      }
      case 'plunge':
        ctx.note(
          'Keqing: a plunging attack is modelled as the low plunge (no collision)'
        )
        infusableHit(ctx, s, 46, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          applies: true,
          icd: 'none',
          label: 'Low Plunge',
        })
        return {
          frames: 73,
          framesInto: { normal: 57, skill: 57, burst: 58, dash: 46, swap: 60 },
        }
      // template dash (Girl body)
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      // template jump (Girl body): 34 frames after a dash, else 31
      case 'jump':
        return templateJump('girl', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, _s: KeqingState, hit) {
    // C4: an Electro reaction she triggers gives +25% ATK for 10 s
    if (
      hit.characterKey === 'Keqing' &&
      ctx.constellation('Keqing') >= 4 &&
      ((hit.path[0] === '_reaction' && C4_REACTIONS.has(hit.path[1])) ||
        (hit.path[0] === 'reaction' && hit.path[1] === 'hyperbloom'))
    )
      ctx.buff('Keqing', ['Keqing', 'afterReact'], 'afterReact', 0, 600, {
        hitlag: 'recipient',
      })
  },
}
