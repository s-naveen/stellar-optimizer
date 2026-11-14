import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { RotationAction } from '../parse'
import type { ActionResult, HitElement, KitModel, SimContext } from '../types'
import {
  KQMSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/varka, main as of 2026-11-10. */

/** Five normal attack steps; the instances of each step */
const varkaNormals: NormalHit[] = [
  {
    hitmarks: [19],
    hitlag: [6],
    toNormal: 23,
    toCharged: 22,
    toAbil: 19,
    frames: 46,
  },
  {
    hitmarks: [18, 28],
    hitlag: [0, 8],
    toNormal: 29,
    toCharged: 30,
    toAbil: 28,
    frames: 46,
  },
  {
    hitmarks: [27, 43],
    hitlag: [0, 8],
    toNormal: 55,
    toCharged: 48,
    toAbil: 43,
    frames: 60,
  },
  {
    hitmarks: [19, 24],
    hitlag: [0, 9],
    toNormal: 40,
    toCharged: 28,
    toAbil: 24,
    frames: 47,
  },
  {
    hitmarks: [44, 45],
    hitlag: [0, 10],
    toNormal: 73,
    toCharged: 48,
    toAbil: 45,
    frames: 82,
  },
]
/** The sheet's node per step and instance (normal: `normal.<node>`; Sturm und Drang: `skill.<node>`) */
const varkaNodes = [
  ['na1'],
  ['na21', 'na22'],
  ['na31', 'na32'],
  ['na41', 'na42'],
  ['na51', 'na52'],
]

interface VarkaState {
  /** The last action of this member (undefined after it swaps out) */
  last?: RotationAction
  /**
   * Sturm und Drang's conversion element: the team's first of Pyro, Hydro, Electro, Cryo
   * (Physical: none, so Four Winds and Azure Devour are not available)
   */
  conv: HitElement
  /** Sturm und Drang (12 s) and C6's free windows (3 s): their end frames */
  timed: Partial<Record<'sturm' | 'c6Ca' | 'c6Skill', number>>
  reductions: number
  a4Stacks: number
  a4Token: number
  a4End: number
  a4Icd: Map<CharacterKey, number>
  a1Snapshot: { t: number; onField: CharacterKey }
  /** C1: the next Four Winds / Azure Devour is doubled */
  c1Extra: boolean
  /** Her last action's animation ends (gcsim's state is Idle from then) */
  lastEnd: number
}

/** The previous action, if it was this member's own (undefined: a swap or another member's action came between) */
function ownPrevious(
  s: { last?: RotationAction },
  previous: RotationAction | undefined
): RotationAction | undefined {
  if (previous === undefined) return undefined
  // a wait is not a swap: look through it
  if (previous.kind === 'wait') return s.last
  return previous === s.last ? previous : undefined
}

/** Sets a timed status to end at `end`; it is cleared when that frame passes (a later end is set by its own call) */
function arm<K extends string>(
  ctx: SimContext,
  timed: Partial<Record<K, number>>,
  key: K,
  end: number
) {
  timed[key] = end
  ctx.atCharacter('Varka', end - ctx.now, (c2) => {
    const e = timed[key]
    if (e !== undefined && c2.now >= e) delete timed[key]
  })
}

const CONVERSIONS = ['pyro', 'hydro', 'electro', 'cryo'] as const

/** Sturm und Drang converts to the first of these present in the party (else Physical) */
function convOf(ctx: SimContext): HitElement {
  for (const e of CONVERSIONS) if (ctx.partyCount(e) > 0) return e
  return 'physical'
}

/** The cancel frames of a step that starts `by` frames into the action */
const shiftInto = (
  into: ActionResult['framesInto'] | undefined,
  by: number
): ActionResult['framesInto'] =>
  into &&
  (Object.fromEntries(
    Object.entries(into).map(([k, v]) => [k, by + (v as number)])
  ) as ActionResult['framesInto'])

/**
 * Normal attacks (`count` steps). In Sturm und Drang the converted element and Anemo alternate
 * (the sheet's `skill` nodes); `windup` is the frames before the first hit (5 from Idle, a dash or a jump).
 */
function normals(
  ctx: SimContext,
  s: VarkaState,
  count: number,
  sturm: boolean,
  windup: number
): ActionResult {
  const attackContext: SimContext = {
    ...ctx,
    hit: (delay, hit) => ctx.hit(delay + windup, hit),
  }
  const r = normalString(
    varkaNormals,
    count,
    (i, d, j) => {
      // Sturm und Drang: the 1st hit of N2 and N3 is Anemo, then the converted element
      const converted = (j + (i === 1 || i === 2 ? 1 : 0)) % 2 === 0
      const element: HitElement = !sturm
        ? 'physical'
        : converted
          ? s.conv
          : 'anemo'
      attackContext.hit(d, {
        path: [sturm ? 'skill' : 'normal', varkaNodes[i][j]],
        tag: 'normal',
        element,
        applies: true,
        icd: !sturm
          ? 'normal'
          : converted
            ? s.conv === 'physical'
              ? 'normal'
              : 'varkaElem'
            : 'varkaWind',
        label: sturm ? `Sturm und Drang N${i + 1}` : `N${i + 1}`,
        blunt: true,
        poiseDamage: 35,
      })
    },
    attackContext
  )
  return {
    frames: r.frames + windup,
    framesInto: shiftInto(r.framesInto, windup),
  }
}

/** Charged Attack: two hits at frame 41 (no windup on the hits; 14 frames of windup unless after a normal or charged attack) */
function chargedAttack(
  ctx: SimContext,
  s: VarkaState,
  windup: number,
  sturm: boolean
): ActionResult {
  const hits: [string, HitElement][] = sturm
    ? [
        ['ca1', s.conv],
        ['ca2', 'anemo'],
      ]
    : [
        ['dmg1', 'physical'],
        ['dmg2', 'physical'],
      ]
  for (const [node, element] of hits)
    ctx.hit(41, {
      path: [sturm ? 'skill' : 'charged', node],
      tag: 'charged',
      element,
      applies: true,
      icd:
        element === 'anemo'
          ? sturm
            ? 'varkaExtraWind'
            : 'normal'
          : sturm && s.conv !== 'physical'
            ? 'varkaExtraElem'
            : 'normal',
      label: sturm ? 'Sturm und Drang Charged Attack' : 'Charged Attack',
      blunt: true,
      poiseDamage: 42,
    })
  ctx.hit(41, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: 9,
    label: 'Varka charged hitlag',
  })
  return withHitlag(
    {
      frames: 67 + windup,
      framesInto: shiftInto(
        { normal: 58, skill: 59, burst: 58, dash: 41, jump: 41, swap: 49 },
        windup
      ),
    },
    { hitmarks: [41], hitlag: [9] }
  )
}

/** Azure Devour: the Charged Attack with a Four Winds charge (4 hits; C1 doubles them once) */
function azureDevour(
  ctx: SimContext,
  s: VarkaState,
  windup: number,
  c6Free: boolean
): ActionResult {
  const c = ctx.constellation('Varka')
  const extra = s.c1Extra
  s.c1Extra = false
  const hits: [number, string, HitElement][] = [
    [40, 'azure1', s.conv],
    [40, 'azure2', 'anemo'],
    [60, 'azure1', s.conv],
    [60, 'azure2', 'anemo'],
  ]
  // C1's Lyrical Libation: this one deals 200% (the sheet's constellation1 nodes are the
  // doubled hits, so they replace the plain ones)
  for (const [d, node, element] of hits)
    ctx.hit(d, {
      path: [extra ? 'constellation1' : 'skill', node],
      tag: 'charged',
      element,
      applies: true,
      icd: element === 'anemo' ? 'varkaExtraWind' : 'varkaExtraElem',
      label: extra ? 'Azure Devour (C1)' : 'Azure Devour',
      blunt: true,
      poiseDamage: element === 'anemo' ? 21 : 39,
    })
  // C2: a hit 10 frames after each Four Winds / Azure Devour (no Durability: it does not apply)
  if (c >= 2)
    ctx.hit(10, {
      path: ['constellation2', 'dmg'],
      tag: 'other',
      element: 'anemo',
      applies: false,
      label: 'Varka C2',
    })
  for (const t of [40, 60])
    ctx.hit(t, {
      path: ['_marker', 'hitlag'],
      tag: 'other',
      element: 'physical',
      animationPause: 9,
      label: 'Azure Devour hitlag',
    })
  const r = withHitlag(
    {
      frames: 75 + windup,
      framesInto: shiftInto(
        {
          normal: 64,
          charged: 74,
          skill: 66,
          burst: 65,
          dash: 60,
          jump: 60,
          swap: 60,
        },
        windup
      ),
    },
    { hitmarks: [40, 60], hitlag: [9, 9], worldTimeHits: true }
  )
  if (c6Free) {
    // C6: the free charge is used up
    delete s.timed.c6Ca
  } else {
    ctx.spendCooldown('special', 660)
    // C6: the next Windbound Skill is free for 3 s
    if (c >= 6) arm(ctx, s.timed, 'c6Skill', ctx.now + 3 * 60)
  }
  return r
}

/** Four Winds' Ascension (the Skill in Sturm und Drang with a conversion): 2 hits; 11 s charge cooldown from frame 39 */
function fourWinds(
  ctx: SimContext,
  s: VarkaState,
  c6Free: boolean
): ActionResult {
  const c = ctx.constellation('Varka')
  const extra = s.c1Extra
  s.c1Extra = false
  const hits: [number, string, HitElement][] = [
    [34, 'fourWind1', s.conv],
    [43, 'fourWind2', 'anemo'],
  ]
  // C1's Lyrical Libation: 200% (the sheet's constellation1 nodes replace the plain hits)
  for (const [d, node, element] of hits)
    ctx.hit(d, {
      path: [extra ? 'constellation1' : 'skill', node],
      tag: 'skill',
      element,
      applies: true,
      icd: 'none',
      label: extra ? "Four Winds' Ascension (C1)" : "Four Winds' Ascension",
      blunt: true,
      poiseDamage: element === 'anemo' ? 35 : 65,
    })
  if (c >= 2)
    ctx.hit(10, {
      path: ['constellation2', 'dmg'],
      tag: 'other',
      element: 'anemo',
      applies: false,
      label: 'Varka C2',
    })
  ctx.hit(34, {
    path: ['_marker', 'hitlag'],
    tag: 'other',
    element: 'physical',
    animationPause: 9,
    label: 'Four Winds hitlag',
  })
  const r = withHitlag(
    {
      frames: 68,
      framesInto: {
        normal: 55,
        charged: 64,
        skill: 56,
        burst: 55,
        dash: 56,
        jump: 55,
      },
    },
    { hitmarks: [34], hitlag: [9] }
  )
  if (c6Free) {
    // C6: the free Skill is used up
    delete s.timed.c6Skill
  } else {
    ctx.atCharacter('Varka', 39, (at) => {
      at.spendCooldown('special', 660)
      if (c >= 6) arm(at, s.timed, 'c6Ca', at.now + 180)
    })
  }
  return r
}

function varkaAct(
  ctx: SimContext,
  s: VarkaState,
  action: RotationAction,
  previous: RotationAction | undefined
): ActionResult {
  const own = ownPrevious(s, previous)
  // gcsim's player state is Idle after a swap or once her last animation has ended
  const idle = own === undefined || ctx.now >= s.lastEnd
  s.last = action
  s.conv = convOf(ctx)
  const c = ctx.constellation('Varka')
  switch (action.kind) {
    case 'normal': {
      const sturm = s.timed.sturm !== undefined
      // gcsim's windup: 5 frames from Idle, a jump or a dash; none straight out of another
      // normal, a charged attack, a skill or a burst
      const windup =
        idle || own?.kind === 'dash' || own?.kind === 'jump' ? 5 : 0
      return normals(ctx, s, action.count ?? 1, sturm, windup)
    }
    case 'charged': {
      const sturm = s.timed.sturm !== undefined
      // gcsim's windup: none straight out of a normal or charged attack, else 14 frames
      const windup =
        !idle && (own?.kind === 'normal' || own?.kind === 'charged') ? 0 : 14
      const freeCa = s.timed.c6Ca !== undefined
      if (
        sturm &&
        s.conv !== 'physical' &&
        (freeCa || ctx.cooldownReadyAt('special') <= ctx.now)
      )
        return azureDevour(ctx, s, windup, freeCa)
      return chargedAttack(ctx, s, windup, sturm)
    }
    case 'skill': {
      if (s.timed.sturm !== undefined && s.conv !== 'physical')
        return fourWinds(ctx, s, s.timed.c6Skill !== undefined)
      // Windbound Execution (tap): Sturm und Drang for 12 s; 16 s cooldown from frame 39
      ctx.hit(40, {
        path: ['skill', 'skillDmg'],
        tag: 'skill',
        element: 'anemo',
        applies: true,
        icd: 'none',
        label: 'Windbound Execution',
        blunt: true,
        poiseDamage: 100,
      })
      ctx.atCharacter('Varka', 39, (at) => {
        arm(at, s.timed, 'sturm', at.now + 720)
        if (s.conv === 'physical') return
        s.reductions = 0
        at.restartCooldown('special', 660)
        // C1: one charge back at once (gcsim's ResetActionCooldown pops one recharge), and the
        // next Four Winds / Azure Devour deals 200%
        if (c >= 1) {
          s.c1Extra = true
          at.resetCooldown('special', 1)
        }
      })
      ctx.hit(40, {
        path: ['_marker', 'hitlag'],
        tag: 'other',
        element: 'physical',
        animationPause: 9,
        label: 'Windbound hitlag',
      })
      return withHitlag(
        {
          cooldown: { key: 'skill', frames: 16 * 60, delay: 39 },
          frames: 55,
          framesInto: {
            normal: 49,
            charged: 49,
            skill: 44,
            burst: 44,
            dash: 46,
            jump: 43,
            swap: 49,
          },
        },
        { hitmarks: [40], hitlag: [9] }
      )
    }
    case 'burst': {
      // Northwind Avatar: the converted element (Anemo without one) at 112, Anemo at 131
      ctx.hit(112, {
        path: ['burst', 'dmg1'],
        tag: 'burst',
        element: s.conv === 'physical' ? 'anemo' : s.conv,
        applies: true,
        icd: 'none',
        label: 'Northwind Avatar',
      })
      ctx.hit(131, {
        path: ['burst', 'dmg2'],
        tag: 'burst',
        element: 'anemo',
        applies: true,
        icd: 'none',
        label: 'Northwind Avatar (2)',
      })
      // extends Sturm und Drang by 2.3 s
      if (s.timed.sturm !== undefined)
        arm(ctx, s.timed, 'sturm', s.timed.sturm + 138)
      return {
        cooldown: { key: 'burst', frames: 15 * 60 },
        frames: 152,
        framesInto: {
          normal: 137,
          skill: 138,
          dash: 138,
          jump: 137,
          swap: 136,
        },
      }
    }
    case 'dash':
      return { frames: 19, framesInto: { jump: 3 } }
    case 'jump':
      // the jump is longer after a dash
      return templateJump('male', 'claymore', previous, ctx)
    default:
      // no plunge in gcsim's Varka
      return { frames: 30 }
  }
}

export const kit: KitModel = {
  characterKey: 'Varka',
  element: 'anemo',
  source: `${KQMSIM}/varka`,
  init: (): VarkaState => ({
    conv: 'physical',
    timed: {},
    reductions: 0,
    a4Stacks: 0,
    a4Token: 0,
    a4End: -1,
    a4Icd: new Map(),
    a1Snapshot: { t: 0, onField: 'Varka' },
    c1Extra: false,
    lastEnd: -1,
  }),
  charges: () => ({ special: 2 }),
  onStart(ctx, s: VarkaState) {
    const poll = (at: SimContext) => {
      s.a1Snapshot = { t: at.now, onField: at.onField }
      at.atCharacter('Varka', 60, poll)
    }
    poll(ctx)
    ctx.state('Varka', ['Varka', 'a4Stacks'], '')
  },
  onHit(ctx, s: VarkaState, hit) {
    if (hit.path[0] === '_reaction' && hit.path[1].endsWith('Swirl')) {
      // C4: his own Swirl gives the party 20% Anemo DMG and the swirled element's DMG for 10 s
      // (gcsim counts Stellar Swirl as Cryo); each copy keeps its holder's hitlag clock
      if (hit.characterKey === 'Varka' && ctx.constellation('Varka') >= 4) {
        const ele =
          hit.path[1] === 'stellarSwirl' ? 'cryo' : hit.path[1].slice(0, -5)
        if ((CONVERSIONS as readonly string[]).includes(ele))
          ctx.buff('Varka', ['Varka', `c4Swirl${ele}`], ele, 0, 600, {
            hitlag: 'recipient',
          })
      }
      const frame = ctx.characterFrame(hit.characterKey)
      if (frame < (s.a4Icd.get(hit.characterKey) ?? -1)) return
      s.a4Icd.set(hit.characterKey, frame + 60)
      const ownFrame = ctx.characterFrame('Varka')
      if (ownFrame >= s.a4End) s.a4Stacks = 0
      s.a4End = ownFrame + 480
      s.a4Stacks = Math.min(s.a4Stacks + 1, 4)
      ctx.state('Varka', ['Varka', 'a4Stacks'], `${s.a4Stacks}`)
      const token = ++s.a4Token
      ctx.atCharacter('Varka', 480, (at) => {
        if (token !== s.a4Token) return
        s.a4Stacks = 0
        at.state('Varka', ['Varka', 'a4Stacks'], '')
      })
      return
    }
    if (hit.characterKey !== 'Varka' || hit.path[0].startsWith('_')) return
    if (
      CONVERSIONS.includes(hit.element as (typeof CONVERSIONS)[number]) ||
      hit.element === 'anemo'
    )
      hit.statSnapshots = [
        ...(hit.statSnapshots ?? []),
        {
          stat: `${hit.element}_dmg_` as 'anemo_dmg_',
          path: ['display', 'passive1', `a1Phec_${hit.element}_dmg_`],
          ...s.a1Snapshot,
        },
      ]
    if (
      hit.tag === 'normal' &&
      s.timed.sturm !== undefined &&
      s.reductions < 15
    ) {
      s.reductions++
      ctx.reduceCooldown(
        'special',
        ctx.members.filter((m) => HEXEREI_CHARACTERS.includes(m)).length >= 2
          ? 60
          : 30
      )
    }
  },
  onHitlag(_ctx, s: VarkaState, frames) {
    for (const key of ['sturm', 'c6Ca', 'c6Skill'] as const)
      if (s.timed[key] !== undefined) s.timed[key]! += frames
  },
  // In Sturm und Drang (with a conversion element) his E is Four Winds' Ascension and his charged
  // attack, with a Four Winds charge, is Azure Devour: each with frames of its own
  variant(ctx, s: VarkaState, action) {
    if (s.timed.sturm === undefined || convOf(ctx) === 'physical')
      return undefined
    const mode = 'Sturm und Drang'
    if (action.kind === 'skill')
      return { key: 'sturm', label: "Four Winds' Ascension", mode }
    if (
      action.kind === 'charged' &&
      (s.timed.c6Ca !== undefined || ctx.cooldownReadyAt('special') <= ctx.now)
    )
      return { key: 'sturm', label: 'Azure Devour', mode }
    return undefined
  },
  act(ctx, s: VarkaState, action, previous) {
    const r = varkaAct(ctx, s, action, previous)
    // gcsim's state stays the action's until its animation (default frames) ends, then Idle
    s.lastEnd = ctx.now + r.frames
    return r
  },
  cooldownKey: (s: VarkaState, action) => {
    if (action.kind === 'skill') {
      if (s.timed.sturm !== undefined && s.conv !== 'physical')
        return s.timed.c6Skill !== undefined ? undefined : 'special'
      return 'skill'
    }
    return action.kind === 'burst' ? 'burst' : undefined
  },
  // Sturm und Drang ends when Varka leaves the field
  onSwapOut(_ctx, s: VarkaState) {
    delete s.timed.sturm
    s.last = undefined
  },
}
