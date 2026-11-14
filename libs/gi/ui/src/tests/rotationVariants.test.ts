import type { CharacterKey } from '@genshin-optimizer/gi/consts'
import { describe, expect, it } from 'vitest'
import { parseRotation } from '../util/teamOpt/rotation/parse'
import { simulateRotation } from '../util/teamOpt/rotation/simulate'
import { kitModels } from '../util/teamOpt/rotation/kits'
import type { KitModel } from '../util/teamOpt/rotation/types'

const members: CharacterKey[] = ['Zibai', 'Linnea', 'Columbina', 'Illuga']
const text =
  'bina EQ -> illuga EQ -> linnea E -> Zibai E N4 E N4 Q E N4 E -> bina'
const run = (frameData = {}) =>
  simulateRotation({
    rotation: parseRotation(
      text,
      members.map((characterKey) => ({ characterKey, name: characterKey }))
    ),
    members,
    constellations: { Zibai: 0, Columbina: 0, Linnea: 0, Illuga: 6 },
    elements: {
      Zibai: 'geo',
      Linnea: 'geo',
      Columbina: 'hydro',
      Illuga: 'geo',
    },
    frameData,
  })
const zibaiSkills = (sim: ReturnType<typeof run>) =>
  sim.actions.filter((a) => a.characterKey === 'Zibai' && a.text === 'E')

describe('a mode or stance’s version of an action', () => {
  it('plays Zibai’s E in Lunar Phase Shift as Spirit Steed’s Stride, with its own frame data', () => {
    const sim = run()
    const skills = zibaiSkills(sim)
    expect(skills.map((a) => a.frameKey)).toEqual([
      'skill',
      'skill@stride',
      'skill@stride',
      'skill@stride',
    ])
    expect(skills[1].variant).toMatchObject({
      label: "Spirit Steed's Stride",
      mode: 'Lunar Phase Shift',
    })
    const data = sim.actionData!.Zibai!
    expect(data.skill.frames).toBe(52)
    expect(data['skill@stride']).toMatchObject({
      action: { kind: 'skill', text: 'E' },
      variant: { key: 'stride' },
    })
    // (Stride: 61 frames, into a normal attack at 45, plus its 2 × 2 hitlag frames)
    expect(data['skill@stride'].framesInto.normal).toBe(49)
  })
  it('keeps an edit of the ordinary E off the Strides, and an edit of the Stride off the E', () => {
    const plain = zibaiSkills(run())
    const editedE = zibaiSkills(run({ Zibai: { skill: { frames: 40 } } }))
    // the entry E is shorter, the Strides as they were
    expect(editedE[0].frames).toBeLessThan(plain[0].frames)
    expect(editedE.slice(1).map((a) => a.frames)).toEqual(
      plain.slice(1).map((a) => a.frames)
    )
    const editedStride = zibaiSkills(
      run({ Zibai: { 'skill@stride': { framesInto: { normal: 30 } } } })
    )
    expect(editedStride[0].frames).toBe(plain[0].frames)
    expect(editedStride[1].frames).toBeLessThan(plain[1].frames)
  })
  it('records every swap: who to whom, when and how long', () => {
    const sim = run()
    const swaps = sim.swaps ?? []
    // (the kept loop starts with the swap into its first member)
    expect(swaps.map((w) => `${w.from}>${w.to}`).sort()).toEqual([
      'Columbina>Illuga',
      'Illuga>Linnea',
      'Linnea>Zibai',
      'Zibai>Columbina',
    ])
    for (const w of swaps) {
      expect(w.frames).toBe(12)
      expect(w.cooldown).toBeGreaterThanOrEqual(0)
      // the incoming member's first action starts once the swap is over
      const next = sim.actions.find(
        (a) => a.characterKey === w.to && a.start >= w.start
      )
      if (next) expect(next.start).toBeGreaterThanOrEqual(w.start + w.frames)
    }
  })
})

describe('versions never change what is played', () => {
  // every kit that names versions, in mixed rotations, with and without its `variant`: the same
  // actions, frames and hits (a version only files the action under its own frame-data key)
  const texts = [
    'E N4 E N4 Q E N4 CA E N2 E CA',
    'Q N4 CA N4 CA E N3 CA hE N2 Q N4',
    'hE N3 CA E Q N5 CA E N1 P D J',
  ]
  const kits = Object.entries(kitModels).filter(([, k]) => k?.variant) as [
    CharacterKey,
    KitModel,
  ][]
  it('covers the kits with versions', () => {
    expect(kits.length).toBeGreaterThan(40)
  })
  it.each(kits)('%s', (ck, kit) => {
    const plain: KitModel = { ...kit, variant: undefined }
    for (const text of texts)
      for (const cons of [0, 6]) {
        const play = (k: KitModel) => {
          try {
            const sim = simulateRotation({
              rotation: parseRotation(`${ck} ${text} -> ${ck}`, [
                { characterKey: ck, name: ck },
              ]),
              members: [ck],
              constellations: { [ck]: cons },
              elements: { [ck]: kit.element },
              kits: { [ck]: k },
              repeats: 2,
              keep: 'all',
            })
            return JSON.stringify({
              frames: sim.frames,
              actions: sim.actions.map((a) => [a.text, a.start, a.frames]),
              hits: sim.hits.map((h) => [h.t, h.path.join('.'), h.label]),
            })
          } catch (e) {
            return `throws ${(e as Error).message}`
          }
        }
        expect(play(kit), `${text} C${cons}`).toBe(play(plain))
      }
  }, 60_000)
})
