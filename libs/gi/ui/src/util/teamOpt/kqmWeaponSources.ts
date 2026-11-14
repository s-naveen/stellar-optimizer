import type { WeaponKey } from '@genshin-optimizer/gi/consts'

/**
 * Where each 4★ and 5★ weapon (and the three 3★ KQM counts) comes from, as the official HoYoLAB
 * wiki's "Source" field gives it
 * (fetched 2026-11-09, 143 4★; checked again 2026-11-13 with every 4★ and 5★: only Exaiphanes
 * Blade, a free 5★, was new). KQM mode's default weapons and refinements follow it: free ones
 * (forged, event, fishing) and the standard wish pool's 4★ (any banner's 4★ drops: "Wish") at
 * R5, Battle Pass ones at their setting (R1), one-copy rewards (quests, console mail) at R1; the
 * standard wish pool's 5★, event-wish-only ones (a weapon banner's rate-up: "Event Wish
 * Exclusive") and Starglitter-shop ones left out. A weapon not listed (newer than the list, or
 * any other 5★) counts as an event-wish weapon.
 */
export type KqmWeaponSource =
  | 'craft'
  | 'event'
  | 'bp'
  | 'fishing'
  | 'quest'
  | 'console'
  | 'starglitter'
  /** The standard wish pool: its 4★ from any banner, its 5★ from the standard banner */
  | 'standard'
  /** Event wishes only (a banner's rate-up), and the 5★ wish weapons */
  | 'gacha'

const sources: Record<
  Exclude<KqmWeaponSource, 'gacha'>,
  readonly WeaponKey[]
> = {
  craft: [
    'AmenomaKageuchi',
    'BlackmarrowLantern',
    'BladeOfAtonement',
    'ChainBreaker',
    'CompoundBow',
    'CovenantOfFrostAndSnow',
    'CrescentPike',
    'DragonspineSpear',
    'EarthShaker',
    'EchoesOfTheHeart',
    'Emberwell',
    'FinaleOfTheDeep',
    'FlowingPurity',
    'FluteOfEzpitzal',
    'FootprintOfTheRainbow',
    'ForestRegalia',
    'Frostbearer',
    'FruitOfFulfillment',
    'HakushinRing',
    'Hamayumi',
    'IronSting',
    'KatsuragikiriNagamasa',
    'KingsSquire',
    'KitainCrossSpear',
    'MappaMare',
    'MasterKey',
    'Moonpiercer',
    'ProspectorsShovel',
    'PrototypeAmber',
    'PrototypeArchaic',
    'PrototypeCrescent',
    'PrototypeRancour',
    'PrototypeStarglitter',
    'RightfulReward',
    'RingOfYaxche',
    'SapwoodBlade',
    'SerenitysCall',
    'SnareHook',
    'SongOfStillness',
    'SongOfTheVigil',
    'TidalShadow',
    'Whiteblind',
  ],
  event: [
    'AshGravenDrinkingHorn',
    'BalladOfTheBoundlessBlue',
    'CalamityOfEshu',
    'CinnabarSpindle',
    'Cloudforged',
    'DialoguesOfTheDesertSages',
    'DodocoTales',
    'EtherlightSpindlelute',
    'FadingTwilight',
    'FesteringDesire',
    'FlameForgedInsight',
    'IbisPiercer',
    'LuxuriousSeaLord',
    'MailedFlower',
    'MissiveWindspear',
    'OathswornEye',
    'RainbowSerpentsRainBow',
    'SequenceOfSolitude',
    'SilverLight',
    'TamayurateiNoOhanashi',
    'ToukabouShigure',
    'UltimateOverlordsMegaMagicSword',
    'WindblumeOde',
  ],
  bp: [
    'BalladOfTheFjords',
    'ClashOfKings',
    'Deathmatch',
    'ForgedByTheGoldenMelody',
    'Frostbreath',
    'HereticsMoltenBlade',
    'JadeVista',
    'SacrificialJade',
    'ScionOfTheBlazingSun',
    'SerpentSpine',
    'SolarPearl',
    'TalkingStick',
    'TheBlackSword',
    'TheViridescentHunt',
    'WolfFang',
  ],
  fishing: ['EndOfTheLine', 'FleuveCendreFerryman', 'TheCatch'],
  quest: [
    // 5★, the Traveler's (its effects are; anyone may wield it): "Great Deeds on the Tundra"
    'ExaiphanesBlade',
    'KagotsurubeIsshin',
    // also an event-wish weapon; one copy from the world quest "Echoes of an Unfinished Past"
    'MoonweaversDawn',
    'SnowTombedStarsilver',
    'SwordOfNarzissenkreuz',
  ],
  console: ['Predator', 'SwordOfDescension'],
  standard: [
    // 5★: the standard banner's (and a weapon banner's lost 50/50)
    'AmosBow',
    'AquilaFavonia',
    'LostPrayerToTheSacredWinds',
    'PrimordialJadeWingedSpear',
    'SkywardAtlas',
    'SkywardBlade',
    'SkywardHarp',
    'SkywardPride',
    'SkywardSpine',
    'WolfsGravestone',
    // 4★: any banner's
    'DragonsBane',
    'EyeOfPerception',
    'FavoniusCodex',
    'FavoniusGreatsword',
    'FavoniusLance',
    'FavoniusSword',
    'FavoniusWarbow',
    'LionsRoar',
    'Rainslasher',
    'Rust',
    'SacrificialBow',
    'SacrificialFragments',
    'SacrificialGreatsword',
    'SacrificialSword',
    'TheBell',
    'TheFlute',
    'TheStringless',
    'TheWidsith',
    // 3★: the only 3★ KQM counts (KQM_THREE_STARS), R5 like the 4★
    'HarbingerOfDawn',
    'Slingshot',
    'ThrillingTalesOfDragonSlayers',
  ],
  starglitter: [
    'BlackcliffAgate',
    'BlackcliffLongsword',
    'BlackcliffPole',
    'BlackcliffSlasher',
    'BlackcliffWarbow',
    'RoyalBow',
    'RoyalGreatsword',
    'RoyalGrimoire',
    'RoyalLongsword',
    'RoyalSpear',
  ],
}

/** The 3★ weapons KQM mode offers besides every 4★ and 5★ (standard wish pool, at R5) */
/**
 * Weapons the game gives one copy of (quest and console-mail rewards; Moonweaver's Dawn is also an
 * event-wish weapon): KQM gives each to one member of a team at most
 */
export const KQM_ONE_COPY: readonly WeaponKey[] = [
  ...sources.quest,
  ...sources.console,
].filter((key) => key !== 'MoonweaversDawn')

export const KQM_THREE_STARS: readonly WeaponKey[] = [
  'HarbingerOfDawn',
  'Slingshot',
  'ThrillingTalesOfDragonSlayers',
]

const byKey = new Map<string, KqmWeaponSource>(
  Object.entries(sources).flatMap(([source, keys]) =>
    keys.map((key) => [key, source as KqmWeaponSource])
  )
)

/** Where a weapon comes from (`gacha` for event-wish weapons and any weapon not in the list) */
export const kqmWeaponSource = (key: WeaponKey): KqmWeaponSource =>
  byKey.get(key) ?? 'gacha'
