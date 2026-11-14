# Illuga skill reference audit

Canonical `lunar_crystallize` flags Illuga's direct damage at about **+36.7%**. Almost all of it is
Dawnbearing Songbird (Tap): the pinned native kit lands the hit but always deals **0 damage**.

The pinned `internal/characters/illuga/skill.go` adds the tap's flat damage (Elemental Mastery and
DEF scaling) to `ai` inside a task at the hitmark, but `QueueAttack` has already copied `ai` when
the attack was queued, so the addition never reaches the attack. The hold variant has the same
pattern. Upstream gcsim computes `FlatDmg` from the snapshot before queueing the attack.

`illuga-skill-flatdmg.patch` moves the queue into that task (flat damage added, then queued at the
hitmark) for both variants. With the canonical source checkout and the patched binary
(`illuga-skill-flatdmg.json`, 200 trials):

| | Canonical | Patched reference |
| --- | ---: | ---: |
| Tap damage per loop (reference) | 0 | 9,057 (app 9,068) |
| Illuga direct damage | +36.7% | +3.2% |
| Team DPS | +1.3% | +0.9% |

The app's Illuga is not changed. The canonical result stays the official one; this audit only
records that the flag comes from the reference.
