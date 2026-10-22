#!/usr/bin/env python3
"""
Build the Christmas Week league marks: each league logo, division badge,
conference, tier and award mark knit in sweater stitches, in its own shape
with no patch around it (owner, Oct 2026: "I want the logo only to be
knitted"). The stitch is the one scripts/build-sweater-marks.py knits the
team patches with.

Lettering cannot be knit from the drawing: a banner word at 60 stitches comes
out as noise. So every <text> but the big AL/NL is stripped before drawing,
and the words that carry meaning (a division's NORTH, a shield's CHAMPION)
are knit back in a stitch font (FONT) sized to whole stitches. The ring
lettering and years on the round medals are left off.

    python3 scripts/build-sweater-league-marks.py [--preview <dir>]

Needs Pillow and the repo's Playwright Chromium (to draw the SVGs). A team
patch knits a one-colour silhouette; a league mark has detail inside it (a
compass star, a trophy, "AL"), so it is knit in several yarns instead: the
mark is recoloured red, green and white (COLORS), drawn, and every stitch
takes the nearest Christmas yarn. The body is green behind a mostly-red mark
and red behind a green one, with a cream stitch outline wherever the mark's
edge would otherwise vanish into the body.

Output: public/assets/<navSlug>/christmas-marks/<dest>.png at 200x200, wired
into src/data/seasonal-marks/<navSlug>-christmas.json (`_logo`, `_swaps`,
`_icons`, `_menuIcons`) the way Halloween's league marks are. --preview writes
the PNGs to <dir> only and leaves the repo alone.
"""
import json, os, re, subprocess, sys, tempfile
from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sweater = __import__('build-sweater-marks')

ROOT = sweater.ROOT
CELL, COLS, ROWS, SIZE = sweater.CELL, sweater.COLS, sweater.ROWS, sweater.SIZE
hexrgb, shade, stitch, band_grid = sweater.hexrgb, sweater.shade, sweater.stitch, sweater.band_grid

RED, DKRED, GREEN, DKGREEN = '#c8102e', '#7d0c12', '#2a8a52', '#145a33'
CREAM, GOLD, SILVER, PINK, INK = '#f3eee3', '#e0b43c', '#b9bec4', '#f4b6bf', '#222222'
YARNS = [RED, DKRED, GREEN, DKGREEN, '#5fbf7f', CREAM, GOLD, SILVER, PINK, INK]

# Recolour each source to Christmas colours before knitting (navy and blue go
# green or red, reds stay red, golds and greys stay).
REDS = {'#c41e3a': RED, '#891529': DKRED, '#fb264a': RED, '#c43c3b': RED,
        '#b34826': RED, '#b22726': RED, '#b22626': RED}
COLORS = {
    'theleague': {**REDS, '#1c497c': RED, '#13365d': DKRED, '#27598f': RED, '#2e8743': GREEN,
                  # Northwest keeps its green, Southwest goes candy pink, East gold
                  '#bddaff': GOLD, '#f4bbaa': PINK},
    'afl': {**REDS, '#002244': DKGREEN, '#243c65': DKGREEN, '#1d4f91': GREEN, '#143766': DKGREEN, '#2565ba': GREEN},
}
# the header logo sits on the red header, so its shield knits green
LOGO_COLORS = {'theleague': {'#1c497c': GREEN, '#13365d': DKGREEN, '#2e8743': RED}}

AWARDS = ('al-north', 'al-south', 'nl-east', 'nl-west', 'afl-championship', 'premier-league',
          'dleague-champion', 'al-champion', 'nl-champion', 'afl-cup')
# navSlug -> [(source asset, dest file, patch band motif, or None for a bare knit)]
MARKS = {
    'theleague': [('/assets/logos/theleague-logo.svg', 'logo.png', None)]
                 + [(f'/assets/theleague/division-badges/{d}.svg', f'division-badges/{d}.png', None)
                    for d in ('northwest', 'southwest', 'central', 'east')],
    'afl': [('/assets/logos/afl-logo.svg', 'logo.png', None),
            ('/assets/afl/conferences/al.svg', 'conferences/al.png', None),
            ('/assets/afl/conferences/nl.svg', 'conferences/nl.png', None),
            ('/assets/afl/premier.svg', 'premier.png', None),
            ('/assets/afl/dleague.svg', 'dleague.png', None)]
           + [(f'/assets/afl/awards/{a}.svg', f'awards/{a}.png', None) for a in AWARDS],
}
# every served cut of a mark -> its patch (dark cuts swap to the same patch)
SWAPS = {
    'theleague': {f'/assets/theleague/division-badges/{d}.svg': f'division-badges/{d}.png'
                  for d in ('northwest', 'southwest', 'central', 'east')},
    'afl': {
        **{f'/assets/afl/{p}{cut}.svg': f'{p}.png'
           for p in ('conferences/al', 'conferences/nl', 'premier', 'dleague') for cut in ('', '-dark')},
        **{f'/assets/afl/awards/{a}.svg': f'awards/{a}.png' for a in AWARDS},
    },
}
ICONS = {'afl': {'premier-league': 'premier.png'}}
MENU_ICONS = {'afl': {f'/assets/afl/{p}{cut}.svg': f'{p}.png' for p in ('premier', 'dleague') for cut in ('', '-dark')}}

# A stitch font: one stitch per pixel, 7 rows, so a banner word is knit in
# whole stitches rather than resampled into noise.
FONT = {
    'A': ['.XX.', 'X..X', 'X..X', 'XXXX', 'X..X', 'X..X', 'X..X'],
    'C': ['.XXX', 'X...', 'X...', 'X...', 'X...', 'X...', '.XXX'],
    'E': ['XXXX', 'X...', 'X...', 'XXX.', 'X...', 'X...', 'XXXX'],
    'H': ['X..X', 'X..X', 'X..X', 'XXXX', 'X..X', 'X..X', 'X..X'],
    'I': ['XXX', '.X.', '.X.', '.X.', '.X.', '.X.', 'XXX'],
    'M': ['X...X', 'XX.XX', 'X.X.X', 'X.X.X', 'X...X', 'X...X', 'X...X'],
    'N': ['X..X', 'XX.X', 'XX.X', 'X.XX', 'X.XX', 'X..X', 'X..X'],
    'O': ['.XX.', 'X..X', 'X..X', 'X..X', 'X..X', 'X..X', '.XX.'],
    'P': ['XXX.', 'X..X', 'X..X', 'XXX.', 'X...', 'X...', 'X...'],
    'R': ['XXX.', 'X..X', 'X..X', 'XXX.', 'X.X.', 'X..X', 'X..X'],
    'S': ['.XXX', 'X...', 'X...', '.XX.', '...X', '...X', 'XXX.'],
    'T': ['XXXXX', '..X..', '..X..', '..X..', '..X..', '..X..', '..X..'],
    'U': ['X..X', 'X..X', 'X..X', 'X..X', 'X..X', 'X..X', '.XX.'],
    'W': ['X...X', 'X...X', 'X...X', 'X.X.X', 'X.X.X', 'XX.XX', 'X...X'],
}
# award -> (word, its centre in the SVG's own units, yarn)
LABELS = {
    'al-north': ('NORTH', 130, 219, CREAM), 'al-south': ('SOUTH', 130, 219, CREAM),
    'nl-east': ('EAST', 130, 219, CREAM), 'nl-west': ('WEST', 130, 219, CREAM),
    'al-champion': ('CHAMPION', 130, 219, DKGREEN), 'nl-champion': ('CHAMPION', 130, 219, DKGREEN),
}
# stitches down the longer side; the shields get more so their word fits
STITCHES = {a: 64 for a in LABELS}
KEEP_TEXT = re.compile(r'<text\b[^>]*>\s*(AL|NL)\s*</text>')
TEXT = re.compile(r'<text\b.*?</text>', re.S)

def strip_text(svg):
    return TEXT.sub(lambda m: m.group(0) if KEEP_TEXT.fullmatch(m.group(0)) else '', svg)

def viewbox(svg):
    return [float(v) for v in re.search(r'viewBox="([^"]+)"', svg).group(1).replace(',', ' ').split()]

ORNAMENT = ["..G..", ".XXX.", "XXXXX", "XXWXX", "XXXXX", ".XXX."]
BANDS = {'tree': sweater.TREE, 'flake': sweater.FLAKE, 'ornament': ORNAMENT}

HEX = re.compile(r'#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b')

def recolour(svg, colors):
    def sub(m):
        h = m.group(0).lower()
        if len(h) == 4: h = '#' + ''.join(c * 2 for c in h[1:])
        return colors.get(h, m.group(0))
    return HEX.sub(sub, svg)

RASTER = r"""
import { chromium } from 'playwright';
import fs from 'fs';
const jobs = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || '/opt/pw-browsers/chromium' });
const p = await b.newPage({ viewport: { width: 480, height: 480 } });
for (const [svg, out] of jobs) {
  const src = 'data:image/svg+xml;base64,' + Buffer.from(fs.readFileSync(svg)).toString('base64');
  await p.setContent(`<body style="margin:0"><img id=i style="width:480px;height:480px;object-fit:contain" src="${src}">`);
  await p.waitForFunction(() => document.getElementById('i').complete);
  await p.locator('#i').screenshot({ path: out, omitBackground: true });
}
await b.close();
"""

def rasterize(jobs, tmp):
    spec = os.path.join(tmp, 'jobs.json')
    json.dump(jobs, open(spec, 'w'))
    subprocess.run(['node', '--input-type=module', '-e', RASTER, spec], cwd=ROOT, check=True)

def nearest(c):
    return min(YARNS, key=lambda y: sum((a - b) ** 2 for a, b in zip(hexrgb(y), c)))

def knit(png, motif, label=None, stitches=None, vb=None):
    src = Image.open(png).convert('RGBA')
    box = src.getbbox()
    src = src.crop(box)
    band_h = len(BANDS[motif]) + 2 if motif else 0
    area = ROWS - 2 * (band_h + 2) - 4 if motif else (stitches or BARE)
    w, h = src.size
    sc = area / max(w, h)
    mw, mh = max(1, round(w * sc)), max(1, round(h * sc))
    small = src.resize((mw, mh), Image.BOX)
    cells = [[None] * mw for _ in range(mh)]
    count = {}
    for r in range(mh):
        for c in range(mw):
            pr, pg, pb, pa = small.getpixel((c, r))
            if pa > 120:
                y = nearest(tuple(round(v * 255 / pa) for v in (pr, pg, pb)))
                cells[r][c] = y
                count[y] = count.get(y, 0) + 1
    # a stitch unlike all four of its neighbours is anti-aliasing noise (ring
    # lettering at 40 stitches): knit it in the yarn most of them share
    for _ in range(2):
        nxt = [row[:] for row in cells]
        for r in range(mh):
            for c in range(mw):
                nb = [cells[rr][cc] for rr, cc in ((r - 1, c), (r + 1, c), (r, c - 1), (r, c + 1))
                      if 0 <= rr < mh and 0 <= cc < mw]
                if cells[r][c] and len(nb) == 4 and cells[r][c] not in nb:
                    top = max(set(nb), key=nb.count)
                    if nb.count(top) >= 3: nxt[r][c] = top
        cells = nxt
    if label:
        # SVG units -> drawn pixel (480px, contain) -> stitch
        word, lx, ly, yarn = label
        px = 480 / max(vb[2], vb[3])
        ox, oy = (480 - vb[2] * px) / 2, (480 - vb[3] * px) / 2
        cx = (ox + (lx - vb[0]) * px - box[0]) * mw / w
        cy = (oy + (ly - vb[1]) * px - box[1]) * mh / h
        glyphs = [FONT[ch] for ch in word]
        width = sum(len(g[0]) for g in glyphs) + len(glyphs) - 1
        c0, r0 = round(cx - width / 2), round(cy - 3.5)
        for g in glyphs:
            for r, row in enumerate(g):
                for c, bit in enumerate(row):
                    if bit == 'X':
                        cells[r0 + r][c0 + c] = yarn
            c0 += len(g[0]) + 1
    if not motif:
        return bare(cells, mw, mh)
    count = {}
    for row in cells:
        for y in row:
            if y: count[y] = count.get(y, 0) + 1
    reds = sum(n for y, n in count.items() if y in (RED, DKRED, PINK))
    greens = sum(n for y, n in count.items() if y in (GREEN, DKGREEN, '#5fbf7f'))
    base = GREEN if reds >= greens else RED
    alt = [CREAM]
    leaf = GOLD if motif == 'ornament' else None
    grid = [[hexrgb(base)] * COLS for _ in range(ROWS)]
    top = band_grid(BANDS[motif], hexrgb(CREAM), [hexrgb(a) for a in alt], hexrgb(base), hexrgb(leaf) if leaf else None)
    for r in range(band_h):
        grid[r] = top[r][:]
        grid[ROWS - band_h + r] = top[r][:]
    acc, b = hexrgb(CREAM), hexrgb(base)
    for c in range(COLS):
        z = c % 4
        grid[band_h][c] = acc if z == 0 else b
        grid[band_h + 1][c] = acc if z in (1, 3) else b
        grid[ROWS - 1 - band_h][c] = acc if z == 0 else b
        grid[ROWS - 2 - band_h][c] = acc if z in (1, 3) else b
    r0 = band_h + 3 + (area - mh) // 2
    c0 = (COLS - mw) // 2
    near = lambda y: sum((p - q) ** 2 for p, q in zip(hexrgb(y), b)) < 60 ** 2
    for r in range(mh):
        for c in range(mw):
            if cells[r][c]:
                grid[r0 + r][c0 + c] = hexrgb(cells[r][c])
    # a cream outline stitch wherever an edge stitch of the mark is close to
    # the body yarn, so a red badge on a red body still has a silhouette
    for r in range(-1, mh + 1):
        for c in range(-1, mw + 1):
            if 0 <= r < mh and 0 <= c < mw and cells[r][c]: continue
            nb = [cells[rr][cc] for rr in (r - 1, r, r + 1) for cc in (c - 1, c, c + 1)
                  if 0 <= rr < mh and 0 <= cc < mw and cells[rr][cc]]
            if nb and any(near(y) for y in nb):
                grid[r0 + r][c0 + c] = acc
    F = 2
    n = COLS + 2 * F
    full = [[acc] * n for _ in range(n)]
    for r in range(ROWS):
        full[r + F][F:F + COLS] = grid[r]
    img = Image.new('RGB', (n * CELL, n * CELL), shade(b, 0.55))
    d = ImageDraw.Draw(img)
    for r in range(n):
        for c in range(n):
            side = (c < F or c >= n - F) and F <= r < n - F
            edge = r < F or r >= n - F or side
            stitch(d, c * CELL, r * CELL, shade(full[r][c], 0.92) if edge and (r + c) % 2 else full[r][c], rot=side)
    img = img.resize((768, 768), Image.LANCZOS)
    mask = Image.new('L', (768 * 4, 768 * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 768 * 4 - 1, 768 * 4 - 1), radius=26 * 4, fill=255)
    mask = mask.resize((768, 768), Image.LANCZOS)
    o = Image.new('RGBA', (768, 768)); o.paste(img, (0, 0), mask)
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(o.resize((SIZE - 8, SIZE - 8), Image.LANCZOS), (4, 4))
    return out

# stitches across a bare mark: more than a patch's mark gets, since nothing
# surrounds it
BARE = 56

def bare(cells, mw, mh):
    # the mark's own stitches on a transparent ground, centred on a square
    n = max(mw, mh)
    img = Image.new('RGBA', (n * CELL, n * CELL), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r0, c0 = (n - mh) // 2, (n - mw) // 2
    for r in range(mh):
        for c in range(mw):
            if cells[r][c]:
                # the yarn's own shadow fills the gaps between its lobes, as
                # the patch's dark ground does, or the page shows through and
                # the mark goes pale on a light theme
                x, y = (c0 + c) * CELL, (r0 + r) * CELL
                d.rectangle((x, y, x + CELL - 1, y + CELL - 1), fill=shade(hexrgb(cells[r][c]), 0.6))
                stitch(d, x, y, hexrgb(cells[r][c]))
    out = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
    out.paste(img.resize((SIZE, SIZE), Image.LANCZOS), (0, 0))
    return out

def main():
    preview = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
    with tempfile.TemporaryDirectory() as tmp:
        jobs, plan = [], []
        for nav, marks in MARKS.items():
            for i, (src, dest, motif) in enumerate(marks):
                colors = {**COLORS[nav], **(LOGO_COLORS.get(nav, {}) if dest == 'logo.png' else {})}
                svg = os.path.join(tmp, f'{nav}-{i}.svg')
                text = strip_text(recolour(open(os.path.join(ROOT, 'public', src.lstrip('/'))).read(), colors))
                open(svg, 'w').write(text)
                jobs.append([svg, svg[:-4] + '.png'])
                key = os.path.splitext(os.path.basename(dest))[0]
                plan.append((nav, dest, motif, svg[:-4] + '.png', LABELS.get(key), STITCHES.get(key), viewbox(text)))
        rasterize(jobs, tmp)
        for nav, dest, motif, png, label, stitches, vb in plan:
            base = preview and os.path.join(preview, nav) or os.path.join(ROOT, 'public/assets', nav, sweater.MARKS)
            path = os.path.join(base, dest)
            os.makedirs(os.path.dirname(path), exist_ok=True)
            knit(png, motif, label, stitches, vb).save(path, optimize=True)
            print('knit', os.path.relpath(path, ROOT if not preview else preview))
    if preview:
        return
    for nav in MARKS:
        mpath = os.path.join(ROOT, 'src/data/seasonal-marks', f'{nav}-{sweater.SEASON}.json')
        manifest = json.load(open(mpath))
        manifest['_logo'] = 'logo.png'
        manifest['_swaps'] = SWAPS[nav]
        if nav in ICONS: manifest['_icons'] = ICONS[nav]
        if nav in MENU_ICONS: manifest['_menuIcons'] = MENU_ICONS[nav]
        open(mpath, 'w').write(json.dumps(manifest, indent=2) + '\n')
        print('wired', os.path.relpath(mpath, ROOT))

if __name__ == '__main__':
    main()
