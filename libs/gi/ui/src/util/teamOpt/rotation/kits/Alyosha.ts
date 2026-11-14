import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/alyosha, main as of 2026-11-10. */

/*
 * Frames follow upstream gcsim (b107b5d), which matches this kit action for action. The pinned
 * kqmsim fork carries an older Alyosha that differs: its normal hitlag halts are 0.04 *frames*
 * (a missing `* 60`, so about 1 frame of hitlag), N4 lands at 18, N2 into N1 is 22, the field
 * ticks every 119 frames and the tap skill dashes at 28. Those rows of the kqmsim frame matrix are
 * reference differences, not kit errors.
 * Not modelled: C1's energy (the sim tracks no energy). A1's and C4's healing are emitted as
 * healing events on Tugarin's attacks.
 */

/** N1..N4 from gcsim's attack.go (hitmarks, cancels). N3 has two instances (17 and 32). */
const alyoshaNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [8],
    toNormal: 18,
    toCharged: 24,
    toAbil: 13,
    frames: 34,
  },
  {
    hitmarks: [14],
    hitlag: [8],
    toNormal: 23,
    toCharged: 26,
    toAbil: 14,
    frames: 38,
  },
  { hitmarks: [17, 32], toNormal: 53, toCharged: 54, toAbil: 32, frames: 65 },
  { hitmarks: [17], toNormal: 56, toCharged: 62, toAbil: 17, frames: 62 },
]
/** Our sheet's normal node for each (string step, instance): N3's two instances are nodes 2 and 3 */
const alyoshaNodes = [[0], [1], [2, 3], [4]]

/** Hunter's Mark and Hunter's Precision last 902 frames (gcsim's skillBuffDur) */
const HUNTERS_DURATION = 902

interface AlyoshaState {
  /** Hunter's Mark on the enemy: until (frame) */
  markUntil: number
  /** Hunter's Precision: until (frame; his hitlag extends it), and its stacks */
  precisionUntil: number
  stacks: number
  /** The expiry check that is current (a refresh replaces it) */
  precisionId: number
  /** Fulgurite Hunting Field: the cast it belongs to, and until (frame; his hitlag extends it) */
  fieldSrc: number
  fieldUntil: number
  /** The Stellar-Conduct radiance state last written (A0) */
  radiance: string
}

/** Hunter's Precision ends at `precisionUntil`, rechecked when his hitlag pushed it back */
function precisionExpiry(ctx: SimContext, s: AlyoshaState, id: number) {
  ctx.at(Math.max(1, s.precisionUntil - ctx.now), (c) => {
    if (s.precisionId !== id) return
    if (c.now < s.precisionUntil) return precisionExpiry(c, s, id)
    s.stacks = 0
    c.state('Alyosha', ['Alyosha', 'skillPrecision'], '')
  })
}

/**
 * Hunter's Mark's trigger (6 frames after a hit): a hit on a marked enemy consumes the mark and
 * adds a Hunter's Precision stack (refreshing the buff; 2 stacks at C6); otherwise, when
 * `canApply`, it applies the mark. The stack count is a state, so a second stack counts at once.
 */
function triggerMark(ctx: SimContext, s: AlyoshaState, canApply: boolean) {
  if (ctx.now < s.markUntil) {
    s.markUntil = -1
    if (ctx.now >= s.precisionUntil) s.stacks = 0
    s.stacks = Math.min(s.stacks + 1, ctx.constellation('Alyosha') >= 6 ? 2 : 1)
    s.precisionUntil = ctx.now + HUNTERS_DURATION
    ctx.state('Alyosha', ['Alyosha', 'skillPrecision'], `${s.stacks}`)
    precisionExpiry(ctx, s, ++s.precisionId)
  } else if (canApply) s.markUntil = ctx.now + HUNTERS_DURATION
}

/** gcsim's A1 and C4: Tugarin's attack heals the active member, and (C4) the lowest-HP one */
function tugarinHeals(ctx: SimContext) {
  ctx.hit(0, {
    path: ['_heal', 'passive1', 'heal'],
    tag: 'other',
    element: 'electro',
    label: 'Tugarin: Healing (A1)',
  })
  if (ctx.constellation('Alyosha') < 4) return
  let lowest: (typeof ctx.members)[number] = 'Alyosha'
  let ratio = ctx.hpRatio('Alyosha') ?? 1
  for (const m of ctx.members) {
    const r = ctx.hpRatio(m)
    if (r !== undefined && r < ratio) {
      ratio = r
      lowest = m
    }
  }
  ctx.hit(0, {
    path: ['_heal', 'constellation4', 'heal'],
    tag: 'other',
    element: 'electro',
    healTargets: [lowest],
    label: 'Tugarin: Healing (C4)',
  })
}

export const kit: KitModel = {
  characterKey: 'Alyosha',
  element: 'electro',
  source: `${GCSIM}/alyosha`,
  init: (): AlyoshaState => ({
    markUntil: -1,
    precisionUntil: -1,
    stacks: 0,
    precisionId: 0,
    fieldSrc: -1,
    fieldUntil: -1,
    radiance: '',
  }),
  act(ctx, s: AlyoshaState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          alyoshaNormals,
          action.count ?? 1,
          (i, d, j) => {
            ctx.hit(d, {
              path: ['normal', `${alyoshaNodes[i][j]}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            })
            // N4 applies (or triggers) Hunter's Mark, 6 frames after the hit
            if (i === 3) ctx.at(d + 6, (c) => triggerMark(c, s, true))
          },
          ctx
        )
      case 'charged':
        ctx.hit(24, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'charged',
          icdGroup: 'PoleExtraAttack',
          label: 'Charged Attack',
        })
        return {
          frames: 63,
          framesInto: {
            normal: 63,
            skill: 62,
            burst: 62,
            dash: 24,
            jump: 24,
            swap: 61,
          },
        }
      case 'skill': {
        const hold = !!action.hold
        const hit = hold ? 113 : 18
        ctx.hit(hit, {
          path: ['skill', hold ? 'holdDmg' : 'pressDmg'],
          tag: 'skill',
          element: 'electro',
          applies: true,
          icd: 'none',
          label: hold ? 'Skill (hold)' : 'Skill (tap)',
        })
        // the skill applies Hunter's Mark, 6 frames after the hit
        ctx.at(hit + 6, (c) => triggerMark(c, s, true))
        return hold
          ? {
              cooldown: { key: 'skill', frames: 900, delay: 111 },
              frames: 142,
              framesInto: {
                normal: 138,
                burst: 138,
                dash: 138,
                jump: 138,
                swap: 137,
              },
            }
          : {
              cooldown: { key: 'skill', frames: 900, delay: 16 },
              frames: 31,
              framesInto: {
                normal: 30,
                burst: 30,
                dash: 30,
                jump: 31,
                swap: 29,
              },
            }
      }
      case 'burst': {
        // Fulgurite Hunting Field: 14 s (+6 s at C2), a tick every 118 frames from frame 79
        const src = ctx.now
        const c2 = ctx.constellation('Alyosha') >= 2
        s.fieldSrc = src
        s.fieldUntil = src + 840 + (c2 ? 360 : 0)
        const tick = (c: SimContext) => {
          if (s.fieldSrc !== src || c.now >= s.fieldUntil) return
          c.hit(0, {
            path: ['burst', 'fieldDmg'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            // (gcsim's group: 1.6 s, first 2 hits apply; not reproduced by the engine's ICD)
            icd: 'Alyosha_ElementalBurst',
            icdGroup: 'AlyoshaBurst',
            label: 'Fulgurite Hunting Field',
          })
          // C2: the field's tick marks the primary target
          if (c2) s.markUntil = c.now + HUNTERS_DURATION
          // Tugarin bites 39 frames after each tick; its hit triggers a mark (never applies one)
          c.at(39, (t) => {
            t.hit(0, {
              path: ['burst', 'tugarinDmg'],
              tag: 'burst',
              element: 'electro',
              applies: true,
              icd: 'Alyosha_ElementalBurst',
              icdGroup: 'AlyoshaBurst',
              label: 'Tugarin',
            })
            tugarinHeals(t)
            t.at(6, (m) => triggerMark(m, s, false))
          })
          c.at(118, tick)
        }
        ctx.at(79, tick)
        return {
          cooldown: { key: 'burst', frames: 1080, delay: 1 },
          frames: 55,
          framesInto: { normal: 54, skill: 53, swap: 52 },
        }
      }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // gcsim's template: 31 frames for this body, 34 right after a dash
        return templateJump('boy', 'polearm', previous, ctx)
      case 'plunge':
        ctx.note('Alyosha: gcsim has no plunge, not modelled')
        return { frames: 30 }
      default:
        return { frames: 30 }
    }
  },
  // his hitlag extends the field's and Hunter's Precision's statuses (gcsim AddStatus(…, true))
  onHitlag(ctx, s: AlyoshaState, frames) {
    if (ctx.now < s.fieldUntil) s.fieldUntil += frames
    if (ctx.now < s.precisionUntil) s.precisionUntil += frames
  },
  // A0: inside a Polestar Field he is in Stellar-Conduct radiance, so Hunter's Precision also
  // raises the on-field member's Stellar-Conduct DMG (the sheet's condition follows the field)
  onBeforeHit(ctx, s: AlyoshaState) {
    const v = ctx.radiance === 'conduct' ? 'on' : ''
    if (v === s.radiance) return
    s.radiance = v
    ctx.state('Alyosha', ['Alyosha', 'a0StellarRadianceSc'], v)
  },
}
