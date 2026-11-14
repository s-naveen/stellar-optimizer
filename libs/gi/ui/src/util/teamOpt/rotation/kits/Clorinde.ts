import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/clorinde, main as of 2026-11-10. */

/** The normal attack string (gcsim's attackHitmarks and attackFrames; the sword has no Aim cancel) */
const clorindeNormals: NormalHit[] = [
  {
    hitmarks: [18],
    hitlag: [6],
    toNormal: 19,
    toCharged: 24,
    toAbil: 18,
    frames: 24,
  },
  {
    hitmarks: [12],
    hitlag: [6],
    toNormal: 12,
    toCharged: 27,
    toAbil: 12,
    frames: 27,
  },
  {
    hitmarks: [23, 32],
    hitlag: [6, 6],
    worldTimeHits: true,
    toNormal: 40,
    toCharged: 42,
    toAbil: 32,
    frames: 42,
  },
  {
    hitmarks: [12, 18, 23],
    hitlag: [5, 5, 5],
    worldTimeHits: true,
    toNormal: 32,
    toCharged: 35,
    toAbil: 23,
    frames: 35,
  },
  {
    hitmarks: [21],
    hitlag: [6],
    toNormal: 60,
    toCharged: 60,
    toAbil: 21,
    frames: 60,
  },
]

/** Night Vigil's Swift Hunt shots, in their 3-shot cycle (gcsim's skillAttackHitmarks and frames) */
const vigilShots = [
  {
    hitmark: 8,
    frames: 18,
    toNormal: 18,
    toCharged: 18,
    toSkill: 11,
    toBurst: 10,
    toAbil: 8,
  },
  {
    hitmark: 8,
    frames: 17,
    toNormal: 17,
    toCharged: 17,
    toSkill: 10,
    toBurst: 10,
    toAbil: 8,
  },
  {
    hitmark: 9,
    frames: 20,
    toNormal: 20,
    toCharged: 20,
    toSkill: 11,
    toBurst: 11,
    toAbil: 9,
  },
]

/** Night Vigil: 6 frames of start-up + 7.5 s */
const VIGIL_FRAMES = 456
/** The skill's cooldown: 16 s, starting 6 frames after the press */
const SKILL_CD = 960
const SKILL_CD_DELAY = 6
/** Surging Blade's internal cooldown: 10 s (a status active on its expiry frame) */
const ARKHE_ICD = 601
/** Bond of Life (HP debt, a fraction of max HP) */
const SHOT_BOL = 0.35
/** Last Lightfall's Bond of Life gain by talent level (gcsim's burstBOL) */
const BURST_BOL = [
  0.66, 0.72, 0.78, 0.84, 0.9, 0.96, 1.02, 1.08, 1.14, 1.2, 1.26, 1.32, 1.38,
  1.44, 1.5,
]
/** Bond of Life is capped at 200% of max HP */
const BOL_MAX = 2
/** A4 stacks last 15 s */
const A4_DURATION = 900
/** C1 Nightwatch Shade: 1.2 s ICD */
const C1_ICD = 72
/** C6 crit buff: 12 s */
const C6_ICD = 720
/** C6 Glimbright Shade: 1 s ICD */
const C6_SHADE_ICD = 60

interface ClorindeState {
  /** Bond of Life (as a fraction of max HP) */
  bol: number
  /** Night Vigil's next Swift Hunt shot (0..2): Impale the Night resets it */
  shot: number
  /** Night Vigil is on (its end is checked at its end event) */
  vigilOn: boolean
  /** Night Vigil ends (frame) */
  vigilUntil: number
  /** Surging Blade's internal cooldown ends (frame) */
  arkheUntil: number
  /** C1 Nightwatch Shade's ICD ends (frame) */
  c1Until: number
  /** C6: Glimbright Shades left this cast, and the ICD of the last one (frame) */
  c6Stacks: number
  glimbrightUntil: number
  /** C6's crit buff ends (frame) */
  c6Until: number
  a1Until: number[]
}

/**
 * A4: a Bond of Life change from 100%+ adds a stack of +10% CRIT Rate (2 max, 15 s, each counted
 * independently: a third replaces the oldest, which is the first to run out anyway)
 */
function a4Stack(ctx: SimContext, _s: ClorindeState) {
  ctx.buff('Clorinde', ['Clorinde', 'a4BondChanges'], '1', 0, A4_DURATION, {
    max: 2,
    hitlag: 'recipient',
  })
}

/** Night Vigil ends (its duration, or Clorinde leaving the field) */
function endVigil(s: ClorindeState) {
  s.vigilOn = false
  s.vigilUntil = -1
}

/**
 * Night Vigil's normal attacks: a Swift Hunt shot each. Under 100% Bond of Life the shot is the
 * piercing one (a box) and gains 0.35 Bond of Life on its hit. Each shot's hit triggers
 * Surging Blade when its cooldown is over (the blade lands 42 frames later).
 */
function swiftHunt(
  ctx: SimContext,
  s: ClorindeState,
  count: number
): ActionResult {
  let start = 0
  let idx = s.shot
  // (what the shots see: the gains of the earlier shots of this action included)
  let bol = s.bol
  let last = vigilShots[idx]
  for (let i = 0; i < count; i++) {
    last = vigilShots[idx]
    const at = start + last.hitmark
    if (bol < 1) {
      ctx.hit(at, {
        path: ['skill', 'piercingDmg'],
        tag: 'normal',
        element: 'electro',
        applies: true,
        icd: 'normal',
        label: 'Swift Hunt (piercing)',
      })
      ctx.at(at, () => {
        s.bol = Math.min(BOL_MAX, s.bol + SHOT_BOL)
      })
      ctx.hit(at, {
        path: ['_marker', 'bondOfLife'],
        tag: 'other',
        element: 'electro',
        label: 'Swift Hunt (Bond of Life)',
      })
      bol = Math.min(BOL_MAX, bol + SHOT_BOL)
    } else
      ctx.hit(at, {
        path: ['skill', 'normalDmg'],
        tag: 'normal',
        element: 'electro',
        applies: true,
        icd: 'normal',
        label: 'Swift Hunt (normal shot)',
      })
    if (ctx.now + at >= s.arkheUntil) {
      ctx.hit(at + 42, {
        path: ['skill', 'bladeDmg'],
        tag: 'skill',
        element: 'electro',
        applies: false,
        icd: 'none',
        label: 'Surging Blade',
      })
      // its defense halt pauses Clorinde (on the field), whatever she is doing then
      ctx.at(at + 42, (c2) => {
        if (c2.onField !== 'Clorinde') return
        c2.hit(0, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 4,
          extendsAction: true,
          label: 'Surging Blade hitlag',
        })
      })
      s.arkheUntil = ctx.now + at + ARKHE_ICD
    }
    idx = (idx + 1) % vigilShots.length
    if (i < count - 1) start += last.toNormal
  }
  s.shot = idx
  return {
    frames: start + last.frames,
    framesInto: {
      normal: start + last.toNormal,
      charged: start + last.toCharged,
      skill: start + last.toSkill,
      burst: start + last.toBurst,
      dash: start + last.toAbil,
      jump: start + last.toAbil,
      swap: start + last.toAbil,
    },
  }
}

/** C6: the Glimbright Shade (1 s ICD) while Night Vigil lasts, 37 frames into Impale at 100%+ */
function glimbrightShade(ctx: SimContext, s: ClorindeState) {
  if (!s.vigilOn || ctx.now < s.glimbrightUntil) return
  s.c6Stacks--
  s.glimbrightUntil = ctx.now + C6_SHADE_ICD
  ctx.hit(0, {
    characterKey: 'Clorinde',
    path: ['constellation6', 'dmg'],
    tag: 'normal',
    element: 'electro',
    applies: true,
    icd: 'ClorindeElementalArt',
    label: 'Glimbright Shade (C6)',
  })
}

/**
 * The skill's first press: Night Vigil (its shots, and Impale the Night on the next press),
 * the skill's cooldown, and C6's crit buff
 */
function vigil(ctx: SimContext, s: ClorindeState, c: number): ActionResult {
  s.vigilOn = true
  s.vigilUntil = ctx.now + VIGIL_FRAMES
  ctx.at(VIGIL_FRAMES, (c2) => {
    if (s.vigilOn && c2.now >= s.vigilUntil) endVigil(s)
  })
  if (c >= 6) {
    s.c6Stacks = 6
    if (ctx.now >= s.c6Until) {
      s.c6Until = ctx.now + C6_ICD
      ctx.buff('Clorinde', ['Clorinde', 'c6AfterSkill'], 'on', 0, C6_ICD)
    }
  }
  return {
    cooldown: { key: 'skill', frames: SKILL_CD, delay: SKILL_CD_DELAY },
    frames: 33,
    framesInto: { normal: 31, skill: 32, dash: 6, jump: 25, swap: 25 },
  }
}

/**
 * Impale the Night (the skill's press in Night Vigil): by Bond of Life, 3 hits and a heal of
 * it (100%+), 1 hit and the heal (under 100%), or 1 hit with no heal (0). It resets the
 * Night Vigil shot cycle. No cooldown.
 */
function impale(ctx: SimContext, s: ClorindeState, c: number): ActionResult {
  const bol = s.bol
  s.shot = 0
  const strike = (path: string[], label: string) =>
    ctx.hit(11, {
      path,
      tag: 'normal',
      element: 'electro',
      applies: true,
      icd: 'normal',
      label,
    })
  if (bol >= 1) {
    for (let k = 0; k < 3; k++)
      strike(
        ['skill', 'thrust3Dmg'],
        `Impale the Night (100%+ BoL, hit ${k + 1})`
      )
    // C6: the Glimbright Shade 37 frames in
    if (c >= 6 && s.c6Stacks > 0) ctx.at(37, (c2) => glimbrightShade(c2, s))
  } else if (bol >= 1e-7)
    strike(['skill', 'thrust2Dmg'], 'Impale the Night (<100% BoL)')
  else strike(['skill', 'thrust1Dmg'], 'Impale the Night (0% BoL)')
  if (bol >= 1e-7)
    // the heal (6 frames in) takes the Bond of Life to 0
    ctx.at(6, (c2) => {
      const prev = s.bol
      s.bol = 0
      if (prev >= 1) a4Stack(c2, s)
      c2.hit(0, {
        path: ['_marker', 'bondOfLife'],
        tag: 'other',
        element: 'electro',
        label: 'Impale the Night (Bond of Life)',
      })
    })
  return {
    frames: 43,
    framesInto: {
      normal: 24,
      skill: 24,
      burst: 24,
      dash: 25,
      jump: 25,
      swap: 42,
    },
  }
}

/** Normal attacks outside Night Vigil (gcsim's attack frames) */
const clorindeNormal = (ctx: SimContext, count: number): ActionResult =>
  normalString(
    clorindeNormals,
    count,
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

export const kit: KitModel = {
  characterKey: 'Clorinde',
  element: 'electro',
  source: `${GCSIM}/clorinde`,
  init: (): ClorindeState => ({
    bol: 0,
    shot: 0,
    vigilOn: false,
    vigilUntil: -1,
    arkheUntil: -1,
    c1Until: -1,
    c6Stacks: 0,
    glimbrightUntil: -1,
    c6Until: -1,
    a1Until: [],
  }),
  // In Night Vigil her normal attacks are Swift Hunt and her E is Impale the Night, and her Q has
  // cancels of its own (gcsim's burstSkillStateFrames)
  variant(_ctx, s: ClorindeState, action) {
    if (!s.vigilOn) return undefined
    const mode = 'Night Vigil'
    switch (action.kind) {
      case 'normal':
        return { key: 'nightVigil', label: 'Swift Hunt', mode }
      case 'skill':
        return { key: 'nightVigil', label: 'Impale the Night', mode }
      case 'burst':
        return { key: 'nightVigil', label: 'Last Lightfall', mode }
      default:
        return undefined
    }
  },
  act(ctx, s: ClorindeState, action, previous) {
    const c = ctx.constellation('Clorinde')
    switch (action.kind) {
      case 'normal':
        return s.vigilOn
          ? swiftHunt(ctx, s, action.count ?? 1)
          : clorindeNormal(ctx, action.count ?? 1)
      case 'charged':
        // (Night Vigil: she cannot use Charged Attacks)
        if (s.vigilOn)
          return {
            frames: 0,
            failed: 'Clorinde cannot use Charged Attacks in Night Vigil',
          }
        ctx.hit(38, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack',
        })
        return {
          frames: 68,
          framesInto: { normal: 66, dash: 38, jump: 38, swap: 45 },
        }
      case 'skill':
        return s.vigilOn ? impale(ctx, s, c) : vigil(ctx, s, c)
      case 'burst': {
        for (const delay of [97, 103, 109, 115, 121])
          ctx.hit(delay, {
            path: ['burst', 'skillDmg'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            icd: 'burst',
            label: 'Last Lightfall',
          })
        // the Bond of Life gain by the burst's level (the sheet's, or 10, +3 from C5, without it)
        const level = Math.min(
          14,
          Math.max(
            0,
            Math.round(
              ctx.calculate('Clorinde', ['total', 'burstIndex']) ??
                9 + (c >= 5 ? 3 : 0)
            )
          )
        )
        // the gain (13 frames in, a character task); C4's Last Lightfall DMG bonus from the Bond of
        // Life then
        ctx.atCharacter('Clorinde', 13, (c2) => {
          const prev = s.bol
          s.bol = Math.min(BOL_MAX, prev + BURST_BOL[level])
          if (prev >= 1) a4Stack(c2, s)
          c2.hit(0, {
            path: ['_marker', 'bondOfLife'],
            tag: 'other',
            element: 'electro',
            label: 'Last Lightfall (Bond of Life)',
          })
          // C4: +2% Last Lightfall DMG per 1% Bond of Life, max 200% (the sheet's 5% steps)
          const pct = Math.min(100, Math.floor((s.bol * 100) / 5) * 5)
          if (c >= 4 && pct >= 10)
            c2.buff('Clorinde', ['Clorinde', 'c4BondPercent'], `${pct}`, 0, 120)
        })
        // each hit pauses her: gcsim's 0.1-frame halt (factor 0) rounds up to 1 frame
        const marks = [97, 103, 109, 115, 121]
        for (const d of marks)
          ctx.hit(d, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 1,
            label: 'Last Lightfall hitlag',
          })
        return withHitlag(
          {
            cooldown: { key: 'burst', frames: 900 },
            frames: 128,
            framesInto: s.vigilOn
              ? { normal: 127, skill: 127, dash: 127, swap: 127 }
              : { dash: 127, swap: 127 },
          },
          { hitmarks: marks, hitlag: [1, 1, 1, 1, 1] }
        )
      }
      case 'dash':
        // the template's dash (Lady body)
        return { frames: 22, framesInto: { jump: 3 } }
      case 'jump':
        // the template's jump (Lady body): longer right after a dash
        return templateJump('lady', 'sword', previous, ctx)
      default:
        // gcsim has no plunge for Clorinde (her plunge data is in config.yml only): no damage
        return { frames: 30 }
    }
  },
  onHit(ctx, s: ClorindeState, hit) {
    if (
      hit.path[0] === '_reaction' &&
      ([
        'electroCharged',
        'lunarCharged',
        'superconduct',
        'stellarConduct',
        'aggravate',
        'quicken',
        'hyperbloom',
        'overloaded',
        'electroSwirl',
      ].includes(hit.path[1]) ||
        // (Electro Crystallize: the crystallize marker carries the aura it consumed)
        (hit.path[1] === 'crystallize' && hit.element === 'electro'))
    ) {
      s.a1Until = s.a1Until.filter((until) => until > ctx.now)
      if (s.a1Until.length === 3) s.a1Until.shift()
      s.a1Until.push(ctx.now + 900)
      ctx.state('Clorinde', ['Clorinde', 'a1Reactions'], `${s.a1Until.length}`)
      ctx.at(900, (c) => {
        s.a1Until = s.a1Until.filter((until) => until > c.now)
        c.state(
          'Clorinde',
          ['Clorinde', 'a1Reactions'],
          s.a1Until.length ? `${s.a1Until.length}` : ''
        )
      })
    }
    // C1 Nightwatch Shade: an Electro Normal Attack hit of Clorinde's in Night Vigil (1.2 s
    // ICD): 2 coordinated hits, 1 frame later
    if (
      ctx.constellation('Clorinde') < 1 ||
      hit.characterKey !== 'Clorinde' ||
      hit.tag !== 'normal' ||
      hit.element !== 'electro' ||
      hit.t >= s.vigilUntil ||
      hit.t < s.c1Until
    )
      return
    s.c1Until = hit.t + C1_ICD
    for (let k = 0; k < 2; k++)
      ctx.hit(1, {
        characterKey: 'Clorinde',
        path: ['constellation1', 'dmg'],
        tag: 'normal',
        element: 'electro',
        applies: true,
        icd: 'ClorindeElementalArt',
        label: 'Nightwatch Shade (C1)',
      })
  },
  // she leaves Night Vigil when she leaves the field (the game text; gcsim keeps it)
  onSwapOut(_ctx, s: ClorindeState) {
    if (s.vigilOn) endVigil(s)
  },
  // in Night Vigil, other healing becomes Bond of Life (100% with A4); HP tracking only
  onHpChange(ctx, s: ClorindeState, change) {
    if (
      change.characterKey !== 'Clorinde' ||
      change.kind !== 'heal' ||
      !s.vigilOn ||
      change.source === 'Clorinde'
    )
      return
    const max = ctx.calculate('Clorinde', ['total', 'hp'])
    if (!max) return
    const prev = s.bol
    s.bol = Math.min(BOL_MAX, prev + (change.amount + change.overheal) / max)
    if (prev >= 1 && s.bol !== prev) a4Stack(ctx, s)
  },
  // Impale the Night (in Night Vigil) has no cooldown: the press waits for the skill's
  cooldownKey: (s: ClorindeState, action) =>
    action.kind === 'skill'
      ? s.vigilOn
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
}
