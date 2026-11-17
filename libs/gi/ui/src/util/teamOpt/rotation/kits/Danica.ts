import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import {
  KQMSIM,
  type NormalHit,
  normalString,
  particleMarker,
  shieldMarker,
  templateJump,
  withHitlag,
} from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/danica.
 * The pinned source has no Anchor Normal Attacks, On-Field Skill E2 / Battle Maid or C2 Toast;
 * those follow the game text (and the Excitement tooltip), with the frames marked ESTIMATE. */
/**
 * Her N3 is "×2" in the game data; kqmsim queues one instance. The second instance is added on
 * the same hitmark (ESTIMATE: no timing data), without extra hitlag, so the verified cancels hold.
 */
const normals: NormalHit[] = [
  {
    hitmarks: [27],
    hitlag: [10],
    toNormal: 38,
    toCharged: 41,
    toAbil: 27,
    frames: 54,
  },
  {
    hitmarks: [24],
    hitlag: [10],
    toNormal: 46,
    toCharged: 48,
    toAbil: 24,
    frames: 66,
  },
  {
    hitmarks: [19, 19],
    hitlag: [9, 0],
    // both instances land together (the second is not pushed back by the first's hitlag)
    worldTimeHits: true,
    toNormal: 31,
    toCharged: 40,
    toAbil: 19,
    frames: 72,
  },
  {
    hitmarks: [41],
    hitlag: [13],
    toNormal: 106,
    toCharged: 109,
    toAbil: 41,
    frames: 112,
  },
]
/** ESTIMATE: the Special Anchor Normal Attacks reuse her normal string's timing. */
const anchorNormals = normals
/** ESTIMATE: On-Field Skill E2 reuses the Entry Skill E2 timing (lands at 42, 60 frames). */
const ON_FIELD_HITMARK = 42
const ON_FIELD_FRAMES = 60
const ANCHOR_DURATION = 1500
/** Entry Skill E2 (Will to Protect) cooldown: 16 s */
const ENTRY_CD = 960
/** C2 Toast: 10 stacks per member; Danica consumes up to 2 of hers in Battle Maid */
const TOAST_STACKS = 10
const TOAST_SELF_MAX = 2

type Maid = '' | 'defense' | 'battle'
interface State {
  anchorEnd: number
  anchorId: number
  excite: number
  exciteReady: number
  coordReady: number
  entryReady: number
  maid: Maid
  /** On-Field Skill E2 uses in the current Battle Maid (5 end it) */
  battleUses: number
  /** A4 Battle Maid stacks (max 3) */
  a4: number
  /** Battle Maid combo: the next stage within the current round */
  comboNext: number
  /** Burst enhancement of the current Maid Form (lit by `syncMaid`) */
  enhanced: boolean
  /** End of the Burst's FormalDress_State (20 s from the cast; -1: none) */
  burstEnd: number
  /** End of the open Royal Aegis shield marker (-1: none) */
  aegisEnd: number
  /** C2 Toast stacks per member */
  toast: Partial<Record<CharacterKey, number>>
  /** The enemy can drop her particles again from this frame (14 s after the last drop) */
  ballReady: number
}
const hit = (
  c: SimContext,
  delay: number,
  path: string[],
  label: string,
  applies = false,
  tag: SimHit['tag'] = 'directStellarConduct'
) =>
  c.hit(delay, {
    path,
    label,
    tag,
    element: tag === 'normal' ? 'physical' : 'electro',
    applies,
    icd: 'none',
  })
const set = (c: SimContext, name: string, value: string) =>
  c.state('Danica', ['Danica', name], value)
const radiance = (c: SimContext) =>
  set(c, 'a0StellarRadianceSc', c.radiance === 'conduct' ? 'on' : '')
/**
 * The form's conditionals. The Burst's enhancement is live (dump UNIQUE_Danica_FormalDress_State,
 * 20 s from the cast in any form): while Danica is in a form and in Radiance (its StarMode_State,
 * checked every 0.1 s), the form's Guard_State or Combat_State is on, and Combat_State's onAdded
 * fills Will to Cleanse.
 */
function syncMaid(c: SimContext, s: State) {
  const lit = !!s.maid && c.now < s.burstEnd && c.radiance === 'conduct'
  if (lit && !s.enhanced && s.maid === 'battle') s.excite = 100
  s.enhanced = lit
  set(c, 'maidForm', s.maid)
  set(c, 'burstEnhanced', lit ? 'on' : '')
  set(c, 'a4Stacks', s.maid === 'battle' && s.a4 ? String(s.a4) : '')
}
/** The Royal Aegis (UNIQUE_Danica_GuardMaid_Shield_Main, a party shield) until the Anchor ends */
function aegisOn(c: SimContext, s: State, label: string) {
  const frames = Math.max(0, s.anchorEnd - c.now)
  shieldMarker(c, 0, frames, label)
  s.aegisEnd = c.now + frames
}
/** The Royal Aegis removed early: a 0-frame shield of the same kind ends the open one */
function aegisOff(c: SimContext, s: State) {
  if (c.now < s.aegisEnd) shieldMarker(c, 0, 0, 'Royal Aegis ends')
  s.aegisEnd = -1
}
function endMaid(c: SimContext, s: State) {
  if (s.maid === 'battle') c.modifyAttackSpeed('DanicaA4', 0, 1, 'Danica')
  // (the shield goes with the form: the Anchor handler's removal, or C4's attached one)
  if (s.maid) aegisOff(c, s)
  // (a form's onRemoved also removes the Burst's FormalDress_State)
  if (s.maid) s.burstEnd = -1
  s.maid = ''
  s.enhanced = false
  s.a4 = 0
  s.battleUses = 0
  syncMaid(c, s)
}
function anchor(c: SimContext, s: State, duration: number) {
  const id = ++s.anchorId
  s.anchorEnd = c.now + duration
  set(c, 'anchor', 'on')
  // C2: (re)summoning or refreshing the Anchor resets everyone's Toast to 10 stacks.
  if (c.constellation('Danica') >= 2)
    s.toast = Object.fromEntries(c.members.map((m) => [m, TOAST_STACKS]))
  const tick = (c: SimContext) => {
    if (id !== s.anchorId) return
    radiance(c)
    syncMaid(c, s)
    if (c.now >= s.anchorEnd) {
      set(c, 'anchor', '')
      s.toast = {}
      endMaid(c, s)
      return
    }
    c.at(Math.min(30, s.anchorEnd - c.now), tick)
  }
  tick(c)
}
const addExcite = (s: State, amount: number) => {
  s.excite = Math.min(100, s.excite + amount)
}
/**
 * Her particles (dump Avatar_Danica_ElementalArt_DropBall_Handler): a hit with the
 * Danica_ElementalArt_DropBall tag, the Anchor Skill's (InsertClaymore) or the Entry Skill's
 * (E2_Enter_Attack), gives the enemy the Unique 14 s Avatar_Danica_ElementalArt_DropBall, whose
 * onAdded drops 15 Energy of Electro particles (5, the ER sheet's "Press"): once per 14 s from
 * either Skill
 */
function dropBall(c: SimContext, s: State, delay: number) {
  c.at(delay, (c2) => {
    if (c2.now < s.ballReady) return
    s.ballReady = c2.now + 840
    particleMarker(c2, 0, 'Danica particles', undefined, 'Danica')
  })
}

/** On-Field Skill E2: consumes all Excitement, enters (or continues) Battle Maid. */
function onFieldE2(c: SimContext, s: State): ActionResult {
  s.excite = 0
  if (s.maid !== 'battle') {
    s.maid = 'battle'
    s.a4 = 0
    s.battleUses = 0
    s.comboNext = 0
    // C4: entering Cleaner also creates a Royal Aegis (UNIQUE_Danica_CombatMaid_Form's onAdded),
    // until she leaves the form or the field
    if (c.constellation('Danica') >= 4) aegisOn(c, s, 'Royal Aegis (C4)')
  }
  s.battleUses++
  // A4: +20% ATK SPD per On-Field Skill E2 (max 3) until Battle Maid ends.
  s.a4 = Math.min(3, s.a4 + 1)
  c.modifyAttackSpeed(
    'DanicaA4',
    0.2 * s.a4,
    Math.max(1, s.anchorEnd - c.now),
    'Danica'
  )
  // (entering Cleaner inside a lit Burst window fills Will to Cleanse again: Combat_State)
  syncMaid(c, s)
  c.at(ON_FIELD_HITMARK, (c2) => {
    radiance(c2)
    // the DMG increase is read at the hit (E2_Field_Attack checks FormalDress_StarMode_State)
    syncMaid(c2, s)
    hit(c2, 0, ['skill', 'onFieldDmg'], 'On-Field Skill E2 (Stellar-Conduct)')
  })
  // After 5 uses Danica leaves Battle Maid and the Anchor is destroyed.
  if (s.battleUses >= 5)
    c.at(ON_FIELD_HITMARK, (c2) => {
      s.anchorEnd = c2.now
      ++s.anchorId
      set(c2, 'anchor', '')
      s.toast = {}
      endMaid(c2, s)
    })
  return { frames: ON_FIELD_FRAMES }
}
const onFieldReady = (s: State, now: number) =>
  now < s.anchorEnd && s.excite >= 100 && s.maid !== 'defense'
/** The anchor string with Battle Maid skips: each new round starts at stage min(uses, 3). */
function anchorString(c: SimContext, s: State, count: number) {
  const engineFirst = c.normalSequence(4, count)
  const skip = s.maid === 'battle' ? Math.min(3, s.battleUses) : 0
  let stage =
    s.maid === 'battle'
      ? engineFirst === 0 || s.comboNext === 0
        ? skip
        : s.comboNext
      : engineFirst
  const stages: number[] = []
  for (let i = 0; i < count; i++) {
    stages.push(stage)
    stage = (stage + 1) % 4
    if (stage === 0 && s.maid === 'battle') stage = skip
  }
  s.comboNext = stage === skip ? 0 : stage
  const ordered = new Proxy(c, {
    get: (target, prop) =>
      prop === 'normalSequence' ? () => 0 : Reflect.get(target, prop),
  })
  return normalString(
    stages.map((i) => anchorNormals[i]),
    count,
    (step, t, j) => {
      const i = stages[step]
      c.hit(t, {
        path: ['skill', `anchor${i}`],
        tag: 'normal',
        element: 'electro',
        applies: true,
        icd: 'normal',
        label: `Anchor N${i + 1}`,
      })
      // Excitement: 25 per anchor attack (once per attack), +25 per A4 stack in Battle Maid;
      // in Defense Maid only the active-member Electro/Cryo rule applies.
      if (j === 0)
        c.at(t, (c2) => {
          if (s.maid === 'defense' || c2.now >= s.anchorEnd) return
          addExcite(s, 25 * (1 + (s.maid === 'battle' ? s.a4 : 0)))
        })
    },
    ordered
  )
}

export const kit: KitModel = {
  characterKey: 'Danica',
  element: 'electro',
  source: `${KQMSIM}/danica`,
  init: (): State => ({
    anchorEnd: -1,
    anchorId: 0,
    excite: 0,
    exciteReady: -1,
    coordReady: -1,
    entryReady: -1,
    maid: '',
    battleUses: 0,
    a4: 0,
    comboNext: 0,
    enhanced: false,
    burstEnd: -1,
    aegisEnd: -1,
    toast: {},
    ballReady: -1,
  }),
  onStart(c) {
    for (const name of ['c2Toast', 'c2SelfToast']) set(c, name, '')
    if (c.constellation('Danica') >= 2)
      c.note(
        'Danica C2: the combat-entry Will to Protect and the Cleaning Decree Will to Purge (hold Normal Attack, 150% DMG, once per combat) are not modelled; Toast stacks are.'
      )
  },
  // With the Anchor out her normal attacks are the Anchor's (estimated frames of their own), and
  // at full Excitement her E is On-Field Skill E2 (Battle Maid; estimated frames of its own)
  variant(ctx, s: State, action) {
    if (action.kind === 'skill')
      return onFieldReady(s, ctx.now)
        ? { key: 'battleMaid', label: 'On-Field Skill E2', mode: 'Battle Maid' }
        : undefined
    if (action.kind === 'normal' && ctx.now < s.anchorEnd)
      return { key: 'anchor', label: 'Anchor Normal Attack', mode: 'Anchor' }
    return undefined
  },
  act(ctx, s: State, action, previous) {
    radiance(ctx)
    switch (action.kind) {
      case 'skill':
        if (onFieldReady(s, ctx.now)) {
          ctx.note(
            'Danica: On-Field Skill E2 / Battle Maid and the Anchor Normal Attacks are not in the reference; their frames are estimates.'
          )
          return onFieldE2(ctx, s)
        }
        hit(ctx, 22, ['skill', 'dmg'], 'Anchor Skill', true, 'skill')
        dropBall(ctx, s, 22)
        // Dump Avatar_Danica_ElementalArt_InsertClaymore: Will to Cleanse to 0, Will to Protect's
        // cooldown (UNIQUE_Danica_E2_GuardMaid_CD) removed, and the Anchor handler removed and
        // re-added; its removal ends either form (and with it the Burst window) and the Royal Aegis
        // (kqmsim keeps the forms)
        ctx.at(22, (c) => {
          endMaid(c, s)
          s.excite = 0
          s.entryReady = -1
          anchor(c, s, ANCHOR_DURATION)
        })
        return withHitlag(
          {
            frames: 44,
            framesInto: { burst: 34, dash: 34, jump: 34 },
            cooldown: { key: 'skill', frames: 1080, delay: 20 },
          },
          { hitmarks: [22], hitlag: [6] }
        )
      case 'burst':
        ;[102, 113, 127, 142, 168].forEach((delay, i) =>
          ctx.at(delay, (c) => {
            radiance(c)
            hit(
              c,
              0,
              [
                'burst',
                i === 0 ? 'hit1Dmg' : i === 4 ? 'hit5Dmg' : 'hit234Dmg',
              ],
              'Burst',
              [0, 2, 4].includes(i),
              'burst'
            )
            if ((i === 0 || i === 4) && c.radiance === 'conduct')
              hit(
                c,
                1,
                ['burst', i === 0 ? 'hit1ScDmg' : 'hit5ScDmg'],
                'Burst (Stellar-Conduct)'
              )
          })
        )
        // FormalDress_State: added at the cast for 20 s, whatever the form (dump
        // Avatar_Danica_ElementalBurst_Initialize); `syncMaid` lights the form's part in Radiance
        s.burstEnd = ctx.now + 1200
        syncMaid(ctx, s)
        ctx.at(1200, (c) => syncMaid(c, s))
        // (the 18 s cooldown starts 0.4 s into the cast: 18.4 s from press to press, tested in game)
        return {
          frames: 100,
          cooldown: { key: 'burst', frames: 1080, delay: 24 },
        }
      case 'normal':
        if (ctx.now < s.anchorEnd)
          return anchorString(ctx, s, action.count ?? 1)
        return normalString(
          normals,
          action.count ?? 1,
          (i, t) =>
            hit(ctx, t, ['normal', `${i}`], `N${i + 1}`, true, 'normal'),
          ctx
        )
      case 'dash':
        return { frames: 22, framesInto: { jump: 4 } }
      case 'jump':
        return templateJump('lady', 'claymore', previous, ctx)
      default:
        return {
          frames: 0,
          failed: `Danica: ${action.text} is not implemented in kqmsim.`,
        }
    }
  },
  cooldownKey: (s: State, action, now) =>
    action.kind === 'skill'
      ? onFieldReady(s, now)
        ? undefined
        : 'skill'
      : action.kind === 'burst'
        ? 'burst'
        : undefined,
  onHit(ctx, s: State, h) {
    if (h.path[0].startsWith('_')) return
    // C2 Toast: each Stellar-Conduct DMG instance a member deals consumes one of their stacks
    // (+80% of Danica's ATK). In Battle Maid Danica's own Stellar-Conduct DMG consumes up to 2 of
    // hers (+350% ATK each).
    if (
      ctx.constellation('Danica') >= 2 &&
      h.tag === 'directStellarConduct' &&
      ctx.now < s.anchorEnd
    ) {
      const stacks = s.toast[h.characterKey] ?? 0
      const self = h.characterKey === 'Danica' && s.maid === 'battle'
      const used = Math.min(self ? TOAST_SELF_MAX : 1, stacks)
      h.states = [
        ...(h.states ?? []),
        {
          owner: 'Danica',
          path: ['Danica', 'c2Toast'],
          value: used && !self ? 'on' : '',
        },
        {
          owner: 'Danica',
          path: ['Danica', 'c2SelfToast'],
          value: used && self ? String(used) : '',
        },
      ]
      if (used) s.toast[h.characterKey] = stacks - used
    }
    if (
      ctx.now >= s.anchorEnd ||
      h.onField === 'Danica' ||
      h.characterKey !== h.onField ||
      !['cryo', 'electro'].includes(h.element)
    )
      return
    // Off-field Excitement (not in Battle Maid, where only anchor attacks count)
    if (ctx.now >= s.exciteReady && s.maid !== 'battle') {
      addExcite(s, 50)
      s.exciteReady = ctx.now + 6
    }
    if (ctx.now >= s.coordReady) {
      s.coordReady = ctx.now + 90
      hit(
        ctx,
        5,
        ['skill', 'coordDmg'],
        'Anchor Coordinated Attack',
        true,
        'skill'
      )
    }
  },
  // C4's Cleaner Royal Aegis ends when she leaves the field (CombatMaid_Form's switch-out)
  onSwapOut(ctx, s: State) {
    if (s.maid === 'battle') aegisOff(ctx, s)
  },
  noEntryReason: (s: State, now) =>
    now >= s.anchorEnd
      ? 'her Anchor was not out (her E summons it for 25 s)'
      : s.maid === 'battle'
        ? 'she was still in Maid: Cleaner'
        : s.excite < 100
          ? "Will to Cleanse was not full (the on-field member's Electro or Cryo hits fill it while her Anchor is out, 50 each)"
          : now < s.entryReady
            ? `Will to Protect was on its 16 s cooldown (${((s.entryReady - now) / 60).toFixed(1)} s left)`
            : undefined,
  onSwapIn(ctx, s: State) {
    if (
      ctx.now >= s.anchorEnd ||
      s.excite < 100 ||
      ctx.now < s.entryReady ||
      s.maid === 'battle'
    )
      return
    s.excite = 0
    s.entryReady = ctx.now + ENTRY_CD
    // Entry Skill E2: Defense Maid and a refreshed Anchor; a Burst window still open lights it
    // (Guard_State)
    anchor(ctx, s, ANCHOR_DURATION)
    s.maid = 'defense'
    s.a4 = 0
    syncMaid(ctx, s)
    // Defense Maid's party shield (kqmsim newShield), until the form ends: 25 s from the Entry
    // Skill's refreshed Anchor at most
    aegisOn(ctx, s, 'Defense Maid shield')
    hit(ctx, 42, ['skill', 'entryDmg'], 'Entry Skill (Stellar-Conduct)')
    dropBall(ctx, s, 42)
    return { frames: 60 }
  },
}
