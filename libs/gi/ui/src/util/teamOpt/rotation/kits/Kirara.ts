import type { ActionResult, KitModel, SimContext } from '../types'
import {
  GCSIM,
  type NormalHit,
  normalString,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/kirara, main as of 2026-11-10. */

const kiraraNormals: NormalHit[] = [
  {
    hitmarks: [13],
    hitlag: [6],
    toNormal: 20,
    toCharged: 24,
    toAbil: 13,
    frames: 33,
  },
  {
    hitmarks: [18],
    hitlag: [6],
    toNormal: 28,
    toCharged: 28,
    toAbil: 18,
    frames: 35,
  },
  {
    hitmarks: [17, 39],
    hitlag: [5, 7],
    toNormal: 54,
    toCharged: 40,
    toAbil: 39,
    frames: 61,
  },
  {
    hitmarks: [39],
    hitlag: [8],
    toNormal: 60,
    toCharged: 63,
    toAbil: 39,
    frames: 63,
  },
]

/** Hold E's length: the rotation text gives none, so gcsim's 10 s cap */
const HOLD_DURATION = 600
/** The skill's Shield of Safe Transport is made 15 frames after the cast and lasts 12 s */
const SHIELD_DELAY = 15
const SHIELD_DURATION = 720
/** C4 (Steed of Skanda): once every 3.8 s, shared by the party (gcsim's status, still active on
 * its expiry frame) */
const C4_ICD = 229
/** The burst's Cat Grass Cardamoms keep the stats of 34 frames into it */
const MINE_SNAPSHOT = 34

interface KiraraState {
  /** The skill's shield is up until this frame (C4 needs it) */
  shieldUntil: number
  /** C4's shared ICD runs until this frame of Kirara's clock (a status: hitlag extends it) */
  c4Until: number
}

/** Skill and burst: C6 (+12% All Elemental DMG for the party) for 15 s */
function c6Buff(ctx: SimContext) {
  if (ctx.constellation('Kirara') >= 6)
    ctx.buff('Kirara', ['Kirara', 'c6AfterSkillBurst'], 'on', 0, 15 * 60, {
      hitlag: 'recipient',
    })
}

function skillShield(ctx: SimContext, s: KiraraState) {
  ctx.at(SHIELD_DELAY, (c2) => {
    s.shieldUntil = c2.now + SHIELD_DURATION
  })
}

export const kit: KitModel = {
  characterKey: 'Kirara',
  element: 'dendro',
  source: `${GCSIM}/kirara`,
  init: (): KiraraState => ({ shieldUntil: -1, c4Until: -1 }),
  act(ctx, s: KiraraState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          kiraraNormals,
          action.count ?? 1,
          (i, d, j) =>
            // the sheet's nodes: N1 '0', N2 '1', N3 '2' and '3' (its two instances), N4 '4'
            ctx.hit(d, {
              path: ['normal', `${i < 2 ? i : i === 2 ? 2 + j : 4}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        // gcsim's three hits: the first is dmg1, the 2nd and 3rd are dmg2
        ctx.hit(20, {
          path: ['charged', 'dmg1'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (1)',
        })
        ctx.hit(27, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (2)',
        })
        ctx.hit(37, {
          path: ['charged', 'dmg2'],
          tag: 'charged',
          element: 'physical',
          applies: true,
          icd: 'normal',
          label: 'Charged Attack (3)',
        })
        return {
          frames: 52,
          framesInto: {
            normal: 43,
            charged: 52,
            skill: 43,
            burst: 43,
            dash: 38,
            jump: 38,
            swap: 37,
          },
        }
      case 'skill': {
        if (!action.hold) {
          // Tail-Flicking Flying Kick (tap)
          ctx.hit(14, {
            path: ['skill', 'tailDmg'],
            tag: 'skill',
            element: 'dendro',
            applies: true,
            icd: 'none',
            label: 'Tail-Flicking Flying Kick',
          })
          // (the kick's defense halt pauses her)
          ctx.hit(14, {
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 4,
            label: 'Kirara skill hitlag',
          })
          skillShield(ctx, s)
          c6Buff(ctx)
          const result: ActionResult = {
            frames: 38,
            framesInto: {
              normal: 34,
              charged: 38,
              skill: 34,
              burst: 34,
              dash: 35,
              jump: 35,
              swap: 33,
            },
            cooldown: { key: 'skill', frames: 8 * 60, delay: 12 },
          }
          return withHitlag(result, { hitmarks: [14], hitlag: [4] })
        }
        // Urgent Neko Parcel (hold): a hit every 30 frames from 16 (up to the hold's end)
        const duration = HOLD_DURATION
        for (let t = 16; t <= duration + 12; t += 30)
          ctx.hit(t, {
            path: ['skill', 'parcelDmg'],
            tag: 'skill',
            element: 'dendro',
            applies: true,
            icd: 'skillHold',
            label: 'Urgent Neko Parcel',
          })
        // Flipclaw Strike, the kick at the end of the hold
        ctx.hit(duration + 36, {
          path: ['skill', 'strikeDmg'],
          tag: 'skill',
          element: 'dendro',
          applies: true,
          icd: 'none',
          label: 'Flipclaw Strike',
        })
        skillShield(ctx, s)
        // A1: the parcel's impacts give Reinforced Packaging; when the hold ends they make more
        // Shields of Safe Transport, which reset the shield's duration (gcsim's a1, 614 frames in)
        ctx.atCharacter('Kirara', duration + 14 + 1, (c2) => {
          s.shieldUntil = c2.now + SHIELD_DURATION
        })
        c6Buff(ctx)
        return {
          cooldown: {
            key: 'skill',
            frames: 8 * 60 + (duration / 30) * 12,
            delay: 14 + duration,
          },
          frames: 668,
          framesInto: {
            normal: 659,
            charged: 668,
            skill: 662,
            burst: 663,
            dash: 662,
            jump: 663,
            swap: 663,
          },
        }
      }
      case 'burst': {
        // Secret Art: Surprise Dispatch: the box hit at 38 frames
        ctx.hit(38, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'dendro',
          applies: true,
          durability: 50,
          icd: 'none',
          label: 'Secret Art: Surprise Dispatch',
        })
        // 6 Cat Grass Cardamoms (C1: 1 more per 8,000 Max HP, up to 4): the default 2 explode on
        // hit at 180 frames, the rest when they expire at 800 frames (18 apart); their stats are
        // those of 34 frames in
        // (without the team's stats, 16,000 Max HP: her base HP and a flower already pass it)
        const hp =
          ctx.constellation('Kirara') >= 1
            ? (ctx.calculate('Kirara', ['total', 'hp']) ?? 16000)
            : 0
        const cardamoms = 6 + Math.min(Math.floor(hp / 8000), 4)
        for (let i = 0; i < 2; i++)
          ctx.hit(180, {
            path: ['burst', 'explosionDmg'],
            tag: 'burst',
            element: 'dendro',
            applies: true,
            icd: 'burst',
            snapshotDelay: MINE_SNAPSHOT,
            label: 'Cat Grass Cardamom',
          })
        for (let i = 0; i < cardamoms - 2; i++)
          ctx.hit(800 + 18 * i, {
            path: ['burst', 'explosionDmg'],
            tag: 'burst',
            element: 'dendro',
            applies: true,
            icd: 'burst',
            snapshotDelay: MINE_SNAPSHOT,
            label: 'Cat Grass Cardamom (expired)',
          })
        c6Buff(ctx)
        return {
          cooldown: { key: 'burst', frames: 15 * 60 },
          frames: 58,
          framesInto: {
            normal: 57,
            charged: 58,
            skill: 57,
            burst: 58,
            dash: 52,
            jump: 52,
            swap: 57,
          },
        }
      }
      case 'dash':
        // Girl body (gcsim's template): 20 frames, 4 to a jump
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // Girl body: 31 frames, 34 after a dash
        return templateJump('girl', 'sword', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
  onHit(ctx, s: KiraraState, hit) {
    if (ctx.constellation('Kirara') < 4) return
    // C4: the active member's normal, charged or plunging attack that hits while the skill's shield
    // protects them (C2's Critical Transport Shields need other members on the field: none here)
    if (hit.t >= s.shieldUntil || ctx.characterFrame('Kirara') < s.c4Until)
      return
    if (hit.tag !== 'normal' && hit.tag !== 'charged' && hit.tag !== 'plunge')
      return
    if (hit.characterKey !== ctx.onField || hit.path[0].startsWith('_')) return
    s.c4Until = ctx.characterFrame('Kirara') + C4_ICD
    ctx.hit(0, {
      characterKey: 'Kirara',
      path: ['constellation4', 'dmg'],
      tag: 'burst',
      element: 'dendro',
      applies: true,
      icd: 'burst',
      label: 'Steed of Skanda (C4)',
    })
  },
}
