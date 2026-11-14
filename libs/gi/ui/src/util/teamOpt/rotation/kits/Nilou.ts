import type { ActionResult, HitElement, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalInto,
  normalString,
  templateJump,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/nilou, main as of 2026-11-10. */

/** Three normal attack steps (outside Pirouette and Lunar Prayer) */
const nilouNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [6],
    toNormal: 20,
    toCharged: 24,
    toAbil: 12,
    frames: 24,
  },
  {
    hitmarks: [9],
    hitlag: [6],
    toNormal: 21,
    toCharged: 27,
    toAbil: 9,
    frames: 27,
  },
  {
    hitmarks: [17],
    hitlag: [8],
    toNormal: 58,
    toCharged: 58,
    toAbil: 17,
    frames: 58,
  },
]

/** Sword Dance: the normal attack in Pirouette or Lunar Prayer, by step (step 3 is Luminous Illusion) */
const sword: { node: string; label: string; hit: NormalHit }[] = [
  {
    node: 'dance1Dmg',
    label: 'Sword Dance 1',
    hit: {
      hitmarks: [14],
      toNormal: 18,
      toCharged: 20,
      toAbil: 14,
      frames: 20,
    },
  },
  {
    node: 'dance2Dmg',
    label: 'Sword Dance 2',
    hit: {
      hitmarks: [12],
      toNormal: 23,
      toCharged: 23,
      toAbil: 12,
      frames: 23,
    },
  },
  {
    node: 'moonDmg',
    label: 'Luminous Illusion',
    hit: {
      hitmarks: [35],
      toNormal: 55,
      toCharged: 60,
      toAbil: 35,
      frames: 60,
    },
  },
]

/** Whirling Steps: the Skill in Pirouette, by step (step 3 is the Water Wheel) */
const whirl: {
  node: string
  label: string
  hit: number
  frames: number
  into: NonNullable<ActionResult['framesInto']>
}[] = [
  {
    node: 'whirl1Dmg',
    label: 'Whirling Steps 1',
    hit: 21,
    frames: 33,
    into: { normal: 27, skill: 27, dash: 26, jump: 27, swap: 31 },
  },
  {
    node: 'whirl2Dmg',
    label: 'Whirling Steps 2',
    hit: 29,
    frames: 62,
    into: { normal: 40, skill: 32, burst: 40, dash: 36, jump: 37 },
  },
  {
    node: 'wheelDmg',
    label: 'Water Wheel',
    hit: 43,
    frames: 63,
    into: { dash: 57, jump: 57, swap: 61 },
  },
]

interface NilouState {
  /** The Sword Dance / Whirling Steps step (0..2) of the cycle; reset when she swaps out */
  step: number
  /** Timed statuses: their end frame (cleared when it passes) */
  timed: Partial<Record<'pirouette' | 'lunar' | 'bounty', number>>
  /** Identifies the running Tranquility Aura (a new one replaces it) */
  aura: number
}

/** Sets a timed status to end at `end`; it is cleared when that frame passes (a later end is set by its own call) */
function arm<K extends string>(
  ctx: SimContext,
  timed: Partial<Record<K, number>>,
  key: K,
  end: number
) {
  timed[key] = end
  ctx.at(end - ctx.now, (c2) => {
    const e = timed[key]
    if (e !== undefined && c2.now >= e) delete timed[key]
  })
}

const ELEMENTS: HitElement[] = [
  'physical',
  'geo',
  'hydro',
  'electro',
  'dendro',
  'pyro',
  'cryo',
  'anemo',
]

/** Golden Chalice's Bounty (A1) needs the whole party Dendro or Hydro, with at least one Dendro */
function bloomParty(ctx: SimContext): boolean {
  const total = ELEMENTS.reduce((n, e) => n + ctx.partyCount(e), 0)
  return (
    ctx.partyCount('dendro') >= 1 &&
    ctx.partyCount('hydro') + ctx.partyCount('dendro') === total
  )
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
 * Tranquility Aura: a Hydro application (no damage, 25 durability, the Nilou ICD group) every 0.5 s
 * for 12 s (18 s with C1) after Whirling Steps' 3rd step. It goes on when she leaves the field.
 */
function tranquility(ctx: SimContext, s: NilouState) {
  const id = ++s.aura
  // (gcsim: a hitlag-affected status, active on its expiry frame, ticking on her clock: 25 ticks
  // in 12 s)
  const end =
    ctx.characterFrame('Nilou') +
    (ctx.constellation('Nilou') >= 1 ? 18 : 12) * 60
  const tick = (cx: SimContext) => {
    if (s.aura !== id || cx.characterFrame('Nilou') > end) return
    cx.hit(1, {
      characterKey: 'Nilou',
      path: ['_marker', 'tranquilityAura'],
      tag: 'other',
      element: 'hydro',
      applies: true,
      durability: 25,
      icd: 'NilouTranquilityAura',
      icdGroup: 'Nilou',
      label: 'Tranquility Aura',
    })
    cx.atCharacter('Nilou', 30, tick)
  }
  tick(ctx)
}

/**
 * The 3rd step of a Pirouette ends it: A1 (Golden Chalice's Bounty, 30 s) when the party is bloom
 * (Dendro/Hydro), then Lunar Prayer (8 s, Sword Dance) for Sword Dance, or the Tranquility Aura
 * (Hydro applications) for Whirling Steps.
 */
function pirouetteEnd(c: SimContext, s: NilouState, dance: boolean) {
  delete s.timed.pirouette
  if (bloomParty(c)) {
    arm(c, s.timed, 'bounty', c.now + 30 * 60)
    c.buff('Nilou', ['Nilou', 'a1AfterSkill'], 'on', 0, 30 * 60)
  }
  if (dance) arm(c, s.timed, 'lunar', c.now + 8 * 60)
  else tranquility(c, s)
}

/**
 * Normal attacks in Pirouette or Lunar Prayer: `count` Sword Dance steps from the current step. In
 * Pirouette the 3rd step (frame 35) ends it, 30 frames after the step starts; C4 gives +50% burst DMG
 * for 8 s after that step's hit.
 */
function swordDance(
  ctx: SimContext,
  s: NilouState,
  count: number,
  inPirouette: boolean
): ActionResult {
  let start = 0
  let lastStart = 0
  let lastIdx = s.step
  for (let n = 0; n < count; n++) {
    const idx = s.step
    const step = sword[idx]
    lastStart = start
    lastIdx = idx
    const hitAt = start + step.hit.hitmarks[0]
    ctx.hit(hitAt, {
      path: ['skill', step.node],
      tag: 'skill',
      element: 'hydro',
      applies: true,
      icd: 'skill',
      label: step.label,
    })
    if (inPirouette && idx === 2) {
      if (ctx.constellation('Nilou') >= 4)
        ctx.buff('Nilou', ['Nilou', 'c4AfterPirHit'], 'on', hitAt, 8 * 60)
      const endAt = start + 30
      ctx.at(endAt, (c2) => pirouetteEnd(c2, s, true))
    }
    s.step = (idx + 1) % 3
    if (n < count - 1) start += step.hit.toNormal
  }
  const last = sword[lastIdx].hit
  return {
    frames: lastStart + last.frames,
    framesInto: shiftInto(normalInto(last), lastStart),
  }
}

/** Whirling Steps (the Skill in Pirouette): one step; the 3rd step ends the Pirouette (40 frames) */
function whirlingSteps(ctx: SimContext, s: NilouState): ActionResult {
  const idx = s.step
  const w = whirl[idx]
  ctx.hit(w.hit, {
    path: ['skill', w.node],
    tag: 'skill',
    element: 'hydro',
    applies: true,
    icd: 'skill',
    label: w.label,
  })
  if (idx === 2) {
    if (ctx.constellation('Nilou') >= 4)
      ctx.buff('Nilou', ['Nilou', 'c4AfterPirHit'], 'on', w.hit, 8 * 60)
    ctx.at(40, (c2) => pirouetteEnd(c2, s, false))
  }
  s.step = (idx + 1) % 3
  return { frames: w.frames, framesInto: w.into }
}

export const kit: KitModel = {
  characterKey: 'Nilou',
  element: 'hydro',
  source: `${GCSIM}/nilou`,
  init: (): NilouState => ({ step: 0, timed: {}, aura: 0 }),
  act(ctx, s: NilouState, action, previous) {
    switch (action.kind) {
      case 'normal':
        if (s.timed.pirouette !== undefined)
          return swordDance(ctx, s, action.count ?? 1, true)
        if (s.timed.lunar !== undefined)
          return swordDance(ctx, s, action.count ?? 1, false)
        return normalString(
          nilouNormals,
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
        // (no Charged Attacks under Pirouette or Lunar Prayer)
        if (s.timed.pirouette !== undefined || s.timed.lunar !== undefined)
          return {
            frames: 0,
            failed:
              'Nilou cannot use Charged Attacks under Pirouette or Lunar Prayer',
          }
        ctx.hit(26, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        ctx.hit(27, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        return {
          frames: 43,
          framesInto: { normal: 42, dash: 27, jump: 27, swap: 27 },
        }
      case 'skill': {
        // Whirling Steps while in Pirouette (no cooldown: the Skill is ready in Pirouette)
        if (s.timed.pirouette !== undefined) return whirlingSteps(ctx, s)
        // Dance of Haftkarsvar (tap): 10 s Pirouette, 18 s cooldown
        ctx.hit(16, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'skill',
          label: 'Dance of Haftkarsvar',
        })
        s.step = 0
        arm(ctx, s.timed, 'pirouette', ctx.now + 10 * 60)
        return {
          cooldown: { key: 'skill', frames: 18 * 60 },
          frames: 22,
          framesInto: { normal: 19, skill: 19, dash: 17, jump: 17, swap: 21 },
        }
      }
      case 'burst':
        // Dance of Abzendegi (91), then Lingering Aeon 121 frames after the burst hit lands (91 + 121)
        ctx.hit(91, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Dance of Abzendegi',
        })
        // (gcsim: an enemy task from the hit, pushed back by enemy hitlag)
        ctx.at(91, (c2) =>
          c2.atEnemy(121, (c3) =>
            c3.hit(0, {
              path: ['burst', 'aeonDmg'],
              tag: 'burst',
              element: 'hydro',
              applies: true,
              icd: 'none',
              label: 'Lingering Aeon',
            })
          )
        )
        return {
          cooldown: { key: 'burst', frames: 18 * 60 },
          frames: 110,
          framesInto: { normal: 108, skill: 108, jump: 109, swap: 107 },
        }
      case 'dash':
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // the jump is longer after a dash
        return templateJump('girl', 'sword', previous, ctx)
      default:
        // no plunge in gcsim's Nilou
        return { frames: 30 }
    }
  },
  cooldownKey: (s: NilouState, action) =>
    action.kind === 'skill'
      ? s.timed.pirouette !== undefined
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  // her Pirouette and Lunar Prayer end when she leaves the field; her step resets
  onSwapOut(_ctx, s: NilouState) {
    s.step = 0
    delete s.timed.pirouette
    delete s.timed.lunar
  },
  // C2: after Golden Chalice's Bounty, a Hydro hit lowers the enemy's Hydro RES by 35% for 10 s
  onHit(ctx, s: NilouState, hit) {
    // A1: a Bountiful Core bursting hits the player with Dendro: the party's EM +100 for 10 s
    // (gcsim's OnPlayerHit, while Golden Chalice's Bounty is up)
    if (
      hit.path[0] === 'reaction' &&
      hit.path[1] === 'bloom' &&
      hit.label === 'Bloom (Bountiful Core)'
    )
      ctx.buff('Nilou', ['Nilou', 'a1AfterHit'], 'on', 0, 600)
    // the Tranquility Aura and reactions deal no damage: C2 needs a damaging hit
    if (
      !hit.path[0].startsWith('_') &&
      hit.element === 'hydro' &&
      s.timed.bounty !== undefined &&
      ctx.constellation('Nilou') >= 2
    )
      ctx.buff('Nilou', ['Nilou', 'c2Hydro'], 'hydro', 0, 10 * 60)
    // C2: Bloom or Lunar-Bloom DMG under the Bounty lowers the enemy's Dendro RES by 35% for 10 s
    if (
      hit.path[0] === 'reaction' &&
      (hit.path[1] === 'bloom' || hit.path[1] === 'lunarBloom') &&
      s.timed.bounty !== undefined &&
      ctx.constellation('Nilou') >= 2
    )
      ctx.buff('Nilou', ['Nilou', 'c2Dendro'], 'dendro', 0, 10 * 60)
  },
}
