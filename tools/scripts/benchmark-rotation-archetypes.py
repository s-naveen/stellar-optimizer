#!/usr/bin/env python3
"""Run fixed rotation fixtures against a pinned kqmsim checkout and the app evaluator.

python3 tools/scripts/benchmark-rotation-archetypes.py --source /path/to/kqmsim \
  --binary /path/to/kqmsim-binary --output /tmp/rotation-archetypes
Use --reuse-reference to rerun only the app after a change. Reports contain measured
accuracy gaps; an execution success never implies that numerical parity passed.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
FIXTURE = ROOT / 'libs/gi/ui/src/tests/fixtures/rotation-archetypes/teams.json'
STAT = {'hp': 'hp', 'atk': 'atk', 'def': 'def', 'hp_': 'hp%', 'atk_': 'atk%',
        'def_': 'def%', 'eleMas': 'em', 'enerRech_': 'er', 'critRate_': 'cr',
        'critDMG_': 'cd', 'heal_': 'heal'}
MAIN = {'atk_': 46.6, 'hp_': 46.6, 'def_': 58.3, 'eleMas': 186.5,
        'enerRech_': 51.8, 'critRate_': 31.1, 'critDMG_': 62.2, 'heal_': 35.9,
        'physical_dmg_': 58.3}
for element in ['pyro', 'hydro', 'cryo', 'electro', 'anemo', 'geo', 'dendro', 'physical']:
    STAT[f'{element}_dmg_'] = 'phys%' if element == 'physical' else f'{element}%'
    MAIN.setdefault(f'{element}_dmg_', 46.6)


def aliases(source, kind):
    raw = (source / f'pkg/shortcut/{kind}.dm.go').read_text()
    return dict(re.findall(r'"([a-z0-9]+)":\s*keys\.(\w+)', raw))


def alias(mapping, key):
    candidates = [a for a, k in mapping.items() if k.lower() == key.lower()]
    # GO's spelling differs from the native keys for these characters.
    special = {'KamisatoAyaka': 'ayaka', 'KamisatoAyato': 'ayato',
               'KaedeharaKazuha': 'kazuha', 'SangonomiyaKokomi': 'kokomi',
               'RaidenShogun': 'raiden', 'AratakiItto': 'itto',
               'TravelerDendro': 'travelerdendro'}
    name = special.get(key, key.lower())
    if name in mapping:
        return name
    if candidates:
        return min(candidates, key=len)
    raise ValueError(f'No native alias for {key}')


def relative(actual, expected):
    return (actual / expected - 1) * 100 if expected else None


REFERENCE_REACTION_ABILITIES = {
    'overload', 'superconduct', 'electrocharged', 'shatter', 'burning', 'bloom',
    'bountiful', 'bountifulcore', 'hyperbloom', 'burgeon', 'lunarcharged',
    'lunarcrystallize', 'stellar swirl', 'stellar swirl detonation',
}


def is_reaction_ability(name):
    lowered = name.lower()
    return lowered in REFERENCE_REACTION_ABILITIES or lowered.startswith('swirl-')


def summarize(team, prefix, loops):
    ours = json.loads(prefix.with_suffix('.ours.json').read_text())
    native = json.loads(prefix.with_suffix('.gcsim.json').read_text())
    stats = native['statistics']
    duration = stats['duration']['mean'] / loops
    # Both sides retain the complete fixed-loop interval, including the startup rotation.
    result = {
        'id': team['id'], 'archetype': team['archetype'],
        'members': [m['key'] for m in team['members']],
        'dps': {'ours': ours['dps'], 'reference': stats['dps']['mean'],
                'differencePercent': relative(ours['dps'], stats['dps']['mean']),
                'referenceSd': stats['dps']['sd']},
        'seconds': {'ours': ours['seconds'] / loops, 'reference': duration,
                    'differencePercent': relative(ours['seconds'] / loops, duration)},
        'rotationDamage': {'ours': ours['dps'] * ours['seconds'] / loops,
                           'reference': stats['dps']['mean'] * duration},
        'warnings': ours['warnings'], 'notes': ours['notes'],
        'appSamples': ours.get('samples', 1),
        'accuracy': {'dpsTolerancePercent': 5, 'durationTolerancePercent': 5,
                     'passed': abs(relative(ours['dps'], stats['dps']['mean'])) <= 5
                     and abs(relative(ours['seconds'] / loops, duration)) <= 5
                     and not ours['warnings']},
        'referenceSampleSeed': native.get('sample_seed'),
        'referenceReactions': {}, 'oursReactions': ours['reactions'],
        'characters': {},
    }
    for profile, char, dps, sources, instances, reactions in zip(
        team['members'], native['character_details'], stats['character_dps'],
        stats['source_dps'], stats['source_damage_instances'], stats['source_reactions']
    ):
        key = profile['key']
        own_direct = sum(a['hits'] * a['perHit'] for a in ours['attacks'].get(key, [])
                         if not a['path'].startswith('reaction.')) / loops
        reference_direct = sum(value['mean'] * duration
                               for ability, value in sources.get('sources', {}).items()
                               if not is_reaction_ability(ability))
        result['characters'][key] = {
            'dps': {'ours': ours['members'].get(key, 0), 'reference': dps['mean'],
                    'differencePercent': relative(ours['members'].get(key, 0), dps['mean'])},
            # Shared reactions are owned by their trigger in the native report. Compare direct
            # talent/gear damage separately so ownership changes cannot masquerade as a kit gap.
            'directDamagePerLoop': {'ours': own_direct, 'reference': reference_direct,
                                    'differencePercent': relative(own_direct, reference_direct)},
            'oursAbilities': {ability: {'hits': value['hits'] / loops, 'dmg': value['dmg'] / loops}
                              for ability, value in ours['abilities'].get(key, {}).items()},
            'referenceAbilities': {
                ability: {'hits': instances.get('sources', {}).get(ability, {}).get('mean', 0) / loops,
                          'damage': value['mean'] * duration}
                for ability, value in sources.get('sources', {}).items()
            },
        }
        for reaction, value in reactions.get('sources', {}).items():
            dst = result['referenceReactions']
            dst[reaction] = dst.get(reaction, 0) + value['mean'] / loops
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path)
    parser.add_argument('--binary', required=True, type=Path)
    parser.add_argument('--output', type=Path, default=Path('/tmp/rotation-archetypes'))
    parser.add_argument('--fixture', type=Path, default=FIXTURE)
    parser.add_argument('--teams', help='Comma-separated fixture IDs (default: all)')
    parser.add_argument('--reuse-reference', action='store_true')
    parser.add_argument('--check-accuracy', action='store_true',
                        help='Exit nonzero when any measured DPS/time gap exceeds 5%%')
    args = parser.parse_args()
    fixture_path = args.fixture.resolve()
    fixture = json.loads(fixture_path.read_text())
    revision = subprocess.check_output(['git', '-C', str(args.source), 'rev-parse', 'HEAD'], text=True).strip()
    if revision != fixture['reference']['commit']:
        raise ValueError(f'Reference checkout is {revision}; expected {fixture["reference"]["commit"]}')
    if subprocess.check_output(['git', '-C', str(args.source), 'status', '--porcelain'], text=True).strip():
        raise ValueError('Reference checkout has uncommitted changes')
    teams = [t for t in fixture['teams'] if not args.teams or t['id'] in args.teams.split(',')]
    if not teams:
        raise ValueError('No matching fixture IDs')
    output = args.output.resolve()
    output.mkdir(parents=True, exist_ok=True)
    weapons, sets, chars = [aliases(args.source, k) for k in ['weapon', 'artifact', 'character']]
    for team in teams:
        prefix = output / team['id']
        prefix.with_suffix('.json').write_text(json.dumps(team['members'], indent=2))
        prefix.with_suffix('.spec.json').write_text(json.dumps({'text': team['text'], 'loops': fixture['loops'], 'conditional': team.get('conditional', {})}))
        lines = []
        for b in team['members']:
            c = alias(chars, b['key'])
            lines += [f'{c} char lvl=90/90 cons={b["cons"]} talent={",".join(str(t) for t in b.get("talent", [10, 10, 10]))};',
                      f'{c} add weapon="{alias(weapons, b["weapon"][0])}" refine={b["weapon"][1]} lvl=90/90;']
            lines += [f'{c} add set="{alias(sets, key)}" count={count};' for key, count in b['sets'].items()]
            main_stats = ' '.join(f'{STAT[key]}={MAIN[key] / (100 if key.endswith("_") else 1):.8f}' for key in b['mains'].values())
            # Preserve duplicate mains (HP/HP, ATK/ATK/ATK).
            sub_stats = ' '.join(f'{STAT[key]}={value / (100 if key.endswith("_") else 1):.8f}' for key, value in b['subs'].items())
            lines += [f'{c} add stats hp=4780 atk=311 {main_stats};', f'{c} add stats {sub_stats};']
        lines += [f'options swap_delay=12 iteration={fixture["iterations"]} ignore_burst_energy=true;',
                  'target lvl=100 resist=0.1 hp=999999999 radius=2 pos=0,2.4;',
                  f'active {team["native"].split()[0]};',
                  f'for let i=0; i<{fixture["loops"]}; i=i+1 {{', team['native'], '}']
        prefix.with_suffix('.fixed.cfg').write_text('\n'.join(lines) + '\n')

    def reference(team):
        prefix = output / team['id']
        if args.reuse_reference and prefix.with_suffix('.gcsim.json').exists():
            sample_path = prefix.with_suffix('.sample.json')
            if sample_path.exists() and json.loads(sample_path.read_text()).get('config', '').strip() == prefix.with_suffix('.fixed.cfg').read_text().strip():
                return
        with prefix.with_suffix('.reference.log').open('w') as log:
            process = subprocess.run([str(args.binary.resolve()), '-c', str(prefix.with_suffix('.fixed.cfg')),
                                      '-out', str(prefix.with_suffix('.gcsim.json')),
                                      '-sample', str(prefix.with_suffix('.sample.json'))], stdout=log, stderr=subprocess.STDOUT)
        if process.returncode:
            raise RuntimeError(f'{team["id"]}: native execution failed: {prefix.with_suffix(".reference.log").read_text()[-1500:]}')
        print(f'Native completed: {team["id"]}', flush=True)

    with ThreadPoolExecutor(max_workers=2) as pool:
        list(pool.map(reference, teams))
    env = dict(os.environ, GCSIM_TEAM=','.join(str(output / t['id']) for t in teams))
    with (output / 'app-tests.log').open('w') as log:
        process = subprocess.run([str(ROOT / 'node_modules/.bin/vitest'), 'run', '--config',
                                  'libs/gi/ui/vitest.config.mts', 'libs/gi/ui/src/tests/gcsimCompare.test.ts'],
                                 cwd=ROOT, env=env, stdout=log, stderr=subprocess.STDOUT)
    if process.returncode:
        raise RuntimeError(f'App execution failed; see {output / "app-tests.log"}')
    report = {'reference': fixture['reference'],
              'binarySha256': hashlib.sha256(args.binary.read_bytes()).hexdigest(),
              'fixtureSha256': hashlib.sha256(fixture_path.read_bytes()).hexdigest(),
              'loops': fixture['loops'], 'iterations': fixture['iterations'],
              'teams': [summarize(t, output / t['id'], fixture['loops']) for t in teams]}
    (output / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    for t in report['teams']:
        d, s = t['dps'], t['seconds']
        print(f'{t["id"]}: {d["ours"]:.0f}/{d["reference"]:.0f} DPS ({d["differencePercent"]:+.1f}%), '
              f'{s["ours"]:.2f}/{s["reference"]:.2f} s ({s["differencePercent"]:+.1f}%)')
    print(f'Report: {output / "report.json"}')
    failed = [t['id'] for t in report['teams'] if not t['accuracy']['passed']]
    print(f'Accuracy gate (5% DPS and duration): {len(teams) - len(failed)}/{len(teams)} pass')
    if failed and args.check_accuracy:
        raise SystemExit(1)


if __name__ == '__main__':
    main()
