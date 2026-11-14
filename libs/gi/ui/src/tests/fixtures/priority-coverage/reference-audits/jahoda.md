# Jahoda Ascendant Gleam source audit

The pinned native `jahoda.go` initializes `a1HealMult = 1.0`, but leaves `a1DmgMult`
at Go's zero value. Only the Pyro A1 branch assigns `a1DmgMult = 1.3`.
`burst.go` multiplies robot flat damage by that field. Electro/Hydro/Cryo teams
therefore deal zero robot damage in the canonical reference, despite its talent
coefficient and successful aura absorption.

The app keeps the described baseline multiplier of 1.0. A separate detached native
worktree adds only that initialization; the exact patch, binary hash and measured
results are recorded beside this file. The canonical checkout is unchanged.

Both references use four full loops and 200 random trials. The comparison isolates
the initialization change, but seeds are not paired, so changes in the overall means
also include ordinary Monte Carlo variation. Other component differences remain.

The app now fills the flask from actual enemy aura, retains its first absorbed element,
handles partial/empty pursuit and early drains, retries robot absorption with no aura,
snapshots robot ATK at absorption, separates element ICDs, and extends C6 on each
recipient's character clock. C1 bounces accumulate probability deterministically;
this is not a random-trial or multi-target certification. Energy refunds remain unverified.
