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
# a border band is its motif's height plus a row of accent above and below

TREE = ["..X..", ".XXX.", "..X..", ".XXX.", "XXXXX"]
FLAKE = ["X.X.X", ".XXX.", "XX.XX", ".XXX.", "X.X.X"]
# G = leaf colour (second motif colour)
CARROT = [".G.G.", ".XXX.", ".XXX.", "..X..", "..X.."]
# a menorah with lit (G) flames: Harambe's nod to Hanukkah (owner, Oct 2026)
MENORAH = ["G.G.G", "X.X.X", "XXXXX", "..X..", ".XXX."]
# binary for Computer Jocks, a pot leaf for Smokane (owner, Oct 2026)
ONE = ["..X..", ".XX..", "..X..", "..X..", ".XXX."]
ZERO = [".XXX.", "X...X", "X...X", "X...X", ".XXX."]
# a pitchfork with a wooden (G) handle for Avenging Amish
PITCHFORK = ["X.X.X", "X.X.X", "XXXXX", "..G..", "..G..", "..G..", "..G.."]
# a three-leaf clover for Muck Juggling Micks
CLOVER = ["...XXX...", "...XXX...", ".XX.X.XX.", ".XXX.XXX.", ".XX.X.XX.", "....X....", ".....X..."]
# One motif per club (owner, Oct 2026: "each team should have a unique trim").
# W = white yarn, a third colour beside the motif (X) and leaf (G) yarns.
WAVE = ["...XXX..", "..X...X.", "..X.X.X.", ".X..XX..", "X.......", "XXXXXXXX"]  # Pacific; seamless
CORN = ["..X..", ".XXX.", ".XXX.", "GXXXG", "GXXXG", ".GGG.", "..G.."]
DOLLAR = ["..X..", ".XXXX", "X.X..", ".XXX.", "..X.X", "XXXX.", "..X.."]
JET = ["...X...", "..XXX..", ".XXXXX.", "XX.X.XX", "...X...", "..XXX.."]
SKULL = [".XXX.", "XXXXX", "X.X.X", "XXXXX", ".XXX.", ".X.X."]
CHILI = ["....G", "...G.", "..XX.", ".XXX.", ".XX..", "X...."]
NOTE = ["..XX.", "..X.X", "..X..", "..X..", "XXX..", "XXX.."]
FLAME = ["..X..", ".XX..", ".XXX.", "XX.XX", "X.G.X", "XGGGX", ".XXX."]
BOLT = ["...XX", "..XX.", ".XX..", "XXXXX", "..XX.", ".XX..", "XX..."]
ELEPHANT = [".XXX....", "XXXXXXX.", "XWXXXXXX", "XXXXXXXX", "X.XXXXXX", "X.XX..XX", "..XX..XX"]
PI = ["XXXXX", ".X.X.", ".X.X.", ".X.X.", "X...X"]
HORSESHOE = ["XX.XX", "X...X", "X...X", "X...X", ".XXX."]
WIZARD_HAT = ["...X.", "..XX.", "..XX.", ".XGX.", ".XXXX", "XXXXX"]
GUITAR = ["..X..", "..X..", "..X..", ".XXX.", "XX.XX", "XXXXX", ".XXX."]
MUG = ["GGGG..", "XXXX..", "XXXXXX", "XXXX.X", "XXXXXX", "XXXX.."]
MINT = [".XXXXX.", "XX.X.XX", "X.XXX.X", "XXX.XXX", "X.XXX.X", "XX.X.XX", ".XXXXX."]
MOUSTACHE = ["..XX.XX..", ".XXXXXXX.", "XXX...XXX", "X.......X"]
GINGERBREAD = [".XXX.", ".XXX.", "XXXXX", ".XGX.", ".XXX.", "XX.XX"]
CUP = ["WWWWW", "XXXXX", "XXXXX", ".XXX.", ".XXX.", ".XXX."]
PAW = ["X.X.X", ".....", ".XXX.", "XXXXX", ".XXX."]
HEART = [".XX.XX.", "XXXXXXX", "XXXXXXX", ".XXXXX.", "..XXX..", "...X..."]
DIAMOND = ["..X..", ".XXX.", "XXXXX", ".XXX.", "..X.."]
DREIDEL = ["..X..", "XXXXX", "XXGXX", "XXXXX", ".XXX.", "..X.."]
SHADES = ["XXXXXXXXX", "XXXX.XXXX", ".XXX.XXX.", "..X...X.."]
CONICAL_HAT = ["....X....", "...XXX...", "..XXXXX..", ".XXXXXXX.", "XXXXXXXXX"]  # Vietnamese non la
CROSS = ["..X..", ".XXX.", "XXXXX", ".XXX.", "..X..", "..X.."]
BUBBLE = [".XXXXX.", "XXXXXXX", "XGXGXGX", "XXXXXXX", ".XXXXX.", "XX....."]
ORNAMENT = ["..G..", ".XXX.", "XXXXX", "XXWXX", "XXXXX", ".XXX."]
MIC = [".XXX.", ".XGX.", ".XXX.", "..X..", "..X..", ".XXX."]
SOUP = [".G.G.G.", "..G.G..", "XXXXXXX", ".XXXXX.", "..XXX.."]
SEAMLESS = {'wave'}
LEAF = ["....X....", "X...X...X", ".X.XXX.X.", "..XXXXX..", "XXX.X.XXX", "....X....", "....X...."]

def hexrgb(h): return tuple(int(h[i:i+2], 16) for i in (1, 3, 5))
def shade(c, f): return tuple(max(0, min(255, int(v * f))) for v in c)

def stitch(d, x, y, col, rot=False):
    # one knit "V": two tilted lobes; rot turns it 90 degrees so the V runs
    # along a side edge
    cx, cy = x + CELL / 2, y + CELL / 2
    bright = sum(col) / 3 > 200
    if bright:
        # fill the gaps between the lobes too, so the dark ground does not
        # bleed through and tint a white mark
        d.rectangle((x, y, x + CELL, y + CELL), fill=shade(col, 0.8))
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
        # light yarn keeps most of its brightness in the shadow lobe, or a
        # white mark knits up grey (owner, Oct 2026: "the brights are faded")
        d.polygon([T(p) for p in pts], fill=shade(col, 0.88 if bright else 0.72))
        inner = [((px - cx) * 0.8 + cx - sgn * 1, (py - cy) * 0.8 + cy - 2) for px, py in pts]
        d.polygon([T(p) for p in inner], fill=col)
        hl = [((px - cx) * 0.35 + cx + sgn * CELL * 0.07 - 3, (py - cy) * 0.45 + cy - CELL * 0.12) for px, py in pts]
        d.polygon([T(p) for p in hl], fill=shade(col, 1.12))

WHITE = (243, 238, 227)

def band_grid(motif, accent, alt, base, leaf=None, gap=1):
    # `motif` is one shape, or a list of same-sized shapes knit in turn
    shapes = motif if isinstance(motif[0], list) else [motif]
    motif = shapes[0]
    band = len(motif) + 2
    g = [[base] * COLS for _ in range(band)]
    for c in range(COLS):
        g[0][c] = accent
        g[band - 1][c] = accent
    w = len(motif[0]) + gap
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
            elif m < len(motif[0]) and motif[r][m] == 'W':
                g[r + 1][c] = WHITE
    return g

def build(mark_path, base, ink, accent, alt, motif, leaf=None, regions=None, centre_rows=(0, 1), gap=1, band_base=None):
    alt = [hexrgb(a) for a in (alt if isinstance(alt, (list, tuple)) else [alt])]
    base, ink, accent = map(hexrgb, (base, ink, accent))
    grid = [[base] * COLS for _ in range(ROWS)]
    top = band_grid(motif, accent, alt, hexrgb(band_base) if band_base else base, hexrgb(leaf) if leaf else None, gap)
    band = len(top)
    for r in range(band):
        grid[r] = top[r][:]
        # the bottom band repeats the top one rather than mirroring it, so
        # motifs with an up (carrots, menorahs, digits) stay upright
        grid[ROWS - band + r] = top[r][:]
    # zigzag separators
    for c in range(COLS):
        z = c % 4
        grid[band][c] = accent if z in (0,) else base
        grid[band + 1][c] = accent if z in (1, 3) else base
        grid[ROWS - 1 - band][c] = accent if z in (0,) else base
        grid[ROWS - 2 - band][c] = accent if z in (1, 3) else base
    area = ROWS - 2 * (band + 2) - 4
    m = Image.open(mark_path).convert('RGBA').split()[3]
    m = m.crop(m.getbbox())
    w, h = m.size
    sc = area / max(w, h)
    mw, mh = max(1, round(w * sc)), max(1, round(h * sc))
    m = m.resize((mw, mh), Image.BOX)
    r0 = band + 3 + (area - mh) // 2
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

# A team's trim as a strip for the roster header (owner, Oct 2026: "decorate
# the coloured team header like a Christmas sweater"): the patch's own band,
# accent rows, motif run and zigzag, knit as a tile that repeats sideways. The
# zigzag sits on the edge facing the header, so `bottom` flips only that.
TRIM_CELL = 10     # px per stitch in the PNG; the page draws it at half that

def trim(base, accent, alt, motif, leaf=None, bottom=False, gap=1, band_base=None):
    shapes = motif if isinstance(motif[0], list) else [motif]
    alts = [hexrgb(a) for a in (alt if isinstance(alt, (list, tuple)) else [alt])]
    base, accent = hexrgb(base), hexrgb(accent)
    band = hexrgb(band_base) if band_base else base
    w = len(shapes[0][0]) + gap
    reps = math.lcm(len(shapes), len(alts))
    cols = math.lcm(w * reps, 4)
    while cols < 48: cols *= 2
    rows = [[accent] * cols]
    for r in range(len(shapes[0])):
        row = [band] * cols
        for c in range(cols):
            m, k = c % w, c // w
            sh = shapes[k % len(shapes)]
            if m < len(sh[0]) and sh[r][m] == 'X': row[c] = alts[k % len(alts)]
            elif m < len(sh[0]) and sh[r][m] == 'G' and leaf: row[c] = hexrgb(leaf)
            elif m < len(sh[0]) and sh[r][m] == 'W': row[c] = WHITE
        rows.append(row)
    rows.append([accent] * cols)
    zig = [[accent if c % 4 == 0 else base for c in range(cols)],
           [accent if c % 4 in (1, 3) else base for c in range(cols)]]
    rows = zig[::-1] + rows if bottom else rows + zig
    img = Image.new('RGB', (cols * CELL, len(rows) * CELL), shade(base, 0.55))
    d = ImageDraw.Draw(img)
    for r, row in enumerate(rows):
        for c, col in enumerate(row):
            stitch(d, c * CELL, r * CELL, col)
    return img.resize((cols * TRIM_CELL, len(rows) * TRIM_CELL), Image.LANCZOS)

MOTIFS, PATTERNS = [TREE, FLAKE], {'wave': WAVE, 'corn': CORN, 'dollar': DOLLAR, 'hat': CONICAL_HAT, 'jet': JET, 'skull': SKULL,
    'chili': CHILI, 'note': NOTE, 'flame': FLAME, 'bolt': BOLT, 'elephant': ELEPHANT, 'pi': PI, 'horseshoe': HORSESHOE,
    'wizard': WIZARD_HAT, 'guitar': GUITAR, 'mug': MUG, 'mint': MINT, 'moustache': MOUSTACHE, 'gingerbread': GINGERBREAD,
    'cup': CUP, 'paw': PAW, 'heart': HEART, 'diamond': DIAMOND, 'dreidel': DREIDEL, 'shades': SHADES, 'cross': CROSS,
    'bubble': BUBBLE, 'ornament': ORNAMENT, 'mic': MIC, 'soup': SOUP, 'carrot': CARROT, 'menorah': [MENORAH, FLAKE], 'binary': [ONE, ZERO, ONE, ONE, ZERO], 'leaf': [LEAF], 'pitchfork': [PITCHFORK], 'clover': [CLOVER]}

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
    ('theleague', '0010'): {'motif': ['#2b972b'], 'pattern': 'binary'},
    ('afl', '0005'): {'motif': ['#2b972b'], 'pattern': 'binary'},
    ('afl', '0001'): {'pattern': 'leaf'},
    ('afl', '0007'): {'pattern': 'pitchfork', 'leaf': '#8a5a32'},
    ('afl', '0013'): {'pattern': 'clover', 'motif': ['#f4f1ea']},
    ('theleague', '0005'): {'motif': ['#de3f3f', '#2f8b59']},
    ('afl', '0015'): {'motif': ['#de3f3f', '#2f8b59']},
    # Drunk Indians: blue and red first; yellow only as a rare accent.
    ('afl', '0002'): {'base': '#f3eee3', 'ink': '#314d78', 'accent': '#314d78', 'motif': ['#d53755', '#d53755', '#f9b813'],
                      'regions': [(lambda fx, fy: fy < .354 or (fy < .415 and fx >= .46), '#d53755')]},
    # Wascawy Wabbits: the orange border shapes are carrots with green tops.
    ('theleague', '0009'): {'motif': ['#ed7117'], 'pattern': 'carrot', 'leaf': '#3f9a4a', 'centre_rows': (.55, 1)},
    ('afl', '0008'): {'motif': ['#418bbe', '#aeadad'], 'pattern': 'menorah', 'leaf': '#f2c14e'},
}

# Each club's own trim motif (owner, Oct 2026), with the yarns it needs. A club
# in both leagues knits the same trim in each.
CLUB_TRIMS = {
    ('theleague', '0001'): {'pattern': 'wave', 'motif': ['#f3eee3']},                       # Pacific Pigskins
    ('theleague', '0002'): {'pattern': 'hat', 'motif': ['#e8d29a']},          # Da Dangsters: Vietnamese                     # Da Dangsters
    ('afl', '0006'): {'pattern': 'hat', 'motif': ['#e8d29a']},
    ('theleague', '0003'): {'pattern': 'jet', 'motif': ['#ebd0a1']},                        # Maverick
    ('theleague', '0004'): {'pattern': 'skull', 'motif': ['#e3e6e8']},                      # Dead Cap Walking
    ('theleague', '0005'): {'pattern': 'chili', 'motif': ['#de3f3f'], 'leaf': '#2f8b59'},   # Mariachi Ninjas
    ('afl', '0015'): {'pattern': 'chili', 'motif': ['#de3f3f'], 'leaf': '#2f8b59'},
    ('theleague', '0006'): {'pattern': 'note', 'motif': ['#c8102e', '#4883db']},           # Music City Mafia
    ('theleague', '0007'): {'pattern': 'flame', 'motif': ['#d7141a'], 'leaf': '#f6b21a'},  # Fire Ready Aim
    ('theleague', '0008'): {'pattern': 'bolt', 'motif': ['#e9e9e9']},                      # Bring The Pain
    ('theleague', '0011'): {'pattern': 'corn', 'motif': ['#ffcd00'], 'leaf': '#4caf50', 'band_base': '#181818'},   # Midwestside Connection
    ('afl', '0011'): {'pattern': 'corn', 'motif': ['#ffcd00'], 'leaf': '#4caf50', 'band_base': '#181818'},
    ('theleague', '0012'): {'pattern': 'elephant', 'motif': ['#aa322b']},                  # Vitside Mafia: Thai/Lao
    ('afl', '0009'): {'pattern': 'elephant', 'motif': ['#aa322b']},
    ('theleague', '0013'): {'pattern': 'pi', 'motif': ['#f68428']},                        # Gridiron Geeks
    ('theleague', '0014'): {'pattern': 'horseshoe', 'motif': ['#d32a3e']},                 # Cowboy Up
    ('theleague', '0015'): {'pattern': 'wizard', 'motif': ['#8a78be'], 'leaf': '#f2c14e'}, # Dark Magicians
    ('theleague', '0016'): {'pattern': 'guitar', 'motif': ['#d4af37']},                    # Running down the Dream
    ('afl', '0002'): {'pattern': 'mug', 'motif': ['#f9b813'], 'leaf': '#ffffff'},          # Drunk Indians
    ('afl', '0003'): {'pattern': 'mint', 'motif': ['#e9e9e9']},                            # Team Minty Fresh
    ('afl', '0004'): {'pattern': 'moustache', 'motif': ['#181818']},                       # Get off my Ditka
    ('afl', '0010'): {'pattern': 'gingerbread', 'motif': ['#b0682e'], 'leaf': '#ffffff'},  # Fullybaked
    ('afl', '0012'): {'pattern': 'cup', 'motif': ['#d53a2b'], 'band_base': '#f3eee3'},                             # Suh girls, one cup
    ('afl', '0014'): {'pattern': 'paw', 'motif': ['#e59923']},                             # A Bruin Pegs Me
    ('afl', '0016'): {'pattern': 'heart', 'motif': ['#ffffff', '#c8102e']},                # Swiftie 4 Life
    ('afl', '0017'): {'pattern': 'diamond', 'motif': ['#ffb612', '#c60c30', '#00539b']},   # Titsburgh Feelers
    ('afl', '0018'): {'pattern': 'dreidel', 'motif': ['#e9e9e9'], 'leaf': '#199b5d'},      # Jewpacabra
    ('afl', '0019'): {'pattern': 'shades', 'motif': ['#f3eee3']},                          # Badd Boys
    ('afl', '0020'): {'pattern': 'cross', 'motif': ['#e9e9e9']},                           # Boondock Saints
    ('afl', '0021'): {'pattern': 'bubble', 'motif': ['#181818'], 'leaf': '#ffffff'},       # Chatmaster
    ('afl', '0022'): {'pattern': 'ornament', 'motif': ['#c8102e', '#2f8b59', '#181818'], 'leaf': '#d4af37'},  # Balls Deep
    ('afl', '0023'): {'pattern': 'mic', 'motif': ['#cc9ca6'], 'leaf': '#8b8f93'},          # The Show
    ('afl', '0024'): {'pattern': 'soup', 'motif': ['#c93803'], 'leaf': '#e9e9e9'},         # No Soup For You
}
for key, trim_o in CLUB_TRIMS.items():
    OVERRIDES[key] = {**OVERRIDES.get(key, {}), **trim_o}

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
    # the centre mark's white stays pure white; only body and trim yarn is warmed
    return yarn(o.get('base', base)), o.get('ink', ink), o.get('motif', yarn(motif))


def main():
    sheet_dir = sys.argv[sys.argv.index('--sheet') + 1] if '--sheet' in sys.argv else None
    for league, cfg in LEAGUES:
        teams = json.load(open(os.path.join(ROOT, cfg)))['teams']
        out_dir = os.path.join(ROOT, 'public/assets', league, MARKS)
        os.makedirs(out_dir, exist_ok=True)
        mpath = os.path.join(ROOT, 'src/data/seasonal-marks', f'{league}-{SEASON}.json')
        # the league's own marks are build-sweater-league-marks.py's: keep them
        old = json.load(open(mpath)) if os.path.exists(mpath) else {}
        manifest = {
            '_source': 'Ugly-sweater patches knit from each team\'s Halloween silhouette in its own colours (Oct 2026). Rebuild: python3 scripts/build-sweater-marks.py; league marks: python3 scripts/build-sweater-league-marks.py',
            '_logo': old.get('_logo'),
            **{k: old[k] for k in ('_swaps', '_icons', '_menuIcons') if k in old},
        }
        versions, tiles, trims = {}, [], {}
        for i, t in enumerate(teams):
            fid = t['franchiseId']
            base, ink, motif = palette(t, league)
            o = OVERRIDES.get((league, fid), {})
            patch = build(os.path.join(ROOT, 'public/assets', league, 'halloween-marks', f'{fid}.png'),
                          base, ink, o.get('accent', ink), motif, PATTERNS.get(o.get('pattern'), MOTIFS[i % 2]),
                          o.get('leaf'), o.get('regions'), o.get('centre_rows', (0, 1)), 0 if o.get('pattern') in SEAMLESS else 1, o.get('band_base'))
            tiles.append((t['name'], patch))
            os.makedirs(os.path.join(out_dir, 'trim'), exist_ok=True)
            pattern = PATTERNS.get(o.get('pattern'), MOTIFS[i % 2])
            for edge in ('top', 'bottom'):
                strip = trim(base, o.get('accent', ink), motif, pattern, o.get('leaf'), edge == 'bottom',
                             0 if o.get('pattern') in SEAMLESS else 1, o.get('band_base'))
                tdest = os.path.join(out_dir, 'trim', f'{fid}-{edge}.png')
                strip.save(tdest, optimize=True)
                trims.setdefault(fid, {})[edge] = hashlib.sha256(open(tdest, 'rb').read()).hexdigest()[:8]
            small = Image.new('RGBA', (SIZE, SIZE), (0, 0, 0, 0))
            small.paste(patch.resize((SIZE - 8, SIZE - 8), Image.LANCZOS), (4, 4))
            dest = os.path.join(out_dir, f'{fid}.png')
            small.save(dest, optimize=True)
            manifest[fid] = f'sweater:{base},{ink}'
            versions[fid] = hashlib.sha256(open(dest, 'rb').read()).hexdigest()[:8]
        manifest['_v'] = versions
        manifest['_trim'] = trims
        with open(mpath, 'w') as f:
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
