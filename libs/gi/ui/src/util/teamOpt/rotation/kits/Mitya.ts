import type { ActionResult, KitModel, SimContext, SimHit } from '../types'
import { KQMSIM, type NormalHit, normalString, templateJump } from './common'

/* Adapted from KQM-git/kqmsim (AGPLv3), commit 7bdf45f, internal/characters/mitya. */
const normals: NormalHit[] = [
  { hitmarks: [15], toNormal: 26, toCharged: 26, toAbil: 15, frames: 500 },
  { hitmarks: [21], toNormal: 33, toCharged: 33, toAbil: 21, frames: 500 },
  { hitmarks: [22], toNormal: 50, toCharged: 50, toAbil: 22, frames: 500 },
]
interface State {
  mode: 'steady' | 'overloaded' | ''
  end: number
  version: number
  recastEnd: number
  recastReady: number
  prisms: number
  prismExpiry: number
  gainUntil: number
  gaining: boolean
  a4: number
  a4End: number
  c4: number
  refundCredit: number
}
const hit = (
  c: SimContext,
  delay: number,
  path: string[],
  label: string,
  tag: SimHit['tag'] = 'directStellarConduct',
  applies = false,
  weight = 1
) =>
  c.hit(delay, {
    path,
    label,
    tag,
    element: 'electro',
    applies,
    // (gcsim: normal attacks use the standard normal-attack ICD; his burst, charged and press/hold
    // skill hits have none)
    icd: tag === 'normal' ? 'normal' : 'none',
    weight,
  })
const set = (c: SimContext, key: string, value: string) =>
  c.state('Mitya', ['Mitya', key], value)
function sync(c: SimContext, s: State) {
  set(c, 'detectionCore', c.now < s.end ? s.mode : '')
  set(c, 'gradientBeacons', s.prisms > 0 ? `${s.prisms}` : '')
  set(c, 'a4Stacks', c.now < s.a4End ? `${s.a4}` : '')
  set(c, 'a0StellarRadianceSc', c.radiance === 'conduct' ? 'on' : '')
}
/**
 * C4: the Detection Core deals one Stellar-Conduct hit for every 5 Gradient Beacons consumed while
 * it is on the field (game text; the pinned kqmsim counts Beacons gained instead). Consumption:
 * the Steady core's overflow, its detonation, and Gradient Detonation charged attacks.
 */
function consumed(c: SimContext, s: State, count: number) {
  // The expiry detonation (at the end frame) still belongs to the core.
  if (c.constellation('Mitya') < 4 || c.now > s.end || !s.mode) return
  s.c4 += count
  while (s.c4 >= 5) {
    s.c4 -= 5
    hit(c, 0, ['constellation4', 'dmg'], 'Mitya C4 (Stellar-Conduct)')
  }
}
function addPrism(c: SimContext, s: State) {
  s.prisms++
  const max = c.constellation('Mitya') >= 1 ? 5 : 4
  if (s.prisms > max && s.mode === 'steady' && c.now < s.end) {
    s.prisms--
    hit(c, 0, ['skill', 'steadyConsumeDmg'], 'Prism Surge (Stellar-Conduct)')
    consumed(c, s, 1)
  } else s.prisms = Math.min(max, s.prisms)
  s.prismExpiry = c.now + 600 // 6 s base + 4 s A4
  s.a4 = Math.min(4, (c.now < s.a4End ? s.a4 : 0) + 1)
  s.a4End = c.now + 900
  sync(c, s)
  c.at(600, (c2) => {
    if (c2.now >= s.prismExpiry) {
      s.prisms = 0
      sync(c2, s)
    }
  })
  c.at(900, (c2) => {
    if (c2.now >= s.a4End) sync(c2, s)
  })
}
function detonate(c: SimContext, s: State) {
  consumed(c, s, s.prisms)
  if (s.prisms)
    c.hit(0, {
      path: ['skill', 'steadyDetonateDmg'],
      label: 'Prism Shatter (Stellar-Conduct)',
      tag: 'directStellarConduct',
      element: 'electro',
      weight: s.prisms,
      // kqmsim snapshots before clearing the prisms: their A1 EM and C6 Steady bonus still apply.
      states: [
        {
          owner: 'Mitya',
          path: ['Mitya', 'gradientBeacons'],
          value: `${s.prisms}`,
        },
        { owner: 'Mitya', path: ['Mitya', 'detectionCore'], value: 'steady' },
      ],
    })
  s.prisms = 0
  sync(c, s)
}
function pulse(c: SimContext, s: State, version: number) {
  if (version !== s.version || s.mode !== 'steady' || c.now >= s.end) return
  sync(c, s)
  c.hit(0, {
    path: ['skill', 'steadyCoreDmg'],
    label: 'Skill Pulse',
    tag: 'skill',
    element: 'electro',
    applies: true,
    icd: 'skill',
  })
  c.at(92, (c2) => pulse(c2, s, version))
}
function core(c: SimContext, s: State, mode: State['mode']) {
  if (s.mode === 'steady' && c.now < s.end) detonate(c, s)
  s.c4 = 0 // each Detection Core counts its own consumed Beacons
  s.mode = mode
  s.end = c.now + 1500
  s.recastEnd = c.now + 360
  s.recastReady = c.now + 90
  const version = ++s.version
  if (c.constellation('Mitya') >= 1) addPrism(c, s)
  sync(c, s)
  if (mode === 'steady') c.at(90, (c2) => pulse(c2, s, version))
  c.at(1500, (c2) => {
    if (version !== s.version) return
    if (s.mode === 'steady') detonate(c2, s)
    s.mode = ''
    sync(c2, s)
  })
}
function gainTick(c: SimContext, s: State) {
  if (c.now >= s.gainUntil) {
    s.gaining = false
    return
  }
  addPrism(c, s)
  c.at(90, (c2) => gainTick(c2, s))
}
export const kit: KitModel = {
  characterKey: 'Mitya',
  element: 'electro',
  source: `${KQMSIM}/mitya`,
  init: (): State => ({
    mode: '',
    end: -1,
    version: 0,
    recastEnd: -1,
    recastReady: -1,
    prisms: 0,
    prismExpiry: -1,
    gainUntil: -1,
    gaining: false,
    a4: 0,
    a4End: -1,
    c4: 0,
    refundCredit: 0,
  }),
  onStart(c) {
    if (c.constellation('Mitya') >= 4)
      c.note(
        'Mitya C4: counts Gradient Beacons consumed by the Detection Core (game text; the reference counts Beacons gained).'
      )
  },
  act(ctx, s: State, action, previous) {
    sync(ctx, s)
    switch (action.kind) {
      case 'normal':
        return normalString(
          normals,
          action.count ?? 1,
          (i, t) =>
            hit(ctx, t, ['normal', `${i}`], `N${i + 1}`, 'normal', true),
          ctx
        )
      case 'skill': {
        if (!action.hold && ctx.now < s.recastEnd) {
          if (ctx.now < s.recastReady)
            return {
              frames: 0,
              failed: 'Mitya: Skill recast is on its 1.5 s cooldown.',
            }
          s.recastReady = ctx.now + 90
          const version = ++s.version
          if (s.mode === 'steady') {
            detonate(ctx, s)
            s.mode = 'overloaded'
          } else {
            s.mode = 'steady'
            ctx.at(90, (c) => pulse(c, s, version))
          }
          sync(ctx, s)
          ctx.at(Math.max(0, s.end - ctx.now), (c) => {
            if (version !== s.version) return
            if (s.mode === 'steady') detonate(c, s)
            s.mode = ''
            sync(c, s)
          })
          return { frames: 8 }
        }
        const hold = action.hold
        hit(
          ctx,
          hold ? 44 : 28,
          ['skill', hold ? 'holdDmg' : 'tapDmg'],
          hold ? 'Skill (Hold)' : 'Skill (Press)',
          'skill',
          true
        )
        ctx.at(hold ? 36 : 22, (c) => {
          core(c, s, hold ? 'overloaded' : 'steady')
          if (hold) addPrism(c, s)
        })
        return {
          frames: hold ? 46 : 24,
          cooldown: { key: 'skill', frames: 1080, delay: hold ? 36 : 22 },
        }
      }
      case 'burst':
        hit(ctx, 120, ['burst', 'dmg'], 'Burst', 'burst', true)
        for (let i = 0; i < 3; i++) ctx.at(119, (c) => addPrism(c, s))
        return { frames: 115, cooldown: { key: 'burst', frames: 900 } }
      case 'charged': {
        const windup = previous?.kind === 'normal' ? 14 : 0
        if (s.mode !== 'overloaded' || ctx.now >= s.end) {
          hit(
            ctx,
            60 - windup,
            ['charged', 'dmg'],
            'Charged Attack',
            'charged',
            true
          )
          return {
            frames: 70 - windup,
            framesInto: {
              normal: 64 - windup,
              charged: 64 - windup,
              skill: 64 - windup,
              burst: 64 - windup,
              dash: 60 - windup,
              jump: 60 - windup,
              swap: 64 - windup,
            },
          }
        }
        let duration = 62 - windup
        const tick = (c: SimContext) => {
          if (!s.prisms) return
          const delay = s.prisms === 1 ? 43 : 15
          duration += delay
          c.at(delay, (c2) => {
            s.prisms = Math.max(0, s.prisms - 1)
            consumed(c2, s, 1)
            hit(
              c2,
              0,
              ['charged', 'gradientStellarDmg'],
              'Special Charge (Stellar-Conduct)'
            )
            if (c2.constellation('Mitya') >= 6) {
              c2.note(
                'Mitya C6: random prism refunds use accumulated probability for reproducible channel timing.'
              )
              s.refundCredit += 0.34
              if (s.refundCredit >= 1) {
                s.refundCredit--
                addPrism(c2, s)
              }
            }
            sync(c2, s)
            if (delay === 15) tick(c2)
          })
        }
        ctx.at(duration, (c) => {
          hit(
            c,
            0,
            ['charged', 'gradientDmg'],
            'Special Charge',
            'charged',
            true
          )
          tick(c)
        })
        return {
          frames: duration + 3,
          duration: () => duration + 3,
        } as ActionResult
      }
      case 'dash':
        return { frames: 21, framesInto: { jump: 2 } }
      case 'jump':
        return templateJump('boy', 'catalyst', previous, ctx)
      default:
        return {
          frames: 0,
          failed: `Mitya: ${action.text} is not implemented in kqmsim.`,
        }
    }
  },
  // A recast waits out its 1.5 s cooldown (gcsim's ActionReady) instead of being skipped
  actionReadyAt: (ctx, s: State, action) =>
    action.kind === 'skill' &&
    !action.hold &&
    ctx.now < s.recastEnd &&
    ctx.now < s.recastReady
      ? s.recastReady
      : ctx.now,
  cooldownKey: (s: State, action, now) =>
    action.kind === 'skill' && !action.hold && now < s.recastEnd
      ? undefined
      : action.kind === 'skill' || action.kind === 'burst'
        ? action.kind
        : undefined,
  onHit(ctx, s: State, h) {
    if (h.path[0] !== '_reaction' || h.path[1] !== 'stellarConduct') return
    s.gainUntil =
      ctx.now + 179 + (s.mode === 'overloaded' && ctx.now < s.end ? 180 : 0)
    if (!s.gaining) {
      s.gaining = true
      gainTick(ctx, s)
    }
    sync(ctx, s)
  },
}
