# Recorded aura regressions

These eight recordings contain 1,824 external element applications from gcsim/kqmsim. The normal test suite replays every application and recorded enemy hitlag through the app's reaction engine. It asserts event count, frame, character, ability, element, durability and the resulting aura. A gauge difference of 0.6 or more fails the test; this preserves the original diagnostic tolerance. Aura presence is also checked independently beyond the native log's 0.001 rounding boundary, since a small Frozen aura still controls CRIT and Shatter. Display filters do not affect assertions.

| Recording | Applications | Reference |
| --- | ---: | --- |
| Dori Hyperbloom | 250 | gcsim `b107b5dc5cb88977bed5270e5d83e64934730d4d` |
| Keqing Aggravate | 344 | Same gcsim revision |
| Arlecchino Overvape | 298 | Same gcsim revision |
| Nilou Bloom | 195 | Same gcsim revision |
| Neuvillette Lunar-Charged | 193 | Same gcsim revision |
| Danica Stellar | 215 | kqmsim `7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c` |
| Prune / Albedo Hexerei | 149 | Same kqmsim revision |
| Ayaka / Shenhe / Kokomi Freeze | 180 | Same kqmsim revision |

The Prune recording covers immediate Electro-Charged cleanup during target hitlag. Deferring cleanup until the next aura-decay tick incorrectly revived an expired EC chain when Electro was reapplied; five recorded applications diverged before this correction.

The Freeze recording retains the native application order. Native defers ordinary unreacted attachments to a damage callback; another attack already queued at the same frame reacts before that refill. The kit-level regression separately checks this order, Kazuha's slash hitlag and Ayaka's sprint application. Replaying application logs alone does not prove that kits have queued their original hits in the right order.

The original simulator logs are reduced to the fields consumed by the replay. Each recording retains its repository, source revision, seed, configuration hash and full original sample hash. This data is derived from the AGPLv3 simulators and is kept under the project's AGPLv3 license.

`applications` entries are `[frame, actorIndex, ability, element, durability, auraBefore, auraAfter]`. `pauses` entries are `[frame, duration, factor]`; the enemy pause is `ceil(duration × (1 − factor))`. Generated reaction applications are excluded from the input stream because the app must generate them itself. The test normalizes `burningFuel` to the reference's `dendro-fuel` spelling.

These are single-target aura regressions with recorded application timing. They do not certify arbitrary character timing, damage, reaction ownership, shared-reaction scaling, equipment or multiple targets. Use the fixed-build numerical comparisons separately.

Run the suite without external files:

```sh
node node_modules/vitest/vitest.mjs run --config libs/gi/ui/vitest.config.mts \
  libs/gi/ui/src/tests/reactionReplay.test.ts --maxWorkers=2 --minWorkers=1
```

Set `REPLAY=/path/to/sample.json` to add a local recording. Comma-separated paths are supported. `SHOW=10-12` prints that time window while checking the entire recording.
