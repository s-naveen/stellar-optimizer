# Freeze cooldown and energy-application follow-up

Latest numerical rerun and pending work: [priority validation](../priority-validation/).

**Our app** is the localhost calculator. **KQM simulator** is the original pinned `kqmsim` binary. A positive gap means our app is higher; a negative gap means it is lower. A mismatch can come from either implementation.

Four complete loops, 200 KQM simulator trials, one level-100 target (999,999,999 HP, radius 2, distance 2.4, 10% resistance), and legal fixed KQM builds: C0 five-stars / C6 four-stars, 10/10/10 base talents, two fixed rolls per substat plus 20 liquid rolls. Both DPS and duration must be within 5%, with no warnings. Burst energy is ignored, so these comparisons do not verify ER sustainability.

| Case | Our app DPS | KQM simulator DPS | DPS gap | Duration gap | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| freeze_chongyun_c2 | 8,946 | 9,018 | -0.8% | +0.2% | Pass |

The stress rotation chains Chongyun bursts across his C2 field and its lingering effect. It checks C2 on catalyst recipients, melee-only A1/infusion, delayed cooldown starts, and burst Shatter. Xingqiu’s orbitals now start from E as well as Q, preserve their chain across a refresh, and use his character clock. Chongyun’s C6 bonus checks enemy HP against his current HP before each blade. Layla now gains Night Stars from party skills and consumes C4 independently for each recipient three frames after normal/charged damage, preserving its short multi-hit grace period and recipient hitlag expiry. Both affected teams have every direct component within 2%.

C6 uses expected enemy damage for the HP timeline; stochastic outcomes near the HP threshold are not a joint HP/crit distribution. Without damage evaluation, the structural simulator explicitly assumes full character health and an enemy damaged by its first hit. Other enemy HP values can be supplied to the simulator, but the UI benchmark uses the target above.

## Cumulative checkpoint

**39/40 passing team gates, 70 distinct characters**. Direct talent/gear damage is within 5% in every tested appearance for **51/70** characters; **19/70** have at least one larger component gap. These are fixed-build diagnostics, not full character certification.

| Stage | Passing teams | Cases |
| --- | ---: | ---: |
| [Original priority teams](../priority-mechanics/) | 14/14 | 14 |
| [Expanded priority coverage](../priority-coverage/) | 9/9 | 9 |
| [New simulator kits](../priority-missing-kits/) | 6/7 | 7 |
| [Expanded Freeze](../priority-freeze/) | 4/4 | 4 |
| [Varka recharge modes](../priority-varka/) | 2/2 | 2 |
| [Cryo Traveler modes](../priority-cryo-traveler/) | 2/2 | 2 |
| [Clorinde Stellar](../priority-stellar-adapted/) | 1/1 | 1 |
| [Chongyun cooldown stress](../priority-freeze-mechanics/) | 1/1 | 1 |

The latest matrix flags `stellar_valeriy` (-5.2% DPS). The off-field Traveler team now passes at -3.1% after Qiqi snapshot and timing corrections. Isolated Polestar expiry and Sandrone passive-data corrections bring Valeriy to +0.5%, but do not replace the official result. See the [current validation](../priority-validation/).

Current validation: **477 tests across 33 files pass**; one local-data test is skipped. See the [handoff checkpoint](../priority-validation/) for measured hitlag, task order, snapshots, sampled Klee, Razor/Dahlia and Stellar follow-ups, and the existing type-check errors.

## Still pending

- Remaining direct-component differences and known reference source defects; passing totals can hide offsetting errors.
- Klee Spark probability/stacks; Clorinde timing; Cryo Traveler higher constellations and mode boundaries; Kaeya defeat extensions, Aloy coils, Charlotte C6 heals, multiple enemies and shield breaks.
- Cyno/Mizuki newer Stellar mechanics are absent from the pinned native implementation. Kachina and Nefer lack both app and pinned native kits.
- Candidate-dependent HP/Fanfare, Lohen Will and Chongyun enemy-HP thresholds are not regenerated for every optimizer gear candidate. ER sustainability and energy refunds remain unverified.

Finish these priority checks before Fontaine, then Sumeru. Details and provenance are in [status.json](status.json) and the [coverage audit](../priority-coverage/coverage-audit.json). Canonical reference and binary hashes remain unchanged.
