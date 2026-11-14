# Valeriy C6 source audit

Latest follow-up: [Stellar expiry and passive-data audit](stellar-expiry-sandrone.md). After correcting Odette's character-clock timing, the canonical case is -5.2% DPS with near-exact duration. An isolated expiry plus Sandrone passive-data correction is +0.5% DPS; the original benchmark remains flagged. Historical experiments below are preserved.

The original Polestar expiry issue is described in `../README.md` and its exact patch
is `polestar-expiry.patch`. The new Valeriy/Odette/Mitya/Sandrone case exercises several
field expiry/recreation cycles, making the stale listener more visible.

After fixing app hit tags, Sandrone normal hitlag/cancels and burst character tasks,
and restricting Valeriy C6's extra Stellar Conduct CRIT DMG to Electro variants, this
case remains outside the canonical 5% team gate. Do not raise the tolerance or restore
the incorrect Cryo CRIT DMG bonus to make it pass.

`valeriy-polestar-expiry.json` records both canonical and isolated expiry-fixed
results, including per-character diagnostics. The latter improves the comparison but
is not substituted for the official reference and does not certify all kit mechanics.
Both means use 200 native trials with unpaired seeds.

Valeriy's shell rhythm cycles the six native timing patterns. Momentum uses half-point
precision for C4 gains, the Directive has a shared fifteen-hit pool, A1 observes active
Electro damage, and C6 begins after the triggering hit. ER refunds and damage/shield
growth from excess Momentum remain unverified; plunges are unsupported.
