import { HEXEREI_CHARACTERS } from '../gearEffects'
import { annulusHitChance } from '../geometry'
import type { KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/albedo, main as of 2026-11-10. */

const albedoNormals: NormalHit[] = [
  {
    hitmarks: [12],
    hitlag: [6],
    toNormal: 14,
    toCharged: 23,
    toAbil: 12,
    frames: 23,
  },
  {
    hitmarks: [11],
    hitlag: [6],
    toNormal: 22,
    toCharged: 21,
    toAbil: 11,
    frames: 22,
  },
  {
    hitmarks: [17],
    hitlag: [8],
    toNormal: 32,
    toCharged: 41,
    toAbil: 17,
    frames: 41,
  },
  {
    hitmarks: [17],
    hitlag: [9],
    toNormal: 34,
    toCharged: 36,
    toAbil: 17,
    frames: 36,
  },
  {
    hitmarks: [27],
    hitlag: [11],
    toNormal: 62,
    toCharged: 62,
    toAbil: 27,
    frames: 62,
  },
]

interface AlbedoState {
  hexEnd: number
  aureliths: number[]
  /** The Solar Isotoma field (a construct): from `fieldStart` to `fieldEnd` */
  fieldStart: number
  fieldEnd: number
  /** Transient Blossom's ICD: the frame another may come */
  icdUntil: number
  /** C2: Fatal Reckoning stacks, which lapse `c2Until` (30 s after the last one) */
  c2Stacks: number
  c2Until: number
}

const FIELD_DURATION = 30 * 60

/** A Fatal Blossom placed at random in the Solar Isotoma field hits the enemy with this chance */
const blossomChance = (ctx: SimContext) =>
  annulusHitChance(
    0.5,
    9.5,
    ctx.target.radius + 3,
    Math.abs(ctx.target.distance - 3)
  )

export const kit: KitModel = {
  characterKey: 'Albedo',
  element: 'geo',
  source: `${KQMSIM}/albedo`,
  init: (): AlbedoState => ({
    hexEnd: -1,
    aureliths: [],
    fieldStart: 0,
    fieldEnd: -1,
    icdUntil: -1e9,
    c2Stacks: 0,
    c2Until: -1e9,
  }),
  onStart(ctx) {
    // Witch's Homework completed (gcsim's default): his own Hexerei upgrades (C1, C2, C6);
    // Secret Rite still needs a second Hexerei member (the sheet checks the tally)
    ctx.state('Albedo', ['Albedo', 'lockHomework'], 'on')
  },
  act(ctx, s: AlbedoState, action, previous) {
    switch (action.kind) {
      case 'normal':
        return normalString(
          albedoNormals,
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
        // two instances at the same frame
        for (let j = 0; j < 2; j++)
          ctx.hit(20, {
            path: ['charged', j ? 'dmg2' : 'dmg1'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'normal',
            label: `Charged Attack${j ? ' (hit 2)' : ''}`,
          })
        return {
          frames: 56,
          framesInto: {
            normal: 56,
            charged: 56,
            skill: 34,
            burst: 34,
            dash: 20,
            jump: 20,
            swap: 33,
          },
        }
      case 'skill': {
        ctx.at(25, (c) => c.construct(FIELD_DURATION))
        ctx.hit(25, {
          path: ['skill', 'dmg'],
          tag: 'skill',
          element: 'geo',
          applies: true,
          label: 'Abiogenesis: Solar Isotoma',
        })
        // the field lasts 30 s from its creation at 25 frames; its blossom ICD resets then
        s.fieldStart = ctx.now + 25
        s.fieldEnd = s.fieldStart + FIELD_DURATION
        s.icdUntil = s.fieldStart
        // C4 (plunge DMG for the active member in the field) and C6 are the sheet's skillInField
        ctx.buff(
          'Albedo',
          ['Albedo', 'skillInField'],
          'skillInField',
          25,
          FIELD_DURATION
        )
        if (
          ctx.members.filter((m) => HEXEREI_CHARACTERS.includes(m)).length >= 2
        )
          ctx.at(26, (c) => {
            s.hexEnd = c.now + 1200
            c.buff('Albedo', ['Albedo', 'lockCreateSolar'], 'on', 0, 1200)
          })
        // C1 (Hexerei): DEF +50% for 20 s from the cast (before the blossoms' snapshot)
        if (ctx.constellation('Albedo') >= 1)
          ctx.buff('Albedo', ['Albedo', 'c1LockAfterSkill'], 'on', 0, 1200)
        return {
          cooldown: { key: 'skill', frames: 240, delay: 23 },
          frames: 33,
          framesInto: {
            normal: 32,
            skill: 33,
            burst: 33,
            dash: 29,
            jump: 28,
            swap: 31,
            // gcsim's CanQueueAfter: a wait can start at the hitmark
            wait: 25,
          },
        }
      }
      case 'burst': {
        const c = ctx.constellation('Albedo')
        // C2: this burst uses up the Fatal Reckoning stacks (the sheet's c2Stacks cond, for the
        // burst and its blossoms, up to 4)
        let stacks = c >= 2 && ctx.now < s.c2Until ? s.c2Stacks : 0
        s.c2Stacks = 0
        // C6 (Hexerei): the burst destroys the Silver Isotomas; it then counts as clearing 4
        // Fatal Reckoning stacks, and Fatal Blossoms deal +250% DEF for 20 s
        s.aureliths = s.aureliths.filter((end) => end >= ctx.now)
        if (c >= 6 && s.aureliths.length) {
          s.aureliths = []
          stacks = 4
          ctx.buff('Albedo', ['Albedo', 'c6LockAfterDestroy'], 'on', 0, 1200, {
            hitlag: 'recipient',
          })
        }
        for (let k = 0; k < stacks; k++)
          ctx.buff('Albedo', ['Albedo', 'c2Stacks'], '1', 0, 200, 4)
        ctx.hit(75, {
          path: ['burst', 'dmg'],
          tag: 'burst',
          element: 'geo',
          applies: true,
          icd: 'burst',
          label: 'Rite of Progeniture: Tectonic Tide',
        })
        // A4: the party's EM for 10 s from the burst (the sheet's burstUsed cond)
        ctx.buff('Albedo', ['Albedo', 'burstUsed'], 'burstUsed', 75, 600)
        // Fatal Blossoms: 7, from 145 frames and 5 apart, if the field is up at 75 frames. The
        // first hits the enemy; the other 6 land at random in the field (gcsim: 0.5 to 9.5 m
        // from its centre, 3 m ahead of Albedo; a 3 m blast), weighted by their chance to hit
        if (s.fieldStart <= ctx.now + 75 && ctx.now + 75 < s.fieldEnd)
          for (let i = 0; i < 7; i++)
            ctx.hit(145 + 5 * i, {
              path: ['burst', 'blossom'],
              tag: 'burst',
              element: 'geo',
              applies: true,
              icd: 'burst',
              weight: i === 0 ? 1 : blossomChance(ctx),
              label: 'Fatal Blossom',
            })
        return {
          cooldown: { key: 'burst', frames: 720, delay: 74 },
          frames: 96,
          framesInto: { normal: 96, skill: 96, dash: 95, jump: 94, swap: 93 },
        }
      }
      case 'dash':
        // template dash (Boy body): 21 frames, 2 into a jump
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        // template jump (Boy body): 31 frames, 34 after a dash
        return templateJump('boy', 'sword', previous, ctx)
      case 'plunge':
        // low plunge (gcsim's low_plunge, which needs an airborne state in gcsim); the optional
        // collision hit is not modelled
        ctx.hit(37, {
          path: ['plunging', 'low'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          label: 'Low Plunge',
        })
        return {
          frames: 63,
          framesInto: {
            normal: 41,
            skill: 42,
            burst: 41,
            dash: 37,
            jump: 59,
            swap: 46,
          },
        }
      default:
        return { frames: 30 }
    }
  },
  // Transient Blossom: a hit in the field (any member's, not the Solar Isotoma hit itself), on a
  // 2 s ICD, makes a blossom hit 1 frame later. C2: each blossom adds a Fatal Reckoning stack
  onHit(ctx, s: AlbedoState, hit: SimHit) {
    if (hit.path[0].startsWith('_')) return
    if (
      hit.characterKey === 'Albedo' &&
      hit.tag === 'skill' &&
      hit.path[1] === 'blossom'
    ) {
      s.aureliths = s.aureliths.filter((end) => end >= ctx.now)
      hit.states = [
        ...(hit.states ?? []),
        {
          owner: 'Albedo',
          path: ['Albedo', 'a1LockSilver'],
          value: s.aureliths.length ? 'on' : '',
        },
      ]
      if (ctx.now < s.hexEnd) {
        s.aureliths.push(ctx.now + 600)
        if (s.aureliths.length > 2) s.aureliths.shift()
        ctx.buff('Albedo', ['Albedo', 'lockCreateSilver'], 'on', 1, 1200)
      }
    }

    if (hit.t < s.fieldStart || hit.t >= s.fieldEnd || hit.t < s.icdUntil)
      return
    if (
      hit.characterKey === 'Albedo' &&
      hit.path[0] === 'skill' &&
      hit.path[1] === 'dmg'
    )
      return
    // (the 2 s ICD status is active through its expiry frame)
    s.icdUntil = hit.t + 121
    ctx.hit(1, {
      characterKey: 'Albedo',
      path: ['skill', 'blossom'],
      tag: 'skill',
      element: 'geo',
      applies: true,
      icd: 'skill',
      label: 'Transient Blossom',
    })
    if (ctx.constellation('Albedo') >= 2) {
      if (hit.t >= s.c2Until) s.c2Stacks = 0
      s.c2Stacks = Math.min(4, s.c2Stacks + 1)
      s.c2Until = hit.t + 30 * 60
      // C2 (Hexerei): off the field, 4 stacks are spent on 3 Fatal Blossoms (300% DEF, burst
      // DMG, 5 frames apart) and the A4 Elemental Mastery
      if (s.c2Stacks >= 4 && ctx.onField !== 'Albedo') {
        s.c2Stacks = 0
        for (let i = 0; i < 3; i++)
          ctx.hit(1 + 5 * i, {
            characterKey: 'Albedo',
            weight: i === 0 ? 1 : blossomChance(ctx),
            path: ['constellation2', 'dmg'],
            tag: 'burst',
            element: 'geo',
            applies: true,
            icd: 'burst',
            blunt: true,
            poiseDamage: 100,
            label: 'Fatal Blossom (C2)',
          })
        ctx.buff('Albedo', ['Albedo', 'burstUsed'], 'burstUsed', 1, 600)
      }
    }
  },
}
