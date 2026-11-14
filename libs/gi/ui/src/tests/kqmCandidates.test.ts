/**
 * KQM's search judges every set and weapon with the effects the rotation plays for it, not only
 * the ones already worn: the replay plays the members' candidates' buff windows
 * (`SimGear.candidates`), each problem keeps only the ones a build in it can have, and a one-copy
 * weapon goes to one member at most.
 */
import { SandboxStorage } from '@genshin-optimizer/common/database'
import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { allWeaponKeys } from '@genshin-optimizer/gi/consts'
import type { LoadoutDatum, TeamOpt } from '@genshin-optimizer/gi/db'
import { ArtCharDatabase, initTeamOpt } from '@genshin-optimizer/gi/db'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import type { KqmBuild } from '../'
import { KQM_ONE_COPY, kqmProblemAttacks, kqmSets, optimizeTeamKqm } from '../'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { SimGear } from '../util/teamOpt/rotation/types'

const statePaths = (attacks: TeamOpt['attacks']) =>
  new Set(
    Object.values(attacks)
      .flat()
      .flatMap((a) => a?.states ?? [])
      .map((s) => `${s.owner}:${s.path.join('.')}`)
  )

describe('candidate set effects in the rotation', () => {
  const members: CharacterKey[] = ['YumemizukiMizuki', 'Odette']
  const play = (gear: Partial<Record<CharacterKey, SimGear>>) =>
    rotationAttacks(
      simulateRotation({
        rotation: parseRotation(
          'Odette E -> YumemizukiMizuki E W5 -> Odette',
          members.map((characterKey) => ({ characterKey, name: characterKey }))
        ),
        members,
        constellations: {},
        elements: Object.fromEntries(
          members.map((m) => [m, getCharEle(m)])
        ) as never,
        gear,
      })
    )

  it("plays Viridescent Venerer's Cryo shred and Scarlet Proof on Mizuki's Stellar Swirls for a candidate as for a set worn", () => {
    const worn = statePaths(
      play({ YumemizukiMizuki: { sets: { ViridescentVenerer: 4 } } })
    )
    expect(worn).toContain('YumemizukiMizuki:ViridescentVenerer.swirlcryo')
    const none = statePaths(play({}))
    expect(none).not.toContain('YumemizukiMizuki:ViridescentVenerer.swirlcryo')
    const candidates = statePaths(
      play({
        YumemizukiMizuki: {
          sets: { BlizzardStrayer: 4 },
          candidates: { sets: ['ViridescentVenerer', 'ScarletProof'] },
        },
      })
    )
    expect(candidates).toContain(
      'YumemizukiMizuki:ViridescentVenerer.swirlcryo'
    )
    expect(candidates).toContain('YumemizukiMizuki:ScarletProof.4Ss')
  })
})

describe("a problem's attacks", () => {
  const build = (sets: KqmBuild['sets'], weapon: string): KqmBuild => ({
    weapon: { key: weapon as never, refinement: 1 },
    sets,
    mains: { sands: 'atk_', goblet: 'atk_', circlet: 'critRate_' },
    rolls: {},
  })
  it('drops the states of sets and weapons no build in it can have, and merges what they split', () => {
    const attack = (
      states: { owner: string; path: string[]; value: string }[]
    ) => ({
      path: ['skill', 'dmg'],
      hits: 1,
      hitMode: 'avgHit' as const,
      states: states as never,
    })
    const attacks: TeamOpt['attacks'] = {
      Odette: [
        attack([
          {
            owner: 'YumemizukiMizuki',
            path: ['ViridescentVenerer', 'swirlcryo'],
            value: 'cryo',
          },
          { owner: 'Odette', path: ['NoblesseOblige', 'set4'], value: 'on' },
          {
            owner: 'Odette',
            path: ['ThrillingTalesOfDragonSlayers', 'Heritage'],
            value: 'on',
          },
        ]),
        attack([
          {
            owner: 'YumemizukiMizuki',
            path: ['ViridescentVenerer', 'swirlcryo'],
            value: '',
          },
          { owner: 'Odette', path: ['NoblesseOblige', 'set4'], value: 'on' },
          {
            owner: 'Odette',
            path: ['ThrillingTalesOfDragonSlayers', 'Heritage'],
            value: '',
          },
        ]),
      ],
    }
    const state = {
      YumemizukiMizuki: build({ BlizzardStrayer: 4 }, 'BlackmarrowLantern'),
      Odette: build({ GladiatorsFinale: 4 }, 'SacrificialSword'),
    }
    // Odette's artifacts vary: her Noblesse is kept, Mizuki's VV (not on her) and Odette's
    // Thrilling Tales (not her weapon) are dropped, and the two attacks become one of 2 hits
    const pruned = kqmProblemAttacks(attacks, 'Odette', state).Odette!
    expect(pruned).toHaveLength(1)
    expect(pruned[0].hits).toBe(2)
    expect(pruned[0].states?.map((s) => s.path[0])).toEqual(['NoblesseOblige'])
    // Mizuki wearing VV: her shred is kept, and the attacks stay apart
    const withVV = kqmProblemAttacks(attacks, 'Odette', {
      ...state,
      YumemizukiMizuki: build({ ViridescentVenerer: 4 }, 'BlackmarrowLantern'),
    }).Odette!
    expect(withVV).toHaveLength(2)
    // Mizuki's own sets vary in her problem: her VV states are kept
    expect(
      kqmProblemAttacks(attacks, 'YumemizukiMizuki', state).Odette
    ).toHaveLength(2)
  })
})
