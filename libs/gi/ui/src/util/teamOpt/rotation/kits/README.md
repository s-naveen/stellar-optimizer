# Character kits for the rotation simulator

One file per character: `kits/<CharacterKey>.ts`, exporting `export const kit: KitModel`.
`index.ts` is generated from this folder (don't edit it by hand). Frame data is adapted from
gcsim (https://github.com/genshinsim/gcsim, AGPLv3; this project is AGPLv3 too) with credit in
each file's header and `source`.
Regenerate the registry with `node tools/scripts/gen-rotation-kits.mjs` from the repository root.

Danica, Mitya and Anastasya (alias Tsaritsa) use
[KQM-git/kqmsim at 7bdf45f](https://github.com/KQM-git/kqmsim/tree/7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c/internal/characters).
The source URL is stored on each kit. They share the existing timeline and damage evaluator;
the browser does not download or run the fork's Go executable. Keep the source commit pinned
when updating mechanics, and compare hit counts, timing, conditions and damage before changing it.

KQM-source limits are surfaced as rotation warnings/notes. Danica's Battle Maid / Anchor normals
and Anastasya's Honor form are unimplemented in that source. Danica's C2 Toast consumption is
not timed. Anastasya's C2 Love CRIT DMG uses the sheet's Love Blessing window rather than an
independent 30-second condition; C6 automatic Triumph is not timed. Other automatic sheet
bonuses still apply through their active conditions. Mitya's C6 refunds use a
deterministic probability accumulator. These limits mean registration is not a claim that every
action and constellation is fully supported.

Read first: `../types.ts` (the types), `./common.ts` (helpers), and the finished examples
`Illuga.ts` (simple: normals, charged, tap/hold skill, burst, a counted buff), `Columbina.ts`
(summon ticking every N frames, triggered damage) and `Zibai.ts` (a stance that changes later
actions, a resource gating an action, cooldown keys).

`Vodyanitsa.ts` demonstrates shared-reaction buff pools: `onReactionSnapshot` attaches
eligibility when the reaction is queued, and `onHit` spends its pool on impact. Use
`ctx.atCharacter(member, delay, fn)` for tasks paused by that member's hitlag; ordinary `ctx.at`
uses world time. C0 Lohen and Vodyanitsa source discrepancies remain documented in the
priority fixture audits; registration does not certify every action or constellation.

## What a kit does

`act(ctx, state, action, previous)` is called when the character performs an action from the
rotation text: `normal` (with `count` = how many hits of the string: N4 → 4), `charged`, `skill`
(`hold` true for hE), `burst`, `plunge`, `dash`, `jump`. It schedules damage with
`ctx.hit(delayFrames, {...})`, buffs with `ctx.buff(owner, path, value, delay, duration)`, later
work with `ctx.at(delay, fn)` (summon ticks), and returns how long the action takes:

- `frames`: default length (gcsim's default / walk frames).
- `framesInto`: cancel frames into the next action by kind (`normal`, `charged`, `skill`, `burst`,
  `dash`, `jump`, `swap`). Take them from gcsim's frame tables (`frames.InitNormalCancelSlice`,
  `InitAbilSlice`, then the per-action overrides like `xFrames[action.ActionSwap] = 36`).
- `cooldown`: `{ key: 'skill' | 'burst', frames, delay }` from gcsim's `SetCD` / `SetCDWithDelay`.

Frames are 60 fps; use gcsim's raw numbers. Normal-attack strings: build a `NormalHit[]` table and
use `normalString` (see Illuga). Add gcsim's windup to the hitmarks if it has one.
`NormalHit.hitlag` can supply the pause for each hit against the standard enemy; `normalString`
then adjusts later hits and cancel frames. `withHitlag` applies the same adjustment to a single
ability. The engine adds the 12-frame swap and respects the one-second swap cooldown; do not
include swap time again in a kit's cancel frames. Events landing on a cancel frame run before
the next action or swap.

## Every damage instance (`ctx.hit`)

```ts
ctx.hit(hitmark, {
  path: ['skill', 'pressDmg'],   // the node in OUR sheet (see below), never a gcsim name
  tag: 'skill',                 // normal | charged | plunge | skill | burst | directLunarCrystallize | reactionLunarCrystallize | other
  element: 'geo',               // the hit's element; 'physical' for physical
  applies: true,                // durability > 0 (it applies its element)
  durability: 25,               // gcsim's Durability (default 25; 50 for "2U")
  icd: 'none',                  // 'none' for ICDTagNone; otherwise a group name ('normal', 'skill', 'burst', or gcsim's tag name)
  label: 'Dawnbearing Songbird',// readable, English, as players call it
})
```

- Take hitmarks from gcsim (`QueueAttack(..., hitmark)` / `QueueCharTask(..., hitmark)`), plus travel
  if it has one.
- Multi-hit attacks: one `ctx.hit` per instance.
- Summons, turrets, DoTs and coordinated attacks: schedule ticks with `ctx.at(interval, tick)` and
  `ctx.hit(0, …)` inside the tick (see Columbina's Gravity Ripple). Keep the duration and interval
  from gcsim, and the first tick's delay.
- Things triggered by other members' hits ("when the active character hits…", "on reaction"):
  implement `onHit(ctx, state, hit)`. It sees every hit in time order (`hit.characterKey`,
  `hit.onField`, `hit.tag`, `hit.element`). Use `ctx.hit(…, { characterKey: '<YourKey>', … })`
  for the damage, with its gcsim delay. Respect gcsim's ICDs (keep the last frame in `state`).
- Element application: `applies`/`durability`/`icd` exactly as in the gcsim AttackInfo
  (Durability 0 → `applies: false`).

## Paths: our sheet's nodes

Our sheet is `libs/gi/sheets/src/Characters/<Key>/index.tsx` (`const dmgFormulas = { … }`).
A path is `[section, node]`:

- Normal attacks: `['normal', '0']`, `['normal', '1']`, … (0-based, the 1st hit of the string is
  '0'). A hit with several instances in one string step uses the same node.
- Charged: `['charged', 'dmg']` or the names in the sheet (e.g. 'dmg1', 'dmg2', 'aimed',
  'fullyAimed'). Plunge: `['plunging', 'dmg' | 'low' | 'high']`.
- Skill / burst / passives / constellations: the keys in `dmgFormulas.skill`, `.burst`,
  `.passive1`, `.constellation2`, … Read the sheet: the key names are not gcsim's.
- Only damage nodes (not shields or heals). If gcsim has damage the sheet doesn't have, skip it and
  add a comment `// not in our sheet: <gcsim abil>`.
- Templates: some sheets build normal/charged/plunging from `dmgForms` helpers (`charTemplates`);
  their nodes still sit at `normal.0`, `charged.dmg`, `plunging.dmg/low/high`.

## Buffs

A buff the kit times is a conditional of the sheet: `ctx.buff('<Key>', ['<Key>', '<condKey>'],
'<state>', delay, durationFrames)`. The cond keys are the second argument of `cond(key, '…')` in the
sheet, and the states are its `states` keys. Only time buffs that exist as a sheet conditional,
and only ones with a duration in gcsim. Stacking buffs: one window per stack event with value
'1' (the engine counts overlaps for paths containing "stack"), passing the most stacks as the 6th
argument of `ctx.buff` when it is not 3. `cooldownKey(state, action, now)` gets the frame the
action would start. Hit-count buffs (e.g. "next N
hits"): `countedBuffs` (see Illuga).

For a resource or stance that changes continuously, use `ctx.state(owner, path, value)`. It closes
the previous interval at the current frame; `''` disables the condition. Use `ctx.buff` for timed
or independently stacking effects. A hit can carry `states` to snapshot specific conditions before
resources are consumed (Mitya's prism detonation); other conditions still use the hit's timeline.
`ctx.radiance` reports the current Conduct or Swirl state from the reaction engine.

`onSwapIn` can return an automatic entry action; its duration precedes the requested action.
`swapReadyAt` gates swapping into a sealed character and is rechecked as scheduled hits land.
A channel whose duration grows as resources arrive can return `duration: () => frames`; the engine
runs scheduled events and rechecks until the channel ends. Action listeners run before those events.

## Constellations and state

`ctx.constellation('<Key>')` gives the member's constellation; gate C-effects on it. Use `init()` +
`state` for stances, resources, ICDs. `cooldownKey` when an action's cooldown depends on state
(Zibai's Stride has none).

## Don'ts

- No imports outside `../types`, `../parse`, `./common`, `../lunarCrystallize`,
  `@genshin-optimizer/gi/consts` (types).
- Don't edit other kits, `index.ts`, `common.ts` or the engine.
- If something can't be modelled, `ctx.note('<Key>: … not modelled')` once, and keep going.

## Engine features (added later — use them instead of hand-rolled versions)

- **Reactions are simulated by the engine** (`../reactions.ts`, a port of gcsim's reactable). Do not
  track auras in a kit. A kit sees every reaction as a marker hit in `onHit`: `hit.path[0] ===
  '_reaction'`, `hit.path[1]` = the reaction (vaporize, melt, aggravate, spread, overloaded,
  superconduct, electroCharged, lunarCharged, frozen, shattered, quicken, burning, bloom, lunarBloom,
  crystallize, lunarCrystallize, moondriftHarmony, stellarConduct, stellarSwirl, pyroSwirl,
  hydroSwirl, electroSwirl, cryoSwirl), `hit.characterKey` = who triggered it, `hit.onField` = who
  was on the field. Transformative reaction damage hits are `path[0] === 'reaction'` (e.g.
  `['reaction', 'hyperbloom']`). "On reaction" talents (Fischl A4, Nahida's Tri-Karma, …) must
  use these.
- **The active character's normal attacks** (Xingqiu, Yelan, Thoma, Fischl C6): `watchAction` in
  `common.ts`, fed by `onPartyAction(ctx, state, actor, action, frames)` (every member's action,
  your own included).
- **Cooldowns at any time**: `ctx.setCooldown(key, frames, characterKey?)` makes a cooldown ready
  `frames` from now (e.g. Xilonen's skill from the moment she leaves the field, in `onSwapOut`);
  `ctx.reduceCooldown(key, frames, characterKey?)` shortens a running one. An action's own
  `cooldown` result still applies after `act`.
- **Party infusions**: `ctx.infuse(element, delay, duration)` (on-field Sword/Claymore/Polearm
  users' Physical normal/charged/plunge hits).
- **ICD**: `icd` is the gcsim ICD tag (hits of one tag share a counter); `icdGroup` the gcsim group
  name from `../icdGroups.ts` when it is not the default.
- **Lunar/Stellar direct damage**: a kit's own "considered Lunar-Charged/-Bloom/-Crystallize or
  Stellar DMG" hits are ordinary `ctx.hit`s on the sheet's node for them (they are not reactions).
- `ctx.sets(characterKey)` gives a member's artifact set pieces when known.
- **HP changes**: emit a `['_marker', 'hpChange']` hit when HP actually changes. Gear effects use
  these for Marechaussee Hunter. Overhealing alone does not create an HP-change marker.
- **Healing**: emit `['_heal', ...healingNodePath]`, e.g. `['_heal', 'skill', 'heal']`, with
  `weight` equal to the number of party members healed. These events do not trigger attack
  listeners or reactions. Ocean-Hued Clam collects them for three seconds, then creates a
  damage entry with the healing contributions. Its formula recalculates healing from build
  stats and caps the accumulated amount at 30,000 HP. The current implementation evaluates
  those healing nodes with the bubble's buff state; it does not snapshot each individual heal.
- **Gear timing**: `SimGear` includes set pieces, weapon key and refinement. Sacrificial weapons
  use accumulated proc probability for reproducible timing, with their real refinement-based
  cooldown and on-field restriction. This is an estimate, not a random trial; the run's notes
  disclose it. A generated rotation reflects the gear supplied to the simulator.

## Regression checks

`rotationTiming.test.ts` covers boundary events, swaps, cooldown reductions and gear windows.
`rotationGear.test.ts` covers HP-change stacks, healing-based Clam damage, persistence and
weapon effects. `kitCheck.test.ts` checks every registered kit's sheet paths.
`kqmsimKits.test.ts` covers the fork's three new kits, alias, automatic entry, seal, radiance,
prism cap, channel duration and resource snapshots.
`gcsimCompare.test.ts` accepts comma-separated `GCSIM_TEAM` path prefixes for external build,
rotation and reference fixtures, so several teams can share one test run. The fixtures remain
outside the repository. It ranks Lunar contributors by reaction damage, as the rotation writer
does, and reports both rotation duration and DPS; matching DPS alone does not establish matching
timing, reaction ownership, or buff snapshots.
