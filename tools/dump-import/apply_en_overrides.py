"""Fill in English text that a beta dump does not have yet (tools/dump-import/en_overrides.json).

For each artifact set listed there:
  - en/artifact_<Key>_gen.json: setName and piece names from the overrides
  - en/artifactNames_gen.json: the set name
  - every other language: an empty set name, and piece names that are one placeholder shared by all
    five pieces (e.g. "Artefaktset 1 von 7.3"), are removed so i18next falls back to English
    (an empty string would be shown as a blank name).
For each weapon listed under "weapon": names that are a generic placeholder in another language
(see PLACEHOLDER_NAMES, e.g. French "Arme : Arc") are removed the same way. A weapon entry can also
give English text the dump lacks:
  - "passiveName": replaces the English passive name
  - "passiveDescription": {"lines": [...], "values": {"<name>": [R1, ..., R5]}}; each line may use
    {name} for that refinement's value, written as <cryo>value</cryo> like the game's highlighted numbers.

Usage: python3 -I tools/dump-import/apply_en_overrides.py
Run it after gi-dm-localization:gen-file (and after strip_placeholder_text.py); it is idempotent.
"""

import json
import os
import re
import sys

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
LOCALES = os.path.join(ROOT, 'libs/gi/dm-localization/assets/locales')


# beta names that only say what kind of item it is ("Weapon: Bow")
PLACEHOLDER_NAMES = {'fr': re.compile(r'^Arme\s*:')}


def load(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


def save(path, data):
    # keep the file's ending: generated locale files have no trailing newline
    with open(path, encoding='utf-8') as f:
        newline = f.read().endswith('\n')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        if newline:
            f.write('\n')


def main():
    overrides = load(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'en_overrides.json'))
    for key, o in overrides.get('artifact', {}).items():
        for lang in sorted(os.listdir(LOCALES)):
            set_path = os.path.join(LOCALES, lang, f'artifact_{key}_gen.json')
            names_path = os.path.join(LOCALES, lang, 'artifactNames_gen.json')
            if not os.path.exists(set_path):
                sys.exit(f'missing {set_path}: run gi-dm-localization:gen-file first')
            data, names = load(set_path), load(names_path)
            pieces = data.get('pieces', {})
            if lang == 'en':
                data['setName'] = o['setName']
                for slot, name in o.get('pieces', {}).items():
                    pieces.setdefault(slot, {})['name'] = name
                names[key] = o['setName']
            else:
                if not data.get('setName'):
                    data.pop('setName', None)
                if not names.get(key, None):
                    names.pop(key, None)
                piece_names = {p.get('name') for p in pieces.values()}
                if len(pieces) > 1 and len(piece_names) == 1:  # one shared placeholder
                    for p in pieces.values():
                        p.pop('name', None)
            save(set_path, data)
            save(names_path, names)
        print(f'{key}: applied')
    for key, o in overrides.get('weapon', {}).items():
        if o.get('passiveName') or o.get('passiveDescription'):
            en_path = os.path.join(LOCALES, 'en', f'weapon_{key}_gen.json')
            data = load(en_path)
            if o.get('passiveName'):
                data['passiveName'] = o['passiveName']
            desc = o.get('passiveDescription')
            if desc:
                values = desc.get('values', {})
                data['passiveDescription'] = {
                    str(r): {
                        str(i): line.format(
                            **{n: f'<cryo>{v[r]}</cryo>' for n, v in values.items()}
                        )
                        for i, line in enumerate(desc['lines'])
                    }
                    for r in range(5)
                }
            save(en_path, data)
            print(f'{key}: English passive text applied')
        for lang, pattern in PLACEHOLDER_NAMES.items():
            weapon_path = os.path.join(LOCALES, lang, f'weapon_{key}_gen.json')
            names_path = os.path.join(LOCALES, lang, 'weaponNames_gen.json')
            data, names = load(weapon_path), load(names_path)
            if pattern.match(data.get('name', '')):
                data.pop('name')
                save(weapon_path, data)
            if pattern.match(names.get(key, '')):
                names.pop(key)
                save(names_path, names)
        print(f'{key}: placeholder names removed')


if __name__ == '__main__':
    main()
