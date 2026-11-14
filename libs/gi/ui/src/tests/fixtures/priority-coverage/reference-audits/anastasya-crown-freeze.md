# Anastasya: To the New World freezes the Palestar Crown

The in-game burst text says To the New World "freezes the Palestar Crown's duration" (during the
burst). The pinned reference (`7bdf45f2`) lets the crown's 20 s status run out regardless, so a
crown thrown before the burst stops attacking while the burst is still up. The app follows the game
text: the crown's remaining time pauses for the burst's 20 s.

This changes Anastasya's damage by +15 to +33% at C0 and moves the canonical gate for Stellar
teams that hold her burst over an existing crown (`stellar_sandrone` +8.0%, `stellar_danica`
+11.3%, `stellar_swirl` +4.2%). With [this patch](anastasya-crown-freeze.patch) applied to a
separate worktree of the same revision (extend the crown's status by the burst's 20 s when the burst
starts), the same app results are within the gate: [results](anastasya-crown-freeze.json).

| Case | Canonical DPS gap | Patched-reference DPS gap |
| --- | ---: | ---: |
| stellar_sandrone | +8.0% | +3.6% (includes the known Sandrone passive data difference) |
| stellar_danica | +11.3% | -1.5% |
| stellar_swirl | +4.2% | -0.4% |
| stellar_traveler_onfield | +7.2% | +0.9% |
| stellar_clorinde | +8.4% | +0.6% |

The canonical source and binary are unchanged; this audit does not replace the canonical gate.
