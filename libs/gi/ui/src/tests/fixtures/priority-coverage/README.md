# Missing-priority-character coverage

Latest numerical rerun and pending work: [priority validation](../priority-validation/).

This follow-up comes before Fontaine and Sumeru, per the requested audit order.
The original 14 cases are in [`../priority-mechanics/`](../priority-mechanics/).

## Expanded priority checkpoint

All nine cases pass the unchanged gate against the canonical pinned binary; `stellar_traveler` is now -3.2% DPS / +0.4% duration after correcting Qiqi’s snapshots and hitlag. The [latest cumulative checkpoint](../priority-validation/) contains **39/40 passing team gates, 70 distinct characters**. Only the Valeriy Stellar case remains flagged. A passing team total does not certify a full kit.

| Case | Our app DPS | KQM simulator DPS | DPS gap | Duration gap | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| hexerei_varka | 33,827 | 33,730 | +0.3% | +1.0% | Pass |
| hexerei_prune_albedo | 23,328 | 23,562 | -1.0% | -0.0% | Pass |
| natlan_ifa_jahoda | 22,976 | 22,936 | +0.2% | +3.0% | Pass |
| stellar_traveler | 8,155 | 8,421 | -3.2% | +0.4% | Pass |
| freeze_skirk | 60,788 | 61,070 | -0.5% | -0.0% | Pass |
| natlan_pyro_traveler_tap | 25,588 | 25,122 | +1.9% | +0.0% | Pass |
| natlan_pyro_traveler_hold | 25,796 | 24,609 | +4.8% | +0.0% | Pass |
| lunar_jahoda_ascendant | 63,309 | 62,977 | +0.5% | -0.0% | Pass |
| hexerei_prune_convert | 18,240 | 17,594 | +3.7% | -1.8% | Pass |

Four complete loops, 200 native trials, one level-100 target with 10% resistance, and legal fixed KQM builds (C0 five-stars / C6 four-stars; 10/10/10 base talents). The unchanged gate requires DPS and duration within 5%. Burst energy is ignored, so these comparisons do not validate ER sustainability.

Run with `tools/scripts/benchmark-rotation-archetypes.py --fixture libs/gi/ui/src/tests/fixtures/priority-coverage/teams.json --source /path/to/clean/kqmsim --binary /path/to/kqmsim --output /tmp/priority-coverage --check-accuracy`.

## Reference expiry experiment

The pinned Polestar Field assigns `OnKill = p.unsub`, but natural gadget expiry invokes
`OnExpiry` and never `OnKill`. Its old element-application listener therefore survives expiry
and can count the application that precedes creating the next field. The app expires its
listener/counting window with the field, so the reference may give the first refreshed field
an extra stack. This matters because the first stack raises the direct Stellar multiplier
from 1.0 to 1.45.

A separate detached reference worktree added only `OnExpiry = p.unsub`. With the same
`stellar_traveler` config, the measured native mean changed from **8,420.93 to 8,230.13 DPS**
(200 trials each; seeds are not paired). App DPS was 8,071.91. This supports keeping the source
issue separate from app multiplier changes. The original pinned checkout is unchanged.
The exact patch and measured metadata are in [`reference-audits/`](reference-audits/).

## Remaining priority audit

[`coverage-audit.json`](coverage-audit.json) records character presence, app/native implementation
availability, and mechanics not exercised by these rotations. Presence in a team is not proof
of full kit coverage.

- **Vesna and Valeriy:** app kits added; C0 Vesna has two passing cases, C6 Valeriy has
  one passing and one flagged case. Their limits and source audits are in the later checkpoint.
- **Lohen:** C0 kit added in the later checkpoint; native burst hit count and other source
  discrepancies remain documented, and full kit / constellation validation is pending.
- **Vodyanitsa:** C0 Freeze and Stellar Swirl cases added; native passive scope remains explicit.
- **App and pinned-native implementation missing:** Kachina and Nefer. Do not silently skip
  them or present their metadata/sheets as simulator support.
- **Added Freeze cases:** Ayaka, Ganyu, Diona, Layla, Charlotte, Kaeya, Chongyun, Rosaria, Aloy and Kokomi now have current cases in [priority-freeze](../priority-freeze/). Their remaining mechanics are explicit there. Clorinde now has a passing [Stellar case](../priority-stellar-adapted/); Cyno and Mizuki newer Stellar mechanics are absent from the pinned native kits.
- **Added modes:** Pyro Traveler C0 tap/hold Nightsoul and Jahoda Ascendant Gleam now have cases.
  Jahoda robot baseline damage has a native source defect; see [the isolated audit](reference-audits/jahoda.md).
- **Checked additional modes:** Prune conversion, recipient-specific Hexerei effects, C6 polling and source snapshots; Varka recharge, A4 and stance clocks (see [priority-varka](../priority-varka/)).
- **Additional modes checked:** Cryo Traveler C0 on-field conversion/Freezing Ice and [Chongyun A1/C2/C6](../priority-freeze-mechanics/). Klee Spark randomness remains pending.
- **Optimizer limit:** candidate-dependent HP/Fanfare and Lohen Will history is not regenerated for each KQM
  gear candidate. Passing fixed-build comparisons does not remove that limitation.

Finish those character/mechanics gaps before Fontaine, then Sumeru. Production KQM stays disabled.
