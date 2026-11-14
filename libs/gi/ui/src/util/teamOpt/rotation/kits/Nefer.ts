import type { KitModel, SimContext } from '../types'
import { type NormalHit, normalString, templateJump } from './common'

/*
 * Nefer. Neither gcsim nor the pinned kqmsim has her, so this kit follows the in-game text and the
 * talent numbers (Shadow Dance 9 s and 3 Phantasm Performances; two skill charges, 9 s each; Veil
 * of Falsehood: 9 s per stack, max 3, C2 5 and +5 s; the burst consumes every Veil). Phantasm
 * Performance spends 1 Verdant Dew (the game's ability config: once per performance).
 * Action frames are ESTIMATES (no published frame data): a Lady catalyst body (normals in the range
 * of gcsim's Lisa / Nicole), the performance's two own hits and three shade hits spaced over
 * ~1.6 s, the burst's two hits at 70 and 100 frames.
 * Not modelled: A4 (extra Verdant Dew from Slither, its base amount is not given in-game).
 */

const neferNormals: NormalHit[] = [
  { hitmarks: [18], toNormal: 26, toCharged: 30, toAbil: 18, frames: 32 },
  { hitmarks: [16], toNormal: 27, toCharged: 30, toAbil: 16, frames: 34 },
  // N3: two hits (both on the sheet's node 2)
  {
    hitmarks: [14, 26],
    toNormal: 40,
    toCharged: 42,
    toAbil: 26,
    frames: 48,
  },
  { hitmarks: [24], toNormal: 62, toCharged: 62, toAbil: 24, frames: 62 },
]
// (N3's two hits share the sheet's node 2: the game lists it as one ×2 multiplier)
const normalNode = (i: number, _j: number) => (i < 3 ? i : 3)

/** Shadow Dance: 9 s, or until 3 Phantasm Performances */
const SHADOW = 540
const PERFORMANCES = 3
/** Seeds of Deceit replace the cores of Lunar-Blooms for 15 s after the skill */
const SEED_WINDOW = 900

interface NeferState {
  shadowEnd: number
  performances: number
  seedEnd: number
  seeds: number
  /** Veil of Falsehood stacks: each one's end frame */
  veils: number[]
}

const activeVeils = (s: NeferState, now: number) =>
  s.veils.filter((end) => end > now)

/** Adds Veil stacks (oldest dropped past the cap) and updates the A1 / C2 conditions */
function addVeils(c: SimContext, s: NeferState, n: number) {
  if (n <= 0) return
  const c2 = c.constellation('Nefer') >= 2
  const cap = c2 ? 5 : 3
  const life = c2 ? 840 : 540
  const veils = activeVeils(s, c.now)
  for (let i = 0; i < n; i++) veils.push(c.now + life)
  s.veils = veils.slice(-cap)
  // (the sheet's A1 / C2 Elemental Mastery follows the stack count)
  syncVeils(c, s)
}

/** The Veil count as the sheet's condition, until the next stack expires */
function syncVeils(c: SimContext, s: NeferState) {
  const veils = activeVeils(s, c.now)
  s.veils = veils
  c.state(
    'Nefer',
    ['Nefer', 'a1VeilStacks'],
    veils.length ? `${veils.length}` : ''
  )
  const next = Math.min(...veils)
  if (Number.isFinite(next)) c.at(next - c.now, (c2) => syncVeils(c2, s))
}

/** A direct Lunar-Bloom hit of Phantasm Performance (no element application) */
function lunar(c: SimContext, delay: number, path: string[], label: string) {
  c.hit(delay, {
    path,
    tag: 'other',
    element: 'dendro',
    applies: false,
    icd: 'none',
    label: `${label} (Lunar-Bloom)`,
  })
}

export const kit: KitModel = {
  characterKey: 'Nefer',
  element: 'dendro',
  source: 'in-game text and talent data (no gcsim kit); frames estimated',
  // Moonsign Benediction: +1 to the party's Moonsign
  moonsign: 1,
  charges: () => ({ skill: 2 }),
  init: (): NeferState => ({
    shadowEnd: -1,
    performances: 0,
    seedEnd: -1,
    seeds: 0,
    veils: [],
  }),
  onStart(c) {
    c.note(
      'Nefer: action frames are estimates (no published frame data). Seeds of Deceit are one per Lunar-Bloom in the 15 s after her skill; A4 (Slither Dew) is not modelled.'
    )
  },
  onHit(c, s: NeferState, hit) {
    // A1 (Ascendant Gleam): Lunar-Blooms in the window leave Seeds of Deceit
    if (
      hit.path[0] === '_reaction' &&
      hit.path[1] === 'lunarBloom' &&
      c.now < s.seedEnd &&
      c.moonsign >= 2
    )
      s.seeds++
  },
  act(ctx, s: NeferState, action, previous) {
    const c = ctx.constellation('Nefer')
    const shadow = ctx.now < s.shadowEnd && s.performances < PERFORMANCES
    switch (action.kind) {
      case 'normal':
        return normalString(
          neferNormals,
          action.count ?? 1,
          (i, d, j) =>
            ctx.hit(d, {
              path: ['normal', `${normalNode(i, j)}`],
              tag: 'normal',
              element: 'dendro',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}${i === 2 ? ` (${j + 1})` : ''}`,
            }),
          ctx
        )
      case 'skill': {
        ctx.hit(18, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'skill',
          label: 'Senet Strategy',
        })
        s.shadowEnd = ctx.now + SHADOW
        s.performances = 0
        s.seedEnd = ctx.now + SEED_WINDOW
        // C2: two Veils at once
        if (c >= 2 && ctx.moonsign >= 2) addVeils(ctx, s, 2)
        if (c >= 4) {
          // C4: Dendro RES -20% in Shadow Dance (until 4.5 s after it); Dew 25% faster on field
          ctx.buff('Nefer', ['Nefer', 'c4ShadowDance'], 'on', 0, SHADOW + 270)
          ctx.boostDew(SHADOW, 1.25)
        }
        return {
          frames: 40,
          framesInto: { charged: 30, normal: 34, burst: 34, swap: 36 },
          cooldown: { key: 'skill', frames: 540 },
        }
      }
      case 'charged': {
        // A Charged Attack or a performance absorbs the Seeds of Deceit (one Veil each)
        if (s.seeds) {
          addVeils(ctx, s, s.seeds)
          s.seeds = 0
        }
        if (shadow && ctx.dew >= 1) {
          // Phantasm Performance: 1 Dew; Nefer's two hits, then the shades' three Lunar-Bloom hits
          ctx.consumeDew(1)
          s.performances++
          syncVeils(ctx, s)
          ctx.hit(22, {
            path: ['skill', 'nefer1Dmg'],
            tag: 'charged',
            element: 'dendro',
            applies: true,
            icd: 'charged',
            label: 'Phantasm Performance (Nefer 1)',
          })
          if (c >= 6)
            lunar(
              ctx,
              40,
              ['skill', 'nefer2Dmg'],
              'Phantasm Performance (Nefer 2)'
            )
          else
            ctx.hit(40, {
              path: ['skill', 'nefer2Dmg'],
              tag: 'charged',
              element: 'dendro',
              applies: true,
              icd: 'charged',
              label: 'Phantasm Performance (Nefer 2)',
            })
          lunar(
            ctx,
            58,
            ['skill', 'shade1Dmg'],
            'Phantasm Performance (Shade 1)'
          )
          lunar(
            ctx,
            74,
            ['skill', 'shade2Dmg'],
            'Phantasm Performance (Shade 2)'
          )
          lunar(
            ctx,
            96,
            ['skill', 'shade3Dmg'],
            'Phantasm Performance (Shade 3)'
          )
          // C6: one more Lunar-Bloom hit as the performance ends
          if (c >= 6)
            lunar(
              ctx,
              104,
              ['constellation6', 'dmg'],
              'Phantasm Performance end (C6)'
            )
          if (s.performances >= PERFORMANCES) s.shadowEnd = ctx.now + 100
          return {
            frames: 100,
            framesInto: {
              normal: 96,
              skill: 96,
              burst: 96,
              dash: 60,
              swap: 96,
            },
          }
        }
        ctx.hit(52, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'dendro',
          applies: true,
          icd: 'charged',
          label: 'Charged Attack',
        })
        return {
          frames: 66,
          framesInto: { normal: 62, skill: 62, burst: 62, dash: 52, swap: 62 },
        }
      }
      case 'burst': {
        // Consumes every Veil for its DMG bonus
        const veils = activeVeils(s, ctx.now).length
        s.veils = []
        syncVeils(ctx, s)
        const states = veils
          ? [
              {
                owner: 'Nefer' as const,
                path: ['Nefer', 'burstVeilsAbsorbed'],
                value: `${veils}`,
              },
            ]
          : undefined
        for (const [d, node, label] of [
          [70, 'hit1', 'Sacred Vow (1)'],
          [100, 'hit2', 'Sacred Vow (2)'],
        ] as const)
          ctx.hit(d, {
            path: ['burst', node],
            tag: 'burst',
            element: 'dendro',
            applies: true,
            durability: 25,
            icd: 'burst',
            label,
            states,
          })
        return {
          frames: 115,
          framesInto: { normal: 112, skill: 112, swap: 110 },
          cooldown: { key: 'burst', frames: 900 },
        }
      }
      case 'dash':
        return { frames: 20, framesInto: { jump: 3 } }
      case 'jump':
        return templateJump('lady', 'catalyst', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
