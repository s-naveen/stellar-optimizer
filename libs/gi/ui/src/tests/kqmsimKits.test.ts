import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { getCharEle } from '@genshin-optimizer/gi/stats'
import { describe, expect, it } from 'vitest'
import { kitModels } from '../util/teamOpt/rotation/kits/index'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel } from '../util/teamOpt/rotation/types'

function run(
  text: string,
  members: CharacterKey[],
  cons: Partial<Record<CharacterKey, number>> = {},
  repeats = 1
) {
  return simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
    constellations: cons,
    repeats,
  })
}
const trio: CharacterKey[] = ['Danica', 'Anastasya', 'Mitya', 'Odette']

describe('KQM-only character kits', () => {
  it('registers the three kits and parses Tsaritsa as Anastasya', () => {
    expect(trio.every((k) => kitModels[k])).toBe(true)
    const sim = run(
      'Danica E -> Tsaritsa E Q -> Mitya E Q -> Odette E W10',
      trio
    )
    expect(sim.unsupported).toEqual([])
    expect(sim.warnings).toEqual([])
    for (const key of trio)
      expect(sim.hits.some((h) => h.characterKey === key)).toBe(true)
    expect(
      trio.slice(0, 3).every((k) => kitModels[k]?.source.includes('7bdf45f'))
    ).toBe(true)
  })

  it('enables Stellar-Conduct with Mitya alone as the enabler and applies Tsaritsa’s two base Polestar stacks', () => {
    const mitya = run('Kaeya E -> Mitya E W8', ['Kaeya', 'Mitya'])
    expect(
      mitya.hits.some((h) => h.path.join('.') === '_reaction.stellarConduct')
    ).toBe(true)
    expect(
      mitya.hits.some((h) => h.path.join('.') === '_reaction.superconduct')
    ).toBe(false)
    const ana = run('Fischl E -> Tsaritsa E W5', ['Fischl', 'Anastasya'])
    const stacks = ana.buffWindows.filter(
      (w) => w.path.join('.') === 'reaction.polestarStacks'
    )
    expect(stacks.length).toBeGreaterThan(0)
    expect(
      stacks.every((w) => Number(w.value) >= 2 && Number(w.value) <= 12)
    ).toBe(true)
  })

  it('Danica coordinates off-field and performs her automatic entry before the requested burst', () => {
    const sim = run(
      'Danica E -> Tsaritsa E W2 -> Mitya E N3 -> Danica Q W2',
      trio
    )
    expect(
      sim.hits.filter(
        (h) =>
          h.characterKey === 'Danica' && h.label === 'Anchor Coordinated Attack'
      ).length
    ).toBeGreaterThanOrEqual(2)
    const entry = sim.actions.find(
      (a) => a.characterKey === 'Danica' && a.text === 'Entry'
    )
    const burst = sim.actions.find(
      (a) => a.characterKey === 'Danica' && a.text === 'Q'
    )
    expect(entry).toBeTruthy()
    expect(burst!.start).toBe(entry!.start + 60)
    expect(
      sim.hits.some((h) => h.label === 'Entry Skill (Stellar-Conduct)')
    ).toBe(true)
    expect(
      sim.buffWindows.some(
        (w) => w.path.join('.') === 'Danica.maidForm' && w.value === 'defense'
      )
    ).toBe(true)
  })

  it('plays Danica’s Anchor normals and Tsaritsa’s Honor form (implemented from the game text)', () => {
    const danica = run('Danica E N2', ['Danica'])
    expect(danica.warnings.join(' ')).not.toMatch(/not implemented/)
    const honor = run('Tsaritsa hE', ['Anastasya'])
    expect(honor.warnings.join(' ')).not.toMatch(/not implemented/)
  })

  it('Mitya’s burst grants three prisms and his hold charged attack consumes them before the next action', () => {
    const sim = run('Mitya hE Q CA N1', ['Mitya'])
    const ca = sim.actions.find((a) => a.text === 'CA')!
    const after = sim.actions.find((a) => a.text === 'N1')!
    const stellar = sim.hits.filter(
      (h) => h.label === 'Special Charge (Stellar-Conduct)'
    )
    expect(stellar).toHaveLength(4) // one from Hold, three from Q at frame 119
    expect(ca.frames).toBe(62 + 3 * 15 + 43 + 3)
    expect(after.start).toBe(ca.start + ca.frames)
    expect(stellar.at(-1)!.t).toBeLessThan(after.start)
  })

  it('Mitya overflows four prisms in Steady State and a recast detonates remaining prisms', () => {
    const sim = run('Kaeya E -> Mitya E Q W2 E W2', ['Kaeya', 'Mitya'])
    expect(
      sim.hits.some((h) => h.label === 'Prism Surge (Stellar-Conduct)')
    ).toBe(true)
    expect(
      sim.hits.some(
        (h) => h.label === 'Prism Shatter (Stellar-Conduct)' && h.weight! > 0
      )
    ).toBe(true)
    const shatter = rotationAttacks(sim).Mitya!.find(
      (a) => a.path.join('.') === 'skill.steadyDetonateDmg'
    )!
    expect(shatter.states).toContainEqual({
      owner: 'Mitya',
      path: ['Mitya', 'detectionCore'],
      value: 'steady',
    })
    expect(
      Number(
        shatter.states?.find((s) => s.path[1] === 'gradientBeacons')?.value
      )
    ).toBeGreaterThan(0)
    expect(
      sim.buffWindows.some(
        (w) =>
          w.path.join('.') === 'Mitya.detectionCore' && w.value === 'overloaded'
      )
    ).toBe(true)
    expect(
      sim.buffWindows
        .filter((w) => w.path.join('.') === 'Mitya.gradientBeacons')
        .every((w) => !w.value || Number(w.value) <= 4)
    ).toBe(true)
  })

  it('Tsaritsa seals after Love burst, waits until unsealed, then performs Triumph automatically', () => {
    const sim = run('Tsaritsa E Q -> Bennett N1 -> Tsaritsa N1', [
      'Anastasya',
      'Bennett',
    ])
    const entry = sim.actions.find((a) => a.text === 'Entry')!
    expect(entry).toBeTruthy()
    // Burst Crown's Stellar hits reduce the seal before its 20 s passive expiry.
    expect(entry.start).toBeGreaterThan(600)
    expect(entry.start).toBeLessThan(1400)
    expect(sim.hits.some((h) => h.label.startsWith('Triumph'))).toBe(true)
    expect(
      sim.buffWindows.some(
        (w) =>
          w.path.join('.') === 'Anastasya.accolades' && w.value === 'loveSeal'
      )
    ).toBe(true)
    const attacks = rotationAttacks(sim).Anastasya!
    expect(attacks.some((a) => a.path.join('.') === 'burst.triumphSc')).toBe(
      true
    )
  })

  it('closes tracked state windows and stops action watchers before a growing channel', () => {
    const seen: string[] = []
    const kit: KitModel = {
      characterKey: 'Mitya',
      element: 'electro',
      source: 'test',
      act(ctx, _s, action) {
        if (action.kind === 'normal') {
          ctx.state('Mitya', ['Mitya', 'gradientBeacons'], '1')
          ctx.at(15, (c) => c.state('Mitya', ['Mitya', 'gradientBeacons'], '2'))
          return { frames: 10 }
        }
        let duration = 20
        ctx.at(5, () => {
          seen.push('event')
          duration = 30
        })
        return { frames: 20, duration: () => duration }
      },
      onPartyAction(_c, _s, _k, a) {
        seen.push(a.kind)
      },
    }
    const sim = simulateRotation({
      rotation: parseRotation('Mitya N1 CA', [
        { characterKey: 'Mitya', name: 'Mitya' },
      ]),
      members: ['Mitya'],
      constellations: {},
      elements: { Mitya: 'electro' },
      kits: { Mitya: kit },
      repeats: 1,
    })
    expect(seen).toEqual(['normal', 'charged', 'event'])
    expect(
      sim.buffWindows
        .filter((w) => w.path[1] === 'gradientBeacons')
        .map((w) => [w.value, w.start, w.end])
    ).toEqual([
      ['1', 0, 15],
      ['2', 15, Number.MAX_SAFE_INTEGER],
    ])
    expect(sim.frames).toBe(40)
  })
})
