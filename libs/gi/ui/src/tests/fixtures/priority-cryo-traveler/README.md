# Cryo Traveler on-field coverage

Latest numerical rerun and pending work: [priority validation](../priority-validation/).

Canonical reference: KQM-git/kqmsim `7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c`. Four complete loops, 200 trials, one level-100 target with 10% resistance, C0/C6 KQM characters, 10/10/10 base talents and legal artifact roll budgets. Native burst energy is ignored.

| Case | Our app DPS | KQM simulator DPS | DPS gap | Duration gap | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| stellar_traveler_onfield | 35,259 | 35,491 | -0.7% | +0.0% | Pass |
| stellar_swirl_traveler_onfield | 17,963 | 18,636 | -3.6% | +0.1% | Pass |

Both cases pass the unchanged 5% DPS and duration gate. The shared-reaction / Freeze case includes Rosaria, Mona and Venti; the Conduct case includes Mitya, Anastasya and Fischl. They exercise actual Freezing Ice, normal/charged conversion, crystals, Frostglow consumption and character-clock tasks.

The [latest cumulative checkpoint](../priority-validation/) contains **39/40 passing team gates, 70 distinct characters**. Direct talent/gear damage is within 5% in every tested appearance for **51/70** characters; **19/70** have at least one larger component gap. These are fixed-build diagnostics, not full character certification. Its [status.json](../priority-freeze-mechanics/status.json) preserves all appearances and source/binary/fixture hashes.

The companion [source audit](../priority-coverage/reference-audits/cryo-traveler.md) separates the native Blizzard Strayer contributor bug, Cryo Freeze variable shadow and Venti weak-point behavior from the app fixes. Canonical team gates retain the original binary. The Cryo Freeze-only experiment did not materially explain this case's gap.

App fixes include recipient-specific Rosaria A4 snapshots, correct composition of captured totals and captured buffs, source-specific buff contexts and target-debuff hitlag that counts overlapping pauses once. Focused tests and the 23-file regression cover these changes.

Still pending: Cryo Traveler C1-C6, plunges, exact mode changes within a grouped normal string and the native omission of 30-second Icepoint expiry; Klee Spark state, remaining Freeze passives/modes, Stellar-adapted characters, gear-dependent resource timelines and ER sustainability. Finish priority coverage before Fontaine, then Sumeru. Production KQM stays disabled.

Follow-up fixes: Kokomi retains cast-time Bake-Kurage ATK (both tested direct components within 0.001%); Fischl retains Oz CRIT DMG as well as ATK (the flagged Conduct case improves from +5.9% to +3.1%). Broader Kokomi healing/modes and Fischl Electro-Crystallize A4 and recast behavior remain unvalidated. The A4 triggerer-clock ICD now has a focused regression.
