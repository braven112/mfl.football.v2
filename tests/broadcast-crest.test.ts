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
import { readFileSync } from 'fs';
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

  it('picks up a franchise the measured manifest flagged, in its own colour', () => {
    const index = broadcastStrokeIndex('afl', afl.teams);
    // Suh girls have no dark cut of any kind and declare their own pink ring.
    // Deliberately an AFL franchise: TheLeague's crests are nearly all covered
    // by 400px dark art now (#680), so it no longer exercises this path — the
    // AFL is where the measured manifest still does the work.
    const suh = afl.teams.find((t: any) => t.franchiseId === '0012');
    expect(resolveBroadcastCrest(suh, 'afl', index).iconStroke).toBe('#ff769f');
  });

  it('falls back to the default white for a flagged franchise with no colour', () => {
    const index = broadcastStrokeIndex('afl', afl.teams);
    // Boondock Saints measure illegible and declare nothing.
    const saints = afl.teams.find((t: any) => t.franchiseId === '0020');
    expect(resolveBroadcastCrest(saints, 'afl', index).iconStroke).toBe(
      DEFAULT_CREST_STROKE_COLOR
    );
  });

  it('honours a config opt-out that only the INDEX knows about', () => {
    // The index is passed in, so a caller can hand a team record rebuilt
    // without `iconStrokeDark` (the way franchise-band-brand rebuilds a
    // franchise off its throwback identity) while the index still carries the
    // opt-out. `false || DEFAULT` would ring a crest a human opted out of.
    const index = broadcastStrokeIndex('afl', afl.teams);
    const chat = afl.teams.find((t: any) => t.franchiseId === '0021');
    const stripped = { ...chat, iconStrokeDark: undefined, groupMeDark: undefined };
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
