# Fresh archetype comparisons

Seven teams, 28 distinct characters, with no members reused from the earlier Keqing,
Arlecchino, Nilou, Dori, Neuvillette, Hu Tao or KQM-only character comparisons.
`teams.json` contains both the rotation-writer text and the corresponding native commands.

| Fixture | Archetype | Members |
| --- | --- | --- |
| ayaka_freeze | Freeze | Ayaka, Shenhe, Kokomi, Kazuha |
| alhaitham_spread | Spread | Alhaitham, Yae Miko, Yaoyao, Kirara |
| ayato_burgeon | Burgeon | Ayato, Thoma, Collei, Dendro Traveler |
| clorinde_overload | Overload | Clorinde, Chevreuse, Beidou, Xiangling |
| eula_physical | Physical / Superconduct | Eula, Raiden, Rosaria, Mika |
| itto_mono_geo | Mono Geo / DEF carry | Itto, Gorou, Albedo, Chiori |
| xiao_anemo_plunge | Anemo plunge | Xiao, Faruzan, Xianyun, Jean |

## Run

Build the native binary from the exact kqmsim commit in `teams.json`, then run:

```sh
python3 tools/scripts/benchmark-rotation-archetypes.py \
  --source /path/to/kqmsim \
  --binary /path/to/kqmsim-binary \
  --output /tmp/rotation-archetypes \
  --check-accuracy
```

The runner checks the reference checkout's revision and requires it to be clean. It writes the
native configurations, app build/rotation inputs, aggregate native results, individual samples,
app results, and a combined `report.json`. `--reuse-reference` reuses an existing result only
when the native sample's recorded configuration matches the generated configuration. Use a
fresh output directory after rebuilding the native binary. `--teams=id,id` selects cases.

The separate structural/regression tests run without the native executable:

```sh
node_modules/.bin/vitest run --config libs/gi/ui/vitest.config.mts \
  libs/gi/ui/src/tests/rotationArchetypes.test.ts
```

## What is measured

Both sides use level 90 characters, C6 four-stars / C0 five-stars, 10/10/10 base talents plus
constellation bonuses, level 90 weapons, five +20 five-star artifact mains, two fixed rolls
of each substat, and 20 liquid rolls respecting the main-stat eligibility caps. These are
fixed test builds, not a search for each team's best gear. The profiles deliberately exercise
weapon/set conditions alongside the character kits.

The native target is one enemy at level 100 with 10% resistance and enough HP to survive the
rotation. Burst energy is ignored to isolate mechanics and timing; these cases do not validate
ER sufficiency. kqmsim runs 200 Monte Carlo trials of four fixed loops. The app now retains
all four complete loops too, including startup. The historical measurements below predate
that alignment and subsequent mechanics fixes; rerun the fixtures for current numbers.
The report retains native DPS standard deviation, per-character/ability damage and hit counts,
reaction counts, and rotation duration so a matching total cannot hide compensating errors.

`--check-accuracy` exits nonzero unless **both DPS and duration are within 5%** of the reference
for every selected team, with no rejected/skipped app actions. This is an audit threshold, not
a claim that a five-percent difference establishes correct mechanics. A normal comparison run
can complete successfully while its numerical accuracy gate fails.

## Historical initial audit, 2026-11-10

All seven configurations execute in kqmsim. After fixing the Itto alias, party-triggered
Starwicker and Beidou's single-target bounce count, the structural/regression tests pass.
**All seven teams failed the numerical accuracy gate at this initial checkpoint.**
Current priority work is recorded in [`../priority-mechanics/README.md`](../priority-mechanics/README.md).

| Fixture | App / reference DPS | DPS gap | App / reference seconds |
| --- | ---: | ---: | ---: |
| ayaka_freeze | 29,899 / 40,776 | -26.7% | 20.33 / 19.83 |
| alhaitham_spread | 22,649 / 30,092 | -24.7% | 35.88 / 27.11 |
| ayato_burgeon | 27,784 / 25,117 | +10.6% | 24.67 / 22.98 |
| clorinde_overload | 25,680 / 44,312 | -42.0% | 20.30 / 18.89 |
| eula_physical | 24,672 / 31,128 | -20.7% | 21.70 / 23.90 |
| itto_mono_geo | 23,003 / 31,044 | -25.9% | 23.22 / 23.35 |
| xiao_anemo_plunge | 22,134 / 38,342 | -42.3% | 20.63 / 19.39 |

These are measured differences for these exact fixtures. The following omissions are evidenced
by the kit implementation and per-ability breakdown; they do not necessarily explain the entire
gap for their team:

- Freeze: Kazuha's absorbed skill/burst hits and A4 elemental-damage buff are absent. Ayaka's
  burst hit count matches, while her per-hit damage is low.
- Spread: Yae uses a single four-second skill cooldown in place of three charges, and her burst
  does not reset those charges. Adjacent grouped normal strings also restart in the app while
  the native counter continues through its combo; Alhaitham's attack sequences need auditing.
- Burgeon: Dendro Traveler's Hydro/Electro/Pyro lamp transformations are absent, and Collei's
  burst duration/application timings differ. Ayato's and Thoma's damage are overestimated.
- Overload: Clorinde's A1 reaction stacks and Chevreuse's Overload-triggered effects are absent.
  Beidou's former multi-enemy bounce assumption had masked part of the underestimation.
- Physical: Raiden's Resolve and energy-cost-based Eye buff are not timed. Mika has no healing
  events for Clam; the reference has two foam hits and the app has none.
- Mono Geo: Chiori does not create the second Tamoto from Albedo's Geo construct (five missing
  turret hits). Itto's charged-slash sequence also differs (8 combo + 2 final versus 9 + 1).
- Plunge: Starwicker now produces eight follow-ups, but Xianyun's A4 plunge bonus is still absent.
  Jean's Clam healing events and Xiao's HP-change set timing are also unmodelled.

Production KQM remains disabled. These measurements do not establish readiness to enable it.
