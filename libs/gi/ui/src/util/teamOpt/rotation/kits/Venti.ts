import { HEXEREI_CHARACTERS } from '../gearEffects'
import type { KitModel, SimContext } from '../types'
import { GCSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from gcsim (https://github.com/genshinsim/gcsim, AGPLv3), internal/characters/venti, main as of 2026-11-10. */

/**
 * Hitmarks include the arrows' 10 frames of travel. The charged attack is the aimed shot: gcsim's
 * normal cancel slice lets it start at the (last) hitmark, like the abilities.
 */
const ventiNormals: NormalHit[] = [
  { hitmarks: [27, 37], toNormal: 30, toCharged: 27, toAbil: 27, frames: 30 },
  { hitmarks: [29], toNormal: 38, toCharged: 19, toAbil: 19, frames: 38 },
  { hitmarks: [38], toNormal: 33, toCharged: 28, toAbil: 28, frames: 33 },
  { hitmarks: [25, 38], toNormal: 31, toCharged: 28, toAbil: 28, frames: 31 },
  { hitmarks: [27], toNormal: 22, toCharged: 17, toAbil: 17, frames: 22 },
  { hitmarks: [59], toNormal: 98, toCharged: 49, toAbil: 49, frames: 98 },
]

interface VentiState {
  burstFrom: number
  burstEnd: number
  token: number
  extensions: number
  extensionReady: number
  extraAbsorbedTicks: number
  swirlEnd: number
  /** C2 (Hexerei): Wherever a Breeze Blows (the next tap E deals 300%) until (Venti's clock) */
  breezeUntil: number
  /** C2: the Windsunder Arrows' 25% chance, as an accumulated probability */
  breezeChance: number
  /** C1 (Hexerei): the extra arrows' 0.25 s ICD */
  c1Ready: number
}
const hexerei = (ctx: SimContext) =>
  ctx.members.filter((k) => HEXEREI_CHARACTERS.includes(k)).length >= 2

/**
 * C4: +25% Anemo DMG for 10 s. Hexerei (the sheet's lockC4SkillBurst): Venti and the active
 * member, from the skill's / burst's cast. Otherwise (the sheet's c4 'pickup'): Venti, when he
 * picks up the skill's particles (`pickupDelay`, gcsim's 100-frame particle delay after the hit).
 */
function c4(ctx: SimContext, pickupDelay: number) {
  ctx.buff('Venti', ['Venti', 'lockC4SkillBurst'], 'on', 0, 600, {
    hitlag: 'recipient',
  })
  if (pickupDelay > 0)
    ctx.buff('Venti', ['Venti', 'c4'], 'pickup', pickupDelay, 600)
}

export const kit: KitModel = {
  characterKey: 'Venti',
  element: 'anemo',
  source: `${GCSIM}/venti`,
  init: (): VentiState => ({
    burstFrom: -1,
    burstEnd: -1,
    token: 0,
    extensions: 0,
    extensionReady: -1,
    extraAbsorbedTicks: 0,
    swirlEnd: -1,
    breezeUntil: -1,
    breezeChance: 0.5,
    c1Ready: -1,
  }),
  onStart(ctx) {
    // Witch's Homework completed (gcsim's default): his own Hexerei upgrades (C2, C4, C6)
    ctx.state('Venti', ['Venti', 'lockHomework'], 'on')
  },
  onHit(ctx, s: VentiState, hit) {
    if (!hexerei(ctx) || ctx.now < s.burstFrom || ctx.now >= s.burstEnd) return
    if (
      hit.path[0] === '_reaction' &&
      hit.path[1].endsWith('Swirl') &&
      hit.characterKey === ctx.onField
    ) {
      s.swirlEnd = ctx.characterFrame('Venti') + 240
      ctx.buff('Venti', ['Venti', 'hexSwirlRecipient'], 'on', 0, 240, {
        recipient: ctx.onField,
        hitlag: 'recipient',
      })
    }
    if (
      hit.characterKey === 'Venti' &&
      hit.path[0] === 'normal' &&
      hit.element === 'anemo' &&
      s.extensions < 2 &&
      ctx.now >= s.extensionReady
    ) {
      s.extensions++
      s.extensionReady = ctx.now + 7
      s.burstEnd += 60
      s.extraAbsorbedTicks += 3
      // The native extension also adds 0.5 seconds to the running burst cooldown.
      ctx.reduceCooldown('burst', -30)
    }
    // C2 (Hexerei): a Windsunder Arrow hit has a 25% chance to give Wherever a Breeze Blows
    // (a deterministic accumulated probability, not a random trial)
    if (
      ctx.constellation('Venti') >= 2 &&
      hit.characterKey === 'Venti' &&
      hit.path[0] === 'normal' &&
      hit.path[1]?.startsWith('hex')
    ) {
      s.breezeChance += 0.25
      if (s.breezeChance >= 1) {
        s.breezeChance -= 1
        s.breezeUntil = ctx.characterFrame('Venti') + 901
      }
    }
  },
  act(ctx, s: VentiState, action, previous) {
    const c = ctx.constellation('Venti')
    switch (action.kind) {
      case 'normal':
        return normalString(
          ventiNormals,
          action.count ?? 1,
          (i, d) => {
            // Secret Rite: during the burst the arrows are Windsunder Arrows (Anemo)
            const hex = hexerei(ctx) && ctx.now + d < s.burstEnd
            ctx.hit(d, {
              path: ['normal', hex ? `hex${i}` : `${i}`],
              tag: 'normal',
              element: hex ? 'anemo' : 'physical',
              applies: true,
              icd: hex ? 'normal' : 'none',
              label: hex ? `N${i + 1} (Windsunder)` : `N${i + 1}`,
            })
            // C1 (Hexerei): 2 tracking arrows per Windsunder Arrow at 20%, once per 0.25 s (game
            // text; the pinned kqmsim has no ICD)
            if (hex && c >= 1)
              ctx.at(d, (at) => {
                if (at.now < s.c1Ready) return
                s.c1Ready = at.now + 15
                for (let j = 0; j < 2; j++)
                  at.hit(0, {
                    path: ['constellation1', `hex${i}`],
                    tag: 'normal',
                    element: 'anemo',
                    applies: true,
                    icd: 'normal',
                    label: `N${i + 1} (C1 Windsunder)`,
                  })
              })
          },
          ctx
        )
      case 'charged':
        // Venti's charged attack is the Aimed Shot, fully charged (gcsim's default hold); its
        // C1 adds 2 arrows at a third of the damage each
        ctx.hit(96, {
          path: ['charged', 'fully'],
          tag: 'charged',
          element: 'anemo',
          applies: true,
          icd: 'ExtraAttack',
          icdGroup: 'Venti',
          label: 'Fully-Charged Aimed Shot',
        })
        if (c >= 1)
          for (let i = 0; i < 2; i++)
            ctx.hit(96, {
              path: ['constellation1', 'fully'],
              tag: 'charged',
              element: 'anemo',
              applies: true,
              icd: 'ExtraAttack',
              icdGroup: 'Venti',
              label: 'Fully-Charged Aimed Shot (C1)',
            })
        return { frames: 94, framesInto: { dash: 86, jump: 86 } }
      case 'skill': {
        if (action.hold) {
          // Skyward Sonnet (hold): centred on Venti, 74 frames in; cooldown 15 s, starting 34
          // frames in; can only be cancelled into the plunge (116 frames)
          ctx.hit(74, {
            path: ['skill', 'hold'],
            tag: 'skill',
            element: 'anemo',
            applies: true,
            durability: 50,
            icd: 'none',
            label: 'Skyward Sonnet (hold)',
          })
          if (c >= 2) ctx.buff('Venti', ['Venti', 'c2'], 'hit', 74, 600)
          if (c >= 4) c4(ctx, 74 + 100)
          return {
            cooldown: { key: 'skill', frames: 900, delay: 34 },
            frames: 289,
            framesInto: { plunge: 116 },
          }
        }
        // Skyward Sonnet (tap): 3 m around the target, 51 frames in; cooldown 6 s from frame 21.
        // C2 (Hexerei): Wherever a Breeze Blows makes it 300% (and is used up)
        const breeze = c >= 2 && ctx.characterFrame('Venti') < s.breezeUntil
        if (breeze) s.breezeUntil = -1
        ctx.hit(51, {
          path: breeze ? ['constellation2', 'dmg'] : ['skill', 'press'],
          tag: 'skill',
          element: 'anemo',
          applies: true,
          durability: 50,
          icd: 'none',
          // (gcsim: stats at the cast)
          snapshotDelay: 0,
          label: breeze
            ? 'Skyward Sonnet (Wherever a Breeze Blows)'
            : 'Skyward Sonnet',
        })
        // C2: the enemy's Anemo and Physical RES -12% for 10 s
        if (c >= 2) ctx.buff('Venti', ['Venti', 'c2'], 'hit', 51, 600)
        if (c >= 4) c4(ctx, 51 + 100)
        return {
          cooldown: { key: 'skill', frames: 360, delay: 21 },
          frames: 98,
          framesInto: {
            normal: 22,
            charged: 22,
            skill: 22,
            burst: 22,
            dash: 22,
            jump: 22,
          },
        }
      }
      case 'burst': {
        const token = ++s.token
        s.burstFrom = ctx.now + 93
        let snapshot: { t: number; onField: SimContext['onField'] } | undefined
        ctx.at(104, (at) => {
          snapshot = { t: at.now, onField: at.onField }
          // C2 (Hexerei): Wherever a Breeze Blows, and Skyward Sonnet's CD resets
          if (c >= 2) {
            s.breezeUntil = at.characterFrame('Venti') + 901
            at.resetCooldown('skill')
          }
          if (c >= 4) c4(at, 0)
        })
        const captured = () =>
          snapshot &&
          (
            [
              'atk',
              'critRate_',
              'critDMG_',
              'eleMas',
              'all_dmg_',
              'anemo_dmg_',
              'pyro_dmg_',
              'hydro_dmg_',
              'electro_dmg_',
              'cryo_dmg_',
            ] as const
          ).map((stat) => ({ stat, path: ['total', stat], ...snapshot! }))
        s.burstEnd = ctx.now + 93 + 480
        s.extensions = 0
        s.extraAbsorbedTicks = 0
        // A tick's Secret Rite multiplier is decided at the previous tick (gcsim sets the next
        // tick's Mult after queuing the current one); the first tick has none
        let hexNext = 'off'
        const tick = (c: SimContext) => {
          if (token !== s.token || c.now >= s.burstEnd) return
          const hexNow = hexNext
          hexNext = c.characterFrame('Venti') < s.swirlEnd ? 'on' : 'off'
          c.hit(0, {
            path: ['burst', 'base'],
            tag: 'burst',
            element: 'anemo',
            applies: true,
            icd: 'burst',
            icdGroup: 'Venti',
            label: "Wind's Grand Ode",
            statSnapshots: captured(),
            states: [
              {
                owner: 'Venti',
                path: ['Venti', 'burstHexBuff'],
                value: hexNow,
              },
            ],
          })
          c.at(24, tick)
        }
        ctx.at(106, tick)
        const check = (c: SimContext, count: number) => {
          if (token !== s.token || count >= Math.floor((480 - 96) / 18)) return
          const element = c.absorb()
          if (!element) {
            c.at(18, (next) => check(next, count + 1))
            return
          }
          const absorbed = (at: SimContext, left: number) => {
            if (token !== s.token) return
            at.hit(0, {
              path: ['burst', 'absorb'],
              tag: 'burst',
              element,
              applies: true,
              icd: `burst-${element}`,
              icdGroup: 'Venti',
              label: "Wind's Grand Ode (Absorbed)",
              statSnapshots: captured(),
              states: [
                {
                  owner: 'Venti',
                  path: ['Venti', 'burstAbsorption'],
                  value: element,
                },
                // The pinned native source leaves the absorbed multiplier unmodified.
                {
                  owner: 'Venti',
                  path: ['Venti', 'burstHexBuff'],
                  value: 'off',
                },
              ],
            })
            if (left + s.extraAbsorbedTicks > 0)
              at.at(24, (next) => absorbed(next, left - 1))
          }
          absorbed(c, 15)
        }
        ctx.at(178, (c) => check(c, 0))
        // C6: the enemy's Anemo RES -20% while it takes the ticks' damage (and 10 s after the last)
        if (c >= 6)
          // (from the snapshot at 104: gcsim applies C6's CRIT DMG as an attack mod at impact, so it
          // must not be left out of the ticks' snapshotted stats)
          ctx.buff('Venti', ['Venti', 'c6'], 'takeDmg', 104, 24 * 19 + 602)
        return {
          cooldown: { key: 'burst', frames: 900, delay: 81 },
          frames: 95,
          framesInto: { jump: 94, swap: 93 },
        }
      }
      case 'plunge':
        // her plunge is the High Plunge (gcsim: it follows a held E)
        ctx.hit(58, {
          path: ['plunging', 'high'],
          tag: 'plunge',
          element: 'physical',
          applies: true,
          icd: 'none',
          label: 'High Plunge',
        })
        return { frames: 58 }
      case 'dash':
        // template dash (Boy body)
        return { frames: 21, framesInto: { jump: 2 } }
      // template jump (Boy body): 34 frames after a dash, else 31
      case 'jump':
        return templateJump('boy', 'bow', previous, ctx)
      default:
        return { frames: 30 }
    }
  },
}
