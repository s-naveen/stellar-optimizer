import type { TeamOptAttack, TeamOptTimedBuff } from '@genshin-optimizer/gi/db'
import { initTeamOpt } from '@genshin-optimizer/gi/db'
import {
  acceptedActivations,
  buffActivations,
  buffSources,
  buffWindows,
  hitTimes,
  mergeIntervals,
  timelineLength,
  timelineSegments,
  timelineWindows,
} from '../util/teamOpt/timeline'

const at = (start: number, end = start) => ({ start, end })
const attack = (
  path: string[],
  hits: number,
  time?: { start: number; end: number },
  extra: Partial<TeamOptAttack> = {}
): TeamOptAttack => ({
  path,
  hits,
  hitMode: 'avgHit',
  ...(time ? { at: time } : {}),
  ...extra,
})
const buff = (b: Partial<TeamOptTimedBuff>): TeamOptTimedBuff => ({
  owner: 'Bennett',
  path: ['Bennett', 'burst'],
  trigger: 'burst',
  duration: 12,
  ...b,
})
const ref = (path: string[]) => ({ owner: 'Bennett' as const, path })

describe('team optimize timeline', () => {
  it('spreads an attack’s hits over its span', () => {
    expect(hitTimes(at(2, 4), 4)).toEqual([2.25, 2.75, 3.25, 3.75])
    expect(hitTimes(at(5), 3)).toEqual([5])
  })

  it('merges overlapping windows', () => {
    expect(
      mergeIntervals([
        [5, 8],
        [0, 2],
        [7, 10],
        [10, 11],
        [3, 3],
      ])
    ).toEqual([
      [0, 2],
      [5, 11],
    ])
  })

  it('opens a window at each of its owner’s casts, minding the cooldown', () => {
    const attacks = {
      Bennett: [
        attack(['burst', 'dmg'], 1, at(1)),
        attack(['skill', 'press'], 1, at(2)),
        attack(['burst', 'dmg'], 1, at(10)),
        attack(['burst', 'dmg'], 1, at(25)),
      ],
      Xiangling: [attack(['burst', 'dmg'], 1, at(3))],
    }
    expect(buffActivations(buff({}), attacks)).toEqual([1, 10, 25])
    // a cooldown of 15 s: the burst at 10 s does not count
    expect(buffWindows(buff({ cooldown: 15 }), attacks)).toEqual([
      [1, 13],
      [25, 37],
    ])
    // without: the one at 10 s refreshes it
    expect(buffWindows(buff({}), attacks)).toEqual([
      [1, 22],
      [25, 37],
    ])
    // a cast without damage counts too
    expect(
      buffActivations(buff({ trigger: 'skill' }), attacks, [
        { member: 'Bennett', kind: 'skill', at: 7 },
      ])
    ).toEqual([2, 7])
  })

  it('continues a window past the rotation’s end at its start', () => {
    const attacks = { Bennett: [attack(['burst', 'dmg'], 1, at(15))] }
    expect(buffWindows(buff({}), attacks, [], 20)).toEqual([
      [0, 7],
      [15, 20],
    ])
  })

  it('refreshes a reaction buff at each reacting hit', () => {
    const attacks = {
      Bennett: [
        attack(['normal', '0'], 4, at(0, 8), { reaction: 'vaporize' }),
        attack(['normal', '1'], 4, at(20, 22)),
      ],
    }
    // hits at 1, 3, 5, 7 s refresh an 8 s buff: up from 1 s to 15 s; the plain hits do nothing
    expect(
      buffWindows(buff({ trigger: 'reaction', duration: 8 }), attacks)
    ).toEqual([[1, 15]])
  })

  it('splits an attack’s hits by the buffs up during them', () => {
    const a = ref(['a']),
      b = ref(['b'])
    const segs = timelineSegments(attack(['normal', '0'], 10, at(0, 10)), [
      { ref: a, intervals: [[0, 4]] },
      { ref: b, intervals: [[6, 20]] },
    ])
    expect(segs).toEqual([
      { hits: 4, excluded: [b] },
      { hits: 2, excluded: [a, b] },
      { hits: 4, excluded: [a] },
    ])
    // all at once: the buffs up at that moment
    expect(
      timelineSegments(attack(['burst', 'dmg'], 3, at(5)), [
        { ref: a, intervals: [[0, 4]] },
        { ref: b, intervals: [[5, 6]] },
      ])
    ).toEqual([{ hits: 3, excluded: [a] }])
    // covered all along: one group, nothing off
    expect(
      timelineSegments(attack(['burst', 'dmg'], 3, at(1, 2)), [
        { ref: a, intervals: [[0, 4]] },
      ])
    ).toEqual([{ hits: 3, excluded: [] }])
  })

  it('combines an attack’s own limit with the buff’s windows', () => {
    const a = ref(['a'])
    // limited to its first 5 of 10 hits (0-5 s), and up from 3 s: hits in 3-5 s only
    const segs = timelineSegments(
      attack(['normal', '0'], 10, at(0, 10), {
        limits: [{ owner: 'Bennett', path: ['a'], hits: 5 }],
      }),
      [{ ref: a, intervals: [[3, 20]] }]
    )
    expect(segs).toEqual([
      { hits: 8, excluded: [{ owner: 'Bennett', path: ['a'] }] },
      { hits: 2, excluded: [] },
    ])
  })
  it('refreshes a skill-hit buff on each of the skill’s hits, a skill buff on its cast only', () => {
    // a skill whose 4 hits run from 0 to 8 s
    const attacks = { Bennett: [attack(['skill', 'field'], 4, at(0, 8))] }
    expect(
      buffActivations(buff({ trigger: 'skillHit', duration: 3 }), attacks)
    ).toEqual([1, 3, 5, 7])
    expect(
      buffWindows(buff({ trigger: 'skillHit', duration: 3 }), attacks)
    ).toEqual([[1, 10]])
    expect(
      buffWindows(buff({ trigger: 'skill', duration: 3 }), attacks)
    ).toEqual([[0, 3]])
    // a burst's hits do not start it
    expect(
      buffActivations(buff({ trigger: 'skillHit' }), {
        Bennett: [attack(['burst', 'dmg'], 3, at(0, 3))],
      })
    ).toEqual([])
  })
  it('takes the attacks the user chose as what starts a buff, any member’s', () => {
    // Instructor on Sucrose, started by Citlali's off-field hits as the user says
    const attacks = {
      Sucrose: [attack(['skill', 'press'], 1, at(0, 0.8))],
      Citlali: [attack(['skill', 'frostfallStormDmg'], 4, at(2, 10))],
    }
    const instructor = buff({
      owner: 'Sucrose',
      path: ['Instructor', 'set4'],
      trigger: 'reaction',
      duration: 8,
    })
    // automatic: nothing of Sucrose's reacts
    expect(buffSources(instructor, attacks)).toEqual([])
    const chosen = {
      ...instructor,
      startedBy: [
        { member: 'Citlali' as const, path: ['skill', 'frostfallStormDmg'] },
      ],
    }
    expect(buffSources(chosen, attacks)).toEqual([
      { member: 'Citlali', index: 0 },
    ])
    // each of its hits starts it
    expect(buffActivations(chosen, attacks)).toEqual([3, 5, 7, 9])
    expect(buffWindows(chosen, attacks)).toEqual([[3, 17]])
    // nothing chosen: never up
    expect(buffActivations({ ...instructor, startedBy: [] }, attacks)).toEqual(
      []
    )
    // a cast trigger: their start
    expect(buffActivations({ ...chosen, trigger: 'burst' }, attacks)).toEqual([
      2,
    ])
  })

  it('ignores activations within the cooldown', () => {
    const attacks = { Bennett: [attack(['normal', '0'], 4, at(0, 8))] }
    const b = buff({ trigger: 'hit', duration: 3, cooldown: 5 })
    expect(buffActivations(b, attacks)).toEqual([1, 3, 5, 7])
    expect(acceptedActivations(b, attacks)).toEqual([1, 7])
  })
  it('repeats at the rotation time, the default one when none is set', () => {
    const teamOpt = {
      ...initTeamOpt(),
      attacks: { Bennett: [attack(['burst', 'dmg'], 1, at(15))] },
      timeline: { on: true, buffs: [buff({ duration: 12 })] },
    }
    expect(timelineLength(teamOpt)).toBe(20)
    // 15 s + 12 s: up to the end, then 7 s from the start of the next rotation
    expect(timelineWindows(teamOpt)[0].intervals).toEqual([
      [0, 7],
      [15, 20],
    ])
    expect(timelineLength({ rotationTime: 30 })).toBe(30)
  })
})
