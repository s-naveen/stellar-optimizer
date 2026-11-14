import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { gearEffects } from '../util/teamOpt/rotation/gearEffects'
import { normalString } from '../util/teamOpt/rotation/kits/common'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type {
  KitModel,
  SimBuffWindow,
  SimContext,
  SimHit,
} from '../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Xilonen', 'Neuvillette']
const parse = (text: string) =>
  parseRotation(
    text,
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )
const hit: Omit<SimHit, 't' | 'characterKey' | 'onField'> = {
  path: ['normal', '0'],
  tag: 'normal',
  element: 'geo',
  label: 'hit',
}

function run(
  text: string,
  kits: Partial<Record<CharacterKey, KitModel>>,
  swapFrames = 12
) {
  return simulateRotation({
    rotation: parse(text),
    members,
    elements: { Xilonen: 'geo', Neuvillette: 'hydro' },
    constellations: {},
    kits,
    repeats: 1,
    swapFrames,
  })
}
const idle: KitModel = {
  characterKey: 'Neuvillette',
  element: 'hydro',
  source: 'test',
  act: () => ({ frames: 1 }),
}

describe('rotation frame ordering', () => {
  it.each([
    'enemy',
    'character',
  ] as const)('keeps the %s task in queue order after its original deadline is extended', (clock) => {
    const order: string[] = []
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        const due = (at: SimContext) => order.push(`${clock} ${at.now}`)
        if (clock === 'enemy') c.atEnemy(20, due)
        else c.atCharacter('Xilonen', 20, due)
        c.hit(10, {
          ...hit,
          path: ['_marker', 'hitlag'],
          animationPause: 10,
        })
        c.at(25, (at) => order.push(`core ${at.now}`))
        return { frames: 50 }
      },
    }
    run('Xilonen E', { Xilonen: kit })
    expect(order).toEqual(['core 25', `${clock} 30`])
  })

  it('evaluates target-aura CRIT modifiers at impact while retaining cast-time base stats', () => {
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        c.state('Xilonen', ['BlizzardStrayer', 'state'], 'cryo')
        c.hit(10, { ...hit, snapshotDelay: 0 })
        c.at(5, (at) =>
          at.state('Xilonen', ['BlizzardStrayer', 'state'], 'frozen')
        )
        return { frames: 20 }
      },
    }
    const attack = rotationAttacks(run('Xilonen E', { Xilonen: kit }))
      .Xilonen![0]
    const captured = (stat: string) =>
      attack.statSnapshots
        ?.find((s) => s.stat === stat)
        ?.states.find((s) => s.path.join('.') === 'BlizzardStrayer.state')
        ?.value
    expect(captured('critRate_')).toBe('frozen')
    expect(captured('atk')).toBe('cryo')
  })

  it('combines a cast-time snapshot with a separately captured teammate buff while keeping target debuffs at impact', () => {
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        c.buff('Xilonen', ['Test', 'lateAttackBuff'], 'on', 5, 100)
        c.buff('Neuvillette', ['Test', 'enemyDebuff'], 'on', 8, 100)
        c.hit(10, {
          ...hit,
          snapshotDelay: 0,
          statSnapshots: [
            {
              characterKey: 'Neuvillette',
              stat: 'atk',
              path: ['display', 'skill', 'capturedBuff'],
              t: 0,
              onField: 'Xilonen',
            },
          ],
        })
        return { frames: 20 }
      },
    }
    const attack = rotationAttacks(
      run('Xilonen E', { Xilonen: kit, Neuvillette: idle })
    ).Xilonen![0]
    expect(
      attack.statSnapshots?.find(
        (s) => s.path.join('.') === 'display.skill.capturedBuff'
      )?.characterKey
    ).toBe('Neuvillette')
    const ownAtk = attack.statSnapshots?.find(
      (s) => !s.characterKey && s.path.join('.') === 'total.atk'
    )
    expect(ownAtk).toBeDefined()
    expect(
      ownAtk?.states.find((s) => s.path[1] === 'lateAttackBuff')?.value
    ).toBe('')
    expect(attack.states?.find((s) => s.path[1] === 'enemyDebuff')?.value).toBe(
      'on'
    )
  })

  it('runs enemy tasks, then character tasks, before core tasks due on the same frame', () => {
    const order: string[] = []
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        c.at(20, () => order.push('core'))
        c.atCharacter('Xilonen', 20, () => order.push('character'))
        c.atEnemy(20, () => order.push('enemy'))
        return { frames: 30 }
      },
    }
    run('Xilonen E', { Xilonen: kit })
    expect(order).toEqual(['enemy', 'character', 'core'])
  })

  it('does not extend an enemy task already due before a core hit applies hitlag', () => {
    const times: number[] = []
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        c.hit(20, { ...hit, path: ['_marker', 'hitlag'], animationPause: 10 })
        c.atEnemy(20, (at) => times.push(at.now))
        return { frames: 40 }
      },
    }
    run('Xilonen E', { Xilonen: kit })
    expect(times).toEqual([20])
  })

  it('extends pending enemy tasks only by new target hitlag, independently of the attacker clock', () => {
    const times: Record<string, number> = {}
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        c.atEnemy(20, (at) => {
          times.enemy = at.now
        })
        c.atCharacter('Xilonen', 20, (at) => {
          times.character = at.now
        })
        c.at(20, (at) => {
          times.core = at.now
        })
        for (const t of [10, 12, 15])
          c.hit(t, {
            ...hit,
            path: ['_marker', 'hitlag'],
            animationPause: 0,
            enemyAnimationPause: 10,
          })
        return { frames: 50 }
      },
    }
    run('Xilonen E', { Xilonen: kit })
    expect(times).toEqual({ enemy: 35, character: 20, core: 20 })
  })

  it('matches native immediate zero-delay enemy tasks and its global-frame delay for tasks added during an existing freeze', () => {
    const order: string[] = []
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        order.push('before')
        c.atEnemy(0, () => order.push('immediate'))
        order.push('after')
        c.hit(10, {
          ...hit,
          path: ['_marker', 'hitlag'],
          animationPause: 0,
          enemyAnimationPause: 10,
        })
        c.at(12, (at) =>
          at.atEnemy(2, (later) => order.push(`new at ${later.now}`))
        )
        return { frames: 40 }
      },
    }
    run('Xilonen E', { Xilonen: kit })
    expect(order).toEqual(['before', 'immediate', 'after', 'new at 14'])
  })

  it('samples cooldown modifiers when a delayed cooldown actually starts', () => {
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        c.at(20, (at) => at.modifyCooldown('field', -0.15, 100))
        return {
          frames: 50,
          cooldown: { key: 'skill', frames: 100, delay: 40 },
        }
      },
    }
    expect(
      run('Xilonen E E', { Xilonen: kit }).actions.map((a) => a.start)
    ).toEqual([0, 125])
  })

  it('keeps temporary cooldown modifiers active through the recipient’s hitlag', () => {
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        c.modifyCooldown('field', -0.15, 30)
        c.hit(10, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 30,
          label: 'Pause',
        })
        return {
          frames: 70,
          cooldown: { key: 'skill', frames: 100, delay: 50 },
        }
      },
    }
    expect(
      run('Xilonen E E', { Xilonen: kit }).actions.map((a) => a.start)
    ).toEqual([0, 135])
  })
  it('extends enemy debuffs by the union of overlapping target pauses across attackers', () => {
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(c) {
        c.buff('Xilonen', ['Test', 'enemyDebuff'], 'on', 0, 20, {
          hitlag: 'enemy',
        })
        for (const [t, characterKey] of [
          [10, 'Xilonen'],
          [12, 'Neuvillette'],
          [15, 'Xilonen'],
          [40, 'Xilonen'],
        ] as const)
          c.hit(t, {
            characterKey,
            path: ['_marker', 'hitlag'],
            tag: 'other',
            element: 'physical',
            animationPause: 10,
            label: 'Pause',
          })
        for (const t of [29, 34, 36, 51])
          c.hit(t, { ...hit, label: `Probe ${t}` })
        return { frames: 80 }
      },
    }
    const sim = run('Xilonen E', { Xilonen: kit, Neuvillette: idle })
    const attacks = rotationAttacks(sim).Xilonen!
    const active = (label: string) =>
      attacks
        .find((a) => a.description === label)
        ?.states?.find((s) => s.path[1] === 'enemyDebuff')?.value ?? ''
    expect(active('Probe 29')).toBe('on')
    expect(active('Probe 34')).toBe('on')
    expect(active('Probe 36')).toBe('') // 20 + union([10,20], [12,22], [15,25]) = 35
    expect(active('Probe 51')).toBe('')
  })
  it('lands the boundary hit before swapping, then spends 12 frames on the swap', () => {
    const order: string[] = []
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(ctx) {
        ctx.hit(10, hit)
        return { frames: 10 }
      },
      onHit() {
        order.push('hit')
      },
      onSwapOut() {
        order.push('swap')
      },
    }
    const sim = run('Xilonen N1 -> Neuvillette N1', {
      Xilonen: kit,
      Neuvillette: idle,
    })
    expect(order).toEqual(['hit', 'swap'])
    expect(sim.hits[0].onField).toBe('Xilonen')
    expect(sim.actions[1].start).toBe(22)
  })

  it('rechecks a cooldown shortened by a queued event while waiting', () => {
    const kit: KitModel = {
      ...idle,
      characterKey: 'Xilonen',
      element: 'geo',
      act(ctx) {
        ctx.at(20, (c) => c.reduceCooldown('skill', 80))
        return { frames: 10, cooldown: { key: 'skill', frames: 100 } }
      },
    }
    const sim = run('Xilonen E E', { Xilonen: kit })
    expect(sim.actions.map((a) => a.start)).toEqual([0, 20])
    expect(sim.notes).toEqual(["Waited 0.2 s for Xilonen's E."]) // one-loop runs report their own waits
  })

  it('respects the one-second swap cooldown', () => {
    const sim = run('Xilonen N1 -> Neuvillette N1 -> Xilonen N1', {
      Xilonen: { ...idle, characterKey: 'Xilonen', element: 'geo' },
      Neuvillette: idle,
    })
    expect(sim.actions.map((a) => a.start)).toEqual([0, 13, 85])
  })

  it('Xilonen activates converted samplers when her second roller hit lands on the swap frame', () => {
    const party: CharacterKey[] = [
      'Xilonen',
      'Neuvillette',
      'Fischl',
      'Bennett',
    ]
    const sim = simulateRotation({
      rotation: parseRotation(
        'Xilonen E N2 -> Neuvillette N1',
        party.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members: party,
      constellations: {},
      elements: {
        Xilonen: 'geo',
        Neuvillette: 'hydro',
        Fischl: 'electro',
        Bennett: 'pyro',
      },
      repeats: 1,
    })
    expect(
      sim.buffWindows.some(
        (w) => w.owner === 'Xilonen' && w.path[1] === 'sourceActive'
      )
    ).toBe(true)
  })

  it('includes hitlag between normal hits and at their cancels', () => {
    const marks: number[] = []
    const result = normalString(
      [
        {
          hitmarks: [11],
          hitlag: [5],
          toNormal: 11,
          toCharged: 17,
          toAbil: 11,
          frames: 24,
        },
        {
          hitmarks: [16],
          hitlag: [5],
          toNormal: 21,
          toCharged: 26,
          toAbil: 16,
          frames: 31,
        },
        {
          hitmarks: [17],
          hitlag: [5],
          toNormal: 31,
          toCharged: 33,
          toAbil: 17,
          frames: 39,
        },
      ],
      3,
      (_i, t) => marks.push(t)
    )
    expect(marks).toEqual([11, 32, 59])
    expect(result.framesInto?.dash).toBe(64)
    expect(result.framesInto?.wait).toBe(59)
    expect(result.frames).toBe(86)
  })

  it('matches Skirk’s native Flash hitlag, chained N1 windup and wait boundary', () => {
    const sim = simulateRotation({
      rotation: parseRotation('Skirk E Q N5 N5 N5 W1', [
        { characterKey: 'Skirk', name: 'Skirk' },
      ]),
      members: ['Skirk'],
      constellations: {},
      elements: { Skirk: 'cryo' },
      repeats: 1,
      keep: 'all',
    })
    expect(sim.warnings).toEqual([])
    const normals = sim.actions.filter((a) => a.text === 'N5')
    expect(normals.map((a) => a.frames)).toEqual([160, 158, 128])
    const hits = sim.hits.filter((h) => h.tag === 'normal')
    expect(hits.slice(0, 7).map((h) => h.t - normals[0].start)).toEqual([
      12, 25, 48, 62, 81, 99, 130,
    ])
    const secondPause = sim.hits.find(
      (h) => h.path.join('.') === '_marker.hitlag' && h.t >= normals[1].start
    )!
    expect(secondPause.t - normals[1].start).toBe(10)
  })
})

function gear(weapon = false) {
  const windows: SimBuffWindow[] = []
  const fx = gearEffects({
    members,
    onField: 'Xilonen',
    gear: {
      Xilonen: { sets: { ScrollOfTheHeroOfCinderCity: 4 } },
      ...(weapon ? { Neuvillette: { weapon: 'SacrificialJade' } } : {}),
    },
    inNightsoul: () => true,
    cooldown: () => 0,
    reduceCooldown: () => {},
    window: (owner, path, value, start, end) =>
      windows.push({ owner, path, value, start, end }),
  })
  return { fx, windows }
}

describe('timed gear effects', () => {
  it('keeps Scroll’s 15 s base and 20 s Nightsoul windows independent', () => {
    const { fx, windows } = gear()
    const t = 100
    const ctx = {
      buff(owner, path, value, delay, duration) {
        windows.push({
          owner,
          path,
          value,
          start: t + delay,
          end: t + delay + duration,
        })
      },
    } as SimContext
    fx.onHit(ctx, {
      ...hit,
      characterKey: 'Xilonen',
      path: ['_reaction', 'crystallize'],
      element: 'hydro',
      t,
    })
    expect(windows.find((w) => w.path[1] === 'react_hydro')).toMatchObject({
      start: 100,
      end: 1000,
    })
    expect(windows.find((w) => w.path[1] === 'nightsoul_hydro')).toMatchObject({
      start: 100,
      end: 1300,
    })
  })

  it('preserves Sacrificial Jade through brief off-field visits and resets the on-field timer', () => {
    const { fx, windows } = gear(true)
    fx.onSwap(300, 'Xilonen', 'Neuvillette')
    fx.onSwap(500, 'Neuvillette', 'Xilonen')
    fx.onSwap(550, 'Xilonen', 'Neuvillette')
    fx.end(1400)
    expect(windows.filter((w) => w.owner === 'Neuvillette')).toEqual([
      {
        owner: 'Neuvillette',
        path: ['SacrificialJade', 'offField'],
        value: 'on',
        start: 300,
        end: 1150,
      },
    ])
  })

  it('does not reactivate an expired Jade buff after less than five seconds off field', () => {
    const { fx, windows } = gear(true)
    fx.onSwap(300, 'Xilonen', 'Neuvillette')
    fx.onSwap(950, 'Neuvillette', 'Xilonen')
    fx.onSwap(980, 'Xilonen', 'Neuvillette')
    fx.onSwap(1000, 'Neuvillette', 'Xilonen')
    fx.onSwap(1400, 'Xilonen', 'Neuvillette')
    fx.end(2000)
    expect(
      windows
        .filter((w) => w.owner === 'Neuvillette')
        .map((w) => [w.start, w.end])
    ).toEqual([
      [300, 900],
      [1300, 2000],
    ])
  })
})
