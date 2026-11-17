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

  it('enables Stellar-Conduct with Mitya alone as the enabler and applies Tsaritsa’s base Polestar stack (1 in the 7.3 beta)', () => {
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
      stacks.every((w) => Number(w.value) >= 1 && Number(w.value) <= 12)
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
    // three from Q at frame 119. The hold makes no Beacon of its own (the game's hold E has none,
    // only C1's on-Skill one); kqmsim adds one, so we differ from it on purpose.
    expect(stellar).toHaveLength(3)
    expect(ca.frames).toBe(62 + 2 * 15 + 43 + 3)
    expect(after.start).toBe(ca.start + ca.frames)
    expect(stellar.at(-1)!.t).toBeLessThan(after.start)
  })

  it('Mitya overflows four prisms in Steady State, and a recast to Overload keeps them for Gradient Detonation', () => {
    const sim = run('Kaeya E -> Mitya E Q W2 E W2', ['Kaeya', 'Mitya'])
    expect(
      sim.hits.some((h) => h.label === 'Prism Surge (Stellar-Conduct)')
    ).toBe(true)
    // (game text: the Steady core consumes the Beacons when its duration ends or another core is
    // created; a recast only changes its state)
    expect(
      sim.hits.some(
        (h) => h.label === 'Prism Shatter (Stellar-Conduct)' && h.weight! > 0
      )
    ).toBe(false)
    const recast = sim.actions.filter(
      (a) => a.characterKey === 'Mitya' && a.text === 'E'
    )[1]!
    const kept = sim.buffWindows.find(
      (w) =>
        w.path.join('.') === 'Mitya.gradientBeacons' &&
        w.start <= recast.start + recast.frames &&
        recast.start + recast.frames < w.end
    )
    expect(Number(kept?.value)).toBeGreaterThan(0)
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

    const ca = run('Kaeya E -> Mitya E Q W2 E CA', ['Kaeya', 'Mitya'])
    expect(
      ca.hits.filter((h) => h.label === 'Special Charge (Stellar-Conduct)')
    ).toHaveLength(Number(kept?.value))
  })

  it('Mitya’s Steady core detonates its Beacons when it ends or a new tap or hold E is used on it', () => {
    const shattered = (sim: ReturnType<typeof run>) =>
      sim.hits
        .filter(
          (h) => h.label === 'Prism Shatter (Stellar-Conduct)' && h.weight! > 0
        )
        .map((h) => h.weight)
    // (Q's three Beacons, 10 s each, outlast the 25 s Steady core)
    expect(shattered(run('Mitya E W14 Q W12', ['Mitya']))).toEqual([3])
    // a new core (the 18 s cooldown Skill, tapped or held) while the Steady one is on
    const fresh = run('Mitya E W17 Q E', ['Mitya'])
    expect(shattered(fresh)).toEqual([3])
    expect(shattered(run('Mitya E W17 Q hE', ['Mitya']))).toEqual([3])
    // never from an Overload core
    expect(shattered(run('Mitya hE W17 Q E', ['Mitya']))).toEqual([])
    // nor from switching modes, either way (here Overload to Steady with four Beacons)
    const back = run('Mitya hE Q E W1', ['Mitya'])
    expect(back.actions.at(-1)?.variant?.key).toBe('switch')
    expect(shattered(back)).toEqual([])

    const attack = rotationAttacks(fresh).Mitya!.find(
      (a) => a.path.join('.') === 'skill.steadyDetonateDmg'
    )!
    // (the new tap E's core, Steady, is the one up when the strike lands)
    expect(attack.states).toContainEqual({
      owner: 'Mitya',
      path: ['Mitya', 'detectionCore'],
      value: 'steady',
    })
    // The game clears the Beacons as the detonation appears, 0.25 s before its strike, so the strike
    // gets no A1 EM from the three it consumes (none are left at C0). kqmsim snapshots them; we
    // differ from it on purpose.
    expect(
      attack.states?.some((s) => s.path[1] === 'gradientBeacons')
    ).toBeFalsy()
  })

  it('Mitya’s DPS loop (hold E opener, then tap E, switch, charged attack) never detonates', () => {
    const members: CharacterKey[] = ['Mitya', 'Odette', 'Valeriy', 'Sucrose']
    const names = members.map((characterKey) => ({
      characterKey,
      name: characterKey,
    }))
    const rotation = parseRotation(
      'odette EQE -> Val EQC -> sucrose N1E(or Q) -> mitya CA Q CA tE -> sucrose N1/E -> mitya tE CA',
      names
    )
    rotation.opener = parseRotation('mitya hE', names).steps
    const sim = simulateRotation({
      rotation,
      members,
      elements: Object.fromEntries(members.map((k) => [k, getCharEle(k)])),
      constellations: {},
      repeats: 3,
      keep: 'all',
    })
    const switches = sim.actions.filter(
      (a) => a.characterKey === 'Mitya' && a.variant?.key === 'switch'
    )
    expect(switches.length).toBeGreaterThanOrEqual(3)
    // Beacons are there at each switch, and stay for the charged attack
    for (const a of switches)
      expect(
        Number(
          sim.buffWindows.find(
            (w) =>
              w.path.join('.') === 'Mitya.gradientBeacons' &&
              w.start <= a.start + a.frames &&
              a.start + a.frames < w.end
          )?.value
        )
      ).toBeGreaterThan(0)
    expect(
      sim.hits.filter(
        (h) => h.label === 'Prism Shatter (Stellar-Conduct)' && h.weight! > 0
      )
    ).toEqual([])
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
