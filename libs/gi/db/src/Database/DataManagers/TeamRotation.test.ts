import type { TeamOpt } from './TeamOpt'
import { initTeamOpt, initTeamOptAttack } from './TeamOpt'
import {
  applyTeamRotation,
  parseTeamRotation,
  TEAM_ROTATION_TYPE,
  teamRotationExport,
} from './TeamRotation'

function teamOpt(): TeamOpt {
  return {
    ...initTeamOpt(),
    attacks: {
      Mitya: [
        { ...initTeamOptAttack(['skill', 'dmg'], 1), reaction: 'aggravate' },
        {
          ...initTeamOptAttack(['burst', 'dmg'], 12),
          hitMode: 'critHit',
          onField: 'Odette',
          bonusStats: { atk_: 20 },
          limits: [{ owner: 'Odette', path: ['Odette', 'buff'], hits: 3 }],
          states: [{ owner: 'team', path: ['resonance', 'x'], value: 'on' }],
          description: 'burst',
        },
      ],
      Valeriy: [],
      Odette: [initTeamOptAttack(['normal', '0'], 2.5)],
      // a former member's attacks: not part of the team's rotation
      Bennett: [initTeamOptAttack(['burst', 'dmg'])],
    },
    keep: ['Valeriy'],
    rotationTime: 21,
    onField: 'Odette',
    bonusStats: { team: { atk_: 10 } },
  }
}
const members = ['Mitya', 'Valeriy', 'Sucrose', 'Odette'] as const

describe('team rotation export/import', () => {
  it('exports only the rotation, of the current members that have attacks', () => {
    const out = teamRotationExport(teamOpt(), members)
    expect(out.type).toBe(TEAM_ROTATION_TYPE)
    expect(Object.keys(out.attacks)).toEqual(['Mitya', 'Odette'])
    expect(out.rotationTime).toBe(21)
    expect(out.onField).toBe('Odette')
    // no other Team Optimize settings
    expect(Object.keys(out).sort()).toEqual(
      ['attacks', 'onField', 'rotationTime', 'type', 'version'].sort()
    )
  })

  it('round-trips through JSON text unchanged', () => {
    const out = teamRotationExport(teamOpt(), members)
    expect(parseTeamRotation(JSON.stringify(out))).toEqual(out)
  })

  it('refuses what is not a rotation export', () => {
    expect(parseTeamRotation('not json')).toBeUndefined()
    expect(parseTeamRotation('[]')).toBeUndefined()
    expect(parseTeamRotation('{"attacks":{}}')).toBeUndefined()
    // a multi-target export pasted by mistake
    expect(
      parseTeamRotation(
        JSON.stringify({ name: 'x', targets: [{ path: ['a'], weight: 1 }] })
      )
    ).toBeUndefined()
  })

  it('cleans what it imports like a saved rotation', () => {
    const parsed = parseTeamRotation({
      type: TEAM_ROTATION_TYPE,
      version: 1,
      attacks: {
        Mitya: [
          { path: ['skill', 'dmg'], hits: 2, hitMode: 'nope', extra: 1 },
          { hits: 1 }, // no path: dropped
        ],
        NotACharacter: [{ path: ['a'], hits: 1 }],
      },
      rotationTime: -5,
      onField: 'NotACharacter',
    })
    expect(parsed).toEqual({
      type: TEAM_ROTATION_TYPE,
      version: 1,
      attacks: {
        Mitya: [{ path: ['skill', 'dmg'], hits: 2, hitMode: 'avgHit' }],
      },
    })
  })

  it('imports into the members it has, keeping the others', () => {
    const rotation = teamRotationExport(teamOpt(), members)
    const target: TeamOpt = {
      ...initTeamOpt(),
      attacks: {
        Mitya: [initTeamOptAttack(['old'])],
        Sucrose: [initTeamOptAttack(['skill', 'dmg'])],
      },
      rotationTime: 15,
    }
    // a team without Odette: her attacks and her being on the field are skipped
    const applied = applyTeamRotation(target, rotation, [
      'Sucrose',
      'Mitya',
      'Xilonen',
    ])
    expect(applied).toEqual(['Mitya'])
    expect(target.attacks.Mitya).toEqual(rotation.attacks.Mitya)
    expect(target.attacks.Sucrose).toEqual([
      initTeamOptAttack(['skill', 'dmg']),
    ])
    expect(target.attacks.Odette).toBeUndefined()
    expect(target.rotationTime).toBe(21)
    expect(target.onField).toBeUndefined()
    // a copy: editing the team later does not change the pasted rotation
    target.attacks.Mitya![0].hits = 99
    expect(rotation.attacks.Mitya![0].hits).toBe(1)
  })

  it('sets who is on the field (the first member: the default)', () => {
    const rotation = teamRotationExport(teamOpt(), members)
    const a = initTeamOpt()
    applyTeamRotation(a, rotation, ['Mitya', 'Odette'])
    expect(a.onField).toBe('Odette')
    const b: TeamOpt = { ...initTeamOpt(), onField: 'Mitya' }
    applyTeamRotation(b, rotation, ['Odette', 'Mitya'])
    expect(b.onField).toBeUndefined()
  })
})
