import type {
  IArtifact,
  ICharacter,
  IWeapon,
} from '@genshin-optimizer/gi/schema'
export interface IGOOD {
  format: 'GOOD'
  source: string
  version: 1 | 2 | 3
  characters?: ICharacter[]
  artifacts?: IArtifact[]
  weapons?: IWeapon[]
}
