# Cryo Traveler on-field and shared-reaction audit

Canonical reference: KQM-git/kqmsim commit `7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c`, unchanged binary SHA-256 `2c77043fef38aef3815c7866a77b36bedd78751e68f598c0fb743e89104becc5`.

The C0 Conduct and Stellar Swirl on-field cases use four loops, 200 native trials, legal fixed KQM artifacts and 10/10/10 base talents. At the time of the isolated reference experiments, canonical gaps were +0.1% and -4.3% DPS, with duration gaps within 0.1%. The latest app rerun is -0.3% and -4.3%; historical experiment values below are preserved. Burst energy is ignored. These are rotation checks, not full character certification.

## App corrections

- Track Icepoint from actual direct/shared Stellar damage, excluding field-creation markers. Gain ICD is shared and runs on Traveler's character clock (120 frames), with a three-stack cap.
- Freezing Ice requires three stacks, an active Star and its own 914-frame Lumine cooldown. Casting consumes Icepoint and grants two Frostglow. It uses the correct regular, Conduct or Swirl formula, seven-frame pauses on each hit, and excludes the ordinary A1 addition.
- Conduct converts ordinary normal/charged/plunge damage while the Star exists. Native coordinated crystals also follow Freezing Ice hits. Normal hitlag and Star/burst-spawn character tasks are represented.
- Rosaria A4 captures its source CRIT contribution at burst cast, and expires separately on each recipient's clock. Shared-reaction snapshots identify the recipient so Rosaria cannot receive her own A4.
- Source-specific snapshots read the source's buff context; a captured stat total composes with captured components without double replacement.
- VV and Rosaria C6 target debuffs extend with enemy hitlag. Overlapping target pauses are counted once across attackers, separately from attacker clocks.

## Native Blizzard Strayer callback

`internal/artifacts/blizzard/blizzard.go` subscribes each wearer to `OnSpecialReactionAttack` but never checks `ae.Info.ActorIndex == char.Index()`. That event runs once per contribution, so one four-piece wearer grants its 20%/40% CRIT bonus to other characters' shared-reaction contributions too.

An isolated worktree added only the actor guard. The Swirl native mean changed from 18,636 to 18,319 DPS; app DPS is 17,829 (-2.7% against that audit). Native skill weak-point crit behavior and other component differences remain. Canonical gates continue to use the original binary. See [the exact patch](blizzard-contributor.patch) and [hashes/results](blizzard-contributor.json).

## Native Cryo Freeze variable shadow

An independent worktree changed only the shadowed `consumed :=` to `consumed =` in `pkg/reactable/freeze.go`. Its Swirl mean was 18,630 DPS, close to the canonical 18,636; this experiment does not explain the original team gap. See [patch](freeze-consumption.patch) and [metadata](freeze-consumption.json). These are independent, unpaired 200-trial means.

## Remaining limits

Native Icepoint omits the described 30-second expiry; this is explicit in the app's timeline note. C1-C6, plunges, exact mode-boundary transitions inside a grouped normal string, energy refunds and ER sustainability remain unvalidated. Candidate-dependent HP/Will timelines are still outside per-gear simulation. Production KQM stays disabled.
