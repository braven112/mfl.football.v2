/**
 * The draft broadcast's franchise crests.
 *
 * The board is dark in both themes, so every `html.dark` crest mechanism the
 * rest of the site relies on is inert here and the artwork has to be picked
 * server-side. These pin the two rules that picking has to satisfy at once —
 * right theme, and no resolution thrown away on the biggest crest on the site —
 * plus the outline that covers the gap between them.
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'fs';
import {
  broadcastStrokeIndex,
  resolveBroadcastCrest,
  type BroadcastCrestTeam,
} from '../src/utils/broadcast-crest';
import { DEFAULT_CREST_STROKE_COLOR } from '../src/utils/crest-dark-stroke-css';

const theleague = JSON.parse(readFileSync('src/data/theleague.config.json', 'utf-8'));
const afl = JSON.parse(readFileSync('data/afl-fantasy/afl.config.json', 'utf-8'));

/** A team carrying only the fields the resolver reads. */
function team(over: Partial<BroadcastCrestTeam> = {}): BroadcastCrestTeam {
  return { franchiseId: '9999', icon: '/assets/x/icons/x.png', ...over };
}

/** No franchise 9999 is in any manifest, so the synthetic teams start clean. */
const EMPTY = broadcastStrokeIndex('theleague', []);

describe('resolveBroadcastCrest — which artwork', () => {
  it('takes the 400px dark cut for both surfaces when there is one', () => {
    const out = resolveBroadcastCrest(
      team({ groupMeDark: '/gm_dark.png', groupMe: '/gm.png', iconDark: '/i_dark.png' }),
      'theleague',
      EMPTY
    );
    expect(out.icon).toBe('/gm_dark.png');
    expect(out.iconSmall).toBe('/gm_dark.png');
  });

  it('keeps the 400px LIGHT art on the big crest over a 100px dark cut', () => {
    // The whole reason the two fields exist: at 68vh a 100px source upscales
    // 7x, which is the more visible failure of the two on a TV.
    const out = resolveBroadcastCrest(
      team({ groupMe: '/gm.png', iconDark: '/i_dark.png' }),
      'theleague',
      EMPTY
    );
    expect(out.icon).toBe('/gm.png');
  });

  it('takes the 100px dark cut on the small surfaces, where it costs nothing', () => {
    const out = resolveBroadcastCrest(
      team({ groupMe: '/gm.png', iconDark: '/i_dark.png' }),
      'theleague',
      EMPTY
    );
    expect(out.iconSmall).toBe('/i_dark.png');
  });

  it('never renders the light `icon` for a franchise that has an iconDark', () => {
    // Not cosmetic: `TeamIconDarkStyles` ships on this page and swaps that
    // exact src under `html.dark`, so rendering it would make the crest follow
    // the VIEWER's theme on a board that has none.
    const out = resolveBroadcastCrest(team({ iconDark: '/i_dark.png' }), 'theleague', EMPTY);
    expect(out.icon).toBe('/i_dark.png');
    expect(out.iconSmall).toBe('/i_dark.png');
  });

  it('falls all the way back to the light icon, and to empty with no art', () => {
    expect(resolveBroadcastCrest(team(), 'theleague', EMPTY).icon).toBe('/assets/x/icons/x.png');
    const bare = resolveBroadcastCrest({ franchiseId: '9999' }, 'theleague', EMPTY);
    expect(bare.icon).toBe('');
    expect(bare.iconSmall).toBe('');
    expect(bare.iconStroke).toBeUndefined();
  });

  it('rewrites an absolute same-origin asset URL to its path', () => {
    // Several AFL `icon` fields are hardcoded production URLs — see
    // preferredIconSrc.
    const out = resolveBroadcastCrest(
      team({ icon: 'https://mflfootballv2.vercel.app/assets/afl/icons/x.png' }),
      'afl',
      EMPTY
    );
    expect(out.icon).toBe('/assets/afl/icons/x.png');
  });
});

describe('resolveBroadcastCrest — the outline', () => {
  it('never strokes a dark cut', () => {
    const out = resolveBroadcastCrest(
      team({ groupMeDark: '/gm_dark.png', iconStrokeDark: '#ffcd00' }),
      'theleague',
      EMPTY
    );
    expect(out.iconStroke).toBeUndefined();
    expect(out.iconSmallStroke).toBeUndefined();
  });

  it('strokes the light art of a franchise that has an iconDark', () => {
    // This is the clause the site-wide manifest cannot supply: it skips every
    // team with an `iconDark` on the grounds that they swap, which is true
    // everywhere except here.
    const out = resolveBroadcastCrest(
      team({ groupMe: '/gm.png', iconDark: '/i_dark.png' }),
      'theleague',
      EMPTY
    );
    expect(out.iconStroke).toBe(DEFAULT_CREST_STROKE_COLOR);
    // …and NOT the small one, which resolved to the dark cut.
    expect(out.iconSmallStroke).toBeUndefined();
  });

  it('honours iconStrokeDark in both directions', () => {
    expect(
      resolveBroadcastCrest(team({ groupMe: '/gm.png', iconStrokeDark: '#ffcd00' }), 'theleague', EMPTY)
        .iconStroke
    ).toBe('#ffcd00');
    // `false` is an opt-out, and it outranks even the iconDark clause above.
    expect(
      resolveBroadcastCrest(
        team({ groupMe: '/gm.png', iconDark: '/i_dark.png', iconStrokeDark: false }),
        'theleague',
        EMPTY
      ).iconStroke
    ).toBeUndefined();
  });

  // The next two pin the flagged-franchise branches with a SYNTHETIC index
  // rather than a named franchise, and that is deliberate. Both were pinned to
  // real teams and both were retired by the dark-artwork sweep within a day:
  // the custom-colour case rode The Show, then No Soup For You, then Suh girls;
  // the default-white case rode the Boondock Saints until they took a
  // `groupMeDark`. A dark cut of ANY kind removes a franchise from these
  // branches by construction, every franchise is on track for one, and at the
  // time of writing ZERO franchises in either league still qualify for the
  // default-white case — so there is nothing left to repoint to.
  //
  // The real-data contract has not been dropped; it lives in the
  // `every franchise, both leagues` sweep below, which walks the actual configs
  // and asserts every light-art crest is stroked or a deliberate opt-out.
  // These two own the resolver's branching, which is franchise-agnostic.

  it('picks up a franchise the measured manifest flagged, in its own colour', () => {
    // Presence in the index is what "the manifest flagged it" means; the value
    // is the config colour. Pink so a default-white regression cannot pass.
    const index = new Map<string, string | false | undefined>([['9999', '#ff769f']]);
    expect(resolveBroadcastCrest(team(), 'afl', index).iconStroke).toBe('#ff769f');
  });

  it('falls back to the default white for a flagged franchise with no colour', () => {
    // Flagged, declaring nothing: an `undefined` VALUE against a PRESENT key.
    // `index.get()` cannot tell that apart from an absent key, so this is the
    // case a `has`/`get` mix-up would silently break.
    const index = new Map<string, string | false | undefined>([['9999', undefined]]);
    expect(resolveBroadcastCrest(team(), 'afl', index).iconStroke).toBe(
      DEFAULT_CREST_STROKE_COLOR
    );
  });

  it('never hands CSS a non-string colour', () => {
    // `iconStrokeDark` is typed `string | boolean` so the raw config assigns,
    // which makes `true` reachable. It has to come back as a real colour: a
    // boolean reaches CSS as `--dbc-crest-stroke: true`, which invalidates the
    // whole composed `filter` and costs the crest its drop shadow too.
    const t = team({ groupMe: '/gm.png', iconStrokeDark: true });
    const index = broadcastStrokeIndex('theleague', [t]);
    const out = resolveBroadcastCrest(t, 'theleague', index);
    expect(typeof out.iconStroke).toBe('string');
    expect(out.iconStroke).toBe(DEFAULT_CREST_STROKE_COLOR);
  });

  it('reads `true` the same way the site-wide stroke builder does', () => {
    // withStrokeColors treats any truthy `iconStrokeDark` as an opt-in. If this
    // resolver disagreed, one config field would mean two things.
    const t = team({ groupMe: '/gm.png', iconStrokeDark: true });
    // Deliberately WITHOUT an index — the meaning must not depend on which team
    // array the caller built one from.
    expect(resolveBroadcastCrest(t, 'theleague').iconStroke).toBe(
      DEFAULT_CREST_STROKE_COLOR
    );
  });

  it('honours a config opt-out that only the INDEX knows about', () => {
    // The index is passed in, so a caller can hand a team record rebuilt
    // without `iconStrokeDark` (the way franchise-band-brand rebuilds a
    // franchise off its throwback identity) while the index still carries the
    // opt-out. `false || DEFAULT` would ring a crest a human opted out of.
    // Synthetic on both sides, matching the twin case in
    // dark-surface-crest.test.ts. This was pinned to Chatmaster, then made to
    // SEARCH the AFL for any opt-out — and the search itself ran dry when Minty
    // Fresh and Ditka took dark artwork, leaving TheLeague holding the only two
    // opt-outs in the repo. Scoping the search wider would just defer it again:
    // every franchise is on track for dark art, and an `iconDark` forbids
    // `iconStrokeDark` outright.
    const index = new Map<string, string | false | undefined>([['9999', false]]);
    // The record deliberately does NOT carry iconStrokeDark — the opt-out
    // exists only in the index, which is the case being pinned.
    const stripped = { franchiseId: '9999', groupMe: '/gm.png' };
    expect(resolveBroadcastCrest(stripped, 'afl', index).iconStroke).toBeUndefined();
  });

  it('leaves an unflagged, dark-cut-less franchise unstroked', () => {
    const index = broadcastStrokeIndex('theleague', theleague.teams);
    // Gridiron Geeks measure legible and declare nothing — no ring.
    const geeks = theleague.teams.find((t: any) => t.franchiseId === '0013');
    expect(resolveBroadcastCrest(geeks, 'theleague', index).iconStroke).toBeUndefined();
  });
});

describe('every franchise, both leagues', () => {
  for (const [league, cfg] of [
    ['theleague', theleague],
    ['afl', afl],
  ] as const) {
    const index = broadcastStrokeIndex(league, cfg.teams);

    it(`${league}: resolves a crest for every franchise`, () => {
      for (const t of cfg.teams) {
        const out = resolveBroadcastCrest(t, league, index);
        expect(out.icon, `${t.nameMedium || t.name} icon`).toBeTruthy();
        expect(out.iconSmall, `${t.nameMedium || t.name} iconSmall`).toBeTruthy();
      }
    });

    it(`${league}: every resolved crest path exists on disk`, () => {
      // A missing crest degrades to NO crest on the TV, not to a smaller one.
      // The existing guards do not cover this: tests/draft-broadcast.test.ts
      // checks AFL config paths only, and tests/team-icon-dark-styles.test.ts
      // only checks a `groupMe` belonging to a team that also has a
      // `groupMeDark` — so a TheLeague franchise carrying just the light
      // 400px art (Geeks, Cowboy Up, Dark Magicians) was unguarded, and this
      // resolver returns exactly that path for them.
      for (const t of cfg.teams) {
        const out = resolveBroadcastCrest(t, league, index);
        for (const [field, src] of [
          ['icon', out.icon],
          ['iconSmall', out.iconSmall],
        ] as const) {
          expect(
            existsSync(`public${src}`),
            `${t.nameMedium || t.name} ${field} -> ${src}`
          ).toBe(true);
        }
      }
    });

    it(`${league}: every light-art crest is either stroked or a deliberate opt-out`, () => {
      // The point of the whole change: a crest that stays on light artwork on a
      // permanently dark board must have SOMETHING separating it from the
      // board, unless a human said otherwise.
      for (const t of cfg.teams) {
        const out = resolveBroadcastCrest(t, league, index);
        const isDark = out.icon === t.groupMeDark || out.icon === t.iconDark;
        if (isDark || !t.iconDark) continue;
        expect(out.iconStroke, `${t.nameMedium || t.name} light art with no ring`).toBeTruthy();
      }
    });
  }
});
