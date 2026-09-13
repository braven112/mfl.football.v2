/**
 * The broadcast shell's structural rules — the ones that live in CSS and in
 * component wiring, where only a scan can hold them.
 *
 * Every block below is a bug this repo has already shipped somewhere else,
 * pointed at the one surface most likely to repeat it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getLeagueTeamConfigs } from '../src/utils/league-team-brands';
import { broadcastStrokeIndex, resolveBroadcastCrest } from '../src/utils/broadcast-crest';
import { crestLeagueKey } from '../src/utils/dark-surface-crest';
import { buildBroadcastDefenseFaces } from '../src/utils/broadcast-board';
import { isEspnCdnUrl } from '../src/utils/espn-cdn';
import { normalizeTeamCode } from '../src/utils/nfl';
import { getPlayerMap } from '../src/utils/player-map';
import { defenseNickname } from '../src/components/shared/live-broadcast/MomentTakeover';
import { MAX_GRID_PANELS, splitPanels } from '../src/utils/broadcast-layout';

const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf8');

/**
 * The file with its comments removed.
 *
 * Every rule below is DOCUMENTED in the file it guards — the CSS explains why
 * it carries no `html.dark`, the page explains why it does not call
 * `Astro.redirect()`. A scan over the raw text therefore matches the prose
 * describing the trap and reports the file as containing it, which is the one
 * way a guard can be worse than no guard: it fails loudest on the code that
 * documents itself best. Strip comments first and assert against the code.
 */
const code = (src: string) =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const CSS = read('src/styles/live-broadcast.css');
const CSS_CODE = code(CSS);
const ISLAND = read('src/components/shared/live-broadcast/LiveBroadcast.tsx');
const ISLAND_CODE = code(ISLAND);
const PAGE = read('src/components/shared/live-broadcast/LiveBroadcastPage.astro');
const CONTROLS = read('src/components/shared/live-broadcast/BroadcastControls.astro');
const CONTROLS_CODE = code(CONTROLS);
const PAGE_CODE = code(PAGE);
const HEADER = code(read('src/components/shared/live-broadcast/BroadcastScoreHeader.tsx'));
const ROUTES = [
  'src/pages/theleague/broadcast.astro',
  'src/pages/afl-fantasy/broadcast.astro',
].map((p) => [p, code(read(p))] as const);

/**
 * The stylesheet with the `.lbc-bar*` rules removed.
 *
 * The toolbar above the board is the ONE themed surface in this file and it is
 * the only place a colour token belongs: it is an ordinary page element under
 * the site nav, not part of the board. Everything else — the board, the setup
 * screen, every reveal — is dark in both themes because franchise colours are
 * its background, and a token there either inverts under `html.dark` or is
 * floored against a surface that does not exist here.
 */
const CSS_BOARD = CSS.replace(/^\.lbc-bar[^{]*\{[^}]*\}/gm, '');

describe('the broadcast surface consumes NO colour token', () => {
  it('references no --color-*, --card-*, --content-*, --page-* or --league-accent', () => {
    // Every one of them either inverts under html.dark (--color-gray-900
    // resolves to near-WHITE, so a "dark broadcast panel" turns white at
    // night), is floored against a surface this page does not have, or flips
    // brightness with the theme. Ink here is always white and the ground is
    // always dark, in both themes.
    const banned = /var\(\s*--(color|card|content|page|league-accent|team-accent)[\w-]*/g;
    expect(CSS_BOARD.match(banned) ?? []).toEqual([]);
  });

  it('themes the TOOLBAR, and only the toolbar', () => {
    // The exception, pinned in both directions. A hardcoded near-black slab
    // under a light-mode nav read as a piece of the board that had escaped
    // onto the page — so the toolbar takes tokens and follows the theme...
    const bar = (CSS.match(/^\.lbc-bar[^{]*\{[^}]*\}/gm) ?? []).join('\n');
    expect(bar).toMatch(/var\(--card-surface\)/);
    expect(bar).toMatch(/var\(--card-border\)/);
    // ...and it carries no board palette of its own, which is what made the
    // old strip a dark slab in the first place.
    expect(bar).not.toMatch(/--lbc-panel|--lbc-ink|#0b1220/);
  });

  it('needs no html.dark override, and has none', () => {
    // A dark-in-both-themes surface with a dark override is a surface someone
    // has started theming — which is the first half of shipping white-on-white.
    expect(CSS_CODE).not.toMatch(/html\.dark/);
    expect(CSS_CODE).not.toMatch(/\[data-theme/);
  });

  it('declares every custom property the island writes inline', () => {
    // design-token-guard reads CSS only, so a property that exists solely as a
    // JS-set inline style is indistinguishable from a typo'd token silently
    // resolving to its fallback in both themes.
    for (const prop of ['--lbc-drift-x', '--lbc-drift-y', '--lbc-drift-y2', '--lbc-dim', '--lbc-mine', '--lbc-theirs', '--wp-split', '--lbc-primary', '--lbc-secondary']) {
      expect(CSS, `${prop} must be declared, not only referenced`).toMatch(
        new RegExp(`^\\s*${prop}\\s*:`, 'm'),
      );
    }
  });

  it('splits the gradient into background-color + background-image', () => {
    // `background: var(--x)` is all-or-nothing: a value rejected for the
    // property resets it to transparent, not to the cascade winner.
    expect(CSS).toMatch(/background-color:\s*#[0-9a-f]{6};\s*\n\s*background-image:\s*var\(\s*--lbc-gradient/i);
    expect(CSS).not.toMatch(/\n\s*background:\s*var\(\s*--lbc-gradient/);
  });
});

describe('burn-in', () => {
  it('drifts with a transform, never a layout property', () => {
    // A layout-affecting drift re-lays out the entire board every 90 seconds
    // for eight hours.
    expect(CSS).toMatch(/transform:\s*translate3d\(var\(--lbc-drift-x/);
    const driftRules = CSS.match(/(top|left|right|bottom|margin[\w-]*):\s*[^;]*--lbc-drift/g) ?? [];
    expect(driftRules).toEqual([]);
  });

  it('uses co-prime periods so the two orbits never coincide', () => {
    const root = Number(/DRIFT_ROOT_MS = ([\d_]+)/.exec(ISLAND)?.[1].replace(/_/g, ''));
    const glyph = Number(/DRIFT_GLYPH_MS = ([\d_]+)/.exec(ISLAND)?.[1].replace(/_/g, ''));
    expect(root).toBeGreaterThan(0);
    expect(glyph).toBeGreaterThan(0);
    expect(glyph).not.toBe(root);
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    // Their least common multiple must be long enough that the paths do not
    // realign within a session.
    expect((root * glyph) / gcd(root, glyph)).toBeGreaterThan(60 * 60 * 1000);
  });

  it('keeps the drift OUT of prefers-reduced-motion', () => {
    // It is sub-perceptual hardware protection, not decoration. Disabling it
    // would leave a static image on a panel for eight hours.
    const rm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion'));
    expect(rm).not.toMatch(/--lbc-drift/);
  });
});

describe('the red-zone banner', () => {
  it('is never animated beyond its entrance', () => {
    // A persistent flasher for a whole drive is intolerable to sit in front
    // of, and anything near 3 Hz is a photosensitivity hazard.
    const block = /\.lbc__redzone\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(block).toMatch(/animation:\s*lbc-rz-in/);
    expect(block).not.toMatch(/infinite/);
    // The only keyframes it may reference run once.
    // Capture only THIS keyframes block — `[^@]*` runs to the next at-rule and
    // would swallow the pulse animation, which legitimately loops.
    const rz = /@keyframes lbc-rz-in\s*\{(?:[^{}]|\{[^{}]*\})*\}/.exec(CSS)?.[0] ?? '';
    expect(rz).toBeTruthy();
    expect(rz).not.toMatch(/infinite/);
  });

  it('sits above the stage layer', () => {
    const stageZ = Number(/\.lbc__stage\s*\{[^}]*z-index:\s*(\d+)/.exec(CSS)?.[1]);
    const rzZ = Number(/\.lbc__redzone\s*\{[^}]*z-index:\s*(\d+)/.exec(CSS)?.[1]);
    expect(rzZ).toBeGreaterThan(stageZ);
  });
});

describe('reduced motion kills all three motion sources', () => {
  it('covers keyframes, the strip transition and the reveal repaint', () => {
    // Killing @keyframes alone leaves the page transition and the gradient
    // repaint moving — the playoffs shimmer shipped exactly that way.
    const rm = CSS.slice(CSS.indexOf('@media (prefers-reduced-motion'));
    expect(rm).toMatch(/\.lbc__page/);
    expect(rm).toMatch(/\.lbc-reveal/);
    expect(rm).toMatch(/\.lbc__strip/);
    expect(rm).toMatch(/transition:\s*none/);
    expect(rm).toMatch(/animation:\s*none/);
  });
});

describe('the layer stack', () => {
  it('hides the strip on `strip` or `all`, and the header only on `all`', () => {
    // The lower third must COEXIST with the scoreboard — an opponent's score
    // is not worth taking the board away for.
    expect(ISLAND).toMatch(/hidden=\{occludes === 'all'\}/);
    expect(ISLAND).toMatch(/hidden=\{occludes !== 'none'\}/);
  });

  it('gives the lower third occludes:none and the takeover occludes:strip', () => {
    expect(ISLAND).toMatch(/kind: 'takeover'[^;]*occludes: 'strip'/);
    expect(ISLAND).toMatch(/kind: 'lower-third'[^;]*occludes: 'none'/);
  });

  it('puts no in-transition on the stage layer', () => {
    // Two curves of the same length compound to their square and the layer
    // beneath dips toward black at the midpoint of every reveal.
    const block = /\.lbc__stage\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(block).not.toMatch(/transition:\s*opacity/);
  });
});

describe('the reveal variants differ in more than wording', () => {
  it('differs in area, colour treatment and motion — not just copy', () => {
    // An owner reads this from ten feet with the real game on the other
    // television. A variant that differs only in a word is not a variant.
    const takeover = read('src/components/shared/live-broadcast/MomentTakeover.tsx');
    const third = read('src/components/shared/live-broadcast/MomentLowerThird.tsx');

    // 1. Area: the takeover fills, the third is a band.
    expect(CSS).toMatch(/\.lbc__stage--takeover\s*\{\s*inset:\s*var\(--lbc-header-h\)/);
    expect(CSS).toMatch(/\.lbc__stage--lower-third\s*\{[^}]*height:\s*26vh/);

    // 2. Colour: a FIELD for mine, a hairline rule for theirs.
    expect(takeover).toMatch(/--lbc-gradient|lbc-reveal/);
    expect(/\.lbc-third\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '').toMatch(/border-top:[^;]*--lbc-primary/);
    expect(/\.lbc-third\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '').not.toMatch(/background-image/);

    // 3. Motion: scale-in vs slide-up.
    expect(CSS).toMatch(/@keyframes lbc-reveal-in/);
    expect(CSS).toMatch(/@keyframes lbc-third-in/);

    // 4. Kicker wording, as the redundant fourth channel — never the only one.
    expect(third).toMatch(/Against you/);
  });
});

describe('the fixes that a scan is the only thing holding', () => {
  const STRIP = code(read('src/components/shared/live-broadcast/BroadcastPlayerStrip.tsx'));
  const BANNER = code(read('src/components/shared/live-broadcast/RedZoneBanner.tsx'));
  const BOARD = code(read('src/utils/broadcast-board.ts'));

  it('passes `inert` as a real boolean', () => {
    // React treats `inert=""` as FALSE and logs a warning, so the empty-string
    // spelling silently never applied and the occluded layer stayed in the
    // a11y tree for the whole 930ms visibility delay.
    expect(HEADER).toMatch(/inert=\{hidden\}/);
    expect(HEADER).not.toMatch(/inert:\s*''/);
    expect(STRIP).not.toMatch(/inert:\s*''/);
  });

  it('renders the clock element its own drop ladder targets', () => {
    // `.lbc__gameclock` had a drop rung and no producer, so rung 4 of 6
    // dropped nothing and the header carried no clock at all.
    expect(HEADER).toMatch(/lbc__gameclock/);
    expect(CSS).toMatch(/\.lbc__gameclock/);
  });

  it('paints marks with the SWATCH and fields with the primary', () => {
    // Two different legibility problems: a 0.7vh bar on `--lbc-panel` and a
    // full-screen field on the darker ground. `toBroadcastPair` only darkens,
    // so it can make a colour safe to write on but never visible.
    expect(HEADER).toMatch(/--lbc-mine'.*\]:\s*matchup\.mine\.swatch/s);
    expect(BOARD).toMatch(/ensureFieldOn/);
    expect(BOARD).toMatch(/ensureContrastOn/);
  });

  it('resolves a franchise gradient and a real second stop', () => {
    // `toBroadcastPair(primary, primary)` made every "gradient" a flat field,
    // and a franchise declaring its own look never got it.
    expect(BOARD).toMatch(/resolveBroadcastGradient/);
    expect(BOARD).not.toMatch(/toBroadcastPair\(\s*rawPrimary,\s*rawPrimary\s*\)/);
  });

  it('mounts BOTH pages during a strip handoff', () => {
    // A transition never runs on mount, so a single swapped page lands at its
    // final state and every rotation is a hard cut.
    expect(STRIP).toMatch(/outgoing/);
    expect(CSS).toMatch(/@keyframes lbc-page-in/);
  });

  it('keeps the red-zone banner out of the live region', () => {
    // Its text carries down & distance, which changes every play — a live
    // region re-read the whole banner every few seconds for a whole drive.
    expect(BANNER).not.toMatch(/aria-live/);
    expect(BANNER).toMatch(/aria-hidden/);
  });

  it('never prints a score for a league whose feed it could not read', () => {
    // `0.0` is a real score. Printing it for a failed read says "nobody has
    // scored yet" — the same "no games" / "couldn't read it" merge the whole
    // live-scoring rule set exists to prevent, and on this board a dimmed
    // panel of zeros is exactly what a pre-kickoff Sunday morning looks like.
    expect(HEADER).toMatch(/const score = /);
    expect(HEADER).toMatch(/readable/);
    // The scores, the projections, the bar, the percentage and the leading
    // emphasis are ALL assertions about numbers we do not have.
    expect(HEADER).toMatch(/lbc__score">\{score\(/);
    expect(HEADER).toMatch(/matchup\.opponent && readable &&/);
    expect(HEADER).toMatch(/readable && mineLive >= theirsLive/);
    // And it says so, rather than only going quiet.
    expect(HEADER).toMatch(/Feed unavailable/);
  });

  it('gives the board a document shell, so it has a font and a title', () => {
    // Rendered bare, the whole board fell back to the UA serif — which has no
    // `tabular-nums`, so every score would jitter its column width on a tick —
    // with no lang and no title.
    expect(PAGE_CODE).toMatch(/TheLeagueLayout/);
    expect(CSS).toMatch(/font-family:/);
  });
});

describe('nothing is sized against a box it does not live in', () => {
  // The whole family of clipping bugs had ONE cause: children sized in
  // viewport units inside boxes whose height comes from flex or grid division.
  // A row's height is a function of the viewport AND the row count AND the
  // header's tier, so `vh` cannot express it — an 81px avatar landed in a 66px
  // row, and a 97px score in a cell the grid had given 230px for two of them.
  it('makes the cell and the row their own size containers', () => {
    for (const sel of ['lbc__cell', 'lbc__row']) {
      // Anchored to the start of a line: an unanchored `.lbc__cell` also
      // matches `.lbc__cells[data-games='2'] .lbc__cell + .lbc__cell`, and
      // reads that rule's body instead of the one being asserted about.
      const block = new RegExp(`^\\.${sel}\\s*\\{([^}]*)\\}`, 'm').exec(CSS)?.[1] ?? '';
      expect(block, `.${sel} must be a size container`).toMatch(/container-type:\s*size/);
    }
  });

  it('sizes the score against the cell in BOTH axes', () => {
    // Height alone is not enough: a short-but-narrow doubleheader cell let the
    // numerals and the projection eat the team NAME down to nothing.
    const rule = /\.lbc__score \{ font-size: ([^;]*);/.exec(CSS)?.[1] ?? '';
    expect(rule).toMatch(/cqh/);
    expect(rule).toMatch(/cqw/);
  });

  it('gives the team name a width floor', () => {
    // It is the only thing on the row that says whose score this is, so it is
    // the last thing that may give up width. The floor lives on the identity
    // COLUMN (`.lbc__who`) now that the yet-to-play count is stacked under the
    // name — it has to be on whichever box the row's flex layout shrinks, and
    // that is the column, not the text inside it.
    const column = /\.lbc__who\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(column).toMatch(/min-width:\s*\d+%/);
    // And the name itself still clips rather than wrapping: a second line in
    // that column is height the cell does not have.
    const name = /\.lbc__tn\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(name).toMatch(/white-space:\s*nowrap/);
    expect(name).toMatch(/text-overflow:\s*ellipsis/);
  });

  it('gives the row’s slack to the NAME, not to the gap before the numerals', () => {
    // `margin-left: auto` on the projection absorbed every spare pixel, so the
    // name sat pinned at its floor with an inch of empty blue in front of the
    // numerals — "Dangsters" rendering as "Dangst…" on a cell that had the
    // room for it (owner, 2026-09-13).
    const column = /\.lbc__who\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(column, 'the identity column must be the one that grows').toMatch(/flex:\s*1\s/);
    const proj = /\.lbc__proj\s*\{([^}]*)\}/.exec(CSS)?.[1] ?? '';
    expect(proj).not.toMatch(/margin-left:\s*auto/);
  });

  it('zeroes the UA paragraph margin', () => {
    // Every label here is a <p>, and `margin: 1em 0` on a 22px tag is 44px of
    // invisible margin inside a ~210px cell — which is what pushed the cell
    // foot out of the bottom even after the type had been sized to fit.
    expect(CSS).toMatch(/\.lbc p[\s\S]{0,40}\{\s*margin:\s*0/);
  });

  it('stacks the panels on a phone by reaching the GRID, not the header', () => {
    // The grid moved onto `.lbc__panels` and the header became a flex column,
    // so a `grid-template-columns` declaration on `.lbc__header` is silently
    // inert — and the symptom is not a broken-looking selector, it is a phone
    // keeping the desktop's 2/3/4 columns inside a 55%-height header.
    const phone = /@media \(max-width: 900px\) \{([\s\S]*?)\n\}/.exec(CSS_CODE)?.[1] ?? '';
    expect(phone).toMatch(/\.lbc__header\[data-tier='2'\] \.lbc__panels/);
    expect(phone).not.toMatch(/\.lbc__header\[data-tier='\d'\],?\s*\n?\s*\{?\s*grid-template-columns/);
  });

  it('lays the header out by PANEL count, not by the type tier', () => {
    // They are different counts. One league on a doubleheader week is one
    // panel and two cells; keying the columns on the tier left half a 1080p
    // screen empty. The grid moved onto `.lbc__panels` when the compact
    // overflow row joined the header — `data-panels` moved with the grid it
    // describes, and must never be read off the header again.
    expect(CSS).toMatch(/\.lbc__panels\[data-panels='1'\]/);
    expect(CSS).not.toMatch(/\.lbc__header\[data-panels=/);
    expect(CSS).not.toMatch(/\.lbc__(header|panels)\[data-tier='\d'\] \{ grid-template-columns/);
    expect(HEADER).toMatch(/className="lbc__panels" data-panels=/);
  });

  it('keeps the header a fixed-height column the grid can flex inside', () => {
    // The grid's rows are declared EXPLICITLY so a panel cannot grow past the
    // header's height and paint over the strip (header z-index 1, strip 0).
    // That is exactly why the overflow row could not be a ninth grid child:
    // it would land in an implicit `auto` row and reintroduce the bug the
    // explicit rows exist to prevent.
    const header = /^\.lbc__header \{([\s\S]*?)\n\}/m.exec(CSS_CODE)?.[1] ?? '';
    expect(header).toMatch(/display:\s*flex/);
    expect(header).toMatch(/flex-direction:\s*column/);
    expect(header).toMatch(/height:\s*var\(--lbc-header-h\)/);
    const panels = /^\.lbc__panels \{([\s\S]*?)\n\}/m.exec(CSS_CODE)?.[1] ?? '';
    expect(panels).toMatch(/display:\s*grid/);
    expect(panels).toMatch(/flex:\s*1/);
    expect(panels).toMatch(/min-height:\s*0/);
    // Every panel-count variant still declares BOTH tracks.
    for (const n of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const rule = new RegExp(`\\.lbc__panels\\[data-panels='${n}'\\]`);
      expect(CSS_CODE, `data-panels='${n}' must be laid out`).toMatch(rule);
    }
  });

  it('escapes the layout column so a television is not boxed into 1232px', () => {
    const block = /^\.lbc \{([\s\S]*?)\n\}/m.exec(CSS)?.[1] ?? '';
    expect(block).toMatch(/width:\s*100vw/);
    expect(block).toMatch(/margin-left:\s*calc\(50% - 50vw\)/);
  });
});

describe('the league picker is reachable', () => {
  it('does not gate the picker on having ZERO leagues enabled', () => {
    // It used to render only when `enabled.length === 0`. The two
    // full-management leagues are on by default, so that branch never ran for
    // a real owner — which made Best Ball and every outside league "opt-in"
    // through a screen there was no way to reach, i.e. not opt-in at all.
    expect(PAGE_CODE).toMatch(/wantsPicker/);
    expect(PAGE_CODE).toMatch(/picker'\) === '1'/);
    // The board branch must key on the picker flag, not on the league count.
    expect(PAGE_CODE).not.toMatch(/board\.enabled\.length === 0 \? \(/);
  });

  it('offers a way in from the board and a way back out', () => {
    // Still reachable FROM the board — but by the `L` key, not a chip. The
    // board carries no visible controls at all (see "the board carries NO
    // controls"), and a setup screen with no way back to it would be the
    // unreachable-opt-in bug above, reintroduced by the fix for a different
    // one.
    expect(ISLAND_CODE).toMatch(/picker=1/);
    expect(ISLAND_CODE).toMatch(/key === 'l'/);
    expect(PAGE_CODE).toMatch(/doneHref/);
  });

  it('lists every league the owner is in, not just the enabled ones', () => {
    // The whole point of the screen is turning ON something that is off.
    expect(PAGE_CODE).toMatch(/board\.leagues\.map/);
  });
});

describe('the page never fetches its own API', () => {
  it('assembles the board in process', () => {
    // A server that already knows the league's registry host has nothing to
    // gain by asking its own edge over the public internet for what it can
    // read directly — and that hop has silently stopped landing once already.
    expect(PAGE_CODE).toMatch(/assembleBroadcastBoard/);
    expect(PAGE_CODE).not.toMatch(/fetch\(/);
    expect(PAGE_CODE).not.toMatch(/\/api\/broadcast-live/);
  });

  it('leaves the polling to the island', () => {
    expect(ISLAND).toMatch(/\/api\/broadcast-live/);
  });
});

describe('the routes own the gate and the cookie', () => {
  it('redirects from the PAGE, never from the shared component', () => {
    // `Astro.redirect()` from a component's frontmatter merely stops rendering
    // it — the response is still a 200 with a blank body.
    for (const [path, src] of ROUTES) {
      expect(src, `${path} must gate`).toMatch(/getAuthUser/);
      expect(src, `${path} must redirect`).toMatch(/Astro\.redirect/);
    }
    expect(PAGE_CODE).not.toMatch(/Astro\.redirect/);
  });

  it('sends each league’s visitor to its OWN login', () => {
    // A correct href still bounces a user cross-league if the gate redirects
    // to the other league's sign-in.
    const [[, theleague], [, afl]] = ROUTES;
    expect(theleague).toMatch(/\/theleague\/login/);
    expect(theleague).not.toMatch(/\/afl-fantasy\/login/);
    expect(afl).toMatch(/\/afl-fantasy\/login/);
    expect(afl).not.toMatch(/\/theleague\/login/);
  });

  it('writes cookies only from the route', () => {
    // `Astro.cookies.set()` from an imported component runs after the headers
    // are committed and throws, blanking the page.
    for (const [path, src] of ROUTES) {
      expect(src, `${path} must remember choices`).toMatch(/rememberBroadcastChoices/);
    }
    expect(PAGE_CODE).not.toMatch(/cookies\.set/);
  });
});

describe('the island', () => {
  it('gates on the ok FLAG, not on the presence of a field', () => {
    // `res.ok` is not "the data is good" and `{}` is truthy: the route answers
    // 200 with ok:false and empty collections when MFL fails.
    expect(ISLAND).toMatch(/body\?\.ok === false/);
  });

  it('keeps the last good data when a poll fails', () => {
    // "The feed says nothing" and "we could not reach the feed" are different
    // facts all the way to the pixels.
    const cat = /catch \{[\s\S]*?setStatus\('error'\)/.exec(ISLAND_CODE)?.[0] ?? '';
    expect(cat).toBeTruthy();
    expect(cat).not.toMatch(/setPoll\(/);
  });

  it('carries both a fetch timeout and an independent watchdog', () => {
    // The loop is a self-chaining timeout, so a hung fetch does not delay the
    // chain — it breaks it, and the board freezes with no sign anything is
    // wrong. That froze the 2026 draft rehearsal board at pick 7.
    expect(ISLAND).toMatch(/AbortSignal\.timeout\(POLL_TIMEOUT_MS\)/);
    expect(ISLAND).toMatch(/POLL_WATCHDOG_MS/);
    expect(ISLAND).toMatch(/setInterval/);
  });

  it('hydrates exactly one island, on load', () => {
    // The TV is opened and walked away from: client:idle can be minutes and
    // client:visible is meaningless at full viewport. A second island would
    // mean two clocks and two queues.
    const directives = PAGE_CODE.match(/client:\w+/g) ?? [];
    expect(directives).toEqual(['client:load']);
  });
});

describe('the board is on one clock, both halves', () => {
  const ROUTE = code(read('src/pages/api/broadcast-live.ts'));

  it('resolves the season year from ?testDate=, on the page AND the poll', () => {
    // /rollover-check cannot exercise a page that reads the wall clock, and
    // the Labor Day boundary is where this board's season year turns.
    expect(PAGE_CODE).toMatch(/getTestDateFromSearchParams\(Astro\.url\.searchParams\)/);
    expect(PAGE_CODE).toMatch(/getCurrentSeasonYear\(testDate\)/);
    expect(ROUTE).toMatch(/getTestDateFromSearchParams\(url\.searchParams\)/);
    expect(ROUTE).toMatch(/getCurrentSeasonYear\(testDate\)/);
  });

  it('forwards ?testDate= from the island, or the poll never sees it', () => {
    // The server reads the parameter off the POLL's request, not the page's.
    expect(ISLAND_CODE).toMatch(/params\.set\('testDate'/);
  });

  it('derives the default week from the same date as the year', () => {
    expect(PAGE_CODE).toMatch(/getCurrentNFLWeek\(testDate \?\? new Date\(\)\)/);
    expect(ROUTE).toMatch(/getCurrentNFLWeek\(testDate \?\? new Date\(\)\)/);
  });

  it('clamps the page week to the same 1-25 the poll enforces', () => {
    // Unclamped, ?week=26 rendered an MFL board and then took 400s from the
    // island forever — the two halves of the screen silently diverging.
    expect(PAGE_CODE).toMatch(/parsedWeek >= 1 && parsedWeek <= 25/);
  });
});

describe('the screensaver shows the whole week', () => {
  const SAVER = code(read('src/components/shared/live-broadcast/BroadcastScreensaver.tsx'));

  it('renders every matchup, not just the first', () => {
    // A doubleheader is two real games against two different opponents, and
    // this is the screen that says where the day ended.
    expect(SAVER).not.toMatch(/panel\.matchups\[0\]/);
    expect(SAVER).toMatch(/panel\.matchups\.map\(/);
  });
});

describe('crest artwork', () => {
  const BOARD = code(read('src/utils/broadcast-board.ts'));
  const TAKEOVER = code(read('src/components/shared/live-broadcast/MomentTakeover.tsx'));

  it('resolves the two crests through the shared resolver', () => {
    // Both fields were the same ~100px `brand.icon` until Sep 2026, so the
    // takeover's 68vh background crest was that icon upscaled 7x.
    expect(BOARD).toMatch(/resolveBroadcastCrest\(/);
  });

  it('gives the BIG surface higher-resolution art than the small one', () => {
    // Behavioural, not a scan: the regression was two fields holding the same
    // string, which no amount of reading the call site reveals. The hand cuts
    // under icons/ are 100x100 and the GroupMe art is 400x400, so at 68vh
    // (~734px) the difference is a 7x upscale against a 1.8x one.
    for (const slug of ['theleague', 'afl-fantasy']) {
      const teams = getLeagueTeamConfigs(slug);
      expect(teams.length).toBeGreaterThan(0);
      const index = broadcastStrokeIndex(crestLeagueKey(slug), teams);
      for (const team of teams) {
        const crest = resolveBroadcastCrest({ ...team }, crestLeagueKey(slug), index);
        if (!crest.icon) continue;
        expect(crest.icon).not.toMatch(/\/icons\//);
      }
    }
  });

  it('keys the manifest by league KEY, never the route directory', () => {
    // `afl-fantasy` finds no measured stroke at all, silently.
    expect(BOARD).toMatch(/crestLeagueKey\(slug\)/);
  });

  it('paints the reveal with the BIG crest', () => {
    expect(TAKEOVER).toMatch(/src=\{team\.icon\}/);
    expect(TAKEOVER).not.toMatch(/lbc-reveal__crest[\s\S]{0,120}team\.iconSmall/);
  });
});

describe('every crest surface can actually draw its ring', () => {
  const STRIP = code(read('src/components/shared/live-broadcast/BroadcastPlayerStrip.tsx'));
  const LAYOUT = code(read('src/utils/broadcast-layout.ts'));

  it('carries the stroke onto the player strip', () => {
    // The strip is the crest surface visible most of the afternoon, so a
    // light franchise cut with no ring is the failure showing the longest.
    expect(LAYOUT).toMatch(/crestStroke/);
    // The class moved onto the always-present wrapper slot, so assert what
    // actually matters: the row's stroke reaches `crestStrokeProps` at all.
    expect(STRIP).toMatch(/crestStrokeProps\([^)]*row\.crestStroke[^)]*'lbc'\)/);
  });

  it('sets a ring WIDTH on every surface that asks for a ring', () => {
    // The shared rule falls back to 0.5px, which is sub-pixel on anything
    // bigger than a rail icon: the ring is applied and buys nothing.
    for (const surface of ['.lbc-reveal__crest', '.lbc-third__crest']) {
      const block = CSS_CODE.slice(CSS_CODE.indexOf(surface));
      const decl = block.slice(0, block.indexOf('}'));
      expect(decl).toMatch(/--lbc-crest-ring-w:/);
    }
  });
});

describe('the player cell follows the repo’s rules', () => {
  const STRIP = code(read('src/components/shared/live-broadcast/BroadcastPlayerStrip.tsx'));

  it('hides the meta-row NFL logo for a team defense', () => {
    // `BroadcastFace` opts a DEF unit into its NFL logo AS the face ("a team
    // defense is a crest, not a person"), so rendering it again in the meta
    // line is the same club's mark twice on one row, a few pixels apart.
    // `LiveScoreboard` has suppressed this since the shared PlayerCell did —
    // this row is the surface that forgot to, and it shipped.
    expect(STRIP).toMatch(/position\.toUpperCase\(\) !== 'DEF'/);
  });
});

describe('the board carries NO controls', () => {
  // Three separate attempts shipped the Leagues / Sound / Fullscreen chips
  // visible on a real television, because all three hid a VISIBLE DEFAULT
  // conditionally and every condition turned out to be an assumption about
  // set-top hardware:
  //
  //   1. `opacity: 0` sat inside `@media (hover: hover) and (pointer: fine)`,
  //      so a coarse-pointer TV never received it at all.
  //   2. On a fine-pointer TV, `.lbc:hover .lbc__chrome` re-showed them
  //      permanently — the cursor is PARKED on the page and never leaves, so
  //      `:hover` is true for the whole afternoon.
  //   3. `.lbc.is-idle` needed a JS timer armed by an interaction a remote may
  //      never deliver to the page.
  //
  // The controls are on the setup screen now. These guards pin the absence,
  // because "hidden" is the state that kept failing and "not there" cannot.

  it('renders no chrome element at all', () => {
    expect(ISLAND_CODE).not.toMatch(/className="lbc__chrome"/);
    expect(ISLAND_CODE).not.toMatch(/lbc__chrome-link/);
  });

  it('styles no chrome, and carries no :hover reveal anywhere', () => {
    expect(CSS_CODE).not.toMatch(/\.lbc__chrome/);
    // The parked-cursor trap. No rule on the BOARD may key off `:hover` — on
    // the one screen this page exists for the cursor is parked and `:hover` is
    // true all afternoon, which is how the second attempt at hiding chrome
    // shipped it permanently visible. The toolbar above the board is exempt
    // and only the toolbar: it is a page element read from a desk, its hover
    // state changes a text colour rather than revealing anything, and it is
    // not on the screen the trap is about.
    const boardCode = CSS_CODE.replace(/^\.lbc-bar[^{]*\{[^}]*\}/gm, '');
    expect(boardCode).not.toMatch(/\.lbc[^{,]*:hover/);
    // Whatever the toolbar does on hover, it may not be a REVEAL.
    const barHover = (CSS_CODE.match(/^\.lbc-bar[^{]*:hover[^{]*\{[^}]*\}/gm) ?? []).join('\n');
    expect(barHover).not.toMatch(/opacity|visibility|display/);
  });

  describe('the ONE exception: the overflow row’s toggle', () => {
    // It is on the board, and that is deliberate — the keys above are
    // unreachable on an Xbox browser, which has no keyboard. These guards pin
    // the property that makes it different from the three that failed: it is
    // UNCONDITIONAL. Not a visible default plus a condition meant to hide it,
    // which is the shape that shipped chrome onto a real television three
    // times for three different reasons.

    it('renders whenever there is something to toggle, and not otherwise', () => {
      // The ROW is gated on `hasExtras`, never on `compact.length > 0`:
      // expanding usually empties `compact`, so keying the row on it would
      // delete the control the moment it was used. (The LIST inside the row is
      // gated on `compact.length` — correctly, since past MAX_GRID_PANELS the
      // row still carries leagues while expanded.)
      expect(HEADER).toMatch(/\{hasExtras && \(/);
      const row = /\{hasExtras && \([\s\S]*?aria-expanded=\{expanded\}/.exec(HEADER)?.[0] ?? '';
      expect(row).not.toBe('');
      expect(row).not.toMatch(/\{!expanded && \(\s*<div/);
      // A real button with a real state, not a div with a click handler.
      expect(HEADER).toMatch(/<button[\s\S]{0,200}lbc__extras-toggle/);
      expect(HEADER).toMatch(/aria-expanded=\{expanded\}/);
    });

    it('is never hidden, dimmed to nothing, or positioned over the scores', () => {
      // Every rule whose selector names the overflow row — comments already
      // stripped, so this is the code and not the prose describing the trap.
      const extras = (CSS_CODE.match(/^\.lbc__extra[^{]*\{[^}]*\}/gm) ?? []).join('\n');
      expect(extras).toMatch(/\.lbc__extras \{/);
      // The three failures, mechanically: an opacity hide, a hover reveal, a
      // hover-capability media query, an idle class, or a `visibility` flip.
      expect(extras).not.toMatch(/opacity:\s*0\b/);
      expect(extras).not.toMatch(/visibility:\s*hidden/);
      expect(extras).not.toMatch(/:hover/);
      expect(extras).not.toMatch(/is-awake|is-idle/);
      // In FLOW, under the panels — never absolute/fixed over them. "Above the
      // scores" and "hidden over the scores" are different fixes and only the
      // first is true whatever the hardware reports.
      expect(extras).not.toMatch(/position:\s*(absolute|fixed|sticky)/);
      expect(extras).toMatch(/flex:\s*0 0 auto/);
      // A FIXED height, so a feed coming or going does not re-scale the panel
      // grid inside a fixed-height header.
      expect(extras).toMatch(/height:\s*[\d.]+vh/);
    });

    it('is sized for a thumbstick, not a mouse', () => {
      // An Xbox pointer is nudged with a stick; a 2vh chip is not a target you
      // can land on from a couch. The toggle takes the row's full height.
      const rule = /\.lbc__extras-toggle \{([\s\S]*?)\n\}/.exec(CSS_CODE)?.[1] ?? '';
      expect(rule).toMatch(/height:\s*100%/);
      // Focus is visible for a remote too — `:focus-visible` alone leaves a
      // set-top browser that does not support it with no ring at all.
      expect(CSS_CODE).toMatch(/\.lbc__extras-toggle:focus \{[^}]*outline:/);
    });

    it('starts COLLAPSED and is not remembered', () => {
      // A television that came back from a power cut showing six squeezed
      // panels because of a click three Sundays ago is the failure the split
      // exists to fix.
      expect(ISLAND_CODE).toMatch(/useState\(false\)/);
      expect(ISLAND_CODE).not.toMatch(/bc_extras/);
    });

    it('sizes the type off the FEATURED cells, not every enabled league', () => {
      // Demoting a league to the compact row buys the panels above it nothing
      // unless the tier stops counting it.
      expect(ISLAND_CODE).toMatch(/densityTier\(countCells\(featured\)\)/);
    });

    it('keeps the memo bailout intact across the 1 Hz heartbeat', () => {
      // The header is memo'd because the island ticks once a second to age the
      // freshness pill. A fresh array or a fresh arrow function in its props
      // breaks that bailout on every tick — ~28,800 re-renders over a Sunday,
      // on set-top hardware. Both shelves come straight off a memoised split,
      // so their identities are stable between ticks.
      expect(ISLAND_CODE).toMatch(/const base = useMemo\(\(\) => splitPanels/);
      expect(ISLAND_CODE).toMatch(/const expanded = useMemo\(/);
      expect(ISLAND_CODE).toMatch(/const \{ featured, compact \} = extrasOpen \? expanded : base;/);
      expect(ISLAND_CODE).toMatch(/const toggleExtras = useCallback/);
    });

    it('never hands the grid more panels than the stylesheet can place', () => {
      // The grid declares one through eight and stops; the rows are explicit
      // so a panel cannot grow past the fixed header height, which means a
      // ninth panel lands in an implicit row inside an `overflow: hidden` box
      // and is not drawn. "Show more leagues" that silently drops the ninth is
      // the failure — it stays on the compact row instead.
      const panels = (n: number) =>
        Array.from({ length: n }, (_, i) => ({
          leagueId: `l${i}`,
          leagueName: `League ${i}`,
          slug: '',
          franchiseId: '0001',
          home: false,
          matchups: [],
          status: 'no-matchup' as const,
        }));
      const split = splitPanels(panels(12), Number.POSITIVE_INFINITY);
      expect(split.featured).toHaveLength(MAX_GRID_PANELS);
      expect(split.compact).toHaveLength(4);
      // And the label does not promise what the layout cannot keep.
      expect(HEADER).toMatch(/'Show more leagues'/);
      expect(HEADER).not.toMatch(/'Show all leagues'/);
    });
  });

  it('offers leagues and sound off the board instead', () => {
    // Removing a control is only correct if it still exists somewhere.
    expect(CONTROLS_CODE).toMatch(/lbc-sound-toggle/);
    expect(CONTROLS_CODE).toMatch(/lbc-setup__chip/);
    for (const k of ['F', 'M', 'L']) {
      expect(CONTROLS).toMatch(new RegExp(`<kbd>${k}</kbd>`));
    }
  });

  it('places the toolbar ABOVE the board, in flow, never over it', () => {
    // "Above the board" and "hidden on the board" are not the same fix, and
    // only the first one is true no matter what the hardware reports. The
    // toolbar must render BEFORE <LiveBroadcast> and must not be positioned.
    const strip = PAGE_CODE.indexOf('variant="strip"');
    const board = PAGE_CODE.indexOf('<LiveBroadcast');
    expect(strip).toBeGreaterThan(-1);
    expect(board).toBeGreaterThan(-1);
    expect(strip).toBeLessThan(board);

    const rule = /^\.lbc-bar \{([^}]*)\}/m.exec(CSS_CODE)?.[1] ?? '';
    expect(rule).not.toBe('');
    expect(rule).not.toMatch(/position:\s*(absolute|fixed|sticky)/);
  });

  it('builds ONE controls component, not a copy per placement', () => {
    // Two near-identical copies is how this repo grew 24 forked siblings.
    expect(PAGE_CODE).toMatch(/BroadcastControls/);
    expect((PAGE_CODE.match(/lbc-setup__chip/g) ?? []).length).toBe(0);
  });

  it('writes the sound cookie from the CLIENT, never Astro.cookies.set', () => {
    // These are shared components, not routes. `Astro.cookies.set()` here runs
    // after the response headers are committed and blanks the page — CLAUDE.md
    // records the Sunday Ticket board shipping exactly that.
    expect(CONTROLS_CODE).not.toMatch(/Astro\.cookies\.set/);
    expect(PAGE_CODE).not.toMatch(/Astro\.cookies\.set/);
    expect(CONTROLS_CODE).toMatch(/document\.cookie/);
  });

  it('initialises the toggle immediately AND on astro:page-load', () => {
    // Both, and neither is redundant. A bundled Astro script is a deferred
    // module, so on a COLD load `astro:page-load` can already have fired by
    // the time it evaluates — listening only for the event left the button
    // inert, which is how it first shipped. And under the ClientRouter the
    // module evaluates once per SESSION, so a one-shot init is dead after the
    // first in-site navigation.
    expect(CONTROLS_CODE).toMatch(/astro:page-load/);
    expect(CONTROLS_CODE).not.toMatch(/DOMContentLoaded/);
    expect(CONTROLS_CODE).toMatch(/^\s*initBroadcastSoundToggle\(\);\s*$/m);
    // Assigned, not added: re-running init must replace the handler, never
    // stack a second copy that fires the toggle twice.
    expect(CONTROLS_CODE).toMatch(/btn\.onclick = /);
  });

  it('reaches the board from the strip without a reload', () => {
    // The strip and the board are on the same page. A toggle that only wrote
    // the cookie would do nothing until a reload, which on a television is
    // never.
    expect(CONTROLS_CODE).toMatch(/lbc:sound/);
    expect(ISLAND_CODE).toMatch(/lbc:sound/);
  });

  it('reaches fullscreen and sound by key, since the board carries no chip', () => {
    // A keypress carries transient activation, which is what lets `F` request
    // fullscreen at all — fullscreen does not survive the navigation from the
    // setup screen, so it has to be asked for from inside this document.
    expect(ISLAND_CODE).toMatch(/requestFullscreen/);
    expect(ISLAND_CODE).toMatch(/key === 'f'/);
    expect(ISLAND_CODE).toMatch(/key === 'm'/);
  });

  it('also reaches fullscreen by BUTTON, for hardware with no keyboard', () => {
    // The keys above are unreachable on the screen this board was built for:
    // an Xbox browser has no keyboard, so `F` is not a fallback there, it is
    // nothing. The button lives on the STRIP (a click carries the same
    // transient activation a keypress does) and the board stays output-only.
    expect(CONTROLS_CODE).toMatch(/lbc-fullscreen-toggle/);
    expect(CONTROLS_CODE).toMatch(/requestFullscreen/);
    // Assigned, not added — re-running init must not stack a second handler
    // that enters fullscreen and immediately leaves it.
    expect(CONTROLS_CODE).toMatch(/btn\.onclick = /);
  });

  it('fullscreens the BOARD, never the document element', () => {
    // Fullscreening the document takes the site nav and this very strip with
    // it — the centred 1232px layout is what the board exists to escape.
    expect(CONTROLS_CODE).toMatch(/querySelector\('\.lbc\.is-board'\)/);
    expect(CONTROLS_CODE).not.toMatch(/documentElement[\s\S]{0,40}\.call\(/);
  });

  it('hides the fullscreen button only where the API does not exist', () => {
    // It ships `hidden` and reveals ITSELF once it has found an API to call:
    // a browser with no Fullscreen API shows nothing rather than a control
    // that silently does nothing, which on a television is indistinguishable
    // from the board being broken. The support check is against the DOCUMENT
    // element — support is a property of the browser — while the board is
    // looked up inside the click, because this strip is server-rendered above
    // a client:load island and the ClientRouter replaces that node.
    expect(CONTROLS_CODE).toMatch(/id="lbc-fullscreen-toggle" hidden/);
    expect(CONTROLS_CODE).toMatch(/requestFn\(document\.documentElement/);
    expect(CONTROLS_CODE).toMatch(/btn\.hidden = false/);
  });

  it('carries every fullscreen prefix all the way through', () => {
    // A prefix advertised in the REQUEST but missing from the state property
    // or the change event is worse than not supporting it: the button reveals
    // itself, enters fullscreen, then can neither report it nor leave it.
    // Xbox's older EdgeHTML browser is an `ms`-prefixed engine, which is the
    // hardware this button exists for.
    for (const [req, state, ev] of [
      ['requestFullscreen', 'fullscreenElement', "'fullscreenchange'"],
      ['webkitRequestFullscreen', 'webkitFullscreenElement', "'webkitfullscreenchange'"],
      ['msRequestFullscreen', 'msFullscreenElement', "'MSFullscreenChange'"],
    ]) {
      expect(CONTROLS_CODE, `${req} must be requestable`).toContain(req);
      expect(CONTROLS_CODE, `${req} needs its state property`).toContain(state);
      expect(CONTROLS_CODE, `${req} needs its change event`).toContain(ev);
    }
  });

  it('lets the UA hide rule actually win on the fullscreen button', () => {
    // `display: inline-flex` is an author rule and `[hidden] { display: none }`
    // is the UA's, so the author rule wins: the button ships `hidden` and
    // rendered anyway — the dead control on an unsupported browser that the
    // `hidden` exists to prevent. This repo has no global `[hidden]` reset.
    expect(CSS_CODE).toMatch(/\.lbc-bar__btn\[hidden\]\s*\{[^}]*display:\s*none/);
  });

  it('repaints the fullscreen label from the EVENT, not the click', () => {
    // Esc and a TV remote's Back button both exit without going through the
    // handler, so a label painted at click time reads "Exit full screen" on a
    // windowed board. Both spellings: a set-top browser may only emit the
    // prefixed one.
    expect(CONTROLS_CODE).toMatch(/'fullscreenchange', 'webkitfullscreenchange'/);
    expect(CONTROLS_CODE).toMatch(/paintFullscreenToggle/);
  });

  it('gives the toolbar exactly three controls, and no league chips', () => {
    // It used to carry a heading, a sentence of prose, a chip per league and a
    // paragraph of shortcuts — a block of chrome above the one page whose
    // whole job is the scores, and six or eight chips deep for anyone in other
    // people's leagues. The leagues are one tap away on the setup screen,
    // which is the screen for choosing them.
    const bar = /<nav class="lbc-bar"[\s\S]*?<\/nav>/.exec(CONTROLS_CODE)?.[0] ?? '';
    expect(bar).not.toBe('');
    expect((bar.match(/class="lbc-bar__btn"/g) ?? []).length).toBe(3);
    // No chip, no heading, no shortcut paragraph on the toolbar.
    expect(bar).not.toMatch(/lbc-setup__chip|chips\.map|<h1|<h2|<kbd/);
    // Leagues is a LINK to the setup screen, so it works with no JavaScript.
    expect(bar).toMatch(/<a class="lbc-bar__btn" href=\{pickerHref\}>Leagues<\/a>/);
  });

  it('keeps the setup screen whole — every league, and the shortcut keys', () => {
    // Removing something from the toolbar is only correct if it still exists
    // where it belongs; an unreachable opt-in is a bug this board has shipped.
    const setup = /<section class="lbc-controls lbc-controls--setup"[\s\S]*?<\/section>/.exec(CONTROLS_CODE)?.[0] ?? '';
    expect(setup).not.toBe('');
    expect(setup).toMatch(/chips\.map\(/);
    expect(setup).toMatch(/doneHref/);
    for (const k of ['F', 'M', 'L']) {
      expect(setup).toMatch(new RegExp(`<kbd>${k}</kbd>`));
    }
  });

  it('still hides the CURSOR, which is the last piece of chrome', () => {
    // Scoped to `.is-board`. The SETUP SCREEN is also a `.lbc` and never
    // mounts the island, so nothing there sets `is-awake` — a bare
    // `.lbc:not(.is-awake)` hid the cursor across the whole league picker,
    // where every control is a pointer target.
    expect(CSS_CODE).toMatch(/\.lbc\.is-board:not\(\.is-awake\)\s*\{[^}]*cursor:\s*none/);
    expect(CSS_CODE).not.toMatch(/(?<!\.is-board)\.lbc:not\(\.is-awake\)/);
    // Only the island's root may carry it.
    expect(ISLAND_CODE).toMatch(/lbc is-board/);
    expect(PAGE_CODE).not.toMatch(/is-board/);
  });

  it('borrows no --lbc-* property it is not inside', () => {
    // The old strip reused `.lbc-setup__chip`, whose `--lbc-panel` /
    // `--lbc-hairline` / `--lbc-text` are declared on `.lbc` — and the strip
    // was a SIBLING of the board, not a descendant, so every one of those
    // `var()`s was invalid at computed-value time and the chips lost their
    // background and border outright. The toolbar has its own class and its
    // own tokens now: a fix that cannot regress, rather than a redeclaration
    // that has to be kept in sync.
    const bar = (CSS_CODE.match(/^\.lbc-bar[^{]*\{[^}]*\}/gm) ?? []).join('\n');
    expect(bar).not.toBe('');
    expect(bar).not.toMatch(/var\(\s*--lbc-/);
    const nav = /<nav class="lbc-bar"[\s\S]*?<\/nav>/.exec(CONTROLS_CODE)?.[0] ?? '';
    expect(nav).not.toMatch(/lbc-setup__chip/);
  });

  it('keeps the strip and the board agreeing about sound', () => {
    // Two ways they fell apart: the board's `M` key left the strip's label and
    // data-on stale (so its next click computed from a stale value and failed
    // to toggle), and the strip is clickable BEFORE the island hydrates, so a
    // fast click dispatched into nothing.
    //
    // Each side names itself and ignores its own echo...
    expect(CONTROLS_CODE).toMatch(/from: 'strip'/);
    expect(ISLAND_CODE).toMatch(/from: 'board'/);
    expect(CONTROLS_CODE).toMatch(/from === 'strip'/);
    expect(ISLAND_CODE).toMatch(/from === 'board'/);
    // ...and BOTH reconcile against the cookie when they start, which is what
    // covers the click nobody was listening for.
    expect(CONTROLS_CODE).toMatch(/bc_sound=\(\[01\]\)/);
    expect(ISLAND_CODE).toMatch(/bc_sound=\(\[01\]\)/);
  });

  it('wakes on every input a television can produce', () => {
    for (const ev of ['pointermove', 'pointerdown', 'touchstart', 'keydown']) {
      expect(ISLAND_CODE).toContain(`'${ev}'`);
    }
  });
});

describe('the sting can actually be heard', () => {
  it('keeps ONE AudioContext and resumes it on a real gesture', () => {
    // It used to build a NEW context per moment, on the stated claim that
    // "autoplay policy is satisfied by the user having turned sound on". It is
    // not: the preference is a cookie read at render, and a preference carried
    // from a previous document is not transient activation. A context built
    // without activation starts SUSPENDED, `osc.start()` schedules against a
    // clock that never advances, and nothing throws — so the board made no
    // sound at all while appearing to work.
    expect(ISLAND_CODE).toMatch(/audioRef/);
    expect(ISLAND_CODE).toMatch(/\.resume\(\)/);
    // One context for the life of the board: constructed only behind the
    // "do I already have one" check.
    expect(ISLAND_CODE).toMatch(/if \(!audioRef\.current\) audioRef\.current = new Ctx\(\)/);
  });

  it('never closes the shared context after a sting', () => {
    // Closing it un-unlocks the audio for every later moment — the board would
    // play at most one sound per gesture.
    expect(ISLAND_CODE).not.toMatch(/ctx\.close\(\)/);
  });
});

describe('the win-probability split is stated once', () => {
  it('draws no bar across the top edge of a cell', () => {
    // A 0.4vh copy of the gradient ran along `.lbc__cell`'s top border. From
    // ten feet it did not read as this matchup's split; it read as a progress
    // bar for the panel tag above it, one per cell down the screen. The bar
    // between the two sides is the only place the split is drawn.
    // Anchored to the line start: unanchored, the first match in the file is
    // the doubleheader divider's `.lbc__cell + .lbc__cell {`, which never had
    // a top border, so the guard passed on a board that still drew one.
    const cell = /^\.lbc__cell \{([^}]*)\}/m.exec(CSS_CODE)?.[1] ?? '';
    expect(cell).not.toBe('');
    expect(cell).not.toMatch(/border-top/);
    expect(cell).not.toMatch(/border-image/);
    // And the survivor still exists, or the split is drawn nowhere at all.
    expect(CSS_CODE).toMatch(/\.lbc__wp \{[^}]*background:\s*var\(--lbc-theirs/);
  });
});

describe('a defense reveal names the club, not the city', () => {
  it('takes the last token off every real defense name', () => {
    // `formatName` builds a DEF as `${city} ${nickname}`, so the nickname is
    // the last whitespace token — and the multi-word cities are exactly the
    // names that wrapped the reveal's headline onto two lines. Checked against
    // the live feed rather than a fixture list, because the rule depends on
    // MFL's own "Bills, Buffalo" ordering staying what it is.
    const defs = [...getPlayerMap(2026).values()].filter((p) => p.position === 'DEF');
    expect(defs.length).toBe(32);
    for (const d of defs) {
      const nick = defenseNickname(d.name);
      expect(nick).not.toContain(' ');
      expect(d.name.endsWith(nick)).toBe(true);
    }
    // The cases that motivated it.
    expect(defenseNickname('Washington Commanders')).toBe('Commanders');
    expect(defenseNickname('New England Patriots')).toBe('Patriots');
    expect(defenseNickname('Tampa Bay Buccaneers')).toBe('Buccaneers');
    // A name with no city is left alone rather than emptied.
    expect(defenseNickname('Bills')).toBe('Bills');
  });

  it('applies it to the DEF headline only', () => {
    const takeover = code(read('src/components/shared/live-broadcast/MomentTakeover.tsx'));
    // A person's name is not a city plus a nickname; running it through this
    // would print his surname alone.
    expect(takeover).toMatch(/isDef \? defenseNickname\(moment\.playerName\) : moment\.playerName/);
  });
});

describe('portrait resets the desktop seat', () => {
  it('unsets the model’s right offset in every portrait block', () => {
    // The model is absolutely positioned at `right: -7.92%` to clear the
    // centred crest. Left unreset in a portrait block it pushes the backdrop
    // off the right edge, where `.lbc-reveal { overflow: hidden }` clips it —
    // and `justify-content` cannot pull back an absolutely positioned child.
    for (const q of ['@media (orientation: portrait)', '@media (max-width: 900px)']) {
      const at = CSS_CODE.indexOf(q);
      expect(at).toBeGreaterThan(-1);
      const block = CSS_CODE.slice(at, CSS_CODE.indexOf('\n}\n', at));
      expect(block).toMatch(/\.lbc-reveal__model \{ right: 0; \}/);
    }
  });
});

describe('the reveal features the scorer, not a chip', () => {
  const TAKEOVER = code(read('src/components/shared/live-broadcast/MomentTakeover.tsx'));

  it('no ESPN athlete id reaches the client', () => {
    // The headline rule in src/types/live-broadcast.ts: a college athlete id
    // and an NFL one are both plain digits, so every join is server-side and
    // only MFL ids cross. The draft board's equivalent ships `espnId` on
    // `BroadcastDefenseFace` and builds the URL in its island — the shape this
    // surface must not copy.
    expect(TAKEOVER).not.toMatch(/espnId/);
    expect(TAKEOVER).not.toMatch(/getPlayerHeadshot/);
    expect(ISLAND_CODE).not.toMatch(/espnId/);
  });

  it('ships resolved URLs, three fields, nothing else', () => {
    const faces = buildBroadcastDefenseFaces({
      d1: { id: 'd1', name: 'Bills, Buffalo', position: 'DEF', nflTeam: 'BUF', headshot: '', espnId: null, projected: 8 },
    });
    const list = faces['BUF'];
    expect(list?.length).toBeGreaterThanOrEqual(2);
    for (const f of list) {
      expect(Object.keys(f).sort()).toEqual(['headshot', 'name', 'position']);
      expect(isEspnCdnUrl(f.headshot)).toBe(true);
    }
  });

  it('resolves every one of the 32 clubs — the WSH/WAS trap, mechanically', () => {
    // A DEF's team code arrives already `normalizeTeamCode`d, so `WSH`, while
    // the spotlight table is keyed `WAS`; MFL's own dialect (GBP/KCC/NEP…)
    // misses eight more. Indexing the table instead of calling the accessor
    // silently drops nine defenses, and nothing downstream says so.
    const MFL = ['BUF','IND','MIA','NEP','NYJ','CIN','CLE','PIT','BAL','HOU','JAC','TEN','DEN','KCC','LVR','LAC',
                 'DAL','NYG','PHI','WAS','CHI','DET','GBP','MIN','ATL','CAR','NOS','TBB','ARI','LAR','SFO','SEA'];
    const meta: Record<string, any> = {};
    MFL.forEach((mfl, i) => {
      meta[`d${i}`] = { id: `d${i}`, name: `${mfl} D`, position: 'DEF',
        nflTeam: normalizeTeamCode(mfl), headshot: '', espnId: null, projected: 7 };
    });
    const faces = buildBroadcastDefenseFaces(meta);
    const missing = MFL.filter((m) => !faces[normalizeTeamCode(m)]);
    expect(missing).toEqual([]);
    expect(Object.values(faces).every((v) => v.length >= 2)).toBe(true);
  });

  it('ships at most three faces per club', () => {
    // Two shown, one spare for a 404. More is payload nobody sees, and the
    // draft board's 101 KB came from hanging a pool off each player.
    const faces = buildBroadcastDefenseFaces({
      d1: { id: 'd1', name: 'x', position: 'DEF', nflTeam: 'KC', headshot: '', espnId: null, projected: 8 },
    });
    expect(Object.values(faces).every((v) => v.length <= 3)).toBe(true);
  });

  it('sizes the stand on the cutout’s own ratio, and never caps the man', () => {
    // An ESPN headshot is LANDSCAPE (600x436). This layer is 64% of the board
    // tall, so the draft board's `width: 120%` of the column renders him taller
    // than the layer and — bottom-anchored, with `.lbc-reveal` clipping — takes
    // his head off.
    const stand = CSS_CODE.slice(CSS_CODE.indexOf('.lbc-reveal__stand'));
    expect(stand.slice(0, stand.indexOf('}'))).toMatch(/aspect-ratio:\s*600\s*\/\s*436/);
    const model = CSS_CODE.slice(CSS_CODE.indexOf('.lbc-reveal__model {'));
    expect(model.slice(0, model.indexOf('}'))).not.toMatch(/max-height:\s*\d+%/);
  });

  it('seats every scorer in the SAME place, player or defense', () => {
    // The two-man pair was tried and filled the layer on a real TV. One seat
    // now, and a defense's stand-in takes it like anyone else — so a reveal
    // never shifts its subject depending on who scored.
    expect(CSS_CODE).not.toMatch(/lbc-reveal__model--def/);
    const at = CSS_CODE.indexOf('.lbc-reveal__model {');
    const block = CSS_CODE.slice(at, CSS_CODE.indexOf('}', at));
    expect(block).toMatch(/position:\s*absolute/);
    expect(parseFloat(block.match(/right:\s*(-?[\d.]+)%/)![1])).toBeCloseTo(-7.92, 2);
  });

  it('shows ONE defender, and marks the unit with its club logo', () => {
    expect(TAKEOVER).toMatch(/\.slice\(0, 1\)/);
    // A defense's name IS a club, so it takes the club's mark; a person's name
    // does not, because his own face already identifies him.
    expect(TAKEOVER).toMatch(/isDef && defLogo &&/);
    // The DARK cut, not `getNFLTeamLogo`'s light `500` one: this board is dark
    // in BOTH themes, so the `html.dark` swap never fires for a light-theme
    // owner driving the TV and the outlined marks come out wrong.
    expect(TAKEOVER).toMatch(/resolveNflDarkLogoUrl/);
    expect(TAKEOVER).not.toMatch(/getNFLTeamLogo/);
    expect(CSS_CODE).toMatch(/\.lbc-reveal__name-logo/);
  });

  it('gives the figure’s space back when there is nothing to show', () => {
    // A 404, or the one player with no cutout, otherwise leaves a column of
    // bare gradient. Sound ONLY because the error handlers remove the <img>:
    // a `display: none` fallback is still there as far as `:has()` is concerned.
    expect(CSS_CODE).toMatch(/\.lbc-reveal:not\(:has\(\.lbc-reveal__model\)\)/);
    expect(TAKEOVER).toMatch(/onError=\{\(\) => setCutout\(null\)\}/);
    expect(TAKEOVER).not.toMatch(/style\.display/);
  });

  it('never hides the subject to resolve a collision', () => {
    // The fix this repo made once and had to undo. `display: none` may only
    // ever fall on the empty BOX, never on a rule targeting a man.
    // Strip `:has(...)` first: the collapse rule legitimately NAMES a model
    // inside its guard while its SUBJECT is the empty figure. Without this the
    // guard fires on the very rule that implements the correct behaviour.
    const withoutGuards = CSS_CODE.replace(/:has\([^)]*\)/g, '');
    const badRule = /\.lbc-reveal__(model|stand)[^{;]*\{[^}]*display:\s*none/;
    expect(withoutGuards).not.toMatch(badRule);
  });

  it('drops the circular chip it replaced', () => {
    expect(TAKEOVER).not.toMatch(/BroadcastFace/);
    expect(CSS_CODE).not.toMatch(/\.lbc-reveal__nameline/);
  });

  it('passes the defenders by reference, or memo() dies on every tick', () => {
    // A `.slice()`/`.map()` here mints a new array each render and defeats
    // MomentTakeover's memo() on the 1 Hz heartbeat — ~28,800 re-renders of
    // the reveal over a Sunday, on set-top hardware.
    expect(ISLAND_CODE).toMatch(/return data\.defenseFaces\[who\?\.nflTeam \?\? ''\];/);
  });
});
