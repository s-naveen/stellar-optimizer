# Lohen: source and runtime audit

Reference: [KQM-git/kqmsim at 7bdf45f](https://github.com/KQM-git/kqmsim/tree/7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c/internal/characters/lohen).
The canonical binary's Go build information identifies that revision and `vcs.modified=false`.
Its checkout was kept clean throughout the audit.

## Identified source omissions

1. `attack.go` defines N3 hitmarks 13, 24 and 35, but loops over the generated multiplier table.
   `zz_lohen.dm.go` contains only one multiplier entry for N3, despite its own `x3` comment.
   This affects ordinary and Masterstroke N3: only the first hit is queued.
2. `skill.go` checks 100 Joy before a special skill but neither consumes Joy nor increments
   `skillsUsed` in `skillPierce`. The source's three-use check therefore never takes effect.
3. `burst.go` queues five hits at 101, 122, 128, 137 and 162. The app's sheet data describes six.
   No sixth timing has been invented. The current C0 kit explicitly reports this discrepancy.
4. The Will listener has no per-member 0.1-second gain ICD; the imported description specifies
   one. The app applies six frames. The pinned A4 listener also lacks the stance requirement
   present in its description; the app requires Masterstroke.

The imported tooltip descriptions contain malformed numeric substitutions, so they are not
used to choose Joy/Will amounts. Those values and timing come from the pinned implementation;
the descriptions establish consumption, hit multiplicity, limits and the gain ICD.

## Isolated N4 experiment

The same four-loop rotation uses N4, special skill, N4, special skill, then burst. With the
missing N3 hits the native run reaches only 68 Joy after N4 and stalls at each requested skill.
The first stall is not evidence that the app should lower its damage.

An isolated detached worktree changed only N3 multiplicity and special-skill Joy consumption /
use counting. It did not change multipliers, frame tables, gear, or the official checkout.

| Implementation | DPS | Seconds per loop |
| --- | ---: | ---: |
| Original pinned native | 14,999 | 54.68 |
| Native with isolated N3/Joy patch | 38,883 | 24.8125 |
| App with described N3/Joy behavior | 38,453 | 24.80 |

Both native measurements use 200 trials, with unpaired random seeds. The app differs from the
patched native mean by -1.1%. The exact patch, config and SHA-256 metadata are saved alongside:

- [`lohen-n3-joy.patch`](lohen-n3-joy.patch)
- [`lohen-n4.cfg`](lohen-n4.cfg)
- [`lohen-n3-joy.json`](lohen-n3-joy.json)

The separate official N5 fixture can execute on the original native binary and passes its
team gate. That fixture does not erase the N4 failure or certify the unresolved burst behavior.

## App implementation limits

Only C0 is implemented. Missing formula evaluations and fractional expected hit counts are
reported instead of silently treating their resources as verified. Candidate-dependent Will
history is captured when generating the timeline and is not recomputed inside every KQM gear
candidate search; treat the current fixed-build result separately from optimization reliability.
