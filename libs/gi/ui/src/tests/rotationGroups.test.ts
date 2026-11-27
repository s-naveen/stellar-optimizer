/**
 * A group, "[Q EEE]?/[N3 N3 N3]": played only when its first Skill or Burst is ready (the rest of
 * it only after that one), the alternative instead of all of it.
 */
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import {
  everyNthBursts,
  parseRotation,
  rotationSpans,
  rotationWords,
} from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'

const yae: CharacterKey[] = ['YaeMiko']
const names = [{ characterKey: 'YaeMiko' as CharacterKey, name: 'Yae Miko' }]
const text = 'Yae Miko EEE [Q EEE]?/[N3 N3 N3] N3 N3 N3 N3 N2'

/** Each rotation's actions, as "E E E Q E E E N3 …" */
function played(rotation = parseRotation(text, names), repeats = 4) {
  const sim = simulateRotation({
    rotation,
    members: yae,
    elements: { YaeMiko: getCharEle('YaeMiko') } as never,
    constellations: {},
    repeats,
    keep: 'all',
  })
  const starts = [...(sim.rotationStarts ?? [0]), Number.POSITIVE_INFINITY]
  return starts.slice(0, -1).map((start, r) =>
    sim.actions
      .filter((a) => a.start >= start && a.start < starts[r + 1])
      .map((a) =>
        (a.frameKey ?? '').startsWith('burst')
          ? 'Q'
          : (a.frameKey ?? '').startsWith('skill')
            ? 'E'
            : 'N'
      )
      .join('')
  )
}

describe('a group of actions', () => {
  it('is parsed with its first action optional, the alternative on it, the rest tied to it', () => {
    const rotation = parseRotation(text, names)
    expect(rotation.warnings).toEqual([])
    const actions = rotation.steps[0].actions
    expect(actions.map((a) => a.kind)).toEqual([
      'skill',
      'skill',
      'skill',
      'burst',
      'skill',
      'skill',
      'skill',
      'normal',
      'normal',
      'normal',
      'normal',
      'normal',
    ])
    const lead = actions[3]
    expect(lead).toMatchObject({ optional: true })
    expect(lead.group).toBeDefined()
    expect(lead.otherwise?.map((a) => [a.kind, a.count])).toEqual([
      ['normal', 3],
      ['normal', 3],
      ['normal', 3],
    ])
    expect(actions.slice(4, 7).every((a) => a.inGroup === lead.group)).toBe(
      true
    )
    expect(actions.slice(7).every((a) => a.inGroup === undefined)).toBe(true)
  })
  it('leaves repeats, parameters and a bare bracket as they were', () => {
    const steps = (t: string) =>
      parseRotation(`Yae Miko ${t}`, names).steps[0].actions
    expect(steps('2[N1 E]').map((a) => a.kind)).toEqual([
      'normal',
      'skill',
      'normal',
      'skill',
    ])
    expect(steps('2 [N1 E]').some((a) => a.group !== undefined)).toBe(false)
    expect(steps('N3[movement=4] E').map((a) => a.kind)).toEqual([
      'normal',
      'skill',
    ])
    expect(steps('E [Q E]').some((a) => a.group !== undefined)).toBe(false)
    // (an alternative without brackets: one word)
    const word = steps('[Q E]?/N2CA N1')
    expect(word[0].otherwise?.map((a) => a.kind)).toEqual(['normal', 'charged'])
    expect(word.at(-1)).toMatchObject({ kind: 'normal', count: 1 })
  })
  it('warns when it does not start with a Skill or Burst, and plays it as written', () => {
    const rotation = parseRotation('Yae Miko [N3 E]?/[N2]', names)
    expect(rotation.warnings).toHaveLength(1)
    expect(rotation.steps[0].actions.map((a) => a.kind)).toEqual([
      'normal',
      'skill',
    ])
  })
  it('plays Q and its Skills when Q is ready, else only the alternative', () => {
    const rotations = played()
    // (Q's cooldown is longer than a rotation: it is ready every other one)
    expect(rotations.some((r) => r.startsWith('EEEQEEE'))).toBe(true)
    expect(rotations.some((r) => r.startsWith('EEENNNNNNNN'))).toBe(true)
    for (const r of rotations) {
      if (r.includes('Q')) expect(r).toBe('EEEQEEENNNNN')
      else expect(r).toBe('EEENNNNNNNN')
    }
  })
  it('without an alternative, leaves the whole group out when it is not ready', () => {
    const rotations = played(
      parseRotation('Yae Miko EEE [Q EEE]? N3 N3 N3 N3 N2', names)
    )
    for (const r of rotations)
      expect(r).toBe(r.includes('Q') ? 'EEEQEEENNNNN' : 'EEENNNNN')
  })
  it('follows a Burst every 2nd rotation (the ER calculator): the alternative in the others', () => {
    const rotation = parseRotation(
      'Yae Miko EEE [Q EEE]/[N3 N3 N3] N3 N3 N3 N3 N2',
      names
    )
    const nth = everyNthBursts(rotation, { YaeMiko: 2 })!
    expect(nth.loops).toBe(2)
    // (each played rotation is the two written ones: with Q, then with its alternative)
    for (const r of played(nth.rotation, 2))
      expect(r).toBe('EEEQEEENNNNN' + 'EEENNNNNNNN')
  })
  describe('edge cases', () => {
    const team: CharacterKey[] = ['YaeMiko', 'Fischl']
    const teamNames = [
      { characterKey: 'YaeMiko' as CharacterKey, name: 'Yae' },
      { characterKey: 'Fischl' as CharacterKey, name: 'Fischl' },
    ]
    const playTeam = (rotation: string, opener?: string) => {
      const parsed = parseRotation(rotation, teamNames)
      if (opener) parsed.opener = parseRotation(opener, teamNames).steps
      return simulateRotation({
        rotation: parsed,
        members: team,
        elements: Object.fromEntries(
          team.map((m) => [m, getCharEle(m)])
        ) as never,
        constellations: {},
        repeats: 4,
        keep: 'all',
      })
    }
    const kinds = (t: string) =>
      parseRotation(`Yae ${t}`, teamNames).steps[0].actions.map((a) =>
        a.inGroup !== undefined ? `(${a.kind})` : a.kind
      )
    it('reads repeats and parameters inside a group and its alternative', () => {
      expect(kinds('[Q 3E]?/[2[N3 CA]]')).toEqual([
        'burst',
        '(skill)',
        '(skill)',
        '(skill)',
      ])
      const lead = parseRotation('Yae [Q 3E]?/[2[N3 CA]]', teamNames).steps[0]
        .actions[0]
      expect(lead.otherwise?.map((a) => a.kind)).toEqual([
        'normal',
        'charged',
        'normal',
        'charged',
      ])
    })
    it('takes two groups in one step, a held Skill leading one, and keeps them apart', () => {
      const actions = parseRotation(
        'Yae [Q E]?/[N2] N1 [hE N2]?/[N1] CA',
        teamNames
      ).steps[0].actions
      expect(actions.map((a) => a.kind)).toEqual([
        'burst',
        'skill',
        'normal',
        'skill',
        'normal',
        'charged',
      ])
      expect(actions[3]).toMatchObject({ hold: true, optional: true })
      expect(actions[0].group).not.toBe(actions[3].group)
      expect(actions[1].inGroup).toBe(actions[0].group)
      expect(actions[4].inGroup).toBe(actions[3].group)
      expect(actions[2].inGroup).toBeUndefined()
      expect(actions[5].inGroup).toBeUndefined()
    })
    it('never throws on a group being typed, and plays what it can', () => {
      for (const t of [
        '[',
        '[Q',
        '[Q EEE',
        '[Q EEE]',
        '[Q EEE]?',
        '[Q EEE]?/',
        '[Q EEE]?/[',
        '[Q EEE]?/[N3 N3',
        '[]?',
        '[ ]?/[N1]',
        ']?/[N1]',
      ]) {
        expect(() => parseRotation(`Yae E ${t} N1`, teamNames)).not.toThrow()
        expect(() => rotationSpans(`Yae E ${t} N1`, teamNames)).not.toThrow()
        expect(() => playTeam(`Yae E ${t} N1 -> Fischl E`)).not.toThrow()
      }
    })
    it('marks a whole group as an action in the writer, a broken one as unknown', () => {
      const text = 'Yae EEE [Q EEE]?/[N3 N3 N3] N2'
      const spans = rotationSpans(text, teamNames).filter(
        (s) => s.kind !== 'member'
      )
      expect(spans.every((s) => s.kind === 'action')).toBe(true)
      expect(
        rotationSpans('Yae [Q EEE N2', teamNames).some(
          (s) => s.kind === 'unknown'
        )
      ).toBe(true)
    })
    it('stays one word for a rotation search, and reads back the same', () => {
      const text = 'Yae EEE [Q EEE]?/[N3 N3 N3] N2 -> Fischl E'
      const [step] = rotationWords(text, teamNames)
      expect(step.words).toEqual(['E', 'E', 'E', '[Q EEE]?/[N3 N3 N3]', 'N2'])
    })
    it('plays in the opener, and before a swap: the alternative goes on to the next member', () => {
      const sim = playTeam(
        'Yae EEE [Q EEE]?/[N3 N3 N3] -> Fischl E N2',
        'Yae [Q EEE]?/[N1]'
      )
      expect(sim.warnings).toEqual([])
      // (each rotation: Fischl's Skill after Yae, the swap right after her group or alternative)
      const fischl = sim.actions.filter(
        (a) =>
          a.characterKey === 'Fischl' && (a.frameKey ?? '').startsWith('skill')
      )
      expect(fischl.length).toBeGreaterThanOrEqual(4)
      const yaeQ = sim.actions.filter(
        (a) =>
          a.characterKey === 'YaeMiko' && (a.frameKey ?? '').startsWith('burst')
      )
      expect(yaeQ.length).toBeGreaterThanOrEqual(2)
    })
    it('without its Burst (Burst scenarios, "Unused"): the alternative, and the group left out', () => {
      const parsed = parseRotation('Yae EEE [Q EEE]?/[N3 N3 N3] N2', teamNames)
      // (as writtenRotation strips a member's Bursts)
      parsed.steps = parsed.steps.map((step) => ({
        ...step,
        actions: step.actions
          .flatMap((a) => (a.kind === 'burst' ? (a.otherwise ?? []) : [a]))
          .map((a) => ({ ...a, optional: true })),
      }))
      const sim = simulateRotation({
        rotation: parsed,
        members: ['YaeMiko'],
        elements: { YaeMiko: getCharEle('YaeMiko') } as never,
        constellations: {},
        repeats: 2,
        keep: 'all',
      })
      const yae = sim.actions.map((a) =>
        (a.frameKey ?? '').startsWith('skill')
          ? 'E'
          : (a.frameKey ?? '').startsWith('burst')
            ? 'Q'
            : 'N'
      )
      expect(yae.includes('Q')).toBe(false)
      // (per rotation: its three Skills, then the three N3 and N2; never six Skills)
      expect(yae.filter((k) => k === 'E').length).toBeLessThanOrEqual(6)
    })
  })
})
