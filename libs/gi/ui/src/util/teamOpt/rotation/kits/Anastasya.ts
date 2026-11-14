import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/anastasya (Tsaritsa).
 * The pinned source has only the Blessing of Love; the Blessing of Honor (hold Skill, Blessed
 * Spear, The Evernight Yields to Dawn, Palestar Edict: Doom), the Palestar Crown freeze, C2's
 * own timers and the C6 triggers are implemented from the game text, with the frame estimates
 * marked ESTIMATE below. */
// Hitmarks include the 10-frame arrow travel. gcsim's InitNormalCancelSlice lets aim (and every
// ability) cancel at the last release frame, so toCharged equals toAbil.
const normals: NormalHit[] = [
  { hitmarks: [27], toNormal: 35, toCharged: 17, toAbil: 17, frames: 35 },
  { hitmarks: [35], toNormal: 26, toCharged: 25, toAbil: 25, frames: 26 },
  { hitmarks: [21, 36], toNormal: 39, toCharged: 26, toAbil: 26, frames: 39 },
  {
    hitmarks: [25, 34, 45],
    toNormal: 44,
    toCharged: 35,
    toAbil: 35,
    frames: 44,
  },
  { hitmarks: [27], toNormal: 52, toCharged: 17, toAbil: 17, frames: 52 },
]
/**
 * ESTIMATE: the Blessed Spear string (1 / 2 / 1 / 3 / 3 instances). No reference has it; the
 * cadence is gcsim's Shenhe (a lady-body polearm, internal/characters/shenhe/attack.go), with the
 * extra instances spread inside her hit windows. No hitlag is modelled.
 */
const spear: NormalHit[] = [
  { hitmarks: [14], toNormal: 23, toCharged: 23, toAbil: 14, frames: 23 },
  { hitmarks: [12, 17], toNormal: 29, toCharged: 29, toAbil: 17, frames: 29 },
  { hitmarks: [19], toNormal: 32, toCharged: 33, toAbil: 19, frames: 33 },
  {
    hitmarks: [14, 18, 22],
    toNormal: 27,
    toCharged: 27,
    toAbil: 22,
    frames: 27,
  },
  {
    hitmarks: [18, 22, 26],
    toNormal: 49,
    toCharged: 49,
    toAbil: 26,
    frames: 49,
  },
]
/** ESTIMATE: hold Skill = the tap (17 / 35 frames) plus Mitya's hold-over-tap 16 frames. */
const HOLD_HITMARK = 33
const HOLD_FRAMES = 51
/** ESTIMATE: The Evernight Yields to Dawn uses To the New World's 105 / 109 frames. */
const BURST_HITMARK = 105
const BURST_FRAMES = 109
/** Blessing of Honor 15 s; The Evernight Yields to Dawn (and its Sealing) 14 s; Love burst 20 s. */
const HONOR_DURATION = 900
const EVERNIGHT_DURATION = 840
const LOVE_DURATION = 1200
/**
 * ESTIMATE: the Honor Sealing uses the Love Sealing's clock (1 point every 12 frames, so 70 points
 * for 14 s) and each Blessed Spear hit removes 2 points (as each Stellar Glimmer hit does for Love).
 */
const HONOR_SEAL_POINTS = 70
const SPEAR_SEAL_POINTS = 2
/** ESTIMATE: Palestar Edict: Doom can be used for 20 s after the Sealing ends (as Triumph). */
const DOOM_WINDOW = 1200

interface State {
  skillEnd: number
  skillId: number
  burstEnd: number
  a1End: number
  sealArmed: boolean
  sealed: boolean
  sealPoints: number
  sealId: number
  shareUntil: number
  triumphUntil: number
  /** Blessing of Honor */
  honorEnd: number
  /** Evernight freezes the Blessing until this frame; `honorLeft` is what remains after it */
  freezeEnd: number
  honorLeft: number
  /** The other members are Sealed by The Evernight Yields to Dawn */
  othersSealed: boolean
  othersSealPoints: number
  othersSealId: number
  othersShareUntil: number
  /** Palestar Edict: Doom: the next stage (1-3) and until when it can be used */
  doomStage: number
  doomUntil: number
  c2LoveEnd: number
  c2HonorEnd: number
  c6Ready: number
  c6LoveEnd: number
  c6LoveArmed: boolean
  c6HonorEnd: number
  c6HonorArmed: boolean
}
const set = (c: SimContext, name: string, value: string) =>
  c.state('Anastasya', ['Anastasya', name], value)
const honorActive = (c: SimContext, s: State) => c.now < s.honorEnd
function sync(c: SimContext, s: State) {
  // She always holds the Blessing of Love unless she holds the Blessing of Honor.
  set(c, 'blessing', honorActive(c, s) ? 'honor' : 'love')
  set(c, 'burstActive', c.now < s.burstEnd ? 'on' : '')
  set(
    c,
    'accolades',
    c.now < s.a1End
      ? s.othersSealed || c.now < s.othersShareUntil
        ? 'honorSeal'
        : s.sealed || c.now < s.shareUntil
          ? 'loveSeal'
          : 'on'
      : ''
  )
  set(
    c,
    'a0StellarRadianceSc',
    c.radiance === 'conduct' ? 'on' : c.radiance === 'swirl' ? 'ss' : ''
  )
  if (c.constellation('Anastasya') >= 2) {
    set(c, 'c2LoveWindow', c.now < s.c2LoveEnd ? 'on' : 'off')
    set(c, 'c2HonorWindow', c.now < s.c2HonorEnd ? 'on' : 'off')
  }
  if (c.constellation('Anastasya') >= 6) {
    set(c, 'c6LoveWindow', c.now < s.c6LoveEnd ? 'on' : 'off')
    set(c, 'c6HonorWindow', c.now < s.c6HonorEnd ? 'on' : 'off')
  }
}
/** Re-evaluate the conditions when a timer ends */
const syncAt = (c: SimContext, s: State, frame: number) =>
  c.at(Math.max(0, frame - c.now), (c2) => sync(c2, s))
function hit(
  c: SimContext,
  delay: number,
  path: string[],
  label: string,
  tag: SimHit['tag'] = 'other',
  applies = false
) {
  c.hit(delay, { path, label, tag, element: 'cryo', applies, icd: 'none' })
}
function stellar(
  c: SimContext,
  section: string,
  name: string,
  label: string,
  states?: SimHit['states']
) {
  const swirl = c.radiance === 'swirl'
  c.hit(0, {
    path: [section, `${name}${swirl ? 'Ss' : 'Sc'}`],
    label: `${label} (${swirl ? 'Stellar Swirl' : 'Stellar-Conduct'})`,
    tag: swirl ? 'directStellarSwirl' : 'directStellarConduct',
    element: 'cryo',
    applies: false,
    icd: 'none',
    states,
  })
}
function sealPoints(c: SimContext, s: State, points: number) {
  if (!s.sealed) return
  s.sealPoints = Math.max(0, s.sealPoints - points)
  if (!s.sealPoints) {
    s.sealed = false
    s.shareUntil = c.now + 480
    s.triumphUntil = c.now + 1200
    sync(c, s)
    c.at(480, (c2) => sync(c2, s))
  }
}
function sealTick(c: SimContext, s: State, id: number) {
  if (id !== s.sealId || !s.sealed) return
  sealPoints(c, s, 1)
  c.at(12, (c2) => sealTick(c2, s, id))
}
/** The other members' (Honor) Sealing ends: Doom becomes available; C6 effects are removed. */
function othersSealPoints(c: SimContext, s: State, points: number) {
  if (!s.othersSealed) return
  s.othersSealPoints = Math.max(0, s.othersSealPoints - points)
  if (s.othersSealPoints) return
  s.othersSealed = false
  s.othersShareUntil = c.now + 480
  s.doomStage = 1
  s.doomUntil = c.now + DOOM_WINDOW
  s.c6LoveEnd = Math.min(s.c6LoveEnd, c.now)
  s.c6HonorEnd = Math.min(s.c6HonorEnd, c.now)
  s.c6LoveArmed = s.c6HonorArmed = false
  sync(c, s)
  syncAt(c, s, s.othersShareUntil)
}
function othersSealTick(c: SimContext, s: State, id: number) {
  if (id !== s.othersSealId || !s.othersSealed) return
  othersSealPoints(c, s, 1)
  c.at(12, (c2) => othersSealTick(c2, s, id))
}
function crown(c: SimContext, s: State, id: number) {
  if (s.skillId !== id || c.now >= s.skillEnd) return
  sync(c, s)
  c.hit(0, {
    path: ['skill', 'crownDmg'],
    label: 'Palestar Crown (Cryo)',
    tag: 'skill',
    element: 'cryo',
    applies: true,
    icd: 'skill',
    icdGroup: 'AnastasyaSkill',
  })
  c.at(4, (c2) => {
    sync(c2, s)
    if (c2.radiance) stellar(c2, 'skill', 'crown', 'Palestar Crown')
    else
      c2.hit(0, {
        path: ['skill', 'crownDmg'],
        label: 'Palestar Crown (Cryo)',
        tag: 'skill',
        element: 'cryo',
        applies: true,
        icd: 'skill',
        icdGroup: 'AnastasyaSkill',
      })
    if (c2.now < s.burstEnd) stellar(c2, 'burst', 'crown', 'Burst Crown')
  })
  c.at(118, (c2) => crown(c2, s, id))
}
function triumph(c: SimContext, s: State): ActionResult {
  s.triumphUntil = -1
  c.at(28, (c2) => {
    sync(c2, s)
    stellar(c2, 'burst', 'triumph', 'Triumph')
  })
  return { frames: 26 }
}
/** C6 arms on a Skill use (30 s; once every 15 s) according to the Blessing it grants. */
function c6OnSkill(c: SimContext, s: State, blessing: 'love' | 'honor') {
  if (c.constellation('Anastasya') < 6 || c.now < s.c6Ready) return
  s.c6Ready = c.now + 900
  if (blessing === 'love') {
    s.c6LoveEnd = c.now + 1800
    s.c6LoveArmed = true
  } else {
    s.c6HonorEnd = c.now + 1800
    s.c6HonorArmed = true
  }
  syncAt(c, s, c.now + 1800)
}
/**
 * Palestar Edict: Doom, stage by stage (selecting a just-unsealed member or pressing the Skill;
 * only the Skill press is modelled). ESTIMATE frames: stage 1 slashes 8 frames apart from 18 and
 * its Stellar finisher at 66 (80 frames); stage 2's leap slash at 30 (50 frames); stage 3 is the
 * thrown spear, timed like Triumph (lands at 28, 26 frames). Stage 3 ends the Evernight freeze.
 */
function doom(c: SimContext, s: State): ActionResult {
  const stage = s.doomStage
  s.doomStage = stage < 3 ? stage + 1 : 0
  if (stage === 1) {
    for (const d of [18, 26, 34, 42, 50])
      c.hit(d, {
        path: ['burst', 'doom1Dmg'],
        label: 'Palestar Edict: Doom 1-Hit (Cryo)',
        tag: 'skill',
        element: 'cryo',
        applies: true,
        icd: 'skill',
      })
    c.at(66, (c2) => {
      sync(c2, s)
      stellar(c2, 'burst', 'doom0', 'Palestar Edict: Doom 1-Hit')
    })
    return { frames: 80 }
  }
  if (stage === 2) {
    c.at(30, (c2) => {
      sync(c2, s)
      stellar(c2, 'burst', 'doom1', 'Palestar Edict: Doom 2-Hit')
    })
    return { frames: 50 }
  }
  c.at(28, (c2) => {
    sync(c2, s)
    stellar(c2, 'burst', 'doom2', 'Palestar Edict: Doom 3-Hit')
  })
  if (c.now < s.freezeEnd) {
    s.freezeEnd = c.now
    s.honorEnd = c.now + s.honorLeft
    syncAt(c, s, s.honorEnd)
  }
  return { frames: 26 }
}
const doomReady = (c: SimContext, s: State) =>
  s.doomStage > 0 && c.now < s.doomUntil

export const kit: KitModel = {
  characterKey: 'Anastasya',
  element: 'cryo',
  source: `${KQMSIM}/anastasya`,
  init: (): State => ({
    skillEnd: -1,
    skillId: 0,
    burstEnd: -1,
    a1End: -1,
    sealArmed: false,
    sealed: false,
    sealPoints: 0,
    sealId: 0,
    shareUntil: -1,
    triumphUntil: -1,
    honorEnd: -1,
    freezeEnd: -1,
    honorLeft: 0,
    othersSealed: false,
    othersSealPoints: 0,
    othersSealId: 0,
    othersShareUntil: -1,
    doomStage: 0,
    doomUntil: -1,
    c2LoveEnd: -1,
    c2HonorEnd: -1,
    c6Ready: -1,
    c6LoveEnd: -1,
    c6LoveArmed: false,
    c6HonorEnd: -1,
    c6HonorArmed: false,
  }),
  onStart(c, s: State) {
    sync(c, s)
    if (c.constellation('Anastasya') >= 6)
      c.note(
        'Anastasya C6: the Love Triumph on the next switch and the Honor Doom strike follow the game text (the reference never triggers them).'
      )
  },
  // Her E is Triumph after the Love Sealing, or Palestar Edict: Doom's next attack after the Honor
  // Sealing; with the Blessing of Honor her normal attacks are the Blessed Spear and her Q is The
  // Evernight Yields to Dawn (each with frames of its own, estimates)
  variant(ctx, s: State, action) {
    if (action.kind === 'skill') {
      if (ctx.now < s.triumphUntil) return { key: 'triumph', label: 'Triumph' }
      if (doomReady(ctx, s))
        return {
          key: `doom${s.doomStage}`,
          label: `Palestar Edict: Doom ${s.doomStage}-Hit`,
        }
      return undefined
    }
    if (!honorActive(ctx, s)) return undefined
    const mode = 'Blessing of Honor'
    if (action.kind === 'normal')
      return { key: 'honor', label: 'Blessed Spear', mode }
    if (action.kind === 'burst')
      return { key: 'honor', label: 'The Evernight Yields to Dawn', mode }
    return undefined
  },
  act(ctx, s: State, action, previous) {
    sync(ctx, s)
    switch (action.kind) {
      case 'normal':
        if (honorActive(ctx, s))
          // Radiance: the final instance of each Blessed Spear attack is Stellar Glimmer DMG.
          return normalString(
            spear,
            action.count ?? 1,
            (i, t, j) =>
              ctx.at(t, (c2) => {
                const label = `Blessed Spear N${i + 1}`
                if (j === spear[i].hitmarks.length - 1 && c2.radiance)
                  stellar(c2, 'skill', `honor${i}`, label, [
                    {
                      owner: 'Anastasya',
                      path: ['Anastasya', 'a0StellarRadianceSc'],
                      value: c2.radiance === 'swirl' ? 'ss' : 'on',
                    },
                  ])
                else
                  c2.hit(0, {
                    path: ['skill', `honor${i}`],
                    tag: 'normal',
                    element: 'cryo',
                    applies: true,
                    icd: 'normal',
                    label,
                  })
              }),
            ctx
          )
        return normalString(
          normals,
          action.count ?? 1,
          (i, t) =>
            ctx.hit(t, {
              path: ['normal', `${i}`],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'none',
              label: `N${i + 1}`,
            }),
          ctx
        )
      case 'charged':
        if (honorActive(ctx, s))
          return {
            frames: 0,
            failed:
              'Anastasya: she cannot use Charged Attacks with the Blessing of Honor.',
          }
        hit(
          ctx,
          96,
          ['charged', 'fullyCharged'],
          'Fully-Charged Aimed Shot',
          'charged',
          true
        )
        return { frames: 96, framesInto: { dash: 86, jump: 86 } }
      case 'skill': {
        if (ctx.now < s.triumphUntil) return triumph(ctx, s)
        if (doomReady(ctx, s)) return doom(ctx, s)
        const cons = ctx.constellation('Anastasya')
        s.a1End = ctx.now + 1200
        syncAt(ctx, s, s.a1End)
        if (action.hold) {
          // ESTIMATE frames (see HOLD_*). Blessing of Honor for 15 s; C2 Honor 125% for 15 s.
          hit(
            ctx,
            HOLD_HITMARK,
            ['skill', 'holdDmg'],
            'Skill (Hold)',
            'skill',
            true
          )
          s.honorEnd = ctx.now + HONOR_DURATION
          s.freezeEnd = -1
          syncAt(ctx, s, s.honorEnd)
          if (cons >= 2) {
            s.c2HonorEnd = ctx.now + 900
            syncAt(ctx, s, s.c2HonorEnd)
          }
          c6OnSkill(ctx, s, 'honor')
          sync(ctx, s)
          ctx.note(
            'Anastasya: the Blessing of Honor (hold Skill, Blessed Spear, Evernight, Doom) is not in the reference; its frames are estimates.'
          )
          return {
            frames: HOLD_FRAMES,
            cooldown: { key: 'skill', frames: 900, delay: 30 },
          }
        }
        // C6 Honor: the next tapped Skill also deals an effect equal to Doom's third attack at
        // 200%; with nobody Sealed she counts as holding every member's Accolades for it.
        if (s.c6HonorArmed && ctx.now < s.c6HonorEnd) {
          s.c6HonorArmed = false
          const accolades = s.othersSealed ? 'on' : 'honorSeal'
          ctx.at(28, (c2) =>
            stellar(c2, 'constellation6', 'doom3', 'Doom 3-Hit (C6)', [
              {
                owner: 'Anastasya',
                path: ['Anastasya', 'blessing'],
                value: 'honor',
              },
              {
                owner: 'Anastasya',
                path: ['Anastasya', 'accolades'],
                value: accolades,
              },
            ])
          )
        }
        hit(ctx, 17, ['skill', 'tapDmg'], 'Skill (Tap)', 'skill', true)
        s.honorEnd = -1
        s.freezeEnd = -1
        // The Love burst freezes the Palestar Crown while it lasts.
        s.skillEnd = ctx.now + 1200 + Math.max(0, s.burstEnd - ctx.now)
        if (cons >= 2) {
          s.c2LoveEnd = ctx.now + 1800
          syncAt(ctx, s, s.c2LoveEnd)
        }
        c6OnSkill(ctx, s, 'love')
        const id = ++s.skillId
        sync(ctx, s)
        ctx.at(139, (c) => crown(c, s, id))
        return {
          frames: 35,
          cooldown: { key: 'skill', frames: 900, delay: 14 },
        }
      }
      case 'burst':
        if (honorActive(ctx, s)) {
          // The Evernight Yields to Dawn (ESTIMATE frames): Stellar-Conduct (Swirl) DMG, freezes
          // the Blessing for 14 s and Seals the other members until their Sealing runs out.
          ctx.at(BURST_HITMARK, (c) => {
            sync(c, s)
            stellar(c, 'burst', 'evernight', 'The Evernight Yields to Dawn')
            s.honorLeft = Math.max(0, s.honorEnd - c.now)
            s.freezeEnd = c.now + EVERNIGHT_DURATION
            s.honorEnd = s.freezeEnd + s.honorLeft
            syncAt(c, s, s.honorEnd)
            s.othersSealed = true
            s.othersSealPoints = HONOR_SEAL_POINTS
            s.doomStage = 0
            const id = ++s.othersSealId
            sync(c, s)
            c.at(12, (c2) => othersSealTick(c2, s, id))
          })
          return {
            frames: BURST_FRAMES,
            cooldown: { key: 'burst', frames: 900 },
          }
        }
        ctx.at(105, (c) => {
          hit(c, 0, ['burst', 'loveDmg'], 'To the New World', 'burst', true)
          s.burstEnd = c.now + LOVE_DURATION
          // It freezes the Palestar Crown's duration while it lasts.
          if (c.now < s.skillEnd) {
            s.skillEnd += LOVE_DURATION
            c.note(
              "Anastasya: To the New World freezes the Palestar Crown's duration (game text; the reference lets the crown expire after 20 s)."
            )
          }
          s.sealArmed = true
          sync(c, s)
          c.at(LOVE_DURATION, (c2) => sync(c2, s))
        })
        return { frames: 109, cooldown: { key: 'burst', frames: 900 } }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('lady', 'bow', previous, ctx)
      default:
        return {
          frames: 0,
          failed: `Anastasya: ${action.text} is not implemented in kqmsim.`,
        }
    }
  },
  onSwapOut(ctx, s: State) {
    if (!s.sealArmed) return
    s.sealArmed = false
    s.sealed = true
    s.sealPoints = 100
    sync(ctx, s)
    const id = ++s.sealId
    ctx.at(12, (c) => sealTick(c, s, id))
  },
  onPartySwap(ctx, s: State, _from, to) {
    if (to === 'Anastasya') return
    if (s.othersSealed)
      ctx.warn(
        `Anastasya: ${to} is Sealed by The Evernight Yields to Dawn and could not be switched in yet.`
      )
    // C6 Love: the next switch to another member triggers Triumph at 250%.
    if (s.c6LoveArmed && ctx.now < s.c6LoveEnd) {
      s.c6LoveArmed = false
      ctx.at(28, (c2) => {
        sync(c2, s)
        stellar(c2, 'constellation6', 'triumph', 'Triumph (C6)', [
          {
            owner: 'Anastasya',
            path: ['Anastasya', 'blessing'],
            value: 'love',
          },
        ])
      })
    }
  },
  swapReadyAt: (s: State, now) => (s.sealed ? now + s.sealPoints * 12 : now),
  onSwapIn(ctx, s: State) {
    if (ctx.now < s.triumphUntil) return triumph(ctx, s)
    return undefined
  },
  cooldownKey: (s: State, action, now) =>
    action.kind === 'skill' &&
    (now < s.triumphUntil || (s.doomStage > 0 && now < s.doomUntil))
      ? undefined
      : action.kind === 'skill' || action.kind === 'burst'
        ? action.kind
        : undefined,
  onHit(ctx, s: State, h) {
    if (h.path[0] === '_reaction' || h.characterKey === 'Anastasya')
      sync(ctx, s)
    if (
      !h.path[0].startsWith('_') &&
      (/Stellar-Conduct|Stellar Swirl/.test(h.label) ||
        (h.path[0] === 'reaction' && h.path[1].startsWith('stellar')))
    )
      sealPoints(ctx, s, 2)
    // Honor: her Blessed Spear Normal Attacks shorten the other members' Sealing.
    if (
      h.characterKey === 'Anastasya' &&
      h.path[0] === 'skill' &&
      h.path[1]?.startsWith('honor')
    )
      othersSealPoints(ctx, s, SPEAR_SEAL_POINTS)
  },
}
