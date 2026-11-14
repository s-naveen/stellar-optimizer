import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { itemConditionals } from '../util/teamOpt/itemConditionals'
import { Cooldowns } from '../util/teamOpt/rotation/cooldowns'
import {
  annulusHitChance,
  diskIntersection,
} from '../util/teamOpt/rotation/geometry'
import { kitModels } from '../util/teamOpt/rotation/kits'
import { normalString } from '../util/teamOpt/rotation/kits/common'
import { bikeChargeTiming } from '../util/teamOpt/rotation/kits/Mavuika'
import { sandroneChannel } from '../util/teamOpt/rotation/kits/Sandrone'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import {
  rotationAttacks,
  simulateRotation,
} from '../util/teamOpt/rotation/simulate'
import type { KitModel, SimContext } from '../util/teamOpt/rotation/types'

const parse = (text: string, members: CharacterKey[]) =>
  parseRotation(
    text,
    members.map((characterKey) => ({ characterKey, name: characterKey }))
  )

describe('native combat rules shared across character kits', () => {
  it('recovers charges sequentially while allowing all available charges to be spent', () => {
    const cd = new Cooldowns(() => 3)
    for (const t of [0, 37, 74]) {
      expect(cd.readyAt('skill', t)).toBe(t)
      cd.spend('skill', t, 240, 16)
    }
    expect(cd.readyAt('skill', 74)).toBe(256)
    cd.spend('skill', 256, 240, 16)
    expect(cd.readyAt('skill', 256)).toBe(496)
  })

  it('restores consumed charges immediately and restarts any remaining recovery', () => {
    const cd = new Cooldowns(() => 3)
    for (const t of [0, 37, 74]) cd.spend('skill', t, 240, 16)
    cd.reset('skill', 100, 2)
    cd.spend('skill', 100, 240, 16)
    cd.spend('skill', 137, 240, 16)
    expect(cd.readyAt('skill', 137)).toBe(340)
    cd.reduce('skill', 137, 100)
    expect(cd.readyAt('skill', 137)).toBe(240)
    cd.reset('skill', 150, 3)
    expect(cd.readyAt('skill', 150)).toBe(150)
  })

  it('continues adjacent normal groups, wraps the combo, and resets on dash', () => {
    const members: CharacterKey[] = ['Alhaitham']
    const run = (text: string) =>
      simulateRotation({
        rotation: parse(text, members),
        members,
        elements: { Alhaitham: 'dendro' },
        constellations: {},
        repeats: 1,
      })
    const nodes = (text: string) =>
      run(text)
        .hits.filter((h) => h.tag === 'normal')
        .map((h) => h.path[1])
    expect(nodes('Alhaitham N3 N3')).toEqual([
      '0',
      '1',
      '2',
      '2',
      '3',
      '4',
      '0',
    ])
    expect(nodes('Alhaitham N2 D N1')).toEqual(['0', '1', '0'])
    expect(nodes('Alhaitham N3 N3 N2')).toHaveLength(10)
  })

  it('preserves Klee’s Hexerei burst combo across charges and releases N3 coordinated charges', () => {
    const run = (members: CharacterKey[]) =>
      simulateRotation({
        rotation: parse('Klee E Q N2 CA N2 CA N2 CA N2 CA W3', members),
        members,
        elements: { Klee: 'pyro', Venti: 'anemo' },
        constellations: {},
        repeats: 1,
        keep: 'all',
      })
    const hex = run(['Klee', 'Venti'])
    expect(
      hex.hits.filter((h) => h.tag === 'normal').map((h) => h.label)
    ).toEqual(['N1', 'N2', 'N3', 'N1', 'N2', 'N3', 'N1', 'N2'])
    const coordinated = hex.hits.filter((h) =>
      h.label.endsWith('(Coordinated)')
    )
    expect(coordinated).toHaveLength(1)
    expect(
      coordinated.every((h) => h.statSnapshots?.every((s) => s.t === h.t - 10))
    ).toBe(true)
    expect(
      run(['Klee'])
        .hits.filter((h) => h.tag === 'normal')
        .map((h) => h.label)
    ).toEqual(['N1', 'N2', 'N1', 'N2', 'N1', 'N2', 'N1', 'N2'])
    expect(
      run(['Klee']).hits.some((h) => h.label.endsWith('(Coordinated)'))
    ).toBe(false)
  })

  it('includes all three initial Durin burst strikes in each form', () => {
    for (const [text, path, label] of [
      ['Durin E N1 Q W25', 'dark', 'As the Stars Smolder'],
      ['Durin E E Q W25', 'purity', 'As the Light Shifts'],
    ]) {
      const sim = simulateRotation({
        rotation: parse(text, ['Durin']),
        members: ['Durin'],
        elements: { Durin: 'pyro' },
        constellations: {},
        repeats: 1,
      })
      const initial = sim.hits.filter((h) => h.label === label)
      expect(initial.map((h) => h.path)).toEqual(
        [1, 2, 3].map((i) => ['burst', `${path}Dmg${i}`])
      )
      expect(initial.map((h) => h.t - initial[0].t)).toEqual([0, 24, 57])
      expect(
        sim.hits.filter((h) => h.label.startsWith('Dragon of'))
      ).toHaveLength(path === 'dark' ? 16 : 20)
    }
  })

  it('lets Sandrone heat ticks reach max Decode and finish the delayed native channel exit', () => {
    const channel = sandroneChannel(0)
    expect(channel.beams).toEqual([60, 120, 180])
    expect(channel.exit).toBe(199)
    expect(channel.queueLength).toBe(204)
    expect(channel.sweeps).toHaveLength(10)
    const sim = simulateRotation({
      rotation: parse('Sandrone CA E', ['Sandrone']),
      members: ['Sandrone'],
      elements: { Sandrone: 'cryo' },
      constellations: {},
      repeats: 1,
    })
    expect(sim.actions[1].start - sim.actions[0].start).toBe(248)
    expect(sim.hits.filter((h) => h.label === 'Sweeping Fire')).toHaveLength(10)
    expect(sandroneChannel(200).queueLength).toBeLessThan(channel.queueLength)
    expect(sandroneChannel(0, true).beams).toHaveLength(6)
  })

  it('expires Odette’s transferred Splendor with the summon while allowing a burst to refresh it', () => {
    const members: CharacterKey[] = ['Odette', 'Amber']
    const amber: KitModel = {
      characterKey: 'Amber',
      element: 'pyro',
      source: 'test',
      act(ctx) {
        ctx.hit(0, {
          path: ['normal', '0'],
          tag: 'normal',
          element: 'physical',
          label: 'Probe',
        })
        return { frames: 1 }
      },
    }
    const value = (text: string) => {
      const sim = simulateRotation({
        rotation: parse(text, members),
        members,
        elements: { Odette: 'cryo', Amber: 'pyro' },
        constellations: {},
        repeats: 1,
        kits: {
          Amber: amber,
          Odette: kitModels.Odette!,
          Lauma: kitModels.Lauma!,
        },
      })
      return (
        rotationAttacks(sim).Amber?.[0].states?.find(
          (s) => s.path[1] === 'a1TeamSplendor'
        )?.value ?? ''
      )
    }
    expect(value('Odette E -> Amber W24 E')).toBe('')
    expect(value('Odette E W15 Q -> Amber W8 E')).toBe('4')
  })

  it('respects Aino’s retargeting lock and the target size for random Water Balls', () => {
    const members: CharacterKey[] = ['Aino', 'Columbina']
    const run = (radius: number) =>
      simulateRotation({
        rotation: parse('Aino Q W18', members),
        members,
        elements: { Aino: 'hydro', Columbina: 'hydro' },
        constellations: { Aino: 6 },
        repeats: 1,
        target: { radius, distance: 2.4 },
      }).hits.filter((h) => h.label === 'Water Ball')
    expect(run(2)).toHaveLength(15)
    expect(run(0.1).length).toBeLessThan(run(2).length)
    expect(run(20)).toHaveLength(21)
  })

  it('spends Lauma’s 18 burst Hymns and keeps Moonsong’s independent expiry after the burst', () => {
    const members: CharacterKey[] = ['Lauma', 'Amber']
    const amber: KitModel = {
      characterKey: 'Amber',
      element: 'pyro',
      source: 'test',
      act(ctx, _s, action) {
        const count = action.kind === 'normal' ? 20 : 2
        for (let i = 0; i < count; i++)
          ctx.hit(action.kind === 'normal' ? i : 60 * i, {
            path: ['reaction', 'bloom'],
            tag: 'other',
            element: 'dendro',
            label: 'Bloom',
          })
        return { frames: 120 }
      },
    }
    const run = (text: string) =>
      simulateRotation({
        rotation: parse(text, members),
        members,
        elements: { Lauma: 'dendro', Amber: 'pyro' },
        constellations: {},
        repeats: 1,
        kits: {
          Amber: amber,
          Odette: kitModels.Odette!,
          Lauma: kitModels.Lauma!,
        },
        reactions: { onHit() {}, dewAt: () => 3, consumeDewAt: (_t, n) => n },
      })
    const enabled = (sim: ReturnType<typeof run>) =>
      sim.hits
        .filter((h) => h.label === 'Bloom')
        .map((h) => h.states?.find((s) => s.path[1] === 'burstPaleHymn')?.value)
    expect(enabled(run('Lauma Q -> Amber N1'))).toEqual([
      ...Array(18).fill('on'),
      '',
      '',
    ])
    expect(enabled(run('Lauma Q hE -> Amber W14 E'))).toEqual(['on', ''])
    const noDew = simulateRotation({
      rotation: parse('Lauma hE W2', ['Lauma']),
      members: ['Lauma'],
      elements: { Lauma: 'dendro' },
      constellations: {},
      repeats: 1,
    })
    expect(noDew.hits.some((h) => h.label.includes('Lunar-Bloom'))).toBe(false)
  })

  it('does not let attack speed cancel before the queue frame or skip hitlag', () => {
    const result = normalString(
      [
        {
          hitmarks: [30],
          hitlag: [9],
          toNormal: 34,
          toCharged: 34,
          toAbil: 30,
          frames: 34,
        },
      ],
      1,
      () => {},
      {
        attackSpeed: 0.25,
        normalSequence: () => 0,
        hit: () => {},
      } as unknown as SimContext
    )
    expect(result.framesInto?.normal).toBe(39)
  })

  it('resolves refreshed values and recipient-specific buffs independently', () => {
    const members: CharacterKey[] = ['Amber', 'Kaeya']
    const kit: KitModel = {
      characterKey: 'Amber',
      element: 'pyro',
      source: 'test',
      act(ctx) {
        ctx.buff('Amber', ['test', 'value'], '1', 0, 150)
        ctx.buff('Amber', ['test', 'value'], '2', 30, 120)
        ctx.buff('Amber', ['test', 'recipientStacks'], '1', 0, 150, {
          recipient: 'Kaeya',
        })
        for (const characterKey of members)
          ctx.hit(50, {
            characterKey,
            path: ['normal', '0'],
            tag: 'normal',
            element: 'physical',
            label: characterKey,
          })
        return { frames: 150 }
      },
    }
    const sim = simulateRotation({
      rotation: parse('Amber E', members),
      members,
      elements: { Amber: 'pyro', Kaeya: 'cryo' },
      constellations: {},
      repeats: 1,
      kits: { Amber: kit, Kaeya: { ...kit, characterKey: 'Kaeya' } },
    })
    const attacks = rotationAttacks(sim)
    expect(attacks.Amber?.[0].states).toContainEqual({
      owner: 'Amber',
      path: ['test', 'value'],
      value: '2',
    })
    expect(
      attacks.Amber?.[0].states?.some((s) => s.path[1] === 'recipientStacks')
    ).toBe(false)
    expect(attacks.Kaeya?.[0].states).toContainEqual({
      owner: 'Amber',
      path: ['test', 'recipientStacks'],
      value: '1',
    })
  })

  it('extends a timed buff only by pauses before it expires, for the affected recipient', () => {
    const members: CharacterKey[] = ['Amber', 'Kaeya']
    const kit: KitModel = {
      characterKey: 'Amber',
      element: 'pyro',
      source: 'test',
      act(ctx) {
        ctx.buff('Amber', ['test', 'clock'], 'on', 0, 100, {
          hitlag: 'recipient',
        })
        for (const [t, pause] of [
          [50, 9],
          [120, 20],
        ])
          ctx.hit(t, {
            characterKey: 'Kaeya',
            path: ['_marker', 'hitlag'],
            animationPause: pause,
            tag: 'other',
            element: 'physical',
            label: 'pause',
          })
        for (const [t, characterKey] of [
          [105, 'Kaeya'],
          [115, 'Kaeya'],
          [105, 'Amber'],
        ] as const)
          ctx.hit(t, {
            characterKey,
            path: ['normal', '0'],
            tag: 'normal',
            element: 'physical',
            label: `${characterKey}-${t}`,
          })
        return { frames: 160 }
      },
    }
    const sim = simulateRotation({
      rotation: parse('Amber E', members),
      members,
      elements: { Amber: 'pyro', Kaeya: 'cryo' },
      constellations: {},
      repeats: 1,
      kits: { Amber: kit, Kaeya: { ...kit, characterKey: 'Kaeya' } },
    })
    const attacks = rotationAttacks(sim)
    expect(attacks.Kaeya).toHaveLength(2)
    expect(
      attacks.Kaeya?.find((a) => a.states?.some((s) => s.path[1] === 'clock'))
        ?.hits
    ).toBe(1)
    expect(
      attacks.Amber?.[0].states?.some((s) => s.path[1] === 'clock') ?? false
    ).toBe(false)
  })

  it('allows Yae to place three Sakura, then restores them with her burst', () => {
    const members: CharacterKey[] = ['YaeMiko']
    const sim = simulateRotation({
      rotation: parse('Yae E E E Q E E E', members),
      members,
      elements: { YaeMiko: 'electro' },
      constellations: {},
      repeats: 1,
    })
    expect(sim.warnings).toEqual([])
    expect(sim.notes.some((n) => n.startsWith('Waited'))).toBe(false)
    expect(sim.actions.slice(0, 3).map((a) => a.start)).toEqual([0, 37, 74])
  })

  it('executes Chiori’s forced swap even when the written next member differs', () => {
    const members: CharacterKey[] = ['AratakiItto', 'Gorou', 'Albedo', 'Chiori']
    const sim = simulateRotation({
      rotation: parse('Chiori E E -> Gorou Q', members),
      members,
      elements: Object.fromEntries(members.map((k) => [k, 'geo'])),
      constellations: {},
      repeats: 1,
    })
    // E 30f + recast 1f + forced swap 12f + 60f swap cooldown + next swap 12f.
    expect(sim.actions.find((a) => a.characterKey === 'Gorou')?.start).toBe(115)
  })

  it('leaves the Slime-only Black Tassel passive off for the generic target', () => {
    const items = itemConditionals(
      { attacks: ['skill'], auras: ['dendro'] },
      { weapons: ['BlackTassel'], sets: [] }
    )
    expect(items.conditional['BlackTassel']).toBeUndefined()
  })

  it('computes burst droplet hit chance from target geometry', () => {
    expect(diskIntersection(2, 1, 5)).toBe(0)
    expect(diskIntersection(2, 1, 0)).toBeCloseTo(Math.PI)
    expect(annulusHitChance(1.5, 9.5, 4.5, 2.4)).toBeCloseTo(18 / 88)
    expect(annulusHitChance(1.5, 9.5, 20, 0)).toBeCloseTo(1)
  })
  it('emits team Nightsoul Bursts at the roster cooldown and supports independent extra bursts', () => {
    const members: CharacterKey[] = ['Mavuika', 'Xilonen']
    const kit: KitModel = {
      characterKey: 'Mavuika',
      element: 'pyro',
      source: 'test',
      init: () => ({ bursts: 0 }),
      onNightsoulBurst(ctx, s) {
        s.bursts++
        ctx.state('Mavuika', ['test', 'bursts'], String(s.bursts))
      },
      act(ctx) {
        for (const t of [0, 719, 720, 1439, 1440])
          ctx.hit(t, {
            path: ['skill', 'dmg'],
            tag: 'skill',
            element: 'pyro',
            label: 'elemental',
          })
        ctx.at(100, (c) => c.nightsoulBurst())
        return { frames: 1500 }
      },
    }
    const sim = simulateRotation({
      rotation: parse('Mavuika E', members),
      members,
      elements: { Mavuika: 'pyro', Xilonen: 'geo' },
      constellations: {},
      repeats: 1,
      kits: {
        Mavuika: kit,
        Xilonen: {
          ...kit,
          characterKey: 'Xilonen',
          onNightsoulBurst: undefined,
        },
      },
    })
    expect(
      sim.buffWindows
        .filter((w) => w.path[1] === 'bursts')
        .map((w) => [w.start, w.value])
    ).toEqual([
      [0, '1'],
      [100, '2'],
      [720, '3'],
      [1440, '4'],
    ])
  })

  it('uses an active resource for Scroll and only grants Codex after points are consumed', () => {
    const members: CharacterKey[] = ['Mavuika']
    const kit: KitModel = {
      characterKey: 'Mavuika',
      element: 'pyro',
      source: 'test',
      nightsoul: (ctx) => ({
        active: ctx.now < 120,
        points: ctx.now < 20 ? 80 : 70,
      }),
      act(ctx) {
        ctx.hit(10, {
          path: ['_reaction', 'crystallize'],
          tag: 'other',
          element: 'pyro',
          label: 'reaction',
        })
        for (const t of [15, 25])
          ctx.hit(t, {
            path: ['skill', 'dmg'],
            tag: 'skill',
            element: 'pyro',
            label: 'hit',
          })
        return { frames: 130 }
      },
    }
    const sim = simulateRotation({
      rotation: parse('Mavuika E', members),
      members,
      elements: { Mavuika: 'pyro' },
      constellations: {},
      repeats: 1,
      kits: { Mavuika: kit },
      gear: { Mavuika: { sets: { ObsidianCodex: 4 } } },
    })
    const attacks = rotationAttacks(sim).Mavuika!
    expect(
      attacks[0].states?.some(
        (s) => s.path[1] === '4NightsoulConsume' && s.value === 'on'
      ) ?? false
    ).toBe(false)
    expect(attacks[1].states).toContainEqual({
      owner: 'Mavuika',
      path: ['ObsidianCodex', '4NightsoulConsume'],
      value: 'on',
    })
  })

  it('adds absorbed bursts for both Anemo kits and applies Cryo EM from Stellar Swirl', () => {
    const members: CharacterKey[] = ['Venti', 'Sucrose', 'Odette', 'Anastasya']
    const sim = simulateRotation({
      rotation: parse(
        'Odette E Q -> Anastasya E Q -> Sucrose E Q -> Venti E Q W8',
        members
      ),
      members,
      elements: {
        Venti: 'anemo',
        Sucrose: 'anemo',
        Odette: 'cryo',
        Anastasya: 'cryo',
      },
      constellations: { Sucrose: 6 },
      repeats: 1,
    })
    expect(
      sim.hits.filter(
        (h) => h.characterKey === 'Venti' && h.path.join('.') === 'burst.absorb'
      ).length
    ).toBeGreaterThan(0)
    expect(
      sim.hits.filter(
        (h) => h.characterKey === 'Sucrose' && h.label.includes('(Absorbed)')
      ).length
    ).toBeGreaterThan(0)
    expect(
      sim.buffWindows.some(
        (w) => w.owner === 'Sucrose' && w.path[1] === 'swirlcryo'
      )
    ).toBe(true)
  })

  it('triggers Ororon Hypersense on allied Nightsoul damage with its 108 frame cooldown', () => {
    const members: CharacterKey[] = ['Ororon', 'Chasca']
    const sim = simulateRotation({
      rotation: parse('Ororon E Q -> Chasca E CA CA CA W5', members),
      members,
      elements: { Ororon: 'electro', Chasca: 'anemo' },
      constellations: { Ororon: 6 },
      repeats: 1,
    })
    const procs = sim.hits.filter(
      (h) => h.characterKey === 'Ororon' && h.path[0] === 'passive1'
    )
    expect(procs.length).toBeGreaterThan(1)
    procs
      .slice(1)
      .forEach((h, i) => expect(h.t - procs[i].t).toBeGreaterThanOrEqual(108))
    expect(procs.every((h) => h.nightsoul)).toBe(true)
  })

  it('grants all five Wriothesley Edicts and emits HP changes for Marechaussee', () => {
    const members: CharacterKey[] = ['Wriothesley']
    const sim = simulateRotation({
      rotation: parse('Wriothesley E N3 N3', members),
      members,
      elements: { Wriothesley: 'cryo' },
      constellations: {},
      repeats: 1,
      gear: { Wriothesley: { sets: { MarechausseeHunter: 4 } } },
    })
    expect(
      sim.buffWindows.some(
        (w) => w.path[1] === 'a4EdictStacks' && w.value === '5'
      )
    ).toBe(true)
    // Chilling Penalty: one HP change per enhanced punch landed
    const punches = sim.hits.filter((h) =>
      h.label?.startsWith('Repelling Fist')
    )
    expect(punches.length).toBeGreaterThanOrEqual(6)
    expect(sim.hits.filter((h) => h.path[1] === 'hpChange')).toHaveLength(
      punches.length
    )
    expect(
      sim.buffWindows.some(
        (w) => w.owner === 'Wriothesley' && w.path[0] === 'MarechausseeHunter'
      )
    ).toBe(true)
  })
  it('waits for a queued resource gain instead of silently dropping the requested action', () => {
    const members: CharacterKey[] = ['Bennett', 'Amber']
    const producer: KitModel = {
      characterKey: 'Bennett',
      element: 'pyro',
      source: 'test',
      act(ctx) {
        ctx.at(30, (c) => c.nightsoulBurst())
        return { frames: 10 }
      },
    }
    const consumer: KitModel = {
      characterKey: 'Amber',
      element: 'pyro',
      source: 'test',
      init: () => ({ points: 0 }),
      onNightsoulBurst(_ctx, s) {
        s.points = 10
      },
      actionReadyAt: (ctx, s) => (s.points >= 10 ? ctx.now : ctx.now + 100),
      act(ctx, s) {
        s.points -= 10
        ctx.hit(0, {
          path: ['skill', 'explosion'],
          tag: 'skill',
          element: 'pyro',
          label: 'resource action',
        })
        return { frames: 10 }
      },
    }
    const sim = simulateRotation({
      rotation: parse('Bennett E -> Amber E', members),
      members,
      elements: { Bennett: 'pyro', Amber: 'pyro' },
      constellations: {},
      repeats: 1,
      keep: 'all',
      kits: { Bennett: producer, Amber: consumer },
    })
    expect(sim.warnings).toEqual([])
    expect(sim.actions.find((a) => a.characterKey === 'Amber')?.start).toBe(30)
    expect(sim.hits.some((h) => h.label === 'resource action')).toBe(true)
  })

  it('reports rejected actions in the startup loop when the complete run is measured', () => {
    const members: CharacterKey[] = ['Amber']
    const sim = simulateRotation({
      rotation: parse('Amber E', members),
      members,
      elements: { Amber: 'pyro' },
      constellations: {},
      repeats: 2,
      keep: 'all',
      kits: {
        Amber: {
          characterKey: 'Amber',
          element: 'pyro',
          source: 'test',
          init: () => ({ first: true }),
          act(_ctx, s) {
            if (s.first) {
              s.first = false
              return { frames: 0, failed: 'startup resource missing' }
            }
            return { frames: 10 }
          },
        },
      },
    })
    expect(sim.warnings).toContain('startup resource missing')
  })

  it('uses Linnea’s native summon sequence and supports her third recast', () => {
    const members: CharacterKey[] = ['Linnea']
    const run = (text: string) =>
      simulateRotation({
        rotation: parse(text, members),
        members,
        elements: { Linnea: 'geo' },
        constellations: {},
        repeats: 1,
      })
    const single = run('Linnea E W7')
    expect(single.notes).toEqual([])
    expect(
      single.hits
        .filter((h) => h.path[1] === 'pummelerDmg')
        .slice(0, 4)
        .map((h) => h.t)
    ).toEqual([114, 126, 225, 237])
    const recast = run('Linnea E E E E W3')
    expect(recast.warnings).toEqual([])
    expect(recast.hits.filter((h) => h.path[1] === 'crushDmg')).toHaveLength(1)
    expect(recast.actions.slice(0, 4).map((a) => a.start)).toEqual([
      0, 20, 30, 40,
    ])
  })

  it('executes Illuga’s C2 in the live timeline after every seventh consumed Song', () => {
    const members: CharacterKey[] = ['Illuga', 'Zibai']
    const attacker: KitModel = {
      characterKey: 'Zibai',
      element: 'geo',
      source: 'test',
      act(ctx) {
        for (let i = 1; i <= 6; i++)
          ctx.hit(i * 10, {
            path: ['skill', 'shift1Dmg'],
            tag: 'normal',
            element: 'geo',
            applies: true,
            label: 'Geo hit',
          })
        return { frames: 150 }
      },
    }
    const sim = simulateRotation({
      rotation: parse('Illuga Q -> Zibai N1', members),
      members,
      elements: { Illuga: 'geo', Zibai: 'geo' },
      constellations: { Illuga: 6 },
      repeats: 1,
      kits: { ...kitModels, Zibai: attacker },
    })
    const c2 = sim.hits.filter(
      (h) => h.characterKey === 'Illuga' && h.path[0] === 'constellation2'
    )
    expect(c2).toHaveLength(1)
    expect(c2[0].t).toBe(184)
    expect(c2[0].applies).toBe(true)
    expect(
      sim.hits.filter((h) =>
        h.states?.some((s) => s.path[1] === 'burstSong' && s.value === 'on')
      )
    ).toHaveLength(7)
  })
  it('uses native Mavuika spin collision, buffered startup, and wait cancellation', () => {
    expect(bikeChargeTiming({ radius: 2, distance: 2.4 }, 15)).toEqual({
      hit: 20,
      final: 86,
      normal: 117,
    })
    expect(bikeChargeTiming({ radius: 2, distance: 2.4 }, 0)).toEqual({
      hit: 35,
      final: 101,
      normal: 132,
    })
    expect(bikeChargeTiming({ radius: 1, distance: 9 }, 15)).toBeUndefined()
    const members: CharacterKey[] = ['Mavuika']
    const sim = simulateRotation({
      rotation: parse('Mavuika E Q N3 CA W3', members),
      members,
      elements: { Mavuika: 'pyro' },
      constellations: {},
      repeats: 1,
    })
    const charge = sim.actions.find((a) => a.text === 'CA')!
    expect(charge.frames).toBe(20)
    const cyclic = sim.hits.find(
      (h) => h.label === 'Flamestrider Charged Attack (Cyclic)'
    )!
    const final = sim.hits.find(
      (h) => h.label === 'Flamestrider Charged Attack (Final)'
    )!
    expect(cyclic.t - charge.start).toBe(20)
    expect(final.t - charge.start).toBe(86)
    expect(
      sim.buffWindows.some(
        (w) => w.path[1] === 'a4TimeSinceBurst' && w.value === '19'
      )
    ).toBe(true)
  })

  it('reports a spend that immediately exits Nightsoul without losing or double-counting it', () => {
    const members: CharacterKey[] = ['Mavuika', 'Xilonen']
    const observer: KitModel = {
      characterKey: 'Mavuika',
      element: 'pyro',
      source: 'test',
      act: () => ({ frames: 1 }),
      init: () => ({ amount: 0 }),
      onNightsoulConsume(ctx, s, _actor, amount) {
        s.amount += amount
        ctx.state('Mavuika', ['test', 'consumed'], String(s.amount))
      },
    }
    const spender: KitModel = {
      characterKey: 'Xilonen',
      element: 'geo',
      source: 'test',
      init: () => ({ points: 90, active: true }),
      nightsoul: (_ctx, s) => s,
      act(ctx, s) {
        ctx.at(10, (c) => {
          c.consumeNightsoul(90)
          s.points = 0
          s.active = false
        })
        return { frames: 20 }
      },
    }
    const sim = simulateRotation({
      rotation: parse('Xilonen E', members),
      members,
      elements: { Mavuika: 'pyro', Xilonen: 'geo' },
      constellations: {},
      repeats: 1,
      kits: { Mavuika: observer, Xilonen: spender },
    })
    expect(
      sim.buffWindows
        .filter((w) => w.path[1] === 'consumed')
        .map((w) => w.value)
    ).toEqual(['90'])
  })

  it('lets Stellar Swirl activate Cryo VV only while its wearer is on field', () => {
    const members: CharacterKey[] = ['Venti', 'Odette']
    const sim = simulateRotation({
      rotation: parse('Odette E -> Venti E Q -> Odette E W8', members),
      members,
      elements: { Venti: 'anemo', Odette: 'cryo' },
      constellations: {},
      repeats: 1,
      gear: { Venti: { sets: { ViridescentVenerer: 4 } } },
    })
    const vv = sim.buffWindows.filter(
      (w) =>
        w.owner === 'Venti' &&
        w.path[0] === 'ViridescentVenerer' &&
        w.path[1] === 'swirlcryo'
    )
    expect(vv.length).toBeGreaterThan(0)
    const off = sim.actions.find(
      (a) => a.characterKey === 'Odette' && a.start > 0
    )!.start
    expect(vv.every((w) => w.start < off)).toBe(true)
  })
  it('triggers Sky’s Unveiling on the active wearer even when a teammate owns the Lunar reaction', () => {
    const members: CharacterKey[] = ['Flins', 'Columbina']
    const attack: KitModel = {
      characterKey: 'Flins',
      moonsign: 1,
      element: 'electro',
      source: 'test',
      act(ctx) {
        ctx.hit(10, {
          characterKey: 'Columbina',
          path: ['_reaction', 'lunarCharged'],
          tag: 'other',
          element: 'electro',
          label: 'Lunar reaction',
        })
        return { frames: 100 }
      },
    }
    const sim = simulateRotation({
      rotation: parse('Flins E -> Columbina E', members),
      members,
      elements: { Flins: 'electro', Columbina: 'hydro' },
      constellations: {},
      repeats: 1,
      kits: {
        Flins: attack,
        Columbina: { ...attack, characterKey: 'Columbina' },
      },
      gear: { Flins: { sets: { NightOfTheSkysUnveiling: 4 } } },
    })
    const windows = sim.buffWindows.filter(
      (w) => w.path[0] === 'NightOfTheSkysUnveiling'
    )
    expect(windows).toHaveLength(1)
    expect(windows[0]).toMatchObject({
      owner: 'Flins',
      start: 11,
      end: 251,
      value: 'on',
    })
  })

  it('activates Geo Resonance near Moondrifts and keeps its shred separate from the damage bonus', () => {
    const members: CharacterKey[] = ['Columbina', 'Illuga', 'Linnea', 'Zibai']
    const sim = simulateRotation({
      rotation: parse(
        'Columbina E -> Illuga E Q -> Linnea E -> Zibai E N4 E W6',
        members
      ),
      members,
      elements: {
        Columbina: 'hydro',
        Illuga: 'geo',
        Linnea: 'geo',
        Zibai: 'geo',
      },
      constellations: { Illuga: 6 },
      repeats: 1,
    })
    expect(sim.warnings).toEqual([])
    expect(
      sim.buffWindows.some(
        (w) => w.path[1] === 'EnduringRock' && w.value === 'on'
      )
    ).toBe(true)
    const shred = sim.buffWindows.filter((w) => w.path[1] === 'EnduringRockHit')
    expect(shred.length).toBeGreaterThan(0)
    expect(shred.every((w) => w.end - w.start === 900)).toBe(true)
  })
})
