/**
 * Franchise crests on surfaces that are DARK IN BOTH THEMES.
 *
 * The site's crest machinery is keyed on `html.dark` — the artwork swap in
 * `team-icon-dark-css.ts` and the measured ring in `crest-dark-stroke-css.ts`
 * both fire only for a viewer whose site theme resolved to dark. A surface that
 * paints deep ink regardless of theme gets nothing from either, so it has to
 * resolve the crest server-side. Three surfaces got that wrong independently
 * (the draft broadcast, the recap composite hero, TheLeague's lineup faceoff),
 * and each shipped the same symptom: a near-black mark dissolving into ink for
 * every light-theme reader.
 *
 * These pin the shared rule and, at the bottom, the call sites — because the
 * regression is never in the helper, it is a new surface (or a re-fork of an
 * existing one) reaching past it for `groupMe` or `icon` directly.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import {
  crestStrokeIndex,
  isDarkCut,
  resolveCrestStroke,
  resolveDarkSurfaceCrest,
  type DarkSurfaceCrestTeam,
} from '../src/utils/dark-surface-crest';
import { DEFAULT_CREST_STROKE_COLOR, withStrokeColors } from '../src/utils/crest-dark-stroke-css';
import {
  eraCrestOverrides,
  getFranchiseBrand,
  getThrowbackFranchiseBrand,
} from '../src/utils/franchise-brand';

const theleague = JSON.parse(readFileSync('src/data/theleague.config.json', 'utf-8'));
const afl = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf-8'));

/** A team carrying only the fields the resolver reads. */
function team(over: Partial<DarkSurfaceCrestTeam> = {}): DarkSurfaceCrestTeam {
  return { franchiseId: '9999', icon: '/assets/x/icons/x.png', ...over };
}

/** No franchise 9999 is in any manifest, so the synthetic teams start clean. */
const EMPTY = crestStrokeIndex('theleague', []);

describe('resolveDarkSurfaceCrest — which artwork', () => {
  it('takes the 400px dark cut when there is one', () => {
    const out = resolveDarkSurfaceCrest(
      team({ groupMeDark: '/gm_dark.png', groupMe: '/gm.png', iconDark: '/i_dark.png' }),
      'theleague',
      EMPTY
    );
    expect(out.src).toBe('/gm_dark.png');
  });

  it('prefers the 100px dark cut over the 400px LIGHT art', () => {
    // Theme first, unlike the draft broadcast's 68vh reveal crest: nothing on
    // these surfaces renders large enough for a 100px source to show.
    const out = resolveDarkSurfaceCrest(
      team({ groupMe: '/gm.png', iconDark: '/i_dark.png' }),
      'theleague',
      EMPTY
    );
    expect(out.src).toBe('/i_dark.png');
  });

  it('never renders the light `icon` for a franchise that has an iconDark', () => {
    // `TeamIconDarkStyles` ships on every page, so that exact src would swap
    // under `html.dark` — and the crest would follow the VIEWER's theme on a
    // surface that has none.
    const out = resolveDarkSurfaceCrest(team({ iconDark: '/i_dark.png' }), 'theleague', EMPTY);
    expect(out.src).toBe('/i_dark.png');
  });

  it('falls back through the light art, and to empty with none at all', () => {
    expect(resolveDarkSurfaceCrest(team({ groupMe: '/gm.png' }), 'theleague', EMPTY).src)
      .toBe('/gm.png');
    expect(resolveDarkSurfaceCrest(team(), 'theleague', EMPTY).src)
      .toBe('/assets/x/icons/x.png');
    expect(resolveDarkSurfaceCrest({ franchiseId: '9999' }, 'theleague', EMPTY).src).toBe('');
  });

  it('rewrites an absolute same-origin asset URL to its path', () => {
    // The AFL config stores production URLs; the crest should ride the page's
    // own connection rather than open a second one.
    const out = resolveDarkSurfaceCrest(
      team({ groupMe: 'https://mflfootballv2.vercel.app/assets/afl/group-me/x.png' }),
      'afl',
      EMPTY
    );
    expect(out.src).toBe('/assets/afl/group-me/x.png');
  });

  it('needs no index for a single-team caller', () => {
    // The recap hero resolves exactly one franchise per render.
    const out = resolveDarkSurfaceCrest(team({ iconDark: '/i_dark.png' }), 'theleague');
    expect(out.src).toBe('/i_dark.png');
  });
});

describe('resolveDarkSurfaceCrest — the ring', () => {
  it('never rings a dark cut', () => {
    const t = team({ iconDark: '/i_dark.png', iconStrokeDark: '#ffffff' });
    const out = resolveDarkSurfaceCrest(t, 'theleague', EMPTY);
    expect(isDarkCut(t, out.src)).toBe(true);
    expect(out.filter).toBeUndefined();
  });

  it('treats HAVING an iconDark as "this light art fails on dark"', () => {
    // Tested on the primitive, not the resolver: this resolver's theme-first
    // order can never leave such a franchise on light art. The signal exists
    // for the ONE order that can — the broadcast's 68vh reveal crest — and the
    // measured manifest deliberately skips these teams, so it is their only
    // one. Losing it here would silently un-ring the board.
    expect(resolveCrestStroke(team({ iconDark: '/i_dark.png' }), EMPTY))
      .toBe(DEFAULT_CREST_STROKE_COLOR);
    expect(resolveCrestStroke(team(), EMPTY)).toBeUndefined();
  });

  it('honours iconStrokeDark in both directions', () => {
    const opted = resolveDarkSurfaceCrest(
      team({ groupMe: '/gm.png', iconStrokeDark: '#ff769f' }),
      'afl',
      EMPTY
    );
    expect(opted.strokeColor).toBe('#ff769f');
    expect(opted.filter).toContain('#ff769f');

    const out = resolveDarkSurfaceCrest(
      team({ groupMe: '/gm.png', iconStrokeDark: false }),
      'afl',
      EMPTY
    );
    expect(out.filter).toBeUndefined();
  });

  it('reads `true` as an opt-in at the default colour', () => {
    // A JSON `true` widens to `boolean`, so it is type-legal and must MEAN
    // something. `drop-shadow(… true)` would be invalid at computed-value
    // time and take the whole filter down with it.
    const out = resolveDarkSurfaceCrest(
      team({ groupMe: '/gm.png', iconStrokeDark: true }),
      'afl',
      EMPTY
    );
    expect(out.strokeColor).toBe(DEFAULT_CREST_STROKE_COLOR);
    expect(out.filter).not.toContain('true');
  });

  it('picks up a manifest-flagged franchise in its own colour', () => {
    // FIND the franchise, never name one (#687). Every franchise in both
    // leagues is on track for dark artwork, and a franchise with an `iconDark`
    // may not carry `iconStrokeDark` at all (`crest-dark-stroke.test.ts`
    // enforces that), so a hardcoded id here is a scheduled failure.
    const index = crestStrokeIndex('afl', afl.teams);
    const named = afl.teams.find(
      (t: any) => typeof t.iconStrokeDark === 'string' && !t.iconDark
    );
    // Guard the search, or this passes vacuously on `undefined` once no
    // franchise names its own colour any more.
    expect(named, 'no AFL franchise names its own stroke colour').toBeDefined();
    expect(resolveDarkSurfaceCrest(named, 'afl', index).strokeColor)
      .toBe(named.iconStrokeDark);
  });

  it('honours an opt-out that only the INDEX knows about', () => {
    // A caller may hand in a record rebuilt without `iconStrokeDark` (the
    // throwback path does exactly that); `false || DEFAULT` would then ring a
    // crest a human opted out of. Synthetic on both sides, so no franchise is
    // named and nothing here expires.
    const index = new Map<string, string | false | undefined>([['9999', false]]);
    const out = resolveDarkSurfaceCrest(
      { franchiseId: '9999', groupMe: '/gm.png' },
      'theleague',
      index
    );
    expect(out.filter).toBeUndefined();
  });

  it('never hands CSS a non-string colour from the index', () => {
    const index = new Map<string, string | false | undefined>([['9999', true as any]]);
    const out = resolveDarkSurfaceCrest({ franchiseId: '9999', groupMe: '/gm.png' }, 'afl', index);
    expect(out.strokeColor).toBe(DEFAULT_CREST_STROKE_COLOR);
  });

  it('leaves an unflagged, dark-cut-less franchise unringed', () => {
    // A franchise the measurement cleared, that declares nothing and has no
    // dark cut: it renders its light art as authored. Found, not named — see
    // above. TheLeague has one (Gridiron Geeks) until it gets dark artwork,
    // and the AFL is checked too so the case survives either league running
    // out first.
    let checked = 0;
    for (const [league, cfg] of [['theleague', theleague], ['afl', afl]] as const) {
      const index = crestStrokeIndex(league, cfg.teams);
      const clean = cfg.teams.find(
        (t: any) => !t.iconDark && !t.groupMeDark && t.iconStrokeDark === undefined
          && !index.has(t.franchiseId)
      );
      if (!clean) continue;
      checked++;
      expect(resolveDarkSurfaceCrest(clean, league, index).filter).toBeUndefined();
    }
    // Only TheLeague has one today (Gridiron Geeks); the AFL has none. When
    // the last one in BOTH leagues gets dark artwork this case stops existing
    // and should be deleted, not left passing on an empty loop.
    expect(checked, 'no franchise in either league is unflagged and dark-cut-less').toBeGreaterThan(0);
  });
});

describe('every franchise, both leagues', () => {
  for (const [league, cfg] of [
    ['theleague', theleague],
    ['afl', afl],
  ] as const) {
    const index = crestStrokeIndex(league, cfg.teams);

    it(`${league}: resolves a crest that exists on disk for every franchise`, () => {
      for (const t of cfg.teams) {
        const out = resolveDarkSurfaceCrest(t, league, index);
        expect(out.src, `${t.nameMedium || t.name}`).toBeTruthy();
        expect(existsSync(`public${out.src}`), `${t.nameMedium || t.name} -> ${out.src}`).toBe(true);
      }
    });

    it(`${league}: is never weaker than the themed surfaces it sits beside`, () => {
      // The real invariant. Every crest the site rings under `html.dark` must
      // ALSO be ringed here when this surface leaves it on light artwork —
      // otherwise a franchise wears a ring on the standings card and none on
      // the panel next to it, which reads as a rendering bug. Eight AFL
      // franchises land here; TheLeague's three are all opt-outs.
      const ringedSiteWide = new Set(
        withStrokeColors(league, cfg.teams)
          .filter((e) => e.strokeColor !== false && e.icon)
          .map((e) => e.icon)
      );
      let checked = 0;
      for (const t of cfg.teams) {
        const out = resolveDarkSurfaceCrest(t, league, index);
        if (isDarkCut(t, out.src)) continue;
        if (!ringedSiteWide.has(t.icon)) continue;
        checked++;
        expect(out.filter, `${t.nameMedium || t.name} light art with no ring`).toBeTruthy();
      }
      // A rewrite that quietly stopped resolving light art would make the loop
      // vacuous and the assertion meaningless.
      if (league === 'afl') expect(checked).toBeGreaterThan(0);
    });
  }
});

describe('throwback brands stay on era artwork', () => {
  // A Throwback Week crest is era art with no dark variant, and the stroke
  // manifest measures current crests only. Inheriting either would put the
  // MODERN logo (or a ring measured for it) under a legacy name.
  const anyEraFranchise = theleague.teams.find(
    (t: any) => t.iconDark && (t.history?.length ?? 0) > 0
  );

  it('clears the dark cuts on a franchise that actually threw back', () => {
    expect(anyEraFranchise, 'fixture: a franchise with an iconDark and a history').toBeTruthy();
    const era = getThrowbackFranchiseBrand(anyEraFranchise.franchiseId, true);
    // Every franchise with a history has an eligible era today; if that ever
    // stops being true this fixture has to move, not be skipped.
    expect(era.icon, 'fixture: franchise resolved no era').not.toBe(anyEraFranchise.icon);
    expect(era.iconDark).toBeUndefined();
    expect(era.groupMeDark).toBeUndefined();
    // `false`, not cleared: the stroke index is keyed by franchiseId and passed
    // in separately, so only the opt-out stops a ring measured for the crest
    // this franchise is no longer wearing.
    expect(era.iconStrokeDark).toBe(false);
    const index = crestStrokeIndex('theleague', theleague.teams);
    const out = resolveDarkSurfaceCrest(era, 'theleague', index);
    expect(out.src).toBe(era.groupMe);
    expect(out.filter).toBeUndefined();
  });

  it('keeps them for a franchise with no eligible era to throw back to', () => {
    // `resolveThrowbackIdentity` falls through to the CURRENT identity there,
    // so the crest is still the modern mark — stripping its dark art would
    // strand that one franchise on light artwork for the week. Tested on the
    // extracted decision because every franchise has an eligible era today, so
    // a sweep over the real config can only ever pass.
    expect(eraCrestOverrides(false)).toEqual({});
    expect(eraCrestOverrides(true)).toEqual({
      iconDark: undefined,
      groupMeDark: undefined,
      iconStrokeDark: false,
    });
    // A franchise the manifest DOES flag, dressed in era art, stays unringed
    // even though the index still holds a colour for its id. Take that id off
    // the manifest itself rather than naming one (#687).
    const index = crestStrokeIndex('afl', afl.teams);
    const flaggedId = [...index.entries()].find(([, v]) => v !== false)?.[0];
    expect(flaggedId, 'no AFL franchise is flagged for a stroke').toBeDefined();
    const flagged = { franchiseId: flaggedId, groupMe: '/era.png', ...eraCrestOverrides(true) };
    expect(resolveDarkSurfaceCrest(flagged, 'afl', index).filter).toBeUndefined();
    // Spread over a modern brand, the false branch has to leave it intact.
    const t = theleague.teams.find((x: any) => x.iconDark && x.groupMeDark);
    const kept = { ...getFranchiseBrand(t.franchiseId), ...eraCrestOverrides(false) };
    expect(resolveDarkSurfaceCrest(kept, 'theleague').src).toBe(t.groupMeDark);
  });

  it('carries the crest fields through on a normal week', () => {
    const t = theleague.teams.find((x: any) => x.iconDark && x.groupMeDark);
    const brand = getFranchiseBrand(t.franchiseId);
    expect(brand.iconDark).toBe(t.iconDark);
    expect(brand.groupMeDark).toBe(t.groupMeDark);
    expect(resolveDarkSurfaceCrest(brand, 'theleague').src).toBe(t.groupMeDark);
  });
});

describe('the call sites', () => {
  // The helper is never the regression. A new dark-in-both-themes surface — or
  // a re-fork of one of these two sibling pages — reaching straight for
  // `groupMe`/`icon` is, and that is exactly how TheLeague's lineup page and
  // the AFL's drifted apart in the first place.
  const SURFACES = [
    'src/components/theleague/season-heroes/RecapCompositeHero.astro',
    'src/pages/theleague/lineup.astro',
    'src/pages/afl-fantasy/lineup.astro',
    'src/pages/theleague/draft-broadcast.astro',
    'src/pages/afl-fantasy/draft-broadcast.astro',
  ];

  for (const file of SURFACES) {
    it(`${file} resolves its crest server-side`, () => {
      const src = readFileSync(file, 'utf-8');
      expect(/resolveDarkSurfaceCrest|resolveBroadcastCrest/.test(src)).toBe(true);
    });
  }

  for (const file of SURFACES.slice(0, 3)) {
    it(`${file} does not reach past it for light-only artwork`, () => {
      const src = readFileSync(file, 'utf-8')
        .split('\n')
        .filter((l) => !l.trimStart().startsWith('//') && !l.trimStart().startsWith('*'))
        .join('\n');
      // The two ways the bug shipped: `brand.groupMe` on the hero, and
      // `team?.iconDark || team?.icon` hand-rolled on a lineup page.
      expect(/\bwatermark:\s*(brand|team)\??\.(groupMe|icon)\b/.test(src)).toBe(false);
      expect(/\bcrest\s*=\s*brand\??\.\??groupMe\b/.test(src)).toBe(false);
    });
  }

  it('the faceoff panel can carry a ring at all', () => {
    // Without this prop the AFL's eight manifest-flagged crests have no way to
    // separate from the panel — the site rings them, this surface could not.
    const foc = readFileSync('src/components/theleague/FaceoffComposite.astro', 'utf-8');
    expect(foc).toContain('watermarkFilter');
    const cards = readFileSync('src/utils/lineup-matchup-cards.ts', 'utf-8');
    expect(cards).toContain('watermarkFilter');
  });
});
