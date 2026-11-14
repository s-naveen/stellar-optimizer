# Priority simulator validation after handoff

**39/40 passing team gates, 70 distinct characters**. Direct talent/gear damage is within 5% in every tested appearance for **55/70** characters; **15/70** have at least one larger component gap. These are fixed-build diagnostics, not full character certification. Refreshed 2026-11-12 after the Natlan timing and event-snapshot corrections.

| Stage | Passing comparisons |
| --- | ---: |
| [Original priority teams](../priority-mechanics/) | 14/14 |
| [Expanded priority coverage](../priority-coverage/) | 9/9 |
| [New simulator kits](../priority-missing-kits/) | 6/7 |
| [Expanded Freeze](../priority-freeze/) | 4/4 |
| [Varka recharge modes](../priority-varka/) | 2/2 |
| [Cryo Traveler modes](../priority-cryo-traveler/) | 2/2 |
| [Clorinde Stellar](../priority-stellar-adapted/) | 1/1 |
| [Freeze mechanics stress](../priority-freeze-mechanics/) | 1/1 |

The numerical gate remains ±5% for both DPS and duration, with no rotation warnings. All cases retain four complete loops including startup, 200 KQM simulator trials, one level-100 target (10% resistance, radius 2, distance 2.4, HP 999,999,999) and legal fixed KQM profiles: C6 four-stars / C0 five-stars, 10/10/10 base talents, two fixed rolls per substat plus 20 liquid rolls. Burst energy is ignored; ER sustainability is not certified.

| Flagged team | DPS gap | Duration gap | Finding |
| --- | ---: | ---: | --- |
| stellar_valeriy | -6.9% | -0.0% | Canonical reference has a Polestar expiry listener defect and uses half the Sandrone passive bonus in the app's current data. Current app code compared with the separately recorded corrected-reference mean gives -1.2% DPS / -0.0% duration. This does not replace the canonical result. |

The off-field Cryo Traveler team passes at **-3.2% DPS / +0.4% duration**. Traveler's remaining direct-component flag is retained against the canonical reference. The isolated [Stellar reference audit](../priority-coverage/reference-audits/stellar-expiry-sandrone.md) preserves earlier selected-attack comparisons and now records a separate current-app recheck. Matching selected contexts does not certify every ability or remove canonical flags.

## Verified changes

Claude added measured normal hitlag to 57 kits, Dori healing, cast/proc snapshots for Sucrose/Xingqiu/Yelan, timed Thrilling Tales and Petra behavior, simulated reactions on otherwise blocked formula nodes, and an enemy-task queue. Unsupported higher constellations for Lohen/Vesna/Vodyanitsa now produce explicit warnings while retaining the implemented base mechanics. These changes are not blanket kit certification.

Follow-up corrections enforce enemy → character → core task order for simultaneous events, combine an attack’s own cast-time snapshot with separately captured teammate buffs, and make aura mismatches fail the replay test. Eight compact, versioned [recordings](../reaction-replay/) cover 1,824 applications without local `/tmp` dependencies.

Razor now receives burst attack speed; Dahlia A4 uses evaluated HP, C6 and normal-state eligibility, including the first-versus-later normals inside a grouped string. Pale Flame gains only after eligible on-field skill damage, has a shared gain cooldown and refreshed character-clock expiry, and no longer assumes two permanent stacks. Razor C6 uses his paused clock. The Hexerei team passes at -2.9% DPS / +0.5% duration, but Razor’s own direct damage remains around -5.1%; particle-triggered C1 and other kit details remain unverified.

Qiqi's Herald captures offensive stats before its initial hit can grant Tenacity, retains them for deployable swipes, and applies initial/target hitlag separately. Its coordinated-attack cooldown uses the triggering character's clock; the extra burst is tagged as direct Stellar Conduct. The snapshot API can retain the actual event's conditions, avoiding later buffs on the same frame leaking backward into the capture.

Polestar's application cooldown uses each contributing character's clock; its character buffs and physical resistance reduction expire on recipient and enemy clocks respectively. Odette's Coda final hitlag, delayed burst attacks, Splendor transfers and Snow Swan's Dream now follow the corresponding character clock. Summon lifetime, ordinary Coda DoT and dance ticks retain native world-time behavior.

Shared normal-attack watchers now use each individual normal state's start and native trigger delay. Electro-Charged cleanup occurs immediately after a reaction consumes its source aura, including during target hitlag. The Prune recording checks this independently; the pinned native C4 snapshot can apply damage modifiers twice, retained as a separate reference discrepancy.

Freeze now follows the native deferred ordering for unreacted aura attachments. Aura-dependent CRIT is evaluated at impact, while Ayaka's burst captures base stats at its first cutting hit. Ayaka's Freeze case passes at **+0.4% DPS**, and her direct damage is now within 5%.

The Natlan follow-up fixes Mualani's burst wait cancel (108 frames instead of 180), its projectile snapshot (108 before impact at 178), Xiangling's three initial burst pauses and character-clock snapshot, and same-frame offensive captures. Xilonen's first crystallizing hit no longer gains the Scroll buff it triggers. Furina's Fanfare remains a live native attack modifier instead of being frozen with other offensive stats. Mualani's direct gap changes from **+20.1% to -4.4%**, Xilonen's from **+14.7% to +0.05%** in that team, and the team passes at **-1.2% DPS / -0.04% duration**. Xiangling retains a -6.1% direct-component flag there.

Claude's additional work includes Nilou/Charlotte/Hu Tao enemy-side effects, Dendro resonance and Baizhu/Nilou bonuses, Hu Tao/Keqing cancels, and sampled Citlali scheduling. Citlali uses 64 complete sampled timelines; this is distinct from the 200 native Monte Carlo trials. The Mavuika case now passes at +0.8% team DPS. Nilou's separate older-profile comparison still fails duration and is not certified by a same-length selected sample.

## Validation

- **497 tests pass across 36 files; one local-data test is skipped.**
- **Eight aura recordings / 1,824 applications** pass at the preserved absolute gauge tolerance of 0.6, with event identity, ordering and aura presence checked. This does not certify all reaction damage, owners or configurations.
- The UI library type check reports the two existing `ImportMeta.glob` errors in `gi/char-cards`. No new rotation-engine errors are reported.
- Production KQM remains disabled. No simulator changes were committed or deployed in this handoff.

## Additional upstream comparisons

These seven comparisons use their own older profiles/reference setup, separate from the 40-case KQM matrix. Damage uses the simulator’s actual mean total damage, not mean DPS multiplied by mean duration. Nilou’s similar total damage still hides a duration mismatch.

| Team | Total damage gap | Duration gap | DPS gap |
| --- | ---: | ---: | ---: |
| classic | +0.5% | -0.0% | +0.5% |
| keqing_aggravate | +1.5% | -0.2% | +1.7% |
| arle_overvape | +0.4% | +0.0% | +0.4% |
| nilou_bloom | +3.8% | +7.3% | -3.5% |
| dori_hyperbloom | +2.4% | +0.1% | +2.3% |
| neuv_lunarcharged | -1.1% | +2.7% | -3.7% |
| kqm_stellar | +2.5% | +0.0% | +2.5% |

## Pending work

| Area | Remaining work |
| --- | --- |
| Stellar | Canonical Valeriy remains flagged despite the isolated reference corrections passing. Continue other direct/shared components, modes and constellations; preserve reference-defect evidence. |
| Component gaps | Continue the 15 flagged character diagnostics; passing totals can contain offsetting errors. Known native discrepancies remain flagged separately. Illuga's +36.7% is a pinned-reference defect (its skill tap deals 0); with the [patched reference](../priority-coverage/reference-audits/illuga.md) it is +3.2%. |
| Timers and snapshots | Continue untested enemy effects, cast snapshots, live attack modifiers and grouped actions that cross buff expiry. Nilou/Charlotte/Hu Tao fixes are implemented; their full kits are not certified. |
| Razor/Dahlia | Particle-triggered C1, stance/sigil clocks and cooldown reset; additional Dahlia shield, energy and grouped-action expiry scenarios. |
| Klee | Sampled C0 Spark stacks, gain cooldown, expiry, actual burst instances and coordinated charges are checked. C1-C6, energy and sample convergence across more teams remain unverified. |
| Other priority modes | Clorinde timing, Cryo Traveler higher constellations/mode boundaries, Kaeya defeat extensions, Aloy coils, Charlotte C6, multiple enemies and shield breaks. |
| Missing implementations | Newer Cyno/Mizuki Stellar mechanics are absent from the pin; Kachina and Nefer have neither an app nor pinned native kit. |
| Tsaritsa modes | Love/off-field comparisons do not cover Honor. Hold skill, Honor burst, enhanced on-field normals and Doom remain unsupported in the timeline/native pin, although manual damage nodes exist. |
| Optimizer resources | Rebuild candidate-dependent HP/Fanfare, Lohen Will, enemy-HP thresholds and HP-based attack-speed histories during gear search; verify ER/refunds separately. |
| Later archetypes | Finish priority coverage before Fontaine, then Sumeru. |

Canonical KQM source remains `7bdf45f2e299c6bf782f81dc60d6cb19fd0bfb4c`; binary SHA-256 remains `2c77043fef38aef3815c7866a77b36bedd78751e68f598c0fb743e89104becc5`. [status.json](status.json) records all 40 cases, every direct-component appearance, fixture hashes and a rotation-source fingerprint.
