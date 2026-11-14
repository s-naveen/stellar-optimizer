# Missing priority kits

Latest numerical rerun and pending work: [priority validation](../priority-validation/).

This stage follows the original 14 cases and the expanding cases in `../priority-coverage/`.
Stellar, Lunar, Hexerei, Freeze and Natlan coverage still comes before Fontaine and Sumeru.

## Current checkpoint

Six of the seven cases meet the unchanged 5% DPS/duration gate against the **untouched**
pinned kqmsim binary. The Valeriy Stellar case remains flagged; an isolated Polestar expiry and Sandrone passive
experiment is [recorded separately](../priority-coverage/reference-audits/stellar-expiry-sandrone.md) and does not replace its official result.

Four full loops, 200 native trials, level-100 target, 10% resistance, KQM C0/C6,
10/10/10 base talents, legal fixed-plus-liquid artifact roll budgets. Native ignores burst
energy, so these results do not verify ER sustainability.

| Case | Our app DPS | KQM simulator DPS | DPS gap | Duration gap | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| freeze_lohen | 40,543 | 39,634 | +2.3% | +1.2% | Pass |
| stellar_vodyanitsa | 52,135 | 52,260 | -0.2% | -0.0% | Pass |
| freeze_vodyanitsa | 72,342 | 71,426 | +1.3% | -0.0% | Pass |
| stellar_vesna | 63,262 | 64,482 | -1.9% | -0.0% | Pass |
| anemo_vesna | 21,287 | 21,242 | +0.2% | -0.0% | Pass |
| stellar_valeriy | 25,258 | 27,125 | -6.9% | -0.0% | Flagged |
| electro_valeriy | 25,962 | 25,921 | +0.2% | +0.9% | Pass |

The [latest cumulative checkpoint](../priority-validation/) contains **39/40 passing team gates, 70 distinct characters**. Direct talent/gear damage is within 5% in every tested appearance for **51/70** characters; **19/70** have at least one larger component gap. These are fixed-build diagnostics, not full character certification. Shared reaction ownership makes raw character DPS unsuitable as a reliability label. Stage-specific `status.json` records provenance; [the latest checkpoint](../priority-validation/) includes every current appearance.

Lohen is **provisional**: the native burst has five hitmarks while sheet data describes six.
The app retains the pinned five-hit timing and exposes that limitation. C1-C6 and plunge are
unsupported. A passing team total does not resolve those gaps.

## Implemented and checked

### Vodyanitsa and shared mechanics

- C0 cast, pulse and healing timing; two shared A4 pools (25 active / 10 off-field uses).
  Shared reaction eligibility is captured before impact for every contributor, using the
  owner's pool; one use is spent when the shared hit lands.
- Song adds to the burst's HP coefficient. Its eligibility is chosen at cast and retained if
  Song expires before impact. Elemental and Stellar flat damage bonuses cap independently.
- Stellar Swirl's outer hit/vortex coefficient scales flat additions too. Cryo and Frozen
  contributors are collected together, excluding Hydro-triggered Freeze owners. Conduct and
  Swirl have separate enablers; Vodyanitsa extends radiance but does not enable Swirl herself.
- Skirk's missing normal hitlag, shifted N1 markers and the wait cancellation boundary.
- Prototype Amber's healing on each recipient's own hitlag-paused clock.
- Electro-Charged damage ICD, queued owner and application-time snapshots. Suppressed hits
  do not consume aura. This removes the excess EC damage in Prune/Albedo.

The earlier cases were rerun: Prune/Albedo is approximately -2.0% DPS, Ifa/Jahoda +0.2%, and
Skirk Freeze -0.9% with near-exact duration. All original 14 cases also still pass.

Vodyanitsa is C0-only. The pinned native implementation enables her duration extension and A1
resistance reduction by party presence, while descriptions scope them to Song. Venti's native
skill also forces a weak-point crit; the app keeps ordinary crit expectation. These differences
and the native Cryo Freeze issue are recorded in the [source audit](../priority-coverage/reference-audits/vodyanitsa.md).

### Vesna and Valeriy

- Vesna C0: Sword Essence, Windborne levels and three-use ending, A1 stacks/expiry,
  Wind Pinion, character-clock Spirit Blades, Q Essence refund, and independent Swirl
  radiance even when Conduct takes priority. Two native cases cover Stellar and ordinary Anemo.
- Valeriy C6: half-point Momentum, C1's first-skill bonus, C4 gain/caps, the fifteen-hit
  Directive pool and A4 scaling, A1 Momentum, C2 EM, C6 hit ordering and Electro-only
  Stellar Conduct CRIT DMG. Shell timing cycles all six native rhythms deterministically.
- These cases exposed and fixed Sandrone normal hitlag/cancels, character-clock burst
  attacks and direct-Stellar tags in Sandrone, Mitya and Danica. Damage breakdowns now keep
  distinct labels even when attacks share the same formula node.
- Valeriy's ordinary Electro team passes. His Stellar team remains outside the canonical
  gate; [the isolated expiry audit](../priority-coverage/reference-audits/valeriy.md) records
  the known reference issue and remaining component differences without loosening tolerance.
- Valeriy shield growth, energy refunds and plunges remain unverified. Vesna C1-C6 and
  plunges are unsupported; the pinned source emits Wind Pinion outside the stance despite
  description wording, which remains explicit in timeline notes.

### Natlan and Ascendant Gleam follow-up

The [coverage matrix](../priority-coverage/) now adds tap/hold Pyro Traveler C0 Burning teams
and Jahoda's two-Moonsign team. Pyro Traveler exposes discrete Nightsoul consumption, hitlag-paused
entry/drain/expiry and damage tags. Emilie's burst respects target marks and uses deterministic
collateral probability rather than nine guaranteed hits. Flins now includes normal hitlag and
stance clocks. Jahoda uses real aura for flask filling/robot absorption, partial and empty
pursuit, robot ATK snapshots, element-specific ICDs and recipient C6 clocks.

The [Jahoda source audit](../priority-coverage/reference-audits/jahoda.md) preserves the pinned
native zero-robot-multiplier defect. Multiple targets, stochastic outcomes and energy refunds
remain outside this fixed-build checkpoint.

### Lohen

- Actual teammate damage distributions drive Will to Win. Each crit outcome is capped before
  averaging; shared reactions retain their independent contributor rolls and ranking.
- Pre-hit buffs, reactions, snapshots and hit-count buffs are included in damage evaluation.
- N3 lands three times; Joy has a six-frame gain ICD, is consumed on a special skill, and stops
  accumulating after the third special skill. Swapping clears the stance and its resources.
- Per-member Will gain ICD, High Spirits, recipient-specific A4, and probabilistic Hexerei
  damage bonus. The expected Will multiplier scales the talent before flat damage additions.
- Normal/charged timing, melee hitlag, stance extension by burst, and a real zero-damage stance
  cast. Unsupported inputs and missing damage evaluations generate warnings.

The N4 source failure was investigated separately, with a minimal native patch and provenance.
See [`../priority-coverage/reference-audits/lohen.md`](../priority-coverage/reference-audits/lohen.md).
The official case above uses the original binary.

```sh
python3 tools/scripts/benchmark-rotation-archetypes.py \
  --source /path/to/clean/kqmsim --binary /path/to/kqmsim \
  --fixture libs/gi/ui/src/tests/fixtures/priority-missing-kits/teams.json \
  --output /tmp/priority-missing-kits --check-accuracy
```

## Still pending

Kachina and Nefer have neither an app kit nor implementation in the pinned native source.
Expanded Freeze and Varka cases now pass; remaining Cryo Traveler, Klee and Stellar-adapted mechanics are tracked in
[`../priority-coverage/coverage-audit.json`](../priority-coverage/coverage-audit.json).

KQM search still uses the generated timeline: candidate-dependent HP/Fanfare and Lohen Will
histories are not regenerated for every gear candidate. This fixed-build checkpoint does not
verify gear-dependent resource thresholds during optimization. Production KQM remains disabled.
