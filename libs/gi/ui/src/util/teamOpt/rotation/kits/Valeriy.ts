import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), pinned by KQMSIM, internal/characters/valeriy. */
const normals: NormalHit[] = [
  {
    hitmarks: [11],
    hitlag: [6],
    toNormal: 15,
    toCharged: 15,
    toAbil: 11,
    frames: 15,
  },
  {
    hitmarks: [10],
    hitlag: [6],
    toNormal: 21,
    toCharged: 21,
    toAbil: 10,
    frames: 21,
  },
  {
    hitmarks: [30],
    hitlag: [10],
    toNormal: 39,
    toCharged: 39,
    toAbil: 30,
    frames: 39,
  },
]
// Native chooses one of these six shell rhythms at random. Cycle all six rather than
// inventing a fixed tick interval; this is a deterministic sample, not an exact RNG expectation.
const rhythms = [
  [0.46, 0.51],
  [0.66, 0.46],
  [0.48, 0.69],
  [0.61, 0.61],
  [0.36, 0.91],
  [0.71, 0.61],
]
const set = (c: SimContext, name: string, value: string) =>
  c.state('Valeriy', ['Valeriy', name], value)
interface State {
  momentum: number
  firstSkill: boolean
  consumed: number
  directive: number
  directiveToken: number
  burstActive: boolean
  burstToken: number
  burstMomentum: number
  rhythm: number
  dashed: boolean
  /** A Normal Attack started by this frame becomes the mortar (0.8 s after E / Q) */
  convertUntil: number
}
/**
 * Tooltip (Direct-Fire Mortar): within 0.8 s after the Elemental Skill or Burst, with at least 40
 * Impact Momentum, the next Normal Attack is converted to the special Charged Attack. Not in the
 * pinned kqmsim; the 0.8 s is counted from the end of the cast animation (estimate: from the
 * cast itself it could never follow the 60-frame burst).
 */
const CONVERT_WINDOW = 48
/** The same context with every scheduled event `offset` frames later (a string after a lead-in). */
function shifted(c: SimContext, offset: number): SimContext {
  return new Proxy(c, {
    get(target, prop) {
      if (prop === 'hit')
        return (d: number, h: Parameters<SimContext['hit']>[1]) =>
          target.hit(d + offset, h)
      if (prop === 'at')
        return (d: number, fn: (x: SimContext) => void) =>
          target.at(d + offset, fn)
      if (prop === 'atCharacter')
        return (
          k: Parameters<SimContext['atCharacter']>[0],
          d: number,
          fn: (x: SimContext) => void
        ) => target.atCharacter(k, d + offset, fn)
      return Reflect.get(target, prop)
    },
  })
}
const cons = (c: SimContext) => c.constellation('Valeriy')
function addMomentum(c: SimContext, s: State, amount: number) {
  const old = s.momentum
  const c4 = cons(c) >= 4
  // Half-point precision preserves C4's 6.5-point A1 increments.
  s.momentum = Math.min(c4 ? 130 : 100, s.momentum + amount * (c4 ? 1.3 : 1))
  return s.momentum - old
}
function special(hit: SimHit) {
  return (
    hit.characterKey === 'Valeriy' &&
    (hit.path[1] === 'mortarDmg' || hit.path[1] === 'shellDmg')
  )
}
function shells(c: SimContext, s: State, token: number) {
  if (!s.burstActive || s.burstToken !== token) return
  const [first, second] = rhythms[s.rhythm++ % rhythms.length]
  for (const delay of [0, first, first + second].map((d) =>
    Math.round((d + 0.15) * 60)
  ))
    c.at(delay, (at) => {
      if (!s.burstActive || s.burstToken !== token) return
      at.hit(0, {
        path: ['burst', 'shellDmg'],
        tag: 'burst',
        element: 'electro',
        applies: true,
        icd: 'burst',
        icdGroup: 'ValeriyBurst',
        label: 'Burst (Tick)',
      })
    })
  c.at(Math.round((first + second + 0.2) * 60), (at) => shells(at, s, token))
}

/** Direct-Fire Mortar: Point-Blank Bombardment (native specialChargeAttack: 43 / 67 frames) */
function mortar(c: SimContext, s: State): ActionResult {
  c.atCharacter('Valeriy', 43, (at) => {
    at.hit(0, {
      path: ['charged', 'mortarDmg'],
      tag: 'charged',
      element: 'electro',
      applies: true,
      icd: 'none',
      label: 'Special Charge',
    })
    // The attack is queued before the callback installs the new Directive.
    at.at(0, (after) => {
      s.consumed = s.momentum
      s.momentum = 0
      s.directive = 15
      const token = ++s.directiveToken
      after.atCharacter('Valeriy', 1080, () => {
        if (s.directiveToken === token) s.directive = 0
      })
    })
  })
  return { frames: 67 }
}
export const kit: KitModel = {
  characterKey: 'Valeriy',
  element: 'electro',
  source: `${KQMSIM}/valeriy`,
  init: (): State => ({
    momentum: 0,
    firstSkill: true,
    consumed: 0,
    directive: 0,
    directiveToken: 0,
    burstActive: false,
    burstToken: 0,
    burstMomentum: 0,
    rhythm: 0,
    dashed: false,
    convertUntil: -1,
  }),
  onStart(c) {
    for (const name of [
      'offensiveDirective',
      'a0StellarRadianceSc',
      'a4Momentum',
      'c2Skill',
      'c2Excess',
      'c6Hit',
    ])
      set(c, name, '')
    c.note(
      'Valeriy: shell timing cycles the six native random rhythms. Energy refunds, shield damage and shield growth from excess Momentum are not validated. Plunges are unsupported.'
    )
  },
  // With 40+ Impact Momentum his charged attack (and a normal attack within 0.8 s after his E or Q)
  // is Direct-Fire Mortar, with frames of its own
  variant(c, s: State, action) {
    const mortar =
      action.kind === 'charged'
        ? s.momentum >= 40
        : action.kind === 'normal' &&
          c.now <= s.convertUntil &&
          s.momentum >= 40
    return mortar ? { key: 'mortar', label: 'Direct-Fire Mortar' } : undefined
  },
  act(c, s: State, action) {
    switch (action.kind) {
      case 'skill':
        c.atCharacter('Valeriy', 25, () => {
          const bonus = cons(c) >= 1 && s.firstSkill ? 1.5 : 1
          s.firstSkill = false
          addMomentum(c, s, 40 * bonus)
        })
        c.atCharacter('Valeriy', 26, (at) => {
          at.hit(0, {
            path: ['skill', 'dmg'],
            tag: 'skill',
            element: 'electro',
            applies: true,
            icd: 'none',
            label: 'Skill',
          })
          // C2: +100 EM for 18 s (game text and skillParam; the pinned kqmsim uses 15 s).
          if (cons(at) >= 2)
            at.at(0, (after) =>
              after.buff('Valeriy', ['Valeriy', 'c2Skill'], 'on', 0, 1080, {
                hitlag: 'recipient',
              })
            )
        })
        s.convertUntil = c.now + 34 + CONVERT_WINDOW
        return { frames: 34, cooldown: { key: 'skill', frames: 600 } }
      case 'burst': {
        c.atCharacter('Valeriy', 43, (at) => {
          at.hit(0, {
            path: ['burst', 'dmg'],
            tag: 'burst',
            element: 'electro',
            applies: true,
            icd: 'none',
            label: 'Burst',
          })
          at.at(0, (after) => {
            const token = ++s.burstToken
            s.burstActive = true
            s.burstMomentum = 0
            shells(after, s, token)
            after.atCharacter('Valeriy', 720, () => {
              if (s.burstToken === token) s.burstActive = false
            })
          })
        })
        s.convertUntil = c.now + 60 + CONVERT_WINDOW
        return { frames: 60, cooldown: { key: 'burst', frames: 900 } }
      }
      case 'charged': {
        if (s.momentum < 40) {
          c.hit(39, {
            path: ['charged', 'dmg'],
            tag: 'charged',
            element: 'physical',
            applies: true,
            icd: 'charged',
            label: 'Charge',
          })
          return { frames: 58 }
        }
        return mortar(c, s)
      }
      case 'normal': {
        const convert = c.now <= s.convertUntil && s.momentum >= 40
        s.convertUntil = -1
        const lead = convert ? mortar(c, s) : undefined
        const count = (action.count ?? 1) - (lead ? 1 : 0)
        if (lead && count <= 0) return lead
        if (lead)
          c.note(
            'Valeriy: a Normal Attack right after his Skill or Burst (with 40+ Impact Momentum) is played as Direct-Fire Mortar.'
          )
        const sc = lead ? shifted(c, lead.frames) : c
        const result = normalString(
          normals,
          count,
          (i, delay) =>
            sc.hit(delay, {
              path: ['normal', String(i)],
              tag: 'normal',
              element: 'physical',
              applies: true,
              icd: 'normal',
              label: `Normal ${i + 1}`,
            }),
          sc
        )
        if (!lead) return result
        return {
          ...result,
          frames: lead.frames + result.frames,
          normalStarts: result.normalStarts?.map((n) => ({
            ...n,
            offset: n.offset + lead.frames,
          })),
          framesInto: Object.fromEntries(
            Object.entries(result.framesInto ?? {}).map(([k, v]) => [
              k,
              lead.frames + (v as number),
            ])
          ),
        }
      }
      case 'dash':
        s.dashed = true
        return { frames: 20, framesInto: { jump: 4 } }
      case 'jump':
        // template jump (Male body): 28 frames, 37 right after a dash
        return {
          frames: s.dashed ? 37 : 28,
          framesInto: { plunge: 5 },
        }
      default:
        return {
          frames: 0,
          failed: `Valeriy: ${action.text} is not implemented.`,
        }
    }
  },
  onPartyAction(_c, s: State, actor, action) {
    if (
      actor !== 'Valeriy' ||
      (action.kind !== 'dash' && action.kind !== 'wait')
    )
      s.dashed = false
    // Only his own next actions can use the conversion window.
    if (actor !== 'Valeriy') s.convertUntil = -1
  },
  onHit(c, s: State, hit) {
    if (hit.path[0].startsWith('_')) return
    const electro = hit.element === 'electro'
    const conduct = c.radiance === 'conduct'
    const eligible =
      electro &&
      hit.characterKey === c.onField &&
      s.directive > 0 &&
      (conduct
        ? hit.tag === 'directStellarConduct'
        : ['normal', 'charged', 'plunge', 'skill', 'burst'].includes(hit.tag))
    hit.states = [
      ...(hit.states ?? []),
      {
        owner: 'Valeriy',
        path: ['Valeriy', 'offensiveDirective'],
        value: eligible ? 'on' : '',
      },
      {
        owner: 'Valeriy',
        path: ['Valeriy', 'a0StellarRadianceSc'],
        value: conduct ? 'on' : '',
      },
      {
        owner: 'Valeriy',
        path: ['Valeriy', 'a4Momentum'],
        value: String(s.consumed),
      },
      {
        owner: 'Valeriy',
        path: ['Valeriy', 'c6Hit'],
        value: c.hasBuff('Valeriy', ['Valeriy', 'c6Hit']) ? 'on' : '',
      },
    ]
    if (eligible) s.directive--
    // Native A1 observes every active-character Electro hit, without an ICD or tag filter.
    if (
      electro &&
      hit.characterKey === c.onField &&
      s.burstActive &&
      s.burstMomentum < (cons(c) >= 4 ? 104 : 80)
    )
      s.burstMomentum += addMomentum(c, s, 5)
    if (cons(c) >= 6 && special(hit))
      c.buff('Valeriy', ['Valeriy', 'c6Hit'], 'on', 0, 420)
  },
}
