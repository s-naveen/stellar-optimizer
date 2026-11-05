import type { AllStats } from '../executors/gen-stats/executor'

/**
 * The part of the game data that loading/validating a database (and a GOOD import) needs:
 * all artifact data, plus the weapon type and rarity of every character and weapon.
 * It is ~5% of allStat_gen.json.
 */
export function deriveCoreStats(all: AllStats) {
  return {
    art: all.art,
    char: {
      data: Object.fromEntries(
        Object.entries(all.char.data).map(([key, { weaponType, rarity }]) => [
          key,
          { weaponType, rarity },
        ])
      ) as {
        [K in keyof AllStats['char']['data']]: Pick<
          AllStats['char']['data'][K],
          'weaponType' | 'rarity'
        >
      },
    },
    weapon: {
      data: Object.fromEntries(
        Object.entries(all.weapon.data).map(([key, { weaponType, rarity }]) => [
          key,
          { weaponType, rarity },
        ])
      ) as {
        [K in keyof AllStats['weapon']['data']]: Pick<
          AllStats['weapon']['data'][K],
          'weaponType' | 'rarity'
        >
      },
    },
  }
}

export type CoreStats = ReturnType<typeof deriveCoreStats>
