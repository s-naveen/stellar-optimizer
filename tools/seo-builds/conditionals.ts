import {
  type ArtifactSetKey,
  allArtifactSetKeys,
  allWeaponKeys,
  type WeaponKey,
} from '@genshin-optimizer/gi/consts'
import { getArtSheet, getWeaponSheet } from '@genshin-optimizer/gi/sheets'

/** What the scenario's character does, used to decide which set/weapon effects she triggers herself */
export type Ctx = {
  /** attack types she uses in the scenario */
  attacks: Array<'normal' | 'charged' | 'plunging' | 'skill' | 'burst'>
  /** elements / Stellar reactions on the enemy during the scenario */
  auras: string[]
}

type Doc = {
  path?: string[]
  name?: unknown
  states?: Record<string, unknown>
}

/** i18n key of a conditional's label, e.g. "charOffField" or "hitOp.skill" */
function nameKey(name: unknown): string {
  const n = name as { props?: { key18?: string; i18nKey?: string } }
  return (
    n?.props?.key18 ??
    n?.props?.i18nKey ??
    (typeof name === 'string' ? name : '')
  )
}

/**
 * Effects that need something the solo, on-field character can't do herself are left off: being off-field,
 * shields, healing, taking damage, HP changes, Bond of Life, defeating enemies, low-HP enemies, party-wide
 * energy or elements, reactions with teammates, nightsoul/Moondrift/Lunar/Bloom/Burning/Stellar Swirl
 * mechanics.
 */
const OFF =
  /offField|OffField|[sS]hield|takeDmg|afterHeal|hpChange|bond\.|afterDefeatEnemy|enemyLessPercentHP|^party$|team\.|moondrift|[lL]unar|[bB]loom|burgeon|nightsoul|swirlReaction|weakSpot|plunging|afterReaction|stellarswirl/

/**
 * Per-item choices the name alone can't decide: a state to use, `null` for off, or `undefined` to
 * fall through to the general rules.
 */
const OVERRIDES: Partial<
  Record<string, (ctx: Ctx, cond: string) => string | null | undefined>
> = {
  // needs a Geo teammate's Crystallize shard
  ArchaicPetra: () => null,
  // needs a healer
  SongOfDaysPast: () => null,
  // needs Burning enemies nearby
  UnfinishedReverie: () => null,
  // the 4-piece procs at random: use its average
  EchoesOfAnOffering: () => 'avg',
  // a Stellar team has no Hydro, so enemies are Cryo-affected, not Frozen
  BlizzardStrayer: (ctx) => (ctx.auras.includes('cryo') ? 'cryo' : null),
  // Gilded Dreams' team counts follow the (solo) team
  GildedDreams: (_ctx, cond) =>
    cond.startsWith('override') ? null : undefined,
  // the 4 stacks need HP loss; the after-burst ATK stays
  VermillionHereafter: (_ctx, cond) => (cond === 'stacks' ? null : undefined),
  // Seals come from teammates' Crystallize shards
  Verdict: () => null,
  // both pieces need Nightsoul's Blessing / Nightsoul points
  ObsidianCodex: () => null,
  // counts teammates of other elements: the assumed party (see PARTY)
  ChainBreaker: () => '3',
  // needs a Hydro/Dendro Elemental Skill and Lunar-Bloom: not these Electro/Cryo Stellar teams
  NightweaversLookingGlass: () => null,
  // one stack each from Normal, Charged, Skill and Burst hits
  PolarStar: (ctx) => (ctx.attacks.includes('charged') ? '4' : '3'),
  // averaged over its cycle by the generator (CYCLES)
  ForgedByTheGoldenMelody: () => null,
  // Royal stacks reset on every CRIT hit: about one stack on average
  RoyalBow: () => '1',
  RoyalGreatsword: () => '1',
  RoyalGrimoire: () => '1',
  RoyalLongsword: () => '1',
  RoyalSpear: () => '1',
}

/**
 * Weapons also ranked at refinements other than the default (5★ R1, 4★ R5). Each one listed here is
 * always kept in the output and shown on the page, even outside the top rows.
 */
export const REFINEMENTS: Record<string, number[]> = {
  JadeVista: [1, 5],
}

/** Jade Vista: ATK per teammate of another element, by refinement */
const JADE_VISTA_ATK = [12, 15, 18, 21, 24]
/**
 * Passives that count the party's elements are ranked with an assumed party: three teammates of
 * other elements than the character's (e.g. the Tsaritsa with Danica, Mitya and Valeriy). Sheets that
 * count the real team (solo here) get the effect as bonus stats; conditional ones are set in
 * OVERRIDES. `note` is shown next to the weapon on the page.
 */
export const PARTY: Record<
  string,
  {
    bonus?: (refinement: number) => Record<string, number>
    note: (refinement: number) => string
  }
> = {
  JadeVista: {
    bonus: (r) => ({ atk_: 3 * JADE_VISTA_ATK[r - 1] }),
    note: (r) =>
      `with three teammates of other elements: +${3 * JADE_VISTA_ATK[r - 1]}% ATK`,
  },
  ChainBreaker: { note: () => 'with three teammates of other elements' },
}

/**
 * Effects that rotate through states over time: the item is ranked by its average over the states
 * (each state's best build), not by its best state.
 */
export const CYCLES: Record<string, Array<Record<string, string>>> = {
  // every 10s: +ATK, then +EM, then +Stellar Glimmer DMG (Contrapuntal left off: it needs her to
  // trigger the reaction herself)
  ForgedByTheGoldenMelody: [
    { movement: '1' },
    { movement: '2' },
    { movement: '3' },
  ],
}

function choose(
  itemKey: string,
  doc: Doc,
  ctx: Ctx
): [string[], string] | undefined {
  if (!doc.path || !doc.states) return undefined
  const states = Object.keys(doc.states)
  const cond = nameKey(doc.name)
  const condKey = doc.path[doc.path.length - 1]
  const override = OVERRIDES[itemKey]?.(ctx, condKey)
  if (override === null) return undefined
  if (typeof override === 'string') return [doc.path, override]
  if (OFF.test(cond)) return undefined
  const has = (a: Ctx['attacks'][number]) => ctx.attacks.includes(a)
  let on = true
  if (/hitOp\.normalChargedSkillBurst/.test(cond)) on = true
  else if (/hitOp\.normalOrCharged/.test(cond))
    on = has('normal') || has('charged')
  else if (/hitOp\.charged/.test(cond)) on = has('charged')
  else if (/hitOp\.normal/.test(cond)) on = has('normal')
  else if (/hitOp\.skillOrBurst|afterUse\.skillOrBurst/.test(cond))
    on = has('skill') || has('burst')
  else if (/hitOp\.skill|afterUse\.skill/.test(cond)) on = has('skill')
  else if (/afterUse\.burst/.test(cond)) on = has('burst')
  else if (/hitOp\.cryo/.test(cond)) on = ctx.auras.includes('cryo')
  else if (/enemyAffected\./.test(cond)) {
    const want = cond
      .split('.')[1]
      .split(/Or/)
      .map((s) => s.toLowerCase())
    on = want.some((w) => ctx.auras.includes(w))
  } else if (
    /elementalReaction\.stellar\.triggerOrHit|stellarglimmer/.test(cond)
  )
    on = ctx.auras.some((a) => a.startsWith('stellar'))
  if (!on) return undefined
  // highest stack / last state
  return [doc.path, states[states.length - 1]]
}

function setPath(obj: Record<string, any>, path: string[], value: string) {
  let o = obj
  for (const p of path.slice(0, -1)) o = o[p] ??= {}
  o[path[path.length - 1]] = value
}

/** Conditional values for every 5★ set and every weapon, chosen for the scenario */
export function itemConditionals(ctx: Ctx) {
  const out: Record<string, any> = {}
  const picked: string[] = []
  const add = (itemKey: string, docs: Doc[] | undefined) => {
    for (const d of docs ?? []) {
      const c = choose(itemKey, d, ctx)
      if (!c) continue
      setPath(out, c[0], c[1])
      picked.push(`${c[0].join('.')}=${c[1]}`)
    }
  }
  for (const k of allArtifactSetKeys as readonly ArtifactSetKey[]) {
    const s = getArtSheet(k) as any
    add(k, s?.setEffectDocument?.(2))
    add(k, s?.setEffectDocument?.(4))
  }
  for (const w of allWeaponKeys as readonly WeaponKey[]) {
    const s = getWeaponSheet(w) as any
    add(w, s?.document)
  }
  return { conditional: out, picked }
}
