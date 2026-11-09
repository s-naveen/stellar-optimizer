# Changelog

Every release of [Stellar Optimizer](https://gi-beta73.github.io/). The app shows the same notes
(home page, and the version in the footer). Generated from
`libs/gi/ui/src/changelog/changelog.json` by `tools/site/release.mjs`: edit that file, not this one.

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
- The unreleased characters Mitya, Danica, Anastasya and Valeriy, with the upcoming weapons and artifact sets.
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
