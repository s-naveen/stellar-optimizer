import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

describe('Qiqi Herald of Frost', () => {
  const members: CharacterKey[] = ['Qiqi', 'Keqing']
  const run = (text: string, probe?: KitModel) =>
    simulateRotation({
      rotation: parseRotation(
        text,
        members.map((characterKey) => ({ characterKey, name: characterKey }))
      ),
      members,
      elements: { Qiqi: 'cryo', Keqing: 'electro' },
      constellations: {},
      kits: { Qiqi: kitModels.Qiqi, Keqing: probe ?? kitModels.Keqing },
      gear: { Qiqi: { sets: { TenacityOfTheMillelith: 4 } } },
      reactions: { onHit() {}, radianceAt: () => 'conduct' },
      repeats: 1,
      keep: 'all',
    })

  it('delays the next ability by initial hitlag while deployable ticks freeze only the target', () => {
    const sim = run('Qiqi E Q W15')
    expect(sim.actions[1].start).toBe(65)
    expect(
      sim.hits
        .filter((h) => h.label === 'Herald of Frost (tick)')
        .map((h) => h.t)
    ).toEqual([96, 231, 291, 426, 486, 621, 681, 816, 876])
    const initial = sim.hitlagEvents?.find(
      (h) => h.characterKey === 'Qiqi' && h.animationPause === 7
    )
    expect(initial?.t).toBe(32)
    const deployable = sim.hits.filter(
      (h) =>
        h.path[0] === '_marker' &&
        h.enemyAnimationPause === 7 &&
        h.label !== 'Qiqi Herald initial hitlag'
    )
    expect(deployable.length).toBeGreaterThanOrEqual(9)
    expect(deployable.every((h) => h.animationPause === 0)).toBe(true)
  })

  it('captures skill stats before its own Tenacity proc and retains them after later buffs expire', () => {
    const sim = run('Qiqi E W15')
    const attacks = rotationAttacks(sim).Qiqi!.filter(
      (a) => a.path[0] === 'skill' && a.path[1] !== 'frostCoordDmg'
    )
    expect(attacks.some((a) => a.path[1] === 'tickDmg')).toBe(true)
    for (const attack of attacks) {
      expect(
        attack.statSnapshots
          ?.find((s) => s.stat === 'atk')
          ?.states.find(
            (s) => s.path.join('.') === 'TenacityOfTheMillelith.skill'
          )?.value ?? ''
      ).toBe('')
      expect(attack.statSnapshots?.some((s) => s.stat === 'cryo_dmg_')).toBe(
        true
      )
    }
    expect(
      attacks.some((a) =>
        a.states?.some(
          (s) => s.path.join('.') === 'TenacityOfTheMillelith.skill' && s.value
        )
      )
    ).toBe(true)
  })

  it('uses the triggering character clock for coordinated attack cooldowns', () => {
    const probe: KitModel = {
      characterKey: 'Keqing',
      element: 'electro',
      source: 'test',
      act(c) {
        for (const t of [0, 132, 142])
          c.hit(t, {
            path: ['skill', 'probe'],
            tag: 'skill',
            element: 'electro',
            label: 'Probe',
          })
        c.hit(20, {
          path: ['_marker', 'hitlag'],
          tag: 'other',
          element: 'physical',
          animationPause: 10,
          label: 'Probe hitlag',
        })
        return { frames: 160 }
      },
    }
    const sim = run('Qiqi E -> Keqing E', probe)
    const start = sim.actions[1].start
    expect(
      sim.hits
        .filter(
          (h) =>
            h.label === 'Herald of Frost (coordinated attack)' && h.t > start
        )
        .map((h) => h.t - start)
    ).toEqual([1, 143])
  })

  it('tags the additional burst hit as direct Stellar Conduct', () => {
    const hit = run('Qiqi Q').hits.find((h) =>
      h.label.includes('(Stellar-Conduct)')
    )
    expect(hit?.tag).toBe('directStellarConduct')
  })
})
