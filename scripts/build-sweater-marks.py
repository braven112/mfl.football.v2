#!/usr/bin/env python3
"""
Build the Christmas Week franchise marks (src/config/seasonal-themes.mjs):
every team knit into an ugly-sweater patch in its own colours.

    python3 scripts/build-sweater-marks.py [--sheet <dir>]

Needs Pillow (python3 -m pip install pillow). Each mark is the team's drawn
Halloween silhouette (public/assets/<navSlug>/halloween-marks/<id>.png)
knitted into a 60x60-stitch sweater: body in the team's primary colour, the
mark in whichever team colour stands out most against it, a tree or snowflake
band top and bottom in a third, and a two-stitch knitted cuff all the way
round. OVERRIDES holds the owner's per-team calls. Output, like
build-seasonal-marks.mjs: public/assets/<navSlug>/christmas-marks/<id>.png at
200x200, and src/data/seasonal-marks/<navSlug>-christmas.json naming each id
with its content hash (`_v`). --sheet also writes a contact sheet per league.
"""
import hashlib, json, math, os, sys
from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LEAGUES = (('theleague', 'src/data/theleague.config.json'), ('afl', 'data/afl-fantasy/afl.config.json'))
SEASON, MARKS, SIZE = 'christmas', 'christmas-marks', 200

COLS = ROWS = 60
CELL = 32          # supersampled cell size
BAND = 7           # rows per border band

TREE = ["..X..", ".XXX.", "..X..", ".XXX.", "XXXXX"]
FLAKE = ["X.X.X", ".XXX.", "XX.XX", ".XXX.", "X.X.X"]
# G = leaf colour (second motif colour)
CARROT = [".G.G.", ".XXX.", ".XXX.", "..X..", "..X.."]
# a menorah with lit (G) flames: Harambe's nod to Hanukkah (owner, Oct 2026)
MENORAH = ["G.G.G", "X.X.X", "XXXXX", "..X..", ".XXX."]

def hexrgb(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))
def shade(c, f): return tuple(max(0, min(255, int(v * f))) for v in c)

def stitch(d, x, y, col, rot=False):
    # one knit "V": two tilted lobes; rot turns it 90 degrees so the V runs
    # along a side edge
    cx, cy = x + CELL / 2, y + CELL / 2
    T = (lambda p: (cx - (p[1] - cy), cy + (p[0] - cx))) if rot else (lambda p: p)
    for sgn in (-1, 1):
        a = math.radians(sgn * 28)
        pts = []
        for t in range(24):
            th = 2 * math.pi * t / 24
            ex, ey = CELL * 0.26 * math.cos(th), CELL * 0.52 * math.sin(th)
            rx = ex * math.cos(a) - ey * math.sin(a)
            ry = ex * math.sin(a) + ey * math.cos(a)
            pts.append((cx + sgn * CELL * 0.2 + rx, cy + ry))
        d.polygon([T(p) for p in pts], fill=shade(col, 0.72))
        inner = [((px - cx) * 0.8 + cx - sgn * 1, (py - cy) * 0.8 + cy - 2) for px, py in pts]
        d.polygon([T(p) for p in inner], fill=col)
        hl = [((px - cx) * 0.35 + cx + sgn * CELL * 0.07 - 3, (py - cy) * 0.45 + cy - CELL * 0.12) for px, py in pts]
        d.polygon([T(p) for p in hl], fill=shade(col, 1.12))

def band_grid(motif, accent, alt, base, leaf=None):
    # `motif` is one shape, or a list of same-sized shapes knit in turn
    shapes = motif if isinstance(motif[0], list) else [motif]
    motif = shapes[0]
    g = [[base] * COLS for _ in range(BAND)]
    for c in range(COLS):
        g[0][c] = accent
        g[BAND - 1][c] = accent
    w = len(motif[0]) + 1
    # centre the repeat: equal margin left and right of the motif run
    off = (COLS - (COLS // w) * w + 1) // 2
    for c in range(COLS):
        m = ((c - off) % w)
        k = (c - off) // w
        motif = shapes[k % len(shapes)]
        for r in range(len(motif)):
            if m < len(motif[0]) and motif[r][m] == 'X':
                g[r + 1][c] = alt[((c - off) // w) % len(alt)]
            elif m < len(motif[0]) and motif[r][m] == 'G' and leaf:
                g[r + 1][c] = leaf
    return g

def build(mark_path, base, ink, accent, alt, motif, leaf=None, regions=None, centre_rows=(0, 1)):
    alt = [hexrgb(a) for a in (alt if isinstance(alt, (list, tuple)) else [alt])]
    base, ink, accent = map(hexrgb, (base, ink, accent))
    grid = [[base] * COLS for _ in range(ROWS)]
    top = band_grid(motif, accent, alt, base, hexrgb(leaf) if leaf else None)
    for r in range(BAND):
        grid[r] = top[r][:]
        grid[ROWS - 1 - r] = top[r][:]
    # zigzag separators
    for c in range(COLS):
        z = c % 4
        grid[BAND][c] = accent if z in (0,) else base
        grid[BAND + 1][c] = accent if z in (1, 3) else base
        grid[ROWS - 1 - BAND][c] = accent if z in (0,) else base
        grid[ROWS - 2 - BAND][c] = accent if z in (1, 3) else base
    area = ROWS - 2 * (BAND + 2) - 4
    m = Image.open(mark_path).convert('RGBA').split()[3]
    m = m.crop(m.getbbox())
    w, h = m.size
    sc = area / max(w, h)
    mw, mh = max(1, round(w * sc)), max(1, round(h * sc))
    m = m.resize((mw, mh), Image.BOX)
    r0 = BAND + 3 + (area - mh) // 2
    # centre by the mark's visual weight, not its bounding box: a lopsided
    # outline (Wabbits' ears) otherwise sits visibly off to one side
    # `centre_rows` limits that to a band of the mark (Wabbits: the face,
    # not the ears)
    px = m.load(); tot = sx = 0
    for r in range(int(mh * centre_rows[0]), int(mh * centre_rows[1])):
        for c in range(mw):
            if px[c, r] > 120:
                tot += 1; sx += c
    cx = sx / tot if tot else mw / 2
    # half weight, half box by default; a named band is centred on outright
    c0 = round(COLS / 2 - ((cx + .5 + mw / 2) / 2 if centre_rows == (0, 1) else cx + .5))
    c0 = max(1, min(COLS - mw - 1, c0))
    for r in range(mh):
        for c in range(mw):
            if m.getpixel((c, r)) > 120:
                col = ink
                # regions: (test(fx, fy), colour) pairs that knit part of the
                # mark in a second colour (Drunk Indians' feather)
                for test, rc in (regions or []):
                    if test(c / mw, r / mh):
                        col = hexrgb(rc); break
                grid[r0 + r][c0 + c] = col
    # knitted edge: a two-stitch cuff in the accent yarn all the way round,
    # its side stitches turned to run along the edge (owner, Oct 2026: the
    # border must look knitted, not like a drawn outline)
    F = 2
    n = COLS + 2 * F
    full = [[accent] * n for _ in range(n)]
    for r in range(ROWS):
        full[r + F][F:F + COLS] = grid[r]
    img = Image.new('RGB', (n * CELL, n * CELL), shade(base, 0.55))
    d = ImageDraw.Draw(img)
    for r in range(n):
        for c in range(n):
            side = (c < F or c >= n - F) and F <= r < n - F
            stitch(d, c * CELL, r * CELL, shade(full[r][c], 0.92) if (r < F or r >= n - F or side) and (r + c) % 2 else full[r][c], rot=side)
    img = img.resize((768, 768), Image.LANCZOS)
    mask = Image.new('L', (768 * 4, 768 * 4), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, 768 * 4 - 1, 768 * 4 - 1), radius=26 * 4, fill=255)
    mask = mask.resize((768, 768), Image.LANCZOS)
    o = Image.new('RGBA', (768, 768)); o.paste(img, (0, 0), mask)
    return o

MOTIFS, PATTERNS = [TREE, FLAKE], {'carrot': CARROT, 'menorah': [MENORAH, FLAKE]}

def rgb(h): return tuple(int(h[i:i+2], 16) / 255 for i in (1, 3, 5))
def lum(h):
    f = lambda c: c / 12.92 if c <= .03928 else ((c + .055) / 1.055) ** 2.4
    r, g, b = map(f, rgb(h)); return .2126 * r + .7152 * g + .0722 * b
def cr(a, b):
    la, lb = sorted((lum(a), lum(b)), reverse=True); return (la + .05) / (lb + .05)
def tohex(t): return '#' + ''.join(f'{max(0, min(255, round(v * 255))):02x}' for v in t)
def push(h, against, target):
    # darken or lighten h until it reaches target contrast against `against`
    c = rgb(h); dark = lum(against) > .3
    for _ in range(40):
        if cr(tohex(c), against) >= target: break
        c = tuple(v * .9 for v in c) if dark else tuple(v + (1 - v) * .12 for v in c)
    return tohex(c)
def yarn(h):  # pure white yarn reads better slightly warm
    return '#f3eee3' if h.lower() in ('#ffffff', '#e9e9e9') else h

# owner's calls (Oct 2026): white character for Music City; the green belongs in
# Computer Jocks' borders; Mariachi Ninjas' borders mix their red and green.
OVERRIDES = {
    ('theleague', '0006'): {'ink': '#ffffff'},
    ('theleague', '0010'): {'motif': ['#2b972b']},
    ('afl', '0005'): {'motif': ['#2b972b']},
    ('theleague', '0005'): {'motif': ['#de3f3f', '#2f8b59']},
    ('afl', '0015'): {'motif': ['#de3f3f', '#2f8b59']},
    # Drunk Indians: blue and red first; yellow only as a rare accent.
    ('afl', '0002'): {'base': '#f3eee3', 'ink': '#314d78', 'accent': '#314d78', 'motif': ['#d53755', '#d53755', '#f9b813'],
                      'regions': [(lambda fx, fy: fy < .354 or (fy < .415 and fx >= .46), '#d53755')]},
    # Wascawy Wabbits: the orange border shapes are carrots with green tops.
    ('theleague', '0009'): {'motif': ['#ed7117'], 'pattern': 'carrot', 'leaf': '#3f9a4a', 'centre_rows': (.55, 1)},
    ('afl', '0008'): {'motif': ['#418bbe', '#aeadad'], 'pattern': 'menorah', 'leaf': '#f2c14e'},
}

def palette(t, league=None):
    cols = [c for c in (t.get('colorPrimary'), t.get('colorSecondary'), t.get('colorTertiary'), t.get('colorQuaternary')) if c]
    base = cols[0]
    # very light primaries (white/grey teams) still make a sweater; keep them
    rest = cols[1:]
    ink = max(rest, key=lambda c: cr(c, base))
    if cr(ink, base) < 3: ink = push(ink, base, 3)
    others = [c for c in rest if c != ink]
    motif = max(others, key=lambda c: min(cr(c, base), 3) + .3 * cr(c, ink)) if others else ink
    if cr(motif, base) < 1.6: motif = ink
    o = OVERRIDES.get((league, t['franchiseId']), {})
    return yarn(o.get('base', base)), yarn(o.get('ink', ink)), o.get('motif', yarn(motif))


def main():
    sheet_dir = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
    for league, cfg in LEAGUES:
        teams = json.load(open(os.path.join(ROOT, cfg)))['teams']
        out_dir = os.path.join(ROOT, 'public/assets', league, MARKS)
        os.makedirs(out_dir, exist_ok=True)
        manifest = {
            '_source': 'Ugly-sweater patches knit from each team\'s Halloween silhouette in its own colours (Oct 2026). Rebuild: python3 scripts/build-sweater-marks.py',
            '_logo': None,
        }
        versions, tiles = {}, []
        for i, t in enumerate(teams):
            fid = t['franchiseId']
            base, ink, motif = palette(t, league)
            o = OVERRIDES.get((league, fid), {})
            patch = build(os.path.join(ROOT, 'public/assets', league, 'halloween-marks', f'{fid}.png'),
                          base, ink, o.get('accent', ink), motif, PATTERNS.get(o.get('pattern'), MOTIFS[i % 2]),
                          o.get('leaf'), o.get('regions'), o.get('centre_rows', (0, 1)))
            tiles.append((t['name'], patch))
            small = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
            small.paste(patch.resize((SIZE - 8, SIZE - 8), Image.LANCZOS), (4, 4))
            dest = os.path.join(out_dir, f'{fid}.png')
            small.save(dest, optimize=True)
            manifest[fid] = f'sweater:{base},{ink}'
            versions[fid] = hashlib.sha256(open(dest, 'rb').read()).hexdigest()[:8]
        manifest['_v'] = versions
        with open(os.path.join(ROOT, 'src/data/seasonal-marks', f'{league}-{SEASON}.json'), 'w') as f:
            f.write(json.dumps(manifest, indent=2) + '\n')
        print(f'{league}: {len(versions)} marks')
        if sheet_dir:
            cols, tile = (6 if len(tiles) > 16 else 4), 230
            rows = (len(tiles) + cols - 1) // cols
            W = Image.new('RGB', (cols * tile + 20, rows * (tile + 34) + 20), (24, 24, 27)); d = ImageDraw.Draw(W)
            for k, (name, im) in enumerate(tiles):
                x, y = 10 + (k % cols) * tile, 10 + (k // cols) * (tile + 34)
                big = im.resize((tile - 30, tile - 30), Image.LANCZOS); W.paste(big, (x + 15, y), big)
                sm = im.resize((32, 32), Image.LANCZOS); W.paste(sm, (x + 15, y + tile - 26), sm)
                d.text((x + 55, y + tile - 18), name[:24], fill=(225, 225, 225))
            W.save(os.path.join(sheet_dir, f'sheet-{league}.png'))


if __name__ == '__main__':
    main()
