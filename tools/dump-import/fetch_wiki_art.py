"""Replace a new character's placeholder images with art from the Genshin Impact Fandom wiki.

Usage: python3 -I tools/dump-import/fetch_wiki_art.py <CharKey> <element> [--card <wiki file title>]
  element: anemo | geo | electro | dendro | hydro | pyro | cryo  (tints generated stand-ins)
  --card:  wiki file to use for the tall character card when "<Name> Card.png" does not exist yet
           (e.g. "File:Anastasya Illustration.png"); it is centre-cropped to 1:2.

What it does, for every image in AssetsData_gen.json chars[<CharKey>]:
  icon / side icon   "<Name> Icon.png" / "<Name> Side Icon.png" (side icon falls back to the icon)
  namecard (banner)  "Namecard Background <Name>*" (falls back to an element-tinted gradient)
  talents / consts   "Talent <talent name>.png" / "Constellation <name>.png", converted from the
                     wiki's coloured circles to the game's light glyph on transparent; a plain star
                     glyph when the wiki has none yet
  character card     "<Name> Card.png" -> libs/gi/char-cards/src/Character_<Name>_Card.webp
Downloads the original PNGs (format=original), writes them to libs/gi/dm/Texture2D (the gen source)
and libs/gi/assets/src/gen/chars/<CharKey>/ (what the app imports). Needs ImageMagick and cwebp.
Then hard-reload the dev server page (images are cached by the browser).
"""

import json
import os
import subprocess
import sys
import tempfile
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
API = 'https://genshin-impact.fandom.com/api.php?'
UA = {'User-Agent': 'Mozilla/5.0 (GO asset fetch)'}
# dark / mid / light stops of the generated namecard per element
TINT = {
    'anemo': ('#0e2422', '#3f9c8a', '#bff3e6'),
    'geo': ('#2a1f0e', '#a7802f', '#f7e0a8'),
    'electro': ('#160f26', '#6a43a0', '#d6b8f5'),
    'dendro': ('#13230d', '#5f8f2c', '#d9f2a9'),
    'hydro': ('#0c1630', '#3b62b8', '#b9d0ff'),
    'pyro': ('#2a0f0c', '#b0432f', '#ffc7b0'),
    'cryo': ('#0d1628', '#3f6ea8', '#a9cdf2'),
}
STAR = (
    "path 'M 64,16 L 73,55 L 112,64 L 73,73 L 64,112 L 55,73 L 16,64 L 55,55 Z "
    'M 100,22 L 102.5,29.5 L 110,32 L 102.5,34.5 L 100,42 L 97.5,34.5 L 90,32 L 97.5,29.5 Z '
    "M 28,86 L 30,92 L 36,94 L 30,96 L 28,102 L 26,96 L 20,94 L 26,92 Z'"
)


def get(url):
    return urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=60).read()


def api(**params):
    return json.loads(get(API + urllib.parse.urlencode({**params, 'format': 'json'})))


def image_urls(titles):
    """{title: url} for the wiki files that exist."""
    found = {}
    for i in range(0, len(titles), 40):
        d = api(action='query', titles='|'.join(titles[i : i + 40]), prop='imageinfo', iiprop='url')
        for page in d['query']['pages'].values():
            if 'imageinfo' in page:
                found[page['title']] = page['imageinfo'][0]['url']
    return found


def download_png(url, dest):
    data = get(url + ('&' if '?' in url else '?') + 'format=original')
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'not a PNG: {url}')
    with open(dest, 'wb') as f:
        f.write(data)


def magick(*args):
    subprocess.run(['magick', *args], check=True)


def to_glyph(src, dest, tmp):
    """Wiki talent icon (glyph on a coloured circle) -> light glyph on transparent, like the game."""
    mask, alpha, both = (os.path.join(tmp, n) for n in ('mask.png', 'a.png', 'm.png'))
    magick(src, '-alpha', 'off', '-colorspace', 'gray', '-level', '62%,90%', mask)
    magick(src, '-alpha', 'extract', alpha)
    magick(mask, alpha, '-compose', 'multiply', '-composite', both)
    magick('-size', '128x128', "xc:#e8e6ea", both, '-alpha', 'off', '-compose', 'copy_opacity', '-composite', dest)


def main(argv):
    if len(argv) < 2 or argv[1] not in TINT:
        sys.exit(__doc__)
    key, ele = argv[0], argv[1]
    card_title = argv[argv.index('--card') + 1] if '--card' in argv else None
    assets = json.load(open(f'{ROOT}/libs/gi/assets-data/src/AssetsData_gen.json'))['chars'][key]
    loc = json.load(open(f'{ROOT}/libs/gi/dm-localization/assets/locales/en/char_{key}_gen.json'))
    name = key  # wiki pages use the display name; for most new characters it equals the key

    titles = {'icon': f'File:{name} Icon.png', 'iconSide': f'File:{name} Side Icon.png'}
    for slot in assets:
        talent = loc.get(slot, {}).get('name') if isinstance(loc.get(slot), dict) else None
        if talent:
            kind = 'Constellation' if slot.startswith('constellation') else 'Talent'
            titles[slot] = f'File:{kind} {talent}.png'
    namecards = api(action='query', list='allimages', aiprefix=f'Namecard_Background_{name}', ailimit=5)
    namecard = next(iter(namecards.get('query', {}).get('allimages', [])), None)
    urls = image_urls(list(titles.values()))

    out_dirs = [f'{ROOT}/libs/gi/dm/Texture2D', f'{ROOT}/libs/gi/assets/src/gen/chars/{key}']
    report = {'wiki': [], 'generated': []}
    with tempfile.TemporaryDirectory() as tmp:
        files = {}
        for slot, file in assets.items():
            if not isinstance(file, str):
                continue
            path = os.path.join(tmp, f'{file}.png')
            src = urls.get(titles.get(slot, ''))
            if slot == 'banner' and namecard:
                download_png(namecard['url'], path)
                report['wiki'].append(slot)
            elif src and slot in ('icon', 'iconSide'):
                download_png(src, path)
                report['wiki'].append(slot)
            elif src:
                raw = os.path.join(tmp, f'raw_{file}.png')
                download_png(src, raw)
                to_glyph(raw, path, tmp)
                report['wiki'].append(slot)
            else:
                files[slot] = path  # generated below, once the icon/namecard exist
                continue
            files[slot] = path
        dark, mid, light = TINT[ele]
        for slot in [s for s in files if s not in report['wiki']]:
            path = files[slot]
            if slot == 'iconSide' and 'icon' in report['wiki']:
                magick(files['icon'], '-resize', '128x128', path)
            elif slot == 'banner':
                magick('-size', '840x400', 'xc:', '-sparse-color', 'Shepards',
                       f'0,400 {dark}  840,0 {light}  300,120 {mid}  760,380 {dark}', '-blur', '0x20', path)
            elif slot == 'bar':
                continue  # made from the namecard after this loop
            else:
                magick('-size', '128x128', 'xc:none', '-fill', '#e8e6ea', '-draw', STAR, path)
            report['generated'].append(slot)
        if 'bar' in files and 'banner' in files:
            magick(files['banner'], '-resize', '420x200^', '-gravity', 'center', '-extent', '420x100', files['bar'])
            report['generated'].append('bar')
        for path in files.values():
            for out in out_dirs:
                subprocess.run(['cp', path, out], check=True)

        card_src = urls.get(card_title) if card_title else None
        if not card_src:
            card_src = image_urls([f'File:{name} Card.png']).get(f'File:{name} Card.png')
        if card_src:
            raw, png = os.path.join(tmp, 'card_raw.png'), os.path.join(tmp, 'card.png')
            download_png(card_src, raw)
            crop = []
            if card_title:  # an illustration, not a card: centre-crop to the card's 1:2 shape
                w, h = map(int, subprocess.run(['magick', 'identify', '-format', '%w %h', raw],
                                               check=True, capture_output=True, text=True).stdout.split())
                crop = ['-gravity', 'center', '-crop', f'{min(w, h // 2)}x{h}+0+0', '+repage']
            magick(raw, *crop, '-resize', '420x', png)
            dest = f'{ROOT}/libs/gi/char-cards/src/Character_{name}_Card.webp'
            subprocess.run(['cwebp', '-quiet', '-q', '85', png, '-o', dest], check=True)
            report['wiki'].append('card')
        else:
            report['generated'].append('card (kept placeholder: pass --card "File:...")')
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main(sys.argv[1:])
