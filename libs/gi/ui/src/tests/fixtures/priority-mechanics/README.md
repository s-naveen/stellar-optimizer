# Priority mechanics audit

Latest numerical rerun and pending work: [priority validation](../priority-validation/).

Measured 2026-11-12 against the clean KQM-git/kqmsim checkout at
`7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c`. The machine-readable checkpoint is
[`status.json`](status.json); it includes binary/fixture hashes and per-character direct-damage diagnostics.

## Current checkpoint

All 14 fixed-build teams meet the numerical gate: DPS and rotation duration each within 5%,
with no rejected actions. There are 41 distinct characters. This is a team-level checkpoint,
not character/constellation certification: 33/41 have direct talent/gear damage within 5% in
all their tested appearances; 8/41 have at least one larger direct-damage difference.
Shared reaction ownership makes raw character DPS unsuitable as a reliability label.

| Fixture | DPS gap | Duration gap |
| --- | ---: | ---: |
| stellar_sandrone | +1.2% | +0.6% |
| stellar_danica | +2.0% | +0.0% |
| stellar_swirl | +0.5% | +0.0% |
| lunar_charged | -3.9% | -0.0% |
| lunar_bloom | -1.3% | +0.4% |
| lunar_crystallize | +1.2% | +1.4% |
| hexerei_klee | +0.1% | +0.5% |
| hexerei_razor | -2.7% | +0.5% |
| freeze_escoffier | +0.3% | -0.1% |
| natlan_mavuika | +0.8% | -0.0% |
| natlan_kinich | +0.9% | +3.5% |
| natlan_mualani | -1.2% | -0.0% |
| natlan_chasca | +1.4% | +0.0% |
| natlan_varesa | -0.5% | -0.5% |

## Reproduce

```sh
python3 tools/scripts/benchmark-rotation-archetypes.py \
  --source /path/to/clean/kqmsim \
  --binary /path/to/kqmsim \
  --fixture libs/gi/ui/src/tests/fixtures/priority-mechanics/teams.json \
  --output /tmp/priority-mechanics --check-accuracy
```

Use `--reuse-reference` only with results produced by the same reference binary. The runner
checks source revision, checkout cleanliness, and cached native configuration. Both sides
retain all four complete loops, including startup. Native results use 200 trials. Profiles
use C6 four-stars/C0 five-stars, 10/10/10 base talents plus constellation bonuses, +20 artifact
mains and legal two-fixed-plus-20-liquid substat budgets. They are fixed builds, not best-build searches.
The single enemy is level 100, radius 2, distance 2.4, 10% resistance. Native burst energy is
ignored; these tests do not validate ER sufficiency, movement, enemy counts, or arbitrary gear.

## Source discrepancies to preserve separately

- **Illuga skill:** `internal/characters/illuga/skill.go` mutates `ai.FlatDmg` in a delayed
  task after passing `ai` by value to `Core.QueueAttack`. The queued attack therefore deals
  zero skill damage in the pinned binary. The app retains its skill damage. The Lunar
  Crystallize team total can pass despite this known component difference.
- **Danica burst:** `internal/characters/danica/burst.go` uses `burst1SSC` for both the first
  and fifth Stellar hits. Its generated data has a distinct, larger `burst5SSC` array. The app
  retains the fifth-hit formula. Do not lower that multiplier to match this reference defect.

- **Polestar Field expiry:** the native gadget assigns its unsubscribe callback to `OnKill`,
  while natural expiry calls `OnExpiry`. The listener survives expiry and can affect the first
  stack of a later field. A separate patched-reference experiment is recorded in
  [`../priority-coverage/reference-audits/`](../priority-coverage/reference-audits/).

## Remaining limits

- Passing totals can hide offsetting component errors (notably Illuga, Danica, Odette,
  some support weapons/sets and healing contexts). Use the per-ability report when auditing.
- Klee's C0 Spark gain uses complete sampled timelines of the native stack-based A1 process; higher constellations and broader convergence checks remain pending.
  Combo continuation, coordinated-attack scheduling and charge snapshots now run in the timeline.
- Random-position attacks (including Aino and Ayato), Chasca bullet selection and Kinich
  movement use deterministic approximations. Their nonlinear reaction outcomes need more coverage.
- Tracked HP/healing is active when a calculation callback is supplied; the app and numerical
  comparison use it for Furina teams. Structural timeline tests without that callback retain
  the explicit fallback approximation. Higher constellations and every healer are not covered.
- HP-dependent timelines are generated from the build supplied to the rotation calculator.
  KQM candidate gear is evaluated on that generated timeline; it does not regenerate HP/Fanfare
  history for every candidate. Candidate-dependent healing remains an optimizer limitation.
- The production feature flag remains off. Local development defaults to on.

## Next order

1. Audit missing characters and mechanics in Stellar, Lunar, Hexerei, Freeze and Natlan.
2. Verify those omissions before broadening to Fontaine.
3. Fontaine archetypes, then Sumeru archetypes.

The next fixed-build cases and their baseline failures are under
[`../priority-coverage/`](../priority-coverage/). A registry entry alone is not evidence of
mechanics support. Kachina and Nefer lack app kits and implementations in this pinned native
checkout. Lohen, Vodyanitsa, Vesna and Valeriy now have app kits; their current
checks and explicit limitations are recorded in [`../priority-missing-kits/`](../priority-missing-kits/). Track these explicitly instead of silently skipping them.

The expanded current matrix has 40 cases, 39 passing canonical team gates and 70 distinct
characters. Valeriy Stellar remains flagged; isolated patched-source experiments never replace
the official reference. Production KQM remains disabled.
