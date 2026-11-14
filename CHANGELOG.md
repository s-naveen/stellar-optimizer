# Changelog

Every release of [Stellar Optimizer](https://gi-beta73.github.io/). The app shows the same notes
(home page, and the version in the footer). Generated from
`libs/gi/ui/src/changelog/changelog.json` by `tools/site/release.mjs`: edit that file, not this one.

## [v1.3.3](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.3.3) (2026-11-14)

### New

- KQM Theorycrafting: Top teams, under the member inspector: the best team, then the best teams that change one member's weapon or artifact sets, each with its team DPS and how far it is from the best. The member that changes stands out; pick a team to see it. The top 50 open in a window.

## [v1.3.2](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.3.2) (2026-11-14)

### New

- Rotation writer: a wait while Mualani surfs in Nightsoul's Blessing builds Wave Momentum, as walking does in game, so "E W90f N1" plays a Surging Bite. Waits can now be written in frames: W90f is 90 frames.
- KQM Theorycrafting: member cards show the weapon and artifact sets of each build, and the constellation as a badge.

### Improved

- KQM Theorycrafting generates builds about 4 times faster, with the same results.

### Fixed

- KQM Theorycrafting now counts what a set or weapon does in the rotation before it is picked, so sets like Viridescent Venerer are chosen when their effect helps the team (Stellar Swirl teams no longer stay on Blizzard Strayer).
- KQM Theorycrafting: picking another weapon or set in a result plays the rotation again with it, so the buffs and debuffs it gives the team are counted.
- KQM Theorycrafting gives a weapon the game has one copy of (Exaiphanes' Blade and other quest rewards) to one member at most.
- Rotation writer: Mualani's surfing jumps, dashes and bites no longer delay her next Skill, so every rotation plays its Surging Bites.
- Epochal Advent's 4-piece bonus counts while the wearer is off the field again.

## [v1.3.1](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.3.1) (2026-11-14)

### New

- KQM Theorycrafting: picking another weapon or set now updates the team DPS and every member card, and picks for several members add up.
- KQM Theorycrafting: each member card shows how many rolls went to each substat (hover for fixed, added and total); the same line sits next to Artifact totals.
- Rotation timeline: each swap now shows as its own block before the next member's actions.
- Frame data: actions that change in a mode or stance (Zibai's Spirit Steed's Stride, Wanderer's Windfavored attacks, Raiden's Musou Isshin and more) have their own rows, so editing one no longer changes the other.

## [v1.3.0](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.3.0) (2026-11-14)

### New

- KQM Theorycrafting (Beta): a new tab on every team. It builds each member from KQM-standard artifacts and the weapons you allow, for the team's rotation, and ranks the sets and weapons for each member. Runs keep going in the background, and the last result is still there after a reload.
- Team Optimize: write a rotation as text, like “Odette EE -> Mitya E -> Sandrone Q”. It is played out with each character's frame data: cooldowns, energy, reactions and when buffs are up.
- Team Optimize has a cleaner look, with details in tooltips, and “What raises team damage” now stays with the saved result.

### Fixed

- Every character released or buffed since 5.0 now follows the game text at every constellation.
- Many older characters' buffs and constellations now follow the game text too.

## [v1.2.0](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.2.0) (2026-11-11)

### New

- Team Optimize: exclude artifacts from a team's optimization. Press ⊘ on an artifact in a result, or find artifacts by set, slot and main stat under Optimize team → Excluded artifacts, where each can be used again.

## [v1.1.6](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.1.6) (2026-11-11)

### Fixed

- Optimize and Team Optimize keep running at full speed when the tab is in the background or the window is minimised.
- Anastasya: her C2 and C6 bonuses now show their Stellar Swirl lines too (the damage already counted them).

## [v1.1.2](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.1.2) (2026-11-09)

### Improved

- Danica and the Tsaritsa follow the latest beta data: the Tsaritsa's Palestar Crown and her burst's Stellar Glimmer bonus are lower.
- The upcoming artifact sets have their official names, Epochal Advent and Empyrean Sojourn.

### Fixed

- Epochal Advent's 4-piece bonus only counts while the wearer is on the field, as in the latest beta.

## [v1.1.0](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.1.0) (2026-11-09)

_Build cards_

### New

- Build card: a picture of a character's build to download or copy, from the character page or a team member's page. It shows the character's art, constellation, talents, weapon, artifacts with their Roll Value and Crit Value, the artifacts' totals and the character's own stats.
- Choose which substats count toward a character's Roll Value on its build card; the others are dimmed.
- Team card in Team Optimize results: the team's DPS and rotation, then every member's build card with its share of the damage, in one picture.

## [v1.0.0](https://github.com/s-naveen/stellar-optimizer/releases/tag/v1.0.0) (2026-11-09)

_The first Stellar Optimizer release_

### New

- Team Optimize: optimize the whole team's artifacts and weapons for one rotation, with energy weapons, member swaps, the closest build when a requirement can't be met, and the next best team builds.
- Improve tab (formerly the Artifact Upgrader), with a built-in substat value and a what-to-farm strip.
- One-click theorycraft of any build, with its best roll distribution.
- Mitya and Valeriy, with their weapons, from beta data ahead of their release.
- The unreleased characters Danica and Anastasya, with the upcoming weapons and artifact sets.
- A best-build page for every character, and an FAQ.
- This changelog, links to the source on GitHub and a Buy me a coffee link.

### Improved

- A much faster artifact optimizer: a new search engine, sped up with WebGPU where the browser supports it.
- A new look: dark theme, compact navigation, a home dashboard, and redesigned Optimize tab, filters and character cards.
- Pages answer clicks at once, art loads as WebP, and the site always runs its latest version.
- Official Chinese terms, and stat names that can be translated.
- No ads; privacy-friendly analytics without cookies.

### Fixed

- Team Optimize keeps each member to its allowed sets: a member takes the pieces its sets need from a teammate, or the run tells you who can't fit.
- Team Optimize no longer keeps a weapon left out of "Weapons to choose from" when a ticked one was free.
