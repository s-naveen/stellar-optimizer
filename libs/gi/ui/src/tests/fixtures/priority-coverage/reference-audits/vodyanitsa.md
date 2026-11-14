# Vodyanitsa C0 and shared-reaction audit

Reference: [KQM-git/kqmsim at 7bdf45f](https://github.com/KQM-git/kqmsim/tree/7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c).
The original clean checkout and binary were used for every team gate. No patched native
binary was substituted. [`vodyanitsa.json`](vodyanitsa.json) records hashes, the sample seed,
and the measured Venti discrepancy below.

## Corrections in the app

- Native `stellarswirl.go` applies the 0.75 hit / 2 or 3 vortex coefficient outside
  `CalcSpecialReactionDmg`, scaling flat additions too. The app had scaled only the reaction
  base. The corrected Stellar wrapper retains the existing Lunar and direct Stellar rules.
- Vodyanitsa A4 reads one active/off-field pool per reaction owner. All contributors receive
  that eligibility before delayed impact; the shared hit spends one use on impact. The flat
  amount remains a live formula of Vodyanitsa's build.
- Native `burst.go` adds Song's bonus to the HP coefficient. The sheet had multiplied the
  original coefficient by `1 + bonus`. Song eligibility is chosen at cast, even if it expires
  before the frame-91 hit.
- Skirk's native Flash attacks pause by 2 / 2 / 2 / 2 / 4 frames. Her tested N5 / N5 / N5 /
  wait sequence now takes 160, 158 and 128 frames. N1 hitlag markers shift with N1.
- Native `CanQueueNext` ignores a new hitlag freeze; ordinary `CanUse` checks it. Waits can
  therefore begin on the hitmark while ordinary actions wait out the new pause.
- Prototype Amber heals at 120 / 240 / 360 frames on each recipient's character clock.
  Tests cover recipient-specific pauses and R1/R5 healing amounts.
- Electro-Charged now respects ReactionB damage ICD, keeps an already queued first owner,
  and snapshots EM/reaction bonus at application. Later ticks use the latest application.
  Suppressed damage does not consume aura. Prune/Albedo returns to approximately +0.0% DPS.
- Stellar Swirl collects live Cryo and Frozen contributors together. Frozen belongs to its
  trigger, and only Cryo triggers contribute through Frozen. Conduct-only characters no
  longer enable Swirl accidentally.

The new fixed-build results are -0.1% DPS / -0.2% duration for Stellar Swirl, and +0.3% DPS /
approximately -0.0% duration for Freeze. Vodyanitsa's own direct damage is within 1% in both.
Team totals do not certify every action, constellation or optimizer candidate.

## Remaining native discrepancies

### Venti's skill forces a crit

`internal/characters/venti/skill.go` sets `HitWeakPoint: true`. Native enemy damage calculation
treats that as a guaranteed crit regardless of CRIT Rate. The imported skill description does
not describe such a guarantee, so the app retains the ordinary crit expectation.

At frame 612 of the saved Stellar sample:

| Quantity | Value |
| --- | ---: |
| Native CRIT Rate | 26.62% |
| Native CRIT DMG | 79.24% |
| Native damage before crit | 4,445.45 |
| Native logged average damage | 5,383.16 |
| Actual native damage, forced crit | 7,968.03 |
| App average damage | 5,383.16 |

Each loop shows the same behavior. This accounts for part of Venti's remaining direct-damage
gap, which remains visible even though the team total passes.

### Vodyanitsa's passive scope

Her +240-frame radiance flag and A1 listeners initialize without requiring Song. Descriptions
scope them to Song. The C0 implementation follows the pinned native behavior and exposes this
limitation in timeline notes.

### Cryo Freeze consumption

`pkg/reactable/freeze.go` declares `consumed := ...` inside its Cryo switch case. The outer
`consumed` stays zero when incoming durability is reduced afterward, leaving extra Cryo gauge.
The app retains normal gauge consumption. A later [Cryo Traveler audit](cryo-traveler.md) isolated the variable fix; it had no material effect on that Swirl case. Its effect is not universally quantified across Freeze teams.

## Boundaries

Vodyanitsa C1-C6, held skill and plunges are unsupported. Native ignores burst energy in these
benchmarks. Candidate-dependent HP/Fanfare and Lohen Will histories are still generated outside
the per-candidate gear search. Production theorycrafting remains disabled.
