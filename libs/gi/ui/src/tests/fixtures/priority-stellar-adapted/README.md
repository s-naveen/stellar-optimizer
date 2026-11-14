# Clorinde Stellar coverage

Latest numerical rerun and pending work: [priority validation](../priority-validation/).

**Our app** is the localhost calculator. **KQM simulator** is the original pinned `kqmsim` binary. A positive gap means our app is higher; a negative gap means it is lower. A mismatch can come from either implementation.

Four complete loops, 200 KQM simulator trials, one level-100 target (999,999,999 HP, radius 2, distance 2.4, 10% resistance), and legal fixed KQM builds: C0 five-stars / C6 four-stars, 10/10/10 base talents, two fixed rolls per substat plus 20 liquid rolls. Both DPS and duration must be within 5%, with no warnings. Burst energy is ignored, so these comparisons do not verify ER sustainability.

| Case | Our app DPS | KQM simulator DPS | DPS gap | Duration gap | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| stellar_clorinde | 35,051 | 35,649 | -1.7% | +0.7% | Pass |

The C0 Clorinde / Mitya / Anastasya / Odette rotation checks Clorinde’s A1 response to Stellar Conduct. All four direct components are within 5% in this case. This does not certify Clorinde’s full kit: basic normal and Arkhe hitlag, character-clock expiry, and other stance inputs still need targeted checks.

The [latest checkpoint](../priority-freeze-mechanics/) contains **39/40 passing team gates, 70 distinct characters**. Direct talent/gear damage is within 5% in every tested appearance for **51/70** characters; **19/70** have at least one larger component gap. These are fixed-build diagnostics, not full character certification.

Canonical reference: `KQM-git/kqmsim` at `7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c`; original binary SHA-256 `2c77043fef38aef3815c7866a77b36bedd78751e68f598c0fb743e89104becc5`. Production KQM stays disabled.
