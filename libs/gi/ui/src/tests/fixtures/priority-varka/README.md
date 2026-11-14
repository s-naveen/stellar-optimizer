# Varka recharge and shared buff follow-up

Latest numerical rerun and pending work: [priority validation](../priority-validation/).

Four complete loops, 200 native trials, one level-100 target with 10% resistance, and legal fixed KQM builds (C0 five-stars / C6 four-stars; 10/10/10 base talents). The unchanged gate requires DPS and duration within 5%. Burst energy is ignored, so these comparisons do not validate ER sustainability.

| Case | Our app DPS | KQM simulator DPS | DPS gap | Duration gap | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| hexerei_varka_azure | 36,481 | 36,430 | +0.1% | +0.8% | Pass |
| anemo_varka_recharge | 21,143 | 22,210 | -4.8% | +1.0% | Pass |

These two additional cases check Azure Devour with Desert Pavilion activation and a team without a second Hexerei member (30f normal-hit cooldown reduction rather than 60f). The original Varka/Venti/Nicole/Bennett case also passes at +1.6% DPS / +1.0% duration, with all four direct-damage components within 5%.

Implemented: two sequential special charges; initial skill restarts and primes recharge; up to fifteen normal-instance reductions per stance; fallback charged attacks when no charge is ready; character-clock special cooldown start, stance and A4 expiry; per-triggerer Swirl/Stellar Swirl ICDs; A1 polling with candidate-sensitive captured context. C1-C6 and plunges remain unvalidated.

Shared corrections: Bennett grants a recipient buff and C6 infusion only on field ticks, with recipient hitlag and off-field linger. Venti captures burst stats at frame 104, and Hexerei cannot activate before his burst field starts. Nicole's non-extra ATK bonuses and captured skill buff compose with other snapshots. Desert Pavilion is disabled until charged damage triggers it; the triggering damage instance retains the old state.

Stage checkpoint: **35/36 passing team gates, 69 distinct characters; 49/69 direct components within 5% in every tested appearance, 20/69 with at least one larger gap**. These are fixed-build diagnostics, not character certification. See [status.json](status.json) for provenance and every component appearance.

Remaining priority mechanics are tracked in [the coverage audit](../priority-coverage/coverage-audit.json). Complete those before Fontaine, then Sumeru. Production KQM stays disabled.

The [latest cumulative checkpoint](../priority-validation/) contains **39/40 passing team gates, 70 distinct characters**. Direct talent/gear damage is within 5% in every tested appearance for **51/70** characters; **19/70** have at least one larger component gap. These are fixed-build diagnostics, not full character certification.
