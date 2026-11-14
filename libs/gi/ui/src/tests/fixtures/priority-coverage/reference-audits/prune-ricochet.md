# Prune C4 copied attack modifiers

Canonical source: KQM-git/kqmsim `7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c`. The original source checkout and binary are unchanged. [Recorded calculations](prune-ricochet.json) retain the sample seed/hash and sixteen parent/ricochet pairs.

Prune's C4 callback in `internal/characters/prune/cons.go` passes the parent's `AttackEvent.Snapshot` to `QueueAttackWithSnap`. The callback runs after `Enemy.HandleAttack` has called `CharWrapper.ApplyAttackMods`, which adds the attack modifiers into `Snapshot.Stats`. The ricochet subsequently runs through `ApplyAttackMods` again.

In this fixture, the first A1 hammer's recorded damage bonus is 0.9115503; its C4 ricochet records 1.8231006. Another pair records 0.3115503 and 0.6231006. Mona's Omen and Albedo's Hexerei modifiers appear in both hits' modifier logs. This supports a copied-modifier discrepancy in the reference, rather than a reason to grant the app's ricochet the same bonus twice.

The JSON includes an arithmetic diagnostic that subtracts the parent's copied bonus. This assumes the parent has zero base all-DMG bonus, as in this fixed Oathsworn Eye / Viridescent profile. It is not a patched native experiment, official benchmark substitute, or general correction for every gear combination.

The app needed independent fixes: coordinated attacks now use actual grouped normal starts, native animation delays and the appropriate character clock. An expired Electro-Charged chain is cleaned up immediately after double Swirl or Electro Crystallize, including during target hitlag. These changes restore all four A1 and C4 triggers per loop in the Prune/Albedo case. The remaining direct-component difference stays visible in the official checkpoint.
