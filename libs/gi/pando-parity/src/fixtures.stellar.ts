import type { ParityFixture } from './harness'

type Conds = {
  anchor?: boolean
  maidForm?: 'defense' | 'battle'
  burstEnhanced?: boolean
  a4Stacks?: number
  radiance?: boolean
  c2Toast?: boolean
  c2SelfToast?: number
}
export const danicaFixture = (
  c: number,
  conds: Conds = {},
  hitMode: ParityFixture['hitMode'] = 'avgHit'
): ParityFixture => {
  const wr: Record<string, string | number> = {}
  const pandoConditionals: NonNullable<ParityFixture['pandoConditionals']> = []
  const push = (name: string, value: number) =>
    pandoConditionals.push({
      sheet: 'Danica',
      src: '0',
      dst: null,
      name,
      value,
    })
  const bool = (k: keyof Conds, name: string) => {
    if (conds[k]) {
      wr[name] = 'on'
      push(name, 1)
    }
  }
  bool('anchor', 'anchor')
  bool('burstEnhanced', 'burstEnhanced')
  bool('radiance', 'a0StellarRadianceSc')
  bool('c2Toast', 'c2Toast')
  if (conds.maidForm) {
    wr.maidForm = conds.maidForm
    push('maidForm', conds.maidForm === 'defense' ? 1 : 2)
  }
  if (conds.a4Stacks) {
    wr.a4Stacks = String(conds.a4Stacks)
    push('a4Stacks', conds.a4Stacks)
  }
  if (conds.c2SelfToast) {
    wr.c2SelfToast = String(conds.c2SelfToast)
    push('c2SelfToast', conds.c2SelfToast)
  }
  return {
    members: [
      {
        char: {
          key: 'Danica',
          level: 90,
          talent: { auto: 9, skill: 9, burst: 9 },
          ascension: 6,
          constellation: c,
        },
        weapon: {
          key: 'WolfsGravestone',
          level: 90,
          ascension: 6,
          refinement: 1,
          location: 'Danica',
          lock: false,
        },
      },
    ],
    enemy: { lvl: 90, preRes: 0.1 },
    hitMode,
    wrConditionals: { Danica: wr },
    pandoConditionals,
  }
}
