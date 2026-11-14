# Pre-5.0 character audit (2026-11-13)

The 74 characters released before 5.0 and not buffed since (the post-5.0 and buffed ones are in
[post-5.0-audit.md](post-5.0-audit.md)) were checked the same way: the in-game text of every talent,
passive and constellation (C1–C6), an action-pair frame matrix against the pinned kqmsim
(`7bdf45f2`) at C0 and C6, and a C0/C6 solo damage check per character against kqmsim (same build,
same rotation, per-ability hits and damage). Frame-matrix mismatches went from 1,372 rows to 316;
every remaining row is listed below as a reference artifact, a random roll in the reference, or a
deliberate difference. The C0/C6 damage checks pass the 5% gate in 154 of 164 cases; the 10 outside
are Anemo Traveler (3, Gust Surge value), Geo Traveler (2, locked passive), Sigewinne C6, Barbara C6,
Collei C0/C6 and Aloy C6 (−5.0%), all reference defects below. The 40-case team gate is unchanged at
34/40 (the five Anastasya crown-freeze teams and Valeriy's Polestar field). To follow up: Raiden in
`electro_valeriy` is +6% per hit while her solo checks are +1.5% / +1.0% (the team stays in the gate
at +4.2%).

Where the reference contradicts the game text, the app follows the game text.

## Reference defects (app follows the game text)

| Character | Game text | Reference | Effect |
| --- | --- | --- | --- |
| Anemo Traveler | Gust Surge "Tornado DMG 80.8%", "Additional Elemental DMG 24.8%" (Lv1; datamined parameters agree, the ability config has no extra ratio) | 37.6% / 18.8% (also upstream gcsim) | solo +28% / +32%. **Open:** if the reference's values are measured, the app's burst is 2.15× too high |
| Geo / Electro Traveler | locked passives (Charged Attack: Rockfell, Detonate) | not implemented | solo +6 to +9%, +4 to +5% |
| Pyro Traveler | locked passive (Charged Attack: Inferno) | not implemented | Pyro Traveler teams gain the Inferno |
| Wanderer | C2 increases Kyougen's DMG | general DMG% for the whole burst animation | small |
| Lynette | C6 "for 6s"; Vivid Shots and A4 end with the Bogglecat Box | 6.4 s; a full box duration after conversion | small |
| Xianyun | Skyladder hits "targets along her path" | only within 1.5 m of the target's centre (never the standard target) | small |
| Dendro Traveler | the lamp ends with Transfiguration | keeps attacking a full lamp duration | not exercised |
| Amber | C6 "ATK by 15% for 10s" | 15 s | small |
| Yanfei | Brilliance ends when she leaves the field | deletes the wrong key | small |
| Keqing | A1 infusion 5 s; C6 counts the recast | 5.33 s (comment: 5.6 s measured); skips the recast | small |
| Yoimiya | A4 uses the stacks she has when casting | counts expired stacks | small |
| Dori | A1 needs the Jinni connection | no check | small |
| Bennett | heals at "equal to or below 70%" | below 70% | none |
| Eula | A4 grants a Grimheart stack; C4 only Lightfall Swords | only with a stack up; also the burst's initial hit | small |
| Zhongli | C2 Jade Shield "when it descends" | at cast | none |
| Chiori | default Tailoring only on the field | off-field too | small |
| Xinyan | C1 on any CRIT (plunges too) | not plunges | small |
| Noelle | C6 +1 s per defeat | assumes 10 defeats (benchmark uses `extend=0`) | — |
| Sigewinne | C5 raises Super Saturated Syringing | burst uses the Normal Attack level | C6 +9.3% |
| Barbara | C2 "your active character gains 15% Hydro DMG" | everyone except Barbara | C6 +10% |
| Kokomi | C6 "for 4s" | 480 frames | small |
| Tartaglia | C4 "every 4s" | 3.9 s | small |
| Lyney | C2 stacks "when Lyney is on the field" | only after a swap-in | solo C6 +26% without a swap |
| Clorinde | Night Vigil ends on leaving the field; no Charged Attacks in it | kept after a swap; allowed | small |
| Furina | A1 from the active character's overflow | any member's | small |
| Emilie | C2 from three named sources | also Spiritbreath Thorn | small |
| Neuvillette | A4 from current HP | none until his HP first changes | C0 +3% |
| Ganyu | C1 "for 6s"; C4 "begins at 5%" | 5 s; keeps 5 stacks into the next burst | C6 −1.9% |
| Aloy | Coils from Freeze Bomb too; cleared 30 s after leaving combat; no constellations | Bomblets only; after leaving the field; C3/C5 levels | C6 −5.0% |
| Kirara | C6 "All Elemental DMG" | Physical too | small |
| Collei | A4 extension count per burst | never resets (only the first burst extends) | +5.5% / +6.8% |
| Mika | C1 shortens the interval under Soulwind | always | none (healing) |
| Alhaitham | mirror removal interval 4 s; burst EM bonus per hit | 233 frames; at cast, scaled by skill level | C6 +2.7% |

Kept as the reference (text ambiguous or the reference consistent with it): Zhongli steles do not
resonate with each other; Eula's shred lasts 7 s per stack; Thoma C1 flat cooldowns; Hu Tao's Blood
Blossom 9.5 s; Dori's Connector 32 ticks; Bennett C6 infusion for every weapon (the text lists
sword/claymore/polearm; reported as an in-game quirk); Yaoyao's burst 6 s and C4 8.8 s (the text's
5 s / 8 s counted after the cast).

## Engine rules added during this audit (gcsim parity)

- An action's state lasts through a following wait to the end of its animation, one frame past
  AnimationLength (gcsim's TimePassed > AnimationLength). Normal-attack watchers (Xingqiu's
  Raincutter, Fischl C6, Thoma) see it: Xingqiu C6 −5.3% → +0.4%.
- A plain jump lets a plunge start only after the whole jump; a written wait still starts at the
  low-plunge window. Under Xianyun's airborne buff only plunges follow, after 4 / 5 frames.
- A swap waits for the outgoing character (`swapOutReadyAt`): Wanderer cannot swap out mid-air.
- Kaveh's skill, burst and C6 burst the Dendro Cores (each blooms on the next frame, owned by its
  creator).
- Attack nodes no longer force `infusion.team` to `none` (team infusions keep the smallest string,
  and 'none' < 'pyro' wiped Bennett C6's Pyro infusion: Bennett C6 −9.6% → −0.6%).
- Cast-time stat snapshots carry the hit's own states.
- HP/stat tracking (`ROTATION_CALCULATION_MEMBERS`) also runs for Hydro Traveler, Hu Tao, Gaming,
  Kuki, Xinyan, Dehya, Noelle, Kirara and Mika (Hu Tao solo −12% → −0.1%).

## Harness notes

- The constellation fixtures must use talents 10/10/10: the benchmark writes `talent=10,10,10` for
  the reference.
- The frame matrix sends `hE` as `skill[hold=1]` (a one-frame hold). The app keeps meaningful holds
  (Jean 1 s for C1, Kirara 10 s, Sayu and Amber their short holds), checked against `hold=60/600` and
  `short_hold=1` separately. Those rows, `J>J`, and the reference's random rolls (Ningguang's attack
  kinds, Xinyan C1 / Rosaria C6 / Yanfei / Dehya crits, Ganyu's burst targeting, Furina's Salon
  offsets, Chevreuse's C2 bomb delay, Emilie and Ayato drops) make up the remaining rows. Wanderer's
  rows are matrix artifacts (Windfavored blocks the reference's swaps; its ground jump is 60 frames).

## Known engine limitations (not modelled)

Energy and particles (Sethos's charged-attack timing, Raiden A1 from teammates, Dori C4, many C2/C4
energy effects), shields and incoming damage (Diluc C2, Dehya, Zhongli C6, Noelle A1, Jean C6,
Kaeya C4, Sigewinne C2), healing restrictions (Arlecchino healed only by her burst; Clorinde's Vigil
turning heals into Bond of Life), enemy defeats and second targets (Kaeya C2, Xiao C6, Mika's extra
Detector stacks, Diluc C1 / Eula C4 enemy-HP conditions), constructs destroyed early and the
3-construct cap (Ningguang's screen, replaced steles), a shared Crystallize shard pool (Navia,
Gorou C2), engine-applied infusions reaching the damage calc (Candace's lingering infusion, C0
−1.2%), ATK SPD reread at each normal of a grouped string (Mika and Rosaria correct it in their
kits), same-frame state ordering (Hu Tao corrects it in its kit). Rotation text cannot express
Bennett's / Yun Jin's charge level 2 or Sigewinne's tier-2 hold.
