"""Strip the "test" placeholder prefix that beta TextMaps put in front of unfinished strings.

Beta dumps ship strings like "test Danica Normal Attack", "testC2", "While the test Anchor is
present" or "test装备者的攻击力…"; in the UI that reads as a bug. This removes the prefix wherever it
starts a sentence or a word ("test Foo" / "testFoo" before a capital letter, or before CJK, Hangul,
Cyrillic or Thai text) in every string of the given JSON files, leaving words such as "testament",
"contest" or "testé" untouched.

Usage: python3 -I tools/dump-import/strip_placeholder_text.py <file.json>...
Run it on the new characters'/weapons'/sets' *_gen.json locale files after generating them (see README).
"""

import json
import re
import sys

# what may follow the prefix: a capital (Latin incl. accented, Cyrillic), a tag/quote, or CJK/kana/
# Hangul/Thai text, so "testErhöht", "test装备者", "testСила", "test พล" are cleaned in every language
PLACEHOLDER = re.compile(
    r'(^|(?<=[\s"「(>]))test ?'
    r'(?=[A-Z<「"\u00c0-\u00de\u0400-\u042f\u0e00-\u0e7f\u3040-\u30ff\u3400-\u9fff\uac00-\ud7af])'
)


# Japanese beta strings carry a build tag: "春潮JP3A", "波砕く雷鳴JP3A"
JP_TAG = re.compile(r'JP\d[A-Z](?![A-Za-z])')


def clean(value):
    if isinstance(value, str):
        return JP_TAG.sub('', PLACEHOLDER.sub('', value))
    if isinstance(value, list):
        return [clean(v) for v in value]
    if isinstance(value, dict):
        return {k: clean(v) for k, v in value.items()}
    return value


def main(paths):
    for path in paths:
        with open(path, encoding='utf-8') as f:
            raw = f.read()
        data = json.loads(raw)
        cleaned = clean(data)
        if cleaned == data:
            print(f'{path}: no placeholders')
            continue
        before = json.dumps(data, ensure_ascii=False)
        count = len(PLACEHOLDER.findall(before)) + len(JP_TAG.findall(before))
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(cleaned, f, ensure_ascii=False, indent=2)
            if raw.endswith('\n'):  # keep the file's ending (generated files have none)
                f.write('\n')
        print(f'{path}: removed {count} placeholder prefix(es)')


if __name__ == '__main__':
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    main(sys.argv[1:])
