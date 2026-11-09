# Adding a new GI character from a YuanShenResources dump

Runbook + scripts used to add **Mitya** (7.2 beta, avatar id `10000136`) from
https://gitlab.com/GuraFoundation/YuanShenResources. Follow the same steps for the next character.

> ⚠️ **Memory:** each gen target loads ~1.3 GB of TextMaps. Always run gen targets **one at a time**
> (`--parallel=1`, or one `nx run` per target). Running them in parallel froze the Mac once.

## 0. One-time setup

```sh
# Node 24 is required (.nvmrc). fnm is installed via brew.
eval "$(fnm env)" && fnm use 24
# Clone the dump (blobless + sparse; only the folders the pipeline reads, ~1.6 GB)
git clone --depth 1 --filter=blob:none --no-checkout https://gitlab.com/GuraFoundation/YuanShenResources.git YuanShenResources
cd YuanShenResources && git sparse-checkout set --no-cone '/ExcelBinOutput/' '/TextMap/' && git checkout && cd ..
# (YuanShenResources/ is in .git/info/exclude)
```
To update later: `cd YuanShenResources && git pull`.

## 1. Read the kit

```sh
# Find the avatar id: search TextMap_MediumEN.json for the name, then AvatarExcelConfigData for nameTextMapHash
python3 -I tools/dump-import/dump_kit.py YuanShenResources "<Name>"
```
`dump_kit.py` prints every talent's param descriptions, lv1/10/13 values, passives, constellations.
Also read the hyperlink glossary (`HyperLinkNameExcelConifgData.json`, key `ID`) for mechanics
such as "Detection Core" / "Gradient Beacons".

## 2. Register the character

- `libs/gi/consts/src/character.ts` → add key to `allNonTravelerCharacterKeys` (alphabetical)
- `libs/gi/dm/src/mapping/character.ts` → `<avatarId>: '<Key>'`

## 3. Generate data + images from the dump (ONE generator at a time)

```sh
cd YuanShenResources && git fetch --depth 1 origin && git reset --hard origin/main && cd ..   # optional: latest beta
tools/dump-import/use_dump.sh            # links dump into libs/gi/dm/GenshinData, rounds floats, swaps deobf names
tools/dump-import/snapshot.sh            # snapshot all generated outputs (to /tmp/gi-dump-snapshot)
# Run each separately and CHECK that it prints "Successfully ran target" (a silent failure happened once in a loop):
NX_DAEMON=false yarn nx run gi-stats:gen-file           --skip-nx-cache --excludeTaskDependencies
NX_DAEMON=false yarn nx run gi-dm-localization:gen-file --skip-nx-cache --excludeTaskDependencies
NX_DAEMON=false yarn nx run gi-assets-data:gen-file     --skip-nx-cache --excludeTaskDependencies
# images (placeholders, see §4) — BEFORE cleanup, because loading the dm library rewrites its debug dumps
tools/dump-import/make_placeholders.sh <Key>
NX_DAEMON=false yarn nx run gi-assets:gen-file          --skip-nx-cache --excludeTaskDependencies
# allow-list is computed for you (new mats + tooltips are detected against the snapshot):
ALLOW=$(python3 -I tools/dump-import/find_allow_list.py /tmp/gi-dump-snapshot <Key> [<Key2> ...])
tools/dump-import/cleanup_after_gen.sh "$ALLOW"
tools/dump-import/restore_dm.sh
# beta TextMaps prefix unfinished strings with "test" ("test Danica Normal Attack", "testC2")
python3 -I tools/dump-import/strip_placeholder_text.py libs/gi/dm-localization/assets/locales/*/char_<Key>_gen.json
```
Then **restart the dev server** (`pkill -f "nx serve frontend"; rm -rf node_modules/.vite`, start again):
gi-assets writes the index before the new folder exists and Vite caches the "missing" import.

`find_allow_list.py` outputs: `<Key>`, `<Key>sStellaFortuna`, avatar id, **new** materials (key + id) used by
ascension/talents, and tooltip ids referenced by `char_<Key>_gen.json` that are new. Examples:
- Mitya: `Mitya,MityasStellaFortuna,10000136,Kristallfold,101274,ShatteredStabilityAnchor,113093,11360001,11360002`
- Danica+Anastasya: `Danica,…,10000147,DamagedFlint,113097,11470001-5,Anastasya,…,10000149,FairyWormwood,101273,11490001-5`

Why cleanup: the dump is a *newer/beta* build, so generation also pulls in other unreleased
items and debug-map changes. Cleanup keeps only allow-listed additions in shared files and restores
every other generated file from the snapshot (idempotent — safe to re-run; re-run it if any later step
imported the dm library while the dump was linked). With Mitya/Danica/Anastasya all existing
characters/weapons came out identical.

Expected new files: `libs/gi/stats/Data/Characters/<Key>/{data,skillParam}.json`,
`libs/gi/dm-localization/assets/locales/*/char_<Key>_gen.json`, `libs/gi/assets/src/gen/chars/<Key>/`.

## 4. Images

The dump has **no images**. `api.hakush.in` is blocked by the Claude Code sandbox proxy.
- Placeholders: `tools/dump-import/make_placeholders.sh <Key>` → writes `libs/gi/dm/Texture2D/*.png` (gitignored);
  gi-assets gen-file copies them to `libs/gi/assets/src/gen/chars/<Key>/` and adds the index entry.
- Real images: put the real PNGs (same file names, see `AssetsData_gen.json` → `chars.<Key>`) in
  `libs/gi/dm/Texture2D/` and re-run gi-assets gen-file; or overwrite files in `libs/gi/assets/src/gen/chars/<Key>/`.
- Real images from the Fandom wiki (once a character is announced):
  `python3 -I tools/dump-import/fetch_wiki_art.py <Key> <element> [--card "File:<Name> Illustration.png"]`
  fetches icon, side icon, namecard, talent/constellation icons ("Talent <name>.png" /
  "Constellation <name>.png", converted to the game's light glyph on transparent) and the character card,
  writes them to both places above, and generates text-free stand-ins (star glyph, element gradient
  namecard, scaled side icon) for whatever the wiki does not have yet. Re-run it later to pick up more.
  Note: the wiki CDN serves WebP unless `format=original` is added (the script does). Hard-reload the
  dev page afterwards: the browser caches the old images under the same URLs.
  Sources: `https://api.hakush.in/gi/UI/<name>.webp` (convert to png), or enka.network after release.
- Character card: `libs/gi/char-cards/src/Character_<Key>_Card.webp` + import/entry in `libs/gi/char-cards/src/index.ts`.

## 5. Write the sheets

| What | Files |
|---|---|
| Sheet (WR, the site's calculation engine) | `libs/gi/sheets/src/Characters/<Key>/index.tsx`, register in `.../Characters/index.ts` |
| Manual strings | `libs/gi/localization/assets/locales/en/char_<Key>.json` (`ct.ch(...)` keys) |

Reference characters:
- Stellar-Conduct direct DMG + base-DMG bonus: **Sandrone** (`stellarDmgNode(mult, stat, 'stellarconduct', ele)`)
- Radiance / Polestar Field cond + active-char team buffs: **Alyosha** (`flags.radiance`, `equal(input.activeCharKey, target.charKey, …)`)
- ATK+EM split scaling: `splitScaleDmgNode`
- Stat keys: `<reaction>_baseDmg_` (base DMG increase), `<reaction>_specialDmg_` (= "Elevated"), `<ele>_enemyRes_` (negative = shred)
- skillParam index order follows the param list in the dump; generated `skillParams` labels may merge entries (e.g. "Low/High Plunge" is one label for 2 params) so label indexes can be offset from param indexes.

### Pitfalls learned (Danica/Anastasya)
- **English beta text loses "Elevated"**: check CHS (`TextMapCHS`): 擢升 = Elevated (`*_specialDmg_`), 提升 = increased (`*_dmg_`).
- **WR `infoMut` mutates the node**: never `infoMut` the same node twice with different paths, and don't spread-copy
  (`{...node}`) for display — the copy loses its label/units. Use a factory (`const mk = () => …`) per use.
- **List conditionals** use the state string as their value.
- Community datamine notes (ICDs, particles, hidden numbers like Sealing meters / Accolades split) are in the
  JSM Faucet Discord (#genshin-updates, #genshin-theorycrafting, off-topic leak discussion). **Read-only.**
  Server search + reading `[id^="message-content"]` innerText via the Chrome extension works well.

## 6. Verify

```sh
NX_DAEMON=false yarn nx run-many -t typecheck -p gi-sheets frontend --excludeTaskDependencies --parallel=1
```
Then open the character in the browser (team page + each tab, toggle every conditional) and check the console.

## 6b. Weapons and artifact sets

Done 2026-11-05 for **TorrentsOfSpring** (12517, claymore), **StarsealedEdict** (14525, catalyst),
**Silverdawn** (15517, bow) and the 7.3 sets **LegacyOfTheFirstChronicle** (15049, 肇史之遗) and
**PreludeOfTheKingfisherCanopy** (15050, 遥天奉翠华引). Find new items with
`WeaponExcelConfigData` / `ReliquarySetExcelConfigData` ids that are not in `libs/gi/dm/src/mapping/{weapon,artifact}.ts`
(skip test items whose `skillAffix` is `[0, 0]`; read texts in `TextMapEN` *and* `TextMap_MediumEN`).

1. Register: `libs/gi/consts/src/{weapon,artifact}.ts` (alphabetical, per weapon type) and
   `libs/gi/dm/src/mapping/{weapon,artifact}.ts` (`<id>: '<Key>'`). Until the sheets exist (step 5) the
   Optimize tab crashes (`getArtSheet(...)` undefined): do steps 1–5 in one go.
2. `use_dump.sh` → `snapshot.sh` → gen targets one at a time: gi-stats, gi-dm-localization, gi-assets-data.
3. Images: `fetch_lunaris_art.sh weapon <Key>...` / `artifact <Key>...` downloads the real icons (beta
   builds included) from Lunaris (`https://api.lunaris.moe/data/assets/{weaponicon,artifacts}/<name>.webp`;
   other folders: avataricon, avatarcard, avatarside, namecardicon, namecardpic, skills, items) and installs
   them as PNG in Texture2D and the gen folder; no regeneration needed. For anything Lunaris lacks,
   `make_item_standins.sh weapon|artifact <Key>...` writes text-free stand-ins (the app's weapon-type / slot
   glyph); real art already in `libs/gi/dm/Texture2D` (same file names) is kept. Official icons of *announced* items, under the game's own file
   names, are on Yatta: `https://gi.yatta.moe/assets/UI/<name>.png` (e.g. `UI_EquipIcon_Catalyst_Chernaya_Awaken`;
   256×256, drop straight into Texture2D and `libs/gi/assets/src/gen/<kind>/<Key>/`). The Fandom wiki has
   renders (`File:Weapon <Name>.png`, `format=original`, fit to 256×256). Beta-only items: hakush.in /
   homdgcat (both blocked on this network, also in Chrome), Honey Hunter (Cloudflare, often down). Then gi-assets gen-file and **ask
   whoever runs the dev server to restart it** (Vite caches the missing folders and 500s the gen indexes).
4. Text: `strip_placeholder_text.py` on the new `weapon_<Key>_gen.json` / `artifact_<Key>_gen.json` (all
   languages; it also removes the JA `JP3A` build tag), then
   `cleanup_after_gen.sh "<keys>,<weapon ids>,1<weapon id>,<set ids>,2<set id>"` (merges the
   weapon/affix/set aggregates and the weapon/set name files; restores everything else, including files
   of earlier imports that the regeneration rewrote), then `apply_en_overrides.py`
   (`en_overrides.json`: English set/piece names the dump lacks; drops empty or placeholder names in other
   languages so they fall back to English), then `restore_dm.sh`.
5. Sheets: `libs/gi/sheets/src/Weapons/<Type>/<Key>/index.tsx` (+ type `index.ts`) /
   `libs/gi/sheets/src/Artifacts/<Key>/index.tsx` (+ `index.ts`); manual strings in
   `libs/gi/localization/assets/locales/en/{weapon,artifact}_<Key>.json`.
6. Check: typecheck `gi-sheets` and `frontend` (§6), then the Weapons/Artifacts pages, a team view
   with the item equipped (toggle every conditional) and the Optimize tab in the browser.

Notes from this batch:
- The dump spells the set table's affix field `EquipAffixId`; `use_dump.sh` renames it (without that,
  gen-locale and gen-assets-data silently skip every artifact set).
- Weapon sheets add `refinementBonus` stats themselves (`allStats.weapon.data[key].refinementBonus`).
- Stellar Glimmer = Stellar-Conduct + Stellar Swirl (HyperLink 11500004). WR Stellar hits sum general +
  `<reaction>_critRate_` + `<element>_critRate_` (wr/reaction/special.ts), so "CRIT Rate of Cryo DMG" is
  `cryo_critRate_`.
- Radiance: weapons read `input.flags.radiance` (set by the wielder's character sheet).
- "Active character" buffs: `equal(input.activeCharKey, target.charKey, …)` in `teamBuff`.

Modelling notes / assumptions (beta text, may change):
- TorrentsOfSpring: ATK +16–32% always; "Royal Decree" list toggle (Royal Decree / Order Complete). The
  Stellar-Conduct DMG bonus (20–40%, doubled when Complete) goes to the active character, wielder included.
  The beta English text calls it "Imperial Edict" at R4–R5; the R1 name is used.
- StarsealedEdict: CRIT DMG from `refinementBonus`; Crystal Compounding (EM) toggle, Law of Combustion
  stacks 1–3 (only shown while Compounding is on), Stellar-Conduct CRIT DMG per stack only in Radiance:
  Stellar-Conduct. Params 5 and 0.75 are not described in the text and are not used.
- Silverdawn: one toggle for White Crown's Bequest (ATK + Stellar Glimmer CRIT DMG); the duration extension
  and the Energy regeneration are not modelled.
- LegacyOfTheFirstChronicle: Cryo CRIT Rate +20%; the extra 20% for Stellar Glimmer DMG is given to Cryo
  wearers only (a non-Cryo wearer's Cryo-variant Stellar Swirl would miss it). An older leak had a
  different 4pc (Burst-triggered); this follows the dump (CNCBWin7.2.50).
- PreludeOfTheKingfisherCanopy: only the revealed 4pc part (Skill + Burst DMG +25%); params 0.3 and 10 are
  for effects "revealed in later versions".
- English set names are provisional translations (en_overrides.json); weapon names are the dump's. Lunaris'
  data (`https://api.lunaris.moe/data/<version>/{artifactlist,weaponlist}.json`, `<version>/en/<kind>/<id>.json`)
  had no English set names either (7.2.50, checked 2026-11-05); its per-level weapon stats matched ours at all
  90 levels. Icons: Starsealed Edict from Yatta, the rest from Lunaris.

## 7. Restore

```sh
tools/dump-import/restore_dm.sh   # unlink dump + restore official deobf.ts
```

## Dump quirks (YuanShenResources vs official AnimeGameData)

| Quirk | Handled by |
|---|---|
| Floats stored at full float32 precision (`793.2581787109375`) | `normalize_excel.py` (shortest round-trip repr) |
| Readable prop names instead of obfuscated | `deobf.dump-names.json` (applied by `use_dump.sh`) — re-check after dump updates by comparing first object of AvatarSkillDepot/AvatarSkill/ProudSkill |
| `HyperLinkNameExcelConifgData` uses `ID` | `use_dump.sh` renames to `id` |
| `TextMapRU.json` / `TextMapTH_1,_2` naming | `use_dump.sh` symlinks to `_0/_1` names |
| `ElementCoeffExcelConfigData` has different/extra rows | only a debug dump, restored by cleanup |

## Mitya modelling notes / assumptions
- Detection Core state cond (`steady` / `overloaded`); beacons cond 1–3 (1–5 at C1) drive A1 EM.
- Stellar-Conduct hits (Gradient Detonation per beacon, Steady core consumption/detonation, C4) use EM base, Electro RES.
- C6 "115% of original DMG" applied to all Steady State core hits (core, consumption, detonation), not C4.
- C1 energy regen, C6 34% beacon chance, Overloaded beacon generation: not modelled (no stat impact).

## Danica / Anastasya modelling notes (7.3 beta)
- Danica: toggles Anchor, Maid Form (Defense/Battle), Burst enhanced (cast in Radiance — community confirmed
  "stellar glimmer locked"), A4 stacks 1–3, Radiance, C2 Toast (party) / self Toast stacks 1–7.
  Defense burst ATK = min(ratio × Danica pre-buff ATK, cap), party-wide (`teamBuff.total.atk`), C1 ×1.8.
  Battle burst "+X% On-Field E2 DMG" modelled as a Stellar-Conduct DMG bonus on that hit only (unconfirmed).
  C2 Toast = flat `stellarconduct_dmgInc` (+100% ATK; self in Battle Maid +150% ATK per stack on On-Field E2).
  C6 party 20% is **Elevated** (CHS 擢升). A4 ATK SPD 20% is a text value (not in params).
- Anastasya: toggles Blessing (Love/Honor), To the New World active, Radiance (Stellar-Conduct / Stellar Swirl),
  Accolades (normal / Anastasya Sealed / teammates Sealed; assumes a 4-member party).
  Accolades units: normal 1; Ana sealed → others 1⅓ (C1: ×3 = 4), Ana 0 (C1: 1); Honor → Ana 4, others 0 (C1: 1);
  C4 ×1.3. Matches community notes (16/16/16/0, C1 48/48/48/12).
  Burst Stellar hits are Stellar-Conduct by default, Stellar Swirl in Radiance: Stellar Swirl; skill Crown 2nd
  instance / Honor NA last instance are Stellar only while in Radiance.
  A4: `stellarswirl_mult_` +15% — engine hook in `libs/gi/wr/src/reaction/stellar.ts` makes it scale the Stellar
  Swirl reaction (incl. vortices) as well as direct Stellar Swirl hits. A4 Stellar-Conduct part (extra Polestar
  stacks) is left to the existing Polestar stack setting (note shown in the sheet).
  Not modelled: Sealing timers/meters, 8s Accolades linger, C6 "possesses everyone's Accolades" for the C6 Doom hit.

## Valeriy / Blazing Lionfang modelling notes (7.3 beta, added 2026-11-06)
- Valeriy (10000137, 4★ Electro sword): no new materials; allow-list
  `Valeriy,ValeriysStellaFortuna,10000137,11370001,11370002,11370003` (+ `BlazingLionfang,12438,112438`).
  Art: Lunaris for icon, namecard, skill/talent glyphs; its side icon is blank, so the side icon and the tall
  card come from the Fandom wiki (`Valeriy Side Icon.png`, `Valeriy Card.png`); the namecard bar is a centre
  crop of the namecard (Lunaris has no `_Alpha`).
- Offensive Directive (after the special Charged Attack, 15 stacks): flat DMG for the active character from
  Valeriy's ATK — Electro DMG outside Radiance (`electro_dmgInc`), Stellar-Conduct DMG in Radiance:
  Stellar-Conduct (`stellarconduct_dmgInc`); applied to every hit (stack count not tracked). A4 adds
  0.3% / 0.9% ATK per point of Impact Momentum consumed (cond 40–100, C4 up to 130; capped at the maximum).
- C2: party EM +100 (toggle); "20 excess Impact Momentum" toggle = shield +160% ATK (partial amounts not modelled).
- C6: Mortar + Thunderburst Shell DMG +100% (DMG bonus, CHS 提升); opponents hit: party `electro_critRate_` +10%,
  `stellarconduct_critDMG_` +40% (toggle). C1 energy and C4 charging efficiency not modelled.
- Blazing Lionfang (12438, 4★ claymore, ER): passive text only in CHS; English in `en_overrides.json`
  (passive name fixes the dump's "Convenant"). "Reforged Blade" toggle = ATK +20–40% and the switch-in
  AoE DMG 280–560% ATK (physical, total ATK, like Skyward Harp's proc).

## Publish (GitHub Pages)
Live site: **https://gi-beta73.github.io/** (org `gi-beta73`, repo `gi-beta73.github.io`, branch `main`;
contains only the built site — no source, no dump, no ads, no Google Analytics, no creator promo links).
Redeploy after any change (build runs as a single process):
```sh
tools/dump-import/deploy_pages.sh        # defaults: owner gi-beta73, repo gi-beta73.github.io, branch main
```
The build uses relative asset paths (`base: ''`) + HashRouter, so it works at a domain root or any sub-path.
Speed: `apps/frontend/public/sw.js` (service worker) caches the site in the browser (hashed files cache-first; index.html network-first; the unhashed locale JSON stale-while-revalidate, with a content hash of all locale files appended as `?v=` by i18n.ts (`__GO_LOCALES_VERSION__`, computed in vite.config.mts), so a deploy that changes any text is fetched fresh on the first visit) — repeat visits load in
~0.3 s with no network for code. First visits depend on GitHub's CDN (10-min cache, slow on cache MISS);
moving to Cloudflare Pages (long-lived cache headers) is the next step if first loads must be faster.
Deploys are incremental: a persistent copy lives in `~/.cache/gi-beta73-site`; old hashed assets are kept so
browsers with a cached older index.html still work (`vite:preloadError` also triggers one auto-reload).
`vite.config.mts` only exposes `NX_URL*`/`NODE_ENV` to the bundle (it used to embed the whole build env).
Note: the site contains unreleased beta characters (user accepted the takedown risk, 2026-11-05).
Removed from the original before publishing: AdSense/ad slots, Lootbar banner, Google Analytics (react-ga4),
creator Twitch/Twitter/Patreon/PayPal quick links.
