/**
 * Guard: the identity ladder's UPLOADED-MARK rung, and what it costs.
 *
 * ── THE CASE THAT FORCED IT ───────────────────────────────────────────────
 * Every franchise in a league this site does not run carries an `icon` in its
 * `TYPE=league` export, and the ladder had no rung for it — so leagues full of
 * real artwork rendered as two grey letters. Adding the rung is only half the
 * job, because "icon" is MFL's word and not a size: Archie's Fantasy Football
 * League (10105) uploaded a **1500×636 PNG of ~400 KB** for all 99 of its
 * franchises, into boxes of 1.4rem and 2.25rem.
 *
 * So this file pins three things that must stay true together:
 *
 *  1. The rung sits ABOVE the NFL name match — art an owner chose outranks art
 *     we inferred from their name — and BELOW a league we run.
 *  2. The mark goes out through the image optimizer, so the bytes are bounded
 *     by the box rather than by whatever was uploaded.
 *  3. The rung travels to the renderer, because it is what says this mark may
 *     be CROPPED square. A crest or club mark is drawn to fit its own box and
 *     a crop cuts off somebody's logo.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveFranchiseIdentity, identityIconAlt } from '../src/utils/mfl-live-identity';
import { optimizedRemoteImage, REMOTE_MARK_HOSTS, REMOTE_MARK_WIDTH } from '../src/utils/remote-image';
import { readLeagueFranchiseMarks } from '../src/utils/broadcast-live-source';
import { clearSchedulePairingsCache } from '../src/utils/mfl-schedule-pairings';

/** A real one, from league 10105's own export. */
const UPLOADED = 'https://www48.myfantasyleague.com/fflnetdynamic2026/10105_franchise_icon0001.png';

describe('the uploaded-mark rung', () => {
  it('shows a franchise its own art, with its own name', () => {
    const id = resolveFranchiseIdentity({
      franchiseId: '0001',
      franchiseName: 'Rhinos',
      leagueSlug: null,
      mflIcon: UPLOADED,
    });
    expect(id.rung).toBe('mfl');
    expect(id.icon).toContain('10105_franchise_icon0001.png');
    expect(id.name).toBe('Rhinos');
    expect(identityIconAlt(id)).toBe('Rhinos logo');
  });

  /**
   * ABOVE the NFL match. A franchise that named itself after a club AND drew
   * its own crest gets its crest — inferring a mark from a name is the weaker
   * claim, and must never displace a real one.
   */
  it('beats the NFL name match', () => {
    const id = resolveFranchiseIdentity({
      franchiseId: '0002',
      franchiseName: 'Saints',
      leagueSlug: null,
      mflIcon: UPLOADED,
    });
    expect(id.rung).toBe('mfl');
    expect(id.nflCode).toBeNull();
  });

  /** BELOW a league we run, whose committed crest and colours outrank both. */
  it('loses to a league we run', () => {
    const id = resolveFranchiseIdentity({
      franchiseId: '0001',
      franchiseName: 'Pacific Pigskins',
      leagueSlug: 'theleague',
      mflIcon: UPLOADED,
    });
    expect(id.rung).toBe('league');
  });

  /** No mark uploaded → the ladder carries on down. Empty is not a mark. */
  it('falls through on an empty icon', () => {
    for (const mflIcon of ['', '   ', null, undefined]) {
      const id = resolveFranchiseIdentity({
        franchiseId: '0003',
        franchiseName: 'Bears',
        leagueSlug: null,
        mflIcon,
      });
      expect(id.rung).toBe('nfl');
    }
  });

  /**
   * NO COLOUR CLAIM. An uploaded image is not a stated brand colour, and
   * sampling one out of the pixels would invent a claim on an owner's behalf —
   * the same reason the text rung stays neutral.
   */
  it('claims no brand colour', () => {
    const id = resolveFranchiseIdentity({
      franchiseId: '0001', franchiseName: 'Rhinos', leagueSlug: null, mflIcon: UPLOADED,
    });
    expect(id.colors.colorPrimary).toBeUndefined();
    expect(id.colors.color).toBe('#64748b');
  });
});

describe('optimizedRemoteImage', () => {
  const had = process.env.VERCEL;
  beforeEach(() => {
    process.env.VERCEL = '1';
  });
  afterEach(() => {
    if (had === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = had;
  });

  it('serves a remote mark through the optimizer at one bounded width', () => {
    const out = optimizedRemoteImage(UPLOADED);
    expect(out).toBe(
      `/_vercel/image?url=${encodeURIComponent(UPLOADED)}&w=${REMOTE_MARK_WIDTH}&q=75`,
    );
  });

  /**
   * `/_vercel/image` exists only on a Vercel deployment. Rewriting anywhere
   * else replaces a working image with a 404 — the optimization degrades to
   * the original, never to nothing.
   */
  it('leaves the URL alone when there is no optimizer to serve it', () => {
    delete process.env.VERCEL;
    expect(optimizedRemoteImage(UPLOADED)).toBe(UPLOADED);
  });

  it('leaves alone anything that is not a plain https URL', () => {
    for (const url of [
      '',
      '/assets/nfl-logos/NO.svg',
      'http://www48.myfantasyleague.com/x.png',
      'data:image/png;base64,AAAA',
      'https://user:pw@www48.myfantasyleague.com/x.png',
      'https://www48.myfantasyleague.com:8443/x.png',
      'https://localhost/x.png',
    ]) {
      expect(optimizedRemoteImage(url)).toBe(url);
    }
  });

  /**
   * THE IMAGE CONFIG LIVES IN `astro.config.ts`, NOT `vercel.json`.
   *
   * The Vercel adapter writes `.vercel/output/config.json` (Build Output API)
   * and THAT is what `/_vercel/image` reads. This shipped to a preview with
   * the block in `vercel.json` first: it deployed, it looked configured, and
   * every mark on the board rendered as a broken-image icon because each
   * optimize request answered `400 INVALID_IMAGE_OPTIMIZE_REQUEST`.
   *
   * Both halves are checked because a request needs both: a `w` outside
   * `sizes` is a 400, and so is a host outside `remotePatterns` — which is
   * also the real allowlist for where our own edge will fetch a source image
   * from, and the reason `optimizedRemoteImage` keeps no second copy of it.
   */
  it('asks for a width the deployment serves, from a host it allows', () => {
    const astroConfig = readFileSync('astro.config.ts', 'utf8');
    const sizes = astroConfig.match(/sizes:\s*\[([^\]]*)\]/)?.[1] ?? '';
    expect(sizes.split(',').map((n) => Number(n.trim()))).toContain(REMOTE_MARK_WIDTH);

    // ONE host list, imported rather than restated. A host the config allows
    // and the helper does not is a lost optimization; a host the helper allows
    // and the config does not is a 400 with a broken mark in its place — so
    // the two must be the same object, not two lists that agree today.
    expect(astroConfig).toContain('remotePatterns: REMOTE_MARK_HOSTS');
    expect(astroConfig).toMatch(/import \{ REMOTE_MARK_HOSTS \} from '\.\/src\/utils\/remote-image'/);
    expect(REMOTE_MARK_HOSTS).toEqual(
      expect.arrayContaining([{ protocol: 'https', hostname: '**.myfantasyleague.com' }]),
    );

    // And the dead config does not come back: a `vercel.json` images block is
    // ignored here, so leaving one would be a second source of truth that
    // cannot be right.
    expect(JSON.parse(readFileSync('vercel.json', 'utf8')).images).toBeUndefined();
  });

  /**
   * A franchise mark is an arbitrary URL and most of them are NOT on MFL's own
   * hosts — this repo's committed league exports carry marks on `theleague.us`,
   * `mfl.football`, `dynastytheleague.com`, `mfladdons.com`, `nbc.com` and
   * `amtv.jp`, with roughly 1 in 15 on `*.myfantasyleague.com`. Vercel answers
   * a `url=` outside `remotePatterns` with a 400, so rewriting one of those
   * does not lose an optimization, it replaces a working mark with a broken
   * box — worse than the initials it displaced.
   */
  it('leaves a host the optimizer would refuse on its original URL', () => {
    for (const url of [
      'https://theleague.us/images/team.png',
      'https://www.nbc.com/logo.png',
      'https://mflfootballv2.vercel.app/assets/theleague/icons/pigskins.png',
      'https://www.mfladdons.com/art.png',
      'https://notmyfantasyleague.com/x.png',
    ]) {
      expect(optimizedRemoteImage(url)).toBe(url);
    }
  });

  it('optimizes the MFL hosts, apex and subdomain alike', () => {
    for (const url of [
      'https://www48.myfantasyleague.com/a.png',
      'https://myfantasyleague.com/b.png',
      'https://API.MyFantasyLeague.com/c.png',
    ]) {
      expect(optimizedRemoteImage(url)).toContain('/_vercel/image?url=');
    }
  });
});

describe('the square crop', () => {
  const card = readFileSync('src/components/shared/live/LvMatchupCard.tsx', 'utf8');
  const boardCss = readFileSync('src/styles/live.css', 'utf8');
  const togglesCss = readFileSync('src/styles/mfl-live.css', 'utf8');

  /**
   * CROP THE UPLOADED MARK, FIT EVERYTHING ELSE. An unknown aspect ratio
   * letterboxed into a 1.4rem box is a few-pixel sliver; the same box with a
   * crest in it is correct, and cropping it would cut off the logo. The rung
   * is what keeps the two apart, so the gate must name it.
   */
  it('crops only on the uploaded-mark rung', () => {
    expect(card).toContain("team.rung === 'mfl'");
    expect(card).toContain('lv-side__crest--crop');
  });

  /**
   * A FAILED MARK FALLS THROUGH TO THE RUNG BELOW, rather than leaving an
   * empty square. An uploaded mark lives on whatever host its commissioner
   * used — several in this repo's own exports are long dead — so this is a
   * permanent condition. Hiding the alt text (the CSS below) stops a broken
   * mark from repainting the row; `onError` is what gives the franchise back
   * the initials it had before the ladder found a mark at all. Both render
   * sites go through the same component so neither can keep only half of it.
   */
  it('falls back to the initials when a mark fails to load', () => {
    const mark = readFileSync('src/components/shared/live/LvMark.tsx', 'utf8');
    expect(mark).toContain('onError');
    expect(mark).toMatch(/if \(!icon \|\| failed\)/);
    for (const site of [card, readFileSync('src/components/shared/mfl-live/LeagueToggles.tsx', 'utf8')]) {
      expect(site).toContain('<LvMark');
      // No hand-rolled second copy of the same markup beside it.
      expect(site).not.toMatch(/<img\s+src=\{(team|league)\.icon\}/);
    }
  });

  /**
   * A mark is a URL somebody else controls. When it 404s the browser paints
   * its ALT TEXT at body size inside a 1.4rem box, which is how a broken
   * optimize request turned two matchup rows into "Rhinos logo" wrapped over
   * three lines each on a real board. The alt attribute stays for screen
   * readers; it just may not repaint the row.
   */
  it('contains a mark that fails to load', () => {
    expect(boardCss).toMatch(/\.lv-side__crest \{[^}]*overflow: hidden;[^}]*font-size: 0;/);
    expect(togglesCss).toMatch(/\.mls__mark:not\(\.mls__mark--text\) \{[^}]*overflow: hidden;/);
  });

  it('crops with cover and fits everything else with contain', () => {
    expect(boardCss).toMatch(/\.lv-side__crest img \{[^}]*object-fit: contain;/);
    expect(boardCss).toMatch(/\.lv-side__crest--crop img \{[^}]*object-fit: cover;/);
    expect(togglesCss).toMatch(/\.mls__mark img \{[^}]*object-fit: contain;/);
    expect(togglesCss).toMatch(/\.mls__mark--crop img \{[^}]*object-fit: cover;/);
  });
});

/**
 * The READ that supplies the rung — parsed straight, from the league export's
 * real shape.
 *
 * Copilot asked for this on PR #1182 and was right to: the icon-vs-logo choice
 * and the https filter are new rules living in one `.find()`, and nothing
 * exercised them directly. The rest of the suite mocks this function away.
 */
describe('readLeagueFranchiseMarks — what it takes from the league export', () => {
  const league = (over: Record<string, unknown> = {}) =>
    ({ id: '10105', name: "Archie's", franchiseId: '0001', franchiseName: 'Rhinos',
       registered: null, host: 'https://www48.myfantasyleague.com', isSession: false, ...over }) as any;

  const respond = (franchise: unknown) =>
    vi.spyOn(globalThis, 'fetch' as never).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ league: { franchises: { franchise } } }),
    } as never);

  beforeEach(() => {
    clearSchedulePairingsCache();
    vi.restoreAllMocks();
  });

  /** A fresh league id per case: the read caches per league-host-year in process. */
  const read = (id: string) => readLeagueFranchiseMarks(league({ id }), 2026, 'cookie');

  it('prefers icon over logo — MFL\u2019s small slot before its banner slot', async () => {
    respond([{ id: '0001', name: 'Rhinos', icon: 'https://x/i.png', logo: 'https://x/l.png' }]);
    expect((await read('a1'))['0001']).toEqual({ name: 'Rhinos', icon: 'https://x/i.png' });
  });

  it('falls back to logo when there is no icon', async () => {
    respond([{ id: '0001', name: 'Rhinos', logo: 'https://x/l.png' }]);
    expect((await read('a2'))['0001'].icon).toBe('https://x/l.png');
  });

  /**
   * HTTPS ONLY. The URL is about to be rendered as an `img src` and handed to
   * our own image optimizer, and real exports carry `http://` marks and at
   * least one malformed `hhttp:` — neither is a mark, and both would render as
   * a broken box where initials would have worked.
   */
  it('takes no mark at all from a non-https field', async () => {
    respond([{ id: '0001', name: 'Rhinos', icon: 'http://x/i.png', logo: 'hhttp://x/l.png' }]);
    expect((await read('a3'))['0001']).toEqual({ name: 'Rhinos', icon: '' });
  });

  /** A blank name is not recorded — the caller's own label is better than ''. */
  it('skips a franchise with no name', async () => {
    respond([{ id: '0001', name: '', icon: 'https://x/i.png' }, { id: '0002', name: 'Freeze' }]);
    const marks = await read('a4');
    expect(marks['0001']).toBeUndefined();
    expect(marks['0002']).toEqual({ name: 'Freeze', icon: '' });
  });

  /** MFL collapses a one-element list to a bare object, everywhere. */
  it('accepts a single franchise as an object, and pads its id', async () => {
    respond({ id: '7', name: 'Solo', icon: 'https://x/i.png' });
    expect(Object.keys(await read('a5'))).toEqual(['0007']);
  });

  it('returns nothing rather than throwing when the body is not a league export', async () => {
    respond(undefined);
    expect(await read('a6')).toEqual({});
  });
});
