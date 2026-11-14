import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const members: CharacterKey[] = ['Zibai', 'Linnea', 'Columbina', 'Illuga']
const rotation = parseRotation(
  'bina EQ -> illuga EQ -> linnea E -> Zibai E N1 E N4 W1 E N4 Q E N2 E -> bina',
  members.map((characterKey) => ({ characterKey, name: characterKey }))
)
const run = (frameOverrides?: Record<number, number>, swapFrames?: number) =>
  simulateRotation({
    rotation,
    members,
    constellations: { Zibai: 1, Columbina: 0, Linnea: 2, Illuga: 6 },
    elements: {
      Zibai: 'geo',
      Linnea: 'geo',
      Columbina: 'hydro',
      Illuga: 'geo',
    },
    frameOverrides,
    swapFrames,
  })

describe('edited rotation timing', () => {
  const base = run()
  // positions in the written rotation: bina E Q, illuga E Q, linnea E, Zibai E N1 E N4 W1 …
  const n1 = 6
  const wait = 9

  it('records each written action with its position and default frames', () => {
    const recorded = [...base.actions, ...(base.waits ?? [])]
      .filter((a) => a.index !== undefined)
      .sort((x, y) => x.index! - y.index!)
    // every written action once, in order (the kept loop)
    expect(recorded.map((a) => a.index)).toEqual(
      Array.from({ length: 16 }, (_, i) => i)
    )
    const w = base.waits!.find((a) => a.index === wait)!
    expect(w.frames).toBe(60)
    expect(w.defaultFrames).toBe(60)
  })

  it('uses an edited frame count and shifts what follows', () => {
    const edited = run({ [n1]: 60 })
    const before = base.actions.find((a) => a.index === n1)!
    const after = edited.actions.find((a) => a.index === n1)!
    expect(after.frames).toBe(60)
    expect(after.defaultFrames).toBe(before.frames)
    const nextBefore = base.actions.find((a) => a.index === n1 + 1)!
    const nextAfter = edited.actions.find((a) => a.index === n1 + 1)!
    expect(nextAfter.start - after.start).toBe(60)
    expect(nextBefore.start - before.start).toBe(before.frames)
  })

  it('lengthens the rotation by an edited wait', () => {
    // (at least: a cooldown or resource the next actions wait on can move with it)
    expect(run({ [wait]: 90 }).frames).toBeGreaterThanOrEqual(base.frames + 30)
  })

  it('applies the swap time to every swap', () => {
    const swaps = base.actions.filter(
      (a, i) => i > 0 && a.characterKey !== base.actions[i - 1].characterKey
    ).length
    expect(swaps).toBeGreaterThan(0)
    expect(run(undefined, 12).frames).toBe(base.frames)
    // (a few frames can vanish into a cooldown wait; a long swap cannot)
    expect(run(undefined, 120).frames).toBeGreaterThan(base.frames)
  })

  it('is unchanged when the edit equals the default', () => {
    const before = base.actions.find((a) => a.index === n1)!
    expect(run({ [n1]: before.frames }).frames).toBe(base.frames)
  })
})

describe('character frame data', () => {
  const base = run()
  const zibaiSkills = base.actions.filter(
    (a) => a.characterKey === 'Zibai' && a.text === 'E'
  ).length
  it('applies a character action edit everywhere it is used', () => {
    const sim = simulateRotation({
      rotation,
      members,
      constellations: { Zibai: 1, Columbina: 0, Linnea: 2, Illuga: 6 },
      elements: {
        Zibai: 'geo',
        Linnea: 'geo',
        Columbina: 'hydro',
        Illuga: 'geo',
      },
      frameData: { Zibai: { skill: { frames: 120, framesInto: {} } } },
    })
    const after = sim.actions.filter(
      (a) => a.characterKey === 'Zibai' && a.text === 'E'
    )
    expect(after.length).toBe(zibaiSkills)
    // every use of it got longer (each use shifts from its own default)
    const before = base.actions.filter(
      (a) => a.characterKey === 'Zibai' && a.text === 'E'
    )
    const sum = (l: typeof before) => l.reduce((n, a) => n + a.frames, 0)
    expect(sum(after)).toBeGreaterThan(sum(before))
    expect(sim.frames).toBeGreaterThan(base.frames)
  })
  it('uses an edited cancel into the next action', () => {
    const into = base.actionData!.Zibai!.skill!.framesInto
    const sim = simulateRotation({
      rotation,
      members,
      constellations: { Zibai: 1, Columbina: 0, Linnea: 2, Illuga: 6 },
      elements: {
        Zibai: 'geo',
        Linnea: 'geo',
        Columbina: 'hydro',
        Illuga: 'geo',
      },
      frameData: {
        Zibai: {
          skill: {
            framesInto: Object.fromEntries(
              Object.keys({ ...into, normal: 0 }).map((k) => [k, 200])
            ),
          },
        },
      },
    })
    const skill = sim.actions.find(
      (a) => a.characterKey === 'Zibai' && a.text === 'E'
    )!
    expect(skill.frames).toBe(200)
    expect(sim.frames).toBeGreaterThan(base.frames)
  })
  it('adds ping to every action', () => {
    const sim = simulateRotation({
      rotation,
      members,
      constellations: { Zibai: 1, Columbina: 0, Linnea: 2, Illuga: 6 },
      elements: {
        Zibai: 'geo',
        Linnea: 'geo',
        Columbina: 'hydro',
        Illuga: 'geo',
      },
      pingFrames: 4,
    })
    const a = sim.actions.find((x) => x.index === 6)!
    const b = base.actions.find((x) => x.index === 6)!
    expect(a.frames).toBe(b.frames + 4)
  })
})
