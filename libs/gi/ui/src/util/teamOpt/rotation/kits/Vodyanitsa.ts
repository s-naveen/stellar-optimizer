import type { KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit pinned by KQMSIM, internal/characters/vodyanitsa. */
const normals: NormalHit[] = [
  { hitmarks: [18], toNormal: 33, toCharged: 33, toAbil: 18, frames: 33 },
  { hitmarks: [12], toNormal: 26, toCharged: 26, toAbil: 12, frames: 26 },
  { hitmarks: [24], toNormal: 45, toCharged: 45, toAbil: 24, frames: 45 },
  { hitmarks: [32], toNormal: 60, toCharged: 60, toAbil: 32, frames: 60 },
]
interface State {
  skillId: number
  skillEnd: number
  /** C2: "Two Voices in Black and White" lasts until this frame (5 s after each Horn attack) */
  c2End: number
  /** C4: expiry frames of the independent Max HP stacks (max 3) */
  c4Stacks: number[]
  poolEnd: number
  lead: number
  chorus: number
  recentSwirlEnd: number
  normalEnd: number
  dashed: boolean
}
const state = (c: SimContext, condition: string, value: string) =>
  c.state('Vodyanitsa', ['Vodyanitsa', condition], value)
const markBonus = (hit: SimHit, value: string) => {
  hit.states = [
    ...(hit.states ?? []),
    { owner: 'Vodyanitsa', path: ['Vodyanitsa', 'a4Hit'], value },
  ]
}
function pool(c: SimContext, s: State, hit: SimHit) {
  return (
    c.now < s.poolEnd &&
    (hit.characterKey === c.onField ? s.lead : s.chorus) > 0
  )
}
function spend(c: SimContext, s: State, hit: SimHit) {
  if (hit.characterKey === c.onField) s.lead = Math.max(0, s.lead - 1)
  else s.chorus = Math.max(0, s.chorus - 1)
}
const sharedSwirl = (hit: SimHit) =>
  hit.path[0] === 'reaction' && hit.path[1].startsWith('stellarswirl')
/**
 * A (Wandering) Vortex is present or exploded in the last 5 s: the vortex creation and its
 * detonation both refresh `recentSwirlEnd` (the vortex lives 181 frames).
 */
const recentVortex = (c: SimContext, s: State) => c.now < s.recentSwirlEnd
/**
 * C2 "Two Voices in Black and White" for this hit: Hydro/Cryo CRIT DMG, or Stellar Swirl CRIT DMG
 * while a vortex is present / just exploded. The sheet limits it to the active character below C6.
 */
function markC2(c: SimContext, s: State, hit: SimHit) {
  if (c.constellation('Vodyanitsa') < 2) return
  hit.states = [
    ...(hit.states ?? []),
    {
      owner: 'Vodyanitsa',
      path: ['Vodyanitsa', 'c2State'],
      value: c.now < s.c2End ? (recentVortex(c, s) ? 'vortex' : 'voice') : '',
    },
  ]
}
/** C4 Max HP stacks: each lasts 6 s on its own (max 3) */
function syncC4(c: SimContext, s: State) {
  s.c4Stacks = s.c4Stacks.filter((end) => c.now < end)
  state(c, 'c4State', s.c4Stacks.length ? `above${s.c4Stacks.length}` : '')
}

export const kit: KitModel = {
  characterKey: 'Vodyanitsa',
  element: 'hydro',
  source: `${KQMSIM}/vodyanitsa`,
  init: (): State => ({
    skillId: 0,
    skillEnd: -1,
    c2End: -1,
    c4Stacks: [],
    poolEnd: -1,
    lead: 0,
    chorus: 0,
    recentSwirlEnd: -1,
    normalEnd: -1,
    dashed: false,
  }),
  onStart(c) {
    for (const condition of [
      'skillSong',
      'skillHit',
      'a1Vortex',
      'a4LeadVocal',
      'a4Chorus',
      'a4Hit',
      'c1Heal',
      'c4State',
    ])
      state(c, condition, '')
    c.note(
      'Vodyanitsa: C0 follows the pinned native implementation. Its +4 s Stellar Swirl duration and vortex RES reduction are enabled by party presence; the description scopes these effects to Song of Ages Past.'
    )
    if (c.constellation('Vodyanitsa') >= 2)
      c.note(
        'Vodyanitsa C2: "Two Voices in Black and White" starts with the Horn of Spring\'s Call attacks (game text; the reference also grants it on the initial Skill hit).'
      )
    if (c.constellation('Vodyanitsa') >= 4 && !c.healthTracked)
      c.note(
        'Vodyanitsa C4: HP is not tracked, so every Song heal is assumed to land on a character at 40% HP or more (Max HP stacks).'
      )
  },
  act(c, s: State, action) {
    switch (action.kind) {
      case 'skill': {
        // Holding only changes the skill outside combat (Water Imp swimming); in combat it is the
        // ordinary cast, as in the reference (which ignores the hold parameter).
        if (action.hold)
          c.note(
            'Vodyanitsa: the held skill (Water Imp swimming) only exists outside combat; hE is played as E.'
          )
        // C2: Song of Ages Past lasts 9 s longer (the cooldown stays 16 s).
        const song = 960 + (c.constellation('Vodyanitsa') >= 2 ? 540 : 0)
        const id = ++s.skillId
        c.hit(0, {
          path: ['skill', 'skillDmg'],
          tag: 'skill',
          element: 'hydro',
          applies: true,
          icd: 'skill',
          label: 'Rechitativ: Sonorous Dawn',
          // It lands before the new Song of Ages Past (C6's DMG Bonus) starts, as native.
          states: [
            {
              owner: 'Vodyanitsa',
              path: ['Vodyanitsa', 'skillSong'],
              value: c.now < s.skillEnd ? 'on' : '',
            },
          ],
        })
        // Native resolves the zero-delay initial hit before refreshing the A4 pools.
        c.at(0, (at) => {
          s.skillEnd = at.now + song
          s.poolEnd = at.now + 1800
          s.lead = 25
          s.chorus = 10
          state(at, 'skillSong', 'on')
          at.at(song, (end) => {
            if (s.skillId === id) state(end, 'skillSong', '')
          })
        })
        const heal = (at: SimContext) => {
          if (id !== s.skillId || at.now >= s.skillEnd) return
          const cons = at.constellation('Vodyanitsa')
          // C4: below 40% HP the heal is 50% stronger; otherwise Vodyanitsa gains a 6 s Max HP stack.
          const low = cons >= 4 && (at.hpRatio(at.onField) ?? 1) < 0.4
          // Heals are evaluated from the live conditions at their frame (not per-hit states).
          if (low)
            at.buff('Vodyanitsa', ['Vodyanitsa', 'c4State'], 'below', 0, 1)
          at.hit(0, {
            path: ['_heal', 'skill', 'songHeal'],
            tag: 'other',
            element: 'hydro',
            label: 'Song of Ages Past (Heal)',
          })
          // C1: each heal grants the party ATK equal to 0.8% of her Max HP for 5 s.
          if (cons >= 1)
            at.buff('Vodyanitsa', ['Vodyanitsa', 'c1Heal'], 'on', 0, 300)
          if (cons >= 4 && !low) {
            s.c4Stacks = [...s.c4Stacks, at.now + 360].slice(-3)
            syncC4(at, s)
            at.at(360, (end) => syncC4(end, s))
          }
          at.at(90, heal)
        }
        const attack = (at: SimContext) => {
          if (id !== s.skillId || at.now >= s.skillEnd) return
          at.hit(0, {
            path: ['skill', 'hornDmg'],
            tag: 'skill',
            element: 'hydro',
            applies: true,
            icd: 'skill',
            label: "Horn of Spring's Call",
          })
          // C2: each Horn attack grants "Two Voices in Black and White" for 5 s (after this hit).
          if (at.constellation('Vodyanitsa') >= 2)
            at.at(0, (after) => {
              s.c2End = after.now + 300
            })
          at.at(180, attack)
        }
        c.at(136, heal)
        c.at(226, attack)
        return {
          frames: 56,
          framesInto: { wait: 32 },
          cooldown: { key: 'skill', frames: 960 },
        }
      }
      case 'burst':
        c.hit(91, {
          path: ['burst', 'skillDmg'],
          tag: 'burst',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Sink With Thee',
          states: [
            {
              owner: 'Vodyanitsa',
              path: ['Vodyanitsa', 'skillSong'],
              value: c.now < s.skillEnd ? 'on' : '',
            },
          ],
        })
        return { frames: 99, cooldown: { key: 'burst', frames: 900 } }
      case 'normal': {
        const result = normalString(
          normals,
          action.count ?? 1,
          (i, delay) =>
            c.hit(delay, {
              path: ['normal', String(i)],
              tag: 'normal',
              element: 'hydro',
              applies: true,
              icd: 'normal',
              label: `Normal ${i + 1}`,
            }),
          c
        )
        s.normalEnd = c.now + result.frames
        return result
      }
      case 'charged': {
        const windup = c.now < s.normalEnd ? 14 : 0
        c.hit(34 - windup, {
          path: ['charged', 'dmg'],
          tag: 'charged',
          element: 'hydro',
          applies: true,
          icd: 'none',
          label: 'Charged Attack',
        })
        return { frames: 41 - windup, framesInto: { wait: 34 - windup } }
      }
      case 'dash':
        s.dashed = true
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        return { frames: s.dashed ? 34 : 31, framesInto: { plunge: 4 } }
      default:
        return {
          frames: 0,
          failed: `Vodyanitsa: ${action.text} is not implemented.`,
        }
    }
  },
  onSwapOut(_c, s: State) {
    s.normalEnd = -1
    s.dashed = false
  },
  onPartyAction(_c, s: State, actor, action) {
    if (
      actor !== 'Vodyanitsa' ||
      (action.kind !== 'dash' && action.kind !== 'wait')
    )
      s.dashed = false
    if (
      actor !== 'Vodyanitsa' ||
      (action.kind !== 'normal' && action.kind !== 'wait')
    )
      s.normalEnd = -1
  },
  onReactionSnapshot(c, s: State, hit) {
    if (!sharedSwirl(hit)) return
    s.recentSwirlEnd = c.now + 300
    c.buff('Vodyanitsa', ['Vodyanitsa', 'a1Vortex'], 'on', 0, 360)
    markBonus(hit, pool(c, s, hit) ? 'stellar' : '')
    markC2(c, s, hit)
  },
  onHit(c, s: State, hit) {
    if (hit.path[0].startsWith('_')) return
    if (!sharedSwirl(hit)) markC2(c, s, hit)
    if (sharedSwirl(hit)) {
      if (c.now < s.poolEnd) spend(c, s, hit)
      return
    }
    if (pool(c, s, hit)) {
      if (hit.tag === 'directStellarSwirl') {
        markBonus(hit, 'stellar')
        spend(c, s, hit)
      } else if (
        ['normal', 'charged', 'plunge', 'skill', 'burst'].includes(hit.tag) &&
        (hit.element === 'hydro' || hit.element === 'cryo') &&
        c.now >= s.recentSwirlEnd
      ) {
        markBonus(hit, 'elemental')
        spend(c, s, hit)
      }
    }
    if (hit.characterKey === 'Vodyanitsa' && hit.tag === 'skill') {
      // A hit receives the old resistance state; its callback shreds for subsequent hits.
      hit.states = [
        ...(hit.states ?? []),
        {
          owner: 'Vodyanitsa',
          path: ['Vodyanitsa', 'skillHit'],
          value: c.hasBuff('Vodyanitsa', ['Vodyanitsa', 'skillHit'])
            ? 'on'
            : '',
        },
      ]
      c.buff('Vodyanitsa', ['Vodyanitsa', 'skillHit'], 'on', 0, 360)
    }
  },
}
