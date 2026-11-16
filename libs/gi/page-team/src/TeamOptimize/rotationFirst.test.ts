// @vitest-environment jsdom
/**
 * The writer can count the first few rotations from the start instead of the repeating pace (a
 * user request: is skipping a Burst better in a timed challenge's first rotation?). With every
 * cooldown ready at the start, nothing waits; the time and hits are per rotation of those played;
 * KQM's replay counts the same rotations.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { teamOptMembers } from '@genshin-optimizer/gi/ui'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { firstRotations } from './RotationTiming'
import {
  kqmRotationReplay,
  simulateWritten,
  writtenSeconds,
  writtenWaits,
} from './RotationWriter'

const MEMBERS: CharacterKey[] = ['Sucrose', 'Bennett']
// (two Skills a rotation: free the first time through, then each waits for a 15 s charge)
const TEXT = 'Sucrose E -> Bennett N1 N1 -> Sucrose E -> Bennett N1'

const stored = new Map<string, string>()
const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
beforeAll(() => {
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => stored.get(k) ?? null,
      setItem: (k: string, v: string) => stored.set(k, String(v)),
      removeItem: (k: string) => stored.delete(k),
      clear: () => stored.clear(),
      key: (i: number) => [...stored.keys()][i] ?? null,
      get length() {
        return stored.size
      },
    },
  })
})
afterAll(() => {
  if (original) Object.defineProperty(globalThis, 'localStorage', original)
})

function setup() {
  const database = new ArtCharDatabase(1, new SandboxStorage({}))
  for (const key of MEMBERS)
    database.chars.set(key, {
      key,
      level: 90,
      ascension: 6,
      talent: { auto: 9, skill: 9, burst: 9 },
      constellation: key === 'Sucrose' ? 1 : 6,
    })
  const ids = MEMBERS.map((k) => database.teamChars.new(k))
  const teamId = database.teams.new({
    loadoutData: ids.map((teamCharId) => ({ teamCharId })) as LoadoutDatum[],
  })
  const members = teamOptMembers(database, teamId)
  const names = members.map(({ characterKey }) => ({
    characterKey,
    name: characterKey,
  }))
  return { database, teamId, members, names }
}

describe('the first rotations from the start', () => {
  const { database, teamId, members, names } = setup()
  const play = (rotations?: number) =>
    simulateWritten({
      text: TEXT,
      opener: '',
      timing: { edits: {}, ...(rotations && { rotations }) },
      frameData: {},
      team: {
        members: MEMBERS,
        constellations: { Sucrose: 1, Bennett: 6 },
        elements: Object.fromEntries(
          MEMBERS.map((m) => [m, getCharEle(m)])
        ) as never,
        gear: {},
      },
      names,
      members,
      database: database as never,
      teamId,
      gender: 'F',
      openerWarning: (w) => w,
    })!
  it('plays the first rotation with every cooldown ready (nothing waits)', () => {
    const repeating = play()
    const first = play(1)
    const perRotation = (r: typeof first) =>
      r.counted!.sim.frames / r.counted!.rotations
    // (the repeating pace waits for the charges: about 30 s; the first rotation runs freely)
    expect(perRotation(repeating) / 60).toBeGreaterThan(25)
    expect(perRotation(first) / 60).toBeLessThan(10)
    expect(first.counted!.rotations).toBe(1)
    expect(Object.keys(first.counted!.sim.stalls ?? {})).toEqual([])
  })
  it('counts the hits per rotation of those played', () => {
    const one = play(1)
    const two = play(2)
    const hits = (r: typeof one) =>
      Object.values(r.attacks ?? {}).reduce(
        (n, a) => n + (a ?? []).reduce((m, x) => m + (x.hits ?? 1), 0),
        0
      )
    expect(two.counted!.rotations).toBe(2)
    // (the second rotation waits for a charge but deals the same hits)
    expect(hits(two)).toBeCloseTo(hits(one), 5)
    // the timeline shows all of them
    expect(two.sim!.rotationStarts!.length).toBe(2)
  })
  it('counts up to 6 rotations (more is read as 6)', () => {
    expect(play(6).counted!.rotations).toBe(6)
    expect(play(6).sim!.rotationStarts!.length).toBe(6)
    expect(firstRotations({ edits: {}, rotations: 9 })).toBe(6)
    expect(firstRotations({ edits: {} })).toBeUndefined()
  })
  it('KQM’s replay counts the same rotations', () => {
    localStorage.setItem(`teamOptRotationText_${teamId}`, TEXT)
    localStorage.setItem(
      `teamOptRotationTiming_${teamId}`,
      JSON.stringify({ edits: {}, rotations: 1 })
    )
    const replay = kqmRotationReplay({
      database: database as never,
      teamId,
      members,
      gender: 'F',
      names,
      teamOpt: initTeamOpt(),
    })!
    const played = replay({
      constellations: { Sucrose: 1, Bennett: 6 },
      gear: {},
      overrides: {},
    } as never)
    expect(played.rotationTime).toBeLessThan(10)
    expect(played.stalls).toEqual([])
  })
})

/**
 * A user report: the first rotation written apart ("First rotation only") was played before the
 * rotations counted from the start, so First 1 counted the repeating rotation instead (its time,
 * none of the opener's hits). Counted from the start, the opener is the first rotation.
 */
describe('the first rotation written apart, counted from the start', () => {
  const { database, teamId, members, names } = setup()
  // (the opener differs from the rotation: Bursts the rotation does not use)
  const OPENER = 'Sucrose E Q -> Bennett E Q N1'
  const play = (rotations: number | undefined, opener = OPENER, text = TEXT) =>
    simulateWritten({
      text,
      opener,
      timing: { edits: {}, ...(rotations && { rotations }) },
      frameData: {},
      team: {
        members: MEMBERS,
        constellations: { Sucrose: 1, Bennett: 6 },
        elements: Object.fromEntries(
          MEMBERS.map((m) => [m, getCharEle(m)])
        ) as never,
        gear: {},
      },
      names,
      members,
      database: database as never,
      teamId,
      gender: 'F',
      openerWarning: (w) => w,
    })!
  const hits = (r: ReturnType<typeof play>) =>
    Object.values(r.attacks ?? {}).reduce(
      (n, a) => n + (a ?? []).reduce((m, x) => m + (x.hits ?? 1), 0),
      0
    )
  const written = (r: ReturnType<typeof play>) =>
    r.counted!.sim.actions.filter((a) => a.text !== 'Entry')
  it('First 1 is the opener alone: its time and hits, from the start', () => {
    const first = play(1)
    // (the opener played as the rotation itself)
    const alone = play(1, '', OPENER)
    expect(first.counted!.rotations).toBe(1)
    expect(first.counted!.sim.start).toBe(0)
    expect(written(first).map((a) => a.text)).toEqual(
      written(alone).map((a) => a.text)
    )
    expect(written(first).every((a) => a.openerIndex !== undefined)).toBe(true)
    expect(written(first).some((a) => a.index !== undefined)).toBe(false)
    expect(first.counted!.sim.frames).toBe(alone.counted!.sim.frames)
    expect(hits(first)).toBeCloseTo(hits(alone), 5)
    expect(writtenSeconds(first)).toBeCloseTo(writtenSeconds(alone)!, 5)
    // (it differs from what the rotation alone gives)
    expect(hits(first)).not.toBeCloseTo(hits(play(1, '')), 1)
  })
  it('First N: the opener, then the rotation N - 1 times, averaged over N', () => {
    const two = play(2)
    expect(two.counted!.rotations).toBe(2)
    expect(two.sim!.rotationStarts!.length).toBe(2)
    const [, second] = two.sim!.rotationStarts!
    const acts = written(two)
    expect(
      acts
        .filter((a) => a.start < second)
        .every((a) => a.openerIndex !== undefined)
    ).toBe(true)
    expect(
      acts.filter((a) => a.start >= second).every((a) => a.index !== undefined)
    ).toBe(true)
    // (both rotations' hits, per rotation: at least the opener's and the rotation's own, with
    // what the opener leaves ticking into the second, Sucrose's Burst)
    const opener = hits(play(1))
    const rotation = hits(play(1, ''))
    expect(hits(two) * 2).toBeGreaterThanOrEqual(opener + rotation - 1e-6)
    // (the first time through is the opener: no "without waiting" comparison)
    expect(writtenWaits(two)).toBeUndefined()
  })
  it('repeating, the opener still only sets up the loop (not counted)', () => {
    const repeating = play(undefined)
    expect(
      repeating.counted!.sim.actions.some((a) => a.openerIndex !== undefined)
    ).toBe(false)
    // (the same as before: the steady pace of the rotation)
    expect(hits(repeating)).toBeCloseTo(hits(play(undefined, '')), 1)
  })
  it('KQM’s replay counts the opener the same way', () => {
    localStorage.setItem(`teamOptRotationText_${teamId}`, TEXT)
    localStorage.setItem(`teamOptRotationOpener_${teamId}`, OPENER)
    localStorage.setItem(
      `teamOptRotationTiming_${teamId}`,
      JSON.stringify({ edits: {}, rotations: 1 })
    )
    const replay = kqmRotationReplay({
      database: database as never,
      teamId,
      members,
      gender: 'F',
      names,
      teamOpt: initTeamOpt(),
    })!
    const played = replay({
      constellations: { Sucrose: 1, Bennett: 6 },
      gear: {},
      overrides: {},
    } as never)
    expect(played.rotationTime).toBeCloseTo(writtenSeconds(play(1))!, 1)
    localStorage.removeItem(`teamOptRotationOpener_${teamId}`)
  })
})
