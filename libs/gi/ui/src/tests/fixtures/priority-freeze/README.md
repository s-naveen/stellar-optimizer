# Expanded Freeze coverage

Latest numerical rerun and pending work: [priority validation](../priority-validation/).

Four complete loops, 200 native trials, one level-100 target with 10% resistance, and legal fixed KQM builds (C0 five-stars / C6 four-stars; 10/10/10 base talents). The unchanged gate requires DPS and duration within 5%. Burst energy is ignored, so these comparisons do not validate ER sustainability.

| Case | Our app DPS | KQM simulator DPS | DPS gap | Duration gap | Gate |
| --- | ---: | ---: | ---: | ---: | --- |
| freeze_ayaka_shenhe_kokomi | 40,952 | 40,772 | +0.4% | -0.0% | Pass |
| freeze_ganyu_rosaria_diona | 18,888 | 19,269 | -2.0% | +0.7% | Pass |
| freeze_kaeya_chongyun_layla | 15,590 | 15,691 | -0.6% | -0.0% | Pass |
| freeze_aloy_charlotte | 7,545 | 7,551 | -0.1% | -0.0% | Pass |

The cases add Ayaka/Shenhe/Kokomi, Ganyu/Rosaria/Diona, Kaeya/Chongyun/Layla and Aloy/Charlotte. Together with earlier stages, eight Freeze teams pass; presence in a team does not certify every character mechanic.

Corrections checked here: Ganyu's guaranteed target marks and annulus-based collateral hit expectation; Mona's zero-damage Hydro bubble application, Omen while the bubble remains, Freeze-aware popping, timeout and post-pop duration; Rosaria's captured ATK/A1 crit contribution and hitlag; Kaeya's normal hitlag. Each has focused regressions.

Still unverified: exact random multi-target targeting, shatter/impulse edge cases, Kaeya defeat extensions, Aloy coil scenarios, Charlotte C6 healing, and shield-break behavior. Refer to the [latest cumulative checkpoint](../priority-validation/status.json) and [coverage audit](../priority-coverage/coverage-audit.json).

Bake-Kurage now retains cast-time ATK before later Tenacity buffs. Kokomi direct damage matches canonical native within 0.001% in both tested teams; other Kokomi modes and healing remain outside that claim.

[Chongyun A1/C2/C6 and Xingqiu orbital follow-up](../priority-freeze-mechanics/) adds a cooldown stress rotation and focused checks. Layla C4 consumption and skill-driven Night Stars are covered there too.
