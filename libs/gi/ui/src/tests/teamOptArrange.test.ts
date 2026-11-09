import type { TeamOptAttack } from '@genshin-optimizer/gi/db'
import { arrangeTimeline, runsOn } from '../util/teamOpt/arrange'

const attack = (
  path: string[],
  hits: number,
  at?: { start: number; end: number }
): TeamOptAttack => ({ path, hits, hitMode: 'avgHit', ...(at ? { at } : {}) })

describe('team optimize timeline arrangement', () => {
  it('lays each member’s actions after the last, fields running on from the cast', () => {
    const out = arrangeTimeline(['Bennett', 'Xiangling'], {
      Bennett: [attack(['skill', 'press'], 1), attack(['burst', 'dmg'], 1)],
      Xiangling: [
        attack(['burst', 'dmg'], 1),
        attack(['burst', 'pyronadoDmg'], 12),
        attack(['normal', '0'], 4),
      ],
    })
    expect(out.Bennett?.map((a) => a.at)).toEqual([
      { start: 0, end: 0.8 },
      { start: 0.8, end: 2.4 },
    ])
    expect(out.Xiangling?.map((a) => a.at)).toEqual([
      { start: 2.4, end: 4 },
      // a burst with many hits runs on from her first cast
      { start: 2.4, end: 12.4 },
      { start: 4, end: 5.8 },
    ])
    expect(runsOn(attack(['burst', 'pyronadoDmg'], 12))).toBe(true)
    expect(runsOn(attack(['normal', '0'], 12))).toBe(false)
  })

  it('squeezes on-field time into the rotation, and never runs past its end', () => {
    const out = arrangeTimeline(
      ['Bennett'],
      {
        Bennett: [
          attack(['normal', '0'], 20),
          attack(['burst', 'fieldDmg'], 10),
        ],
      },
      { length: 6 }
    )
    for (const a of out.Bennett ?? []) {
      expect(a.at!.start).toBeGreaterThanOrEqual(0)
      expect(a.at!.end).toBeLessThanOrEqual(6)
      expect(a.at!.end).toBeGreaterThanOrEqual(a.at!.start)
    }
  })

  it('only fills in what has no time yet, after what is placed', () => {
    const out = arrangeTimeline(
      ['Bennett'],
      {
        Bennett: [
          attack(['skill', 'press'], 1, { start: 3, end: 4 }),
          attack(['burst', 'dmg'], 1),
        ],
      },
      { only: 'untimed' }
    )
    expect(out.Bennett?.[0].at).toEqual({ start: 3, end: 4 })
    expect(out.Bennett?.[1].at).toEqual({ start: 4, end: 5.6 })
  })
  it('puts the supports first and the member who stays on the field last', () => {
    const attacks = {
      Sandrone: [attack(['charged', 'dmg'], 10), attack(['skill', 'dmg'], 1)],
      Bennett: [attack(['burst', 'dmg'], 1), attack(['skill', 'press'], 1)],
    }
    const out = arrangeTimeline(['Sandrone', 'Bennett'], attacks)
    // Bennett's casts first, in his list's order
    expect(out.Bennett?.map((a) => a.at)).toEqual([
      { start: 0, end: 1.6 },
      { start: 1.6, end: 2.4 },
    ])
    // then Sandrone: her skill before her Charged Attacks
    expect(out.Sandrone?.[1].at).toEqual({ start: 2.4, end: 3.2 })
    expect(out.Sandrone?.[0].at).toEqual({ start: 3.2, end: 13.2 })
    // the member on the field can be given
    const given = arrangeTimeline(['Sandrone', 'Bennett'], attacks, {
      carry: 'Bennett',
    })
    expect(given.Sandrone?.[1].at?.start).toBe(0)
    expect(given.Bennett?.[0].at?.start).toBe(10.8)
  })

  it('runs a field from its own kind of cast, already placed or not', () => {
    const out = arrangeTimeline(
      ['Xiangling'],
      {
        Xiangling: [
          attack(['skill', 'press'], 1, { start: 0, end: 0.8 }),
          attack(['burst', 'dmg'], 1, { start: 5, end: 6.6 }),
          attack(['burst', 'pyronadoDmg'], 12),
          attack(['skill', 'guobaDmg'], 4),
        ],
      },
      { only: 'untimed' }
    )
    expect(out.Xiangling?.[2].at).toEqual({ start: 5, end: 15 })
    expect(out.Xiangling?.[3].at).toEqual({ start: 0, end: 8 })
  })

  it('fills a full rotation at its end, without going past it', () => {
    const out = arrangeTimeline(
      ['Bennett'],
      {
        Bennett: [
          attack(['normal', '0'], 1, { start: 0, end: 10 }),
          attack(['burst', 'dmg'], 1),
        ],
      },
      { only: 'untimed', length: 10 }
    )
    expect(out.Bennett?.[1].at).toEqual({ start: 8.4, end: 10 })
  })
  it('casts a skill or burst once: its ticks and add-ons, and reactions, run alongside', () => {
    const out = arrangeTimeline(['Sucrose'], {
      Sucrose: [
        attack(['skill', 'press'], 1),
        attack(['burst', 'dot'], 2),
        attack(['burst', 'electro'], 2),
        attack(['reaction', 'pyroSwirl'], 2),
      ],
    })
    // on the field: the skill, then the burst's cast (its first attack)
    expect(out.Sucrose?.[0].at).toEqual({ start: 0, end: 0.8 })
    expect(out.Sucrose?.[1].at).toEqual({ start: 0.8, end: 2.4 })
    // the burst's add-on runs from its cast; the swirl comes with the first cast
    expect(out.Sucrose?.[2].at).toEqual({ start: 0.8, end: 10.8 })
    expect(out.Sucrose?.[3].at).toEqual({ start: 0, end: 0.5 })
  })
})
