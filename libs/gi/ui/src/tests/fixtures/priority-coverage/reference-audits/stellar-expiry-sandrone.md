# Stellar expiry, snapshots and passive-data audit

The canonical source and binary remain unchanged. This experiment uses a separate worktree at `7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c` with only [this patch](stellar-expiry-sandrone.patch). [Machine-readable results](stellar-expiry-sandrone.json) record binary, patch, configuration and complete sample hashes, seeds, means, standard deviations and selected hit contexts.

The reference corrections are:

- Unsubscribe the Polestar application listener on natural expiry, as it already does on explicit destruction. Otherwise an expired field continues recording applications before the next field is created, granting stale initial stacks. The existing independent expiry-only experiment is preserved in `polestar-expiry.json`.
- Change Sandrone's passive scaling from 0.35% per 100 ATK, capped at 7%, to 0.7% per 100 ATK, capped at 14%. The latter matches both the app's current `Sandrone/skillParam.json` and its local English description. This is a discrepancy between the pinned reference implementation and the app's current data; this audit does not independently establish live-game values.

Each native mean uses 200 trials and the same four-loop fixed KQM configuration as the official case. Seeds are unpaired. Burst energy remains ignored.

| Case | Canonical DPS gap | Isolated reference DPS gap | Isolated duration gap |
| --- | ---: | ---: | ---: |
| stellar_traveler | -3.085% | -0.756% | +0.407% |
| stellar_valeriy | -5.235% | +0.525% | -0.026% |

The app also needed real corrections. Qiqi's missing initial hitlag moved her burst before a Polestar refresh. Herald swipes were using current offensive stats rather than the initial skill snapshot. Offensive conditions are now captured before the initial hit's Tenacity proc; target debuffs remain evaluated at impact. Coordinated attacks use the triggering character's paused cooldown and freeze only the target. Her additional burst has the direct Stellar Conduct tag.

Odette's Coda now includes its three-frame final pause and native recovery; burst attacks, Splendor transfers and Snow Swan's Dream use her character clock. The summon, dance tick chain and ordinary Coda DoT keep native world-time behavior. Polestar application cooldowns and character/enemy buff expiry also use their respective clocks.

The following comparisons sum each recorded native hit's `calc.avg_crit_dmg` over four loops, removing individual crit-roll noise. App damage is the sum of evaluated hit groups over the same four loops. Counts and selected damage contexts are retained in the JSON; random timing and other mechanics can still differ between samples.

| Selected component | App expected damage per loop | Isolated native expected damage per loop | Gap |
| --- | ---: | ---: | ---: |
| Traveler: Conduct javelins | 9,797.276 | 9,797.374 | -0.0010% |
| Qiqi: Conduct burst | 32,464.289 | 32,464.644 | -0.0011% |
| Odette: Conduct Coda | 90,170.329 | 90,171.234 | -0.0010% |

The official checkpoint remains **39/40**, with Valeriy flagged against the original reference. These isolated results are supporting diagnostics, not substitute gates or full character certification. Other attacks, higher constellations, random rhythms, multiple enemies, shields and energy refunds remain subject to the limitations in the main checkpoint.

## Current app recheck (2026-11-12)

The original selected-component audit above retains its original timestamp. Current app reruns against the same cached canonical means give -3.2% for Cryo Traveler and -6.9% for Valeriy. Comparing current app DPS with the separately recorded corrected-reference means gives -0.8% and -1.2% respectively. The JSON `currentAppRecheck` records the current source fingerprint and distinguishes this recheck from the historical selected attacks. Native means, binaries and patches were not regenerated or substituted into the canonical gate.
