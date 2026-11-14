import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/tartaglia, main as of 2026-11-10. */

/**
 * Ranged stance: the bow's six shots (the arrow lands 10 frames after its hitmark). Its Charged
 * Attack is gcsim's aim, which a normal attack allows at its hitmark (InitNormalCancelSlice)
 */
const rangedNormals: NormalHit[] = [
  { hitmarks: [17], toNormal: 26, toCharged: 17, toAbil: 17, frames: 26 },
  { hitmarks: [8], toNormal: 27, toCharged: 8, toAbil: 8, frames: 27 },
  { hitmarks: [15], toNormal: 33, toCharged: 15, toAbil: 15, frames: 33 },
  { hitmarks: [19], toNormal: 32, toCharged: 19, toAbil: 19, frames: 32 },
  { hitmarks: [11], toNormal: 33, toCharged: 11, toAbil: 11, frames: 33 },
  { hitmarks: [14], toNormal: 66, toCharged: 14, toAbil: 14, frames: 66 },
]
const RANGED_TRAVEL = 10

/**
 * Melee stance: the Hydro strikes (N6 has two hits). Hitlag per hit: gcsim's halt frames plus its
 * default defense halt (+3.6 frames), rounded up as gcsim applies it
 */
const meleeNormals: NormalHit[] = [
  {
    hitmarks: [8],
    hitlag: [6],
    toNormal: 10,
    toCharged: 23,
    toAbil: 8,
    frames: 23,
  },
  {
    hitmarks: [6],
    hitlag: [6],
    toNormal: 11,
    toCharged: 23,
    toAbil: 6,
    frames: 23,
  },
  {
    hitmarks: [16],
    hitlag: [8],
    toNormal: 32,
    toCharged: 37,
    toAbil: 16,
    frames: 37,
  },
  {
    hitmarks: [7],
    hitlag: [8],
    toNormal: 33,
    toCharged: 37,
    toAbil: 7,
    frames: 37,
  },
  {
    hitmarks: [7],
    hitlag: [8],
    toNormal: 22,
    toCharged: 23,
    toAbil: 7,
    frames: 23,
  },
  {
    hitmarks: [4, 20],
    hitlag: [6, 11],
    toNormal: 65,
    toCharged: 65,
    toAbil: 20,
    frames: 65,
  },
]
/** Our sheet's melee nodes, by string step (N6's two hits: `normal61`, `normal62`) */
const meleeNodes = ['normal1', 'normal2', 'normal3', 'normal4', 'normal5']

/** Riptide lasts 10 s, +8 s from A1 (assumed); enemy statuses are active on their expiry frame */
const RIPTIDE = 18 * 60 + 1
/** Riptide Flash: 0.7 s ICD; Riptide Slash: 1.5 s ICD (shared with Riptide Blast, as in gcsim) */
const FLASH_ICD = 43
const SLASH_ICD = 91
/** C4: Riptide ticks every 4 s (the game text; gcsim uses 3.9 s) */
const C4_INTERVAL = 240

interface TartagliaState {
  /** Foul Legacy's Melee Stance is on */
  melee: boolean
  /** Frame Foul Legacy was cast (the stance's time sets its cooldown when it is left) */
  eCast: number
  /** The enemy's Riptide ends (frame) */
  riptideUntil: number
  /** Riptide Flash's ICD ends (frame) */
  flashIcd: number
  /** Riptide Slash's ICD ends (frame): Riptide Blast waits for it too */
  slashIcd: number
  /** C4's chain of Riptide ticks, by the Riptide that started it */
  c4Src: number
  /** C6: Light of Obliteration was used in this stance (leaving it resets the skill cooldown) */
  mlBurst: boolean
  /**
   * A4: melee Normal and Charged crits apply Riptide. A deterministic accumulator of the hits'
   * crit chances (from 0.5: the median first crit) stands for gcsim's crit rolls
   */
  critAcc: number
}

/** Riptide on the enemy (a fresh application starts C4's ticks when there was none) */
function applyRiptide(c: SimContext, s: TartagliaState) {
  if (c.constellation('Tartaglia') >= 4 && c.now >= s.riptideUntil) {
    const src = c.now
    s.c4Src = src
    c.atEnemy(C4_INTERVAL, (c2) => c4Tick(c2, s, src))
  }
  s.riptideUntil = c.now + RIPTIDE
}

/** A4: a melee Normal or Charged hit applies Riptide on a crit (its crit chance accumulated) */
function a4OnMelee(c: SimContext, s: TartagliaState) {
  if (!s.melee) return
  const rate = Math.min(
    1,
    Math.max(0, c.calculate('Tartaglia', ['total', 'critRate_']) ?? 0.5)
  )
  s.critAcc += rate
  if (s.critAcc < 1) return
  s.critAcc -= 1
  applyRiptide(c, s)
}

/** C4: a Riptide Slash in the stance, else a Riptide Flash, every 3.9 s while the Riptide lasts */
function c4Tick(c: SimContext, s: TartagliaState, src: number) {
  if (src !== s.c4Src || c.now >= s.riptideUntil) return
  if (s.melee) riptideSlash(c)
  else riptideFlash(c)
  c.atEnemy(C4_INTERVAL, (c2) => c4Tick(c2, s, src))
}

/** Riptide Flash: three hits 1 frame after it is triggered (no ICD of its own) */
function riptideFlash(c: SimContext) {
  for (let i = 0; i < 3; i++)
    c.hit(1, {
      characterKey: 'Tartaglia',
      path: ['charged', 'flashDmg'],
      tag: 'normal',
      element: 'hydro',
      applies: true,
      icd: 'TartagliaRiptideFlash',
      label: 'Riptide Flash',
    })
}

/** Riptide Flash on a fully-charged Aimed Shot that hits a Riptide enemy (before the Riptide is applied) */
function flashOnAim(c: SimContext, s: TartagliaState) {
  if (c.now >= s.riptideUntil || c.now < s.flashIcd) return
  s.flashIcd = c.now + FLASH_ICD
  riptideFlash(c)
}

/** Riptide Slash: a melee hit on a Riptide enemy (1 frame later), once per 1.5 s */
function riptideSlash(c: SimContext) {
  c.hit(1, {
    characterKey: 'Tartaglia',
    path: ['skill', 'riptideSlash'],
    tag: 'skill',
    element: 'hydro',
    applies: true,
    icd: 'none',
    label: 'Riptide Slash',
  })
}

/** The melee hit's callback: a Riptide Slash, if the stance is on and the enemy has Riptide off ICD */
function slashOnMelee(c: SimContext, s: TartagliaState) {
  if (!s.melee || c.now >= s.riptideUntil || c.now < s.slashIcd) return
  s.slashIcd = c.now + SLASH_ICD
  riptideSlash(c)
}

/** The stance ends without a skill press (a swap, or 30 s): its cooldown starts now (C6: reset) */
function leaveStance(c: SimContext, s: TartagliaState) {
  s.melee = false
  const frames = s.mlBurst
    ? 0
    : stanceCooldown(c.now - s.eCast, c.constellation('Tartaglia'))
  s.mlBurst = false
  c.setCooldown('skill', frames, 'Tartaglia')
}

/** Foul Legacy's stance time sets the skill's cooldown when it is left (gcsim's table) */
function stanceCooldown(inStance: number, c: number): number {
  let cd: number
  if (inStance < 2 * 60) cd = 7 * 60
  else if (inStance < 4 * 60) cd = 8 * 60
  else if (inStance < 5 * 60) cd = 9 * 60
  else if (inStance < 8 * 60) cd = 5 * 60 + inStance
  else if (inStance < 30 * 60) cd = 6 * 60 + inStance
  else cd = 45 * 60
  return c >= 1 ? Math.trunc(cd * 0.8) : cd
}

export const kit: KitModel = {
  characterKey: 'Tartaglia',
  element: 'hydro',
  source: `${GCSIM}/tartaglia`,
  normalAnimationDelay: (_ctx, s: TartagliaState, kind) =>
    kind === 'xingqiu' ? (s.melee ? 12 : 9) : 0,
  init: (): TartagliaState => ({
    melee: false,
    eCast: -1,
    riptideUntil: -1,
    flashIcd: -1,
    slashIcd: -1,
    c4Src: -1,
    mlBurst: false,
    critAcc: 0.5,
  }),
  act(ctx, s: TartagliaState, action, previous) {
    const c = ctx.constellation('Tartaglia')
    const afterDash = previous?.kind === 'dash'
    switch (action.kind) {
      case 'normal':
        if (s.melee)
          return normalString(
            meleeNormals,
            action.count ?? 1,
            (i, d, j) => {
              const node =
                i < 5 ? meleeNodes[i] : j === 0 ? 'normal61' : 'normal62'
              ctx.hit(d, {
                path: ['skill', node],
                tag: 'normal',
                element: 'hydro',
                applies: true,
                icd: 'normal',
                label: `Melee N${i + 1}`,
              })
              // (A4's Riptide first, so the hit that applies it can also Slash)
              ctx.at(d, (c2) => {
                a4OnMelee(c2, s)
                slashOnMelee(c2, s)
              })
            },
            ctx
          )
        return normalString(
          rangedNormals,
          action.count ?? 1,
          (i, d) =>
            ctx.hit(d + RANGED_TRAVEL, {
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
        if (s.melee) {
          // the melee Charged Attack: two Hydro hits, each with a Riptide Slash check
          const hitmarks = [14, 27]
          hitmarks.forEach((d, j) => {
            ctx.hit(d, {
              path: ['skill', `charged${j + 1}`],
              tag: 'charged',
              element: 'hydro',
              applies: true,
              icd: 'ExtraAttack',
              label: `Charged Attack ${j + 1}`,
            })
            ctx.at(d, (c2) => {
              a4OnMelee(c2, s)
              slashOnMelee(c2, s)
            })
          })
          return {
            frames: 55,
            framesInto: { skill: 29, burst: 29, dash: 14, jump: 15, swap: 52 },
          }
        }
        // the fully-charged Aimed Shot: Hydro, lands 10 frames after its hitmark; Riptide Flash on
        // a Riptide enemy, then the Riptide, then a Riptide Slash if the stance came on meanwhile
        ctx.hit(86 + RANGED_TRAVEL, {
          path: ['charged', 'aimedCharged'],
          tag: 'charged',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Fully-Charged Aimed Shot',
        })
        ctx.at(86 + RANGED_TRAVEL, (c2) => {
          flashOnAim(c2, s)
          applyRiptide(c2, s)
          slashOnMelee(c2, s)
        })
        return {
          frames: 94,
          framesInto: { dash: 86, jump: 86 },
        }
      }
      case 'skill': {
        if (s.melee) {
          // leaving the stance (no damage): its cooldown from the time in it, from the Stance's
          // delay (11 frames; 0 after a dash)
          const inStance = ctx.now - s.eCast
          s.melee = false
          if (s.mlBurst) {
            // C6: Light of Obliteration was used: no cooldown
            s.mlBurst = false
            return {
              cooldown: { key: 'skill', frames: 0, delay: 0 },
              frames: afterDash ? 23 : 18,
              framesInto: afterDash
                ? { normal: 13, burst: 16, dash: 22, jump: 3 }
                : { normal: 17, burst: 18, dash: 17, jump: 17, swap: 16 },
            }
          }
          const cooldown = {
            key: 'skill',
            frames: stanceCooldown(inStance, c),
            delay: afterDash ? 0 : 11,
          }
          return afterDash
            ? {
                cooldown,
                frames: 23,
                framesInto: { normal: 13, burst: 16, dash: 22, jump: 3 },
              }
            : {
                cooldown,
                frames: 18,
                framesInto: {
                  normal: 17,
                  burst: 18,
                  dash: 17,
                  jump: 17,
                  swap: 16,
                },
              }
        }
        // entering the Melee Stance (for 30 s): the Raging Tide hit (Hydro, 16 frames, 3 after a dash)
        s.melee = true
        s.eCast = ctx.now
        s.mlBurst = false
        const cast = ctx.now
        // (the stance also ends 30 s after it was cast, a character task: its cooldown is then the
        // longest one, 45 s)
        ctx.atCharacter('Tartaglia', 30 * 60, (c2) => {
          if (s.eCast === cast && s.melee) leaveStance(c2, s)
        })
        ctx.hit(afterDash ? 3 : 16, {
          path: ['skill', 'stanceDmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Foul Legacy: Raging Tide',
        })
        // (ranged stance cast: the 1 s cooldown; the stance's own cooldown is set when it is left)
        return afterDash
          ? {
              cooldown: { key: 'skill', frames: 60, delay: 0 },
              frames: 24,
              framesInto: { normal: 17, burst: 17, dash: 22, jump: 3 },
            }
          : {
              cooldown: { key: 'skill', frames: 60, delay: 14 },
              frames: 39,
              framesInto: { normal: 19, burst: 19, dash: 19, jump: 21 },
            }
      }
      case 'burst': {
        if (s.melee) {
          // (Riptide Blast shares Riptide Slash's ICD, as in gcsim: the text gives it none, nor
          // says it has none)
          // Light of Obliteration: Hydro AoE; a Riptide enemy takes a Riptide Blast (which clears it)
          if (c >= 6) s.mlBurst = true
          ctx.hit(69, {
            path: ['burst', 'meleeDmg'],
            tag: 'burst',
            element: 'hydro',
            applies: true,
            durability: 50,
            icd: 'none',
            label: 'Light of Obliteration',
          })
          ctx.at(69, (c2) => {
            if (c2.now >= s.riptideUntil || c2.now < s.slashIcd) return
            s.riptideUntil = -1
            c2.hit(1, {
              characterKey: 'Tartaglia',
              path: ['burst', 'riptideBlastDmg'],
              tag: 'burst',
              element: 'hydro',
              applies: true,
              durability: 50,
              icd: 'none',
              label: 'Riptide Blast',
            })
          })
          return {
            cooldown: { key: 'burst', frames: 900, delay: 66 },
            frames: 103,
            framesInto: { normal: 102, skill: 102, jump: 102, swap: 101 },
          }
        }
        // Flash of Havoc: ranged Hydro AoE that applies Riptide
        ctx.hit(70, {
          path: ['burst', 'rangedDmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Flash of Havoc',
        })
        ctx.at(70, (c2) => applyRiptide(c2, s))
        return {
          cooldown: { key: 'burst', frames: 900, delay: 0 },
          frames: 55,
          framesInto: { normal: 54, dash: 54, jump: 54, swap: 53 },
        }
      }
      case 'plunge':
        // gcsim has no plunge for Tartaglia
        ctx.note(
          'Tartaglia: the plunging attack is not modelled (gcsim has none).'
        )
        return { frames: 30 }
      case 'dash':
        // (gcsim's own dash for Tartaglia: 19 frames, 3 to a skill)
        return { frames: 19, framesInto: { skill: 3 } }
      case 'jump':
        return templateJump('male', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  // leaving the stance by a swap: the skill's cooldown from the time in the stance (gcsim resets
  // the running 1 s cooldown first)
  onSwapOut(ctx, s: TartagliaState) {
    if (s.melee) leaveStance(ctx, s)
  },
}
