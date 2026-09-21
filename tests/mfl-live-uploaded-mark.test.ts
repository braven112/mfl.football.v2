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

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveFranchiseIdentity, identityIconAlt } from '../src/utils/mfl-live-identity';
import { optimizedRemoteImage, REMOTE_MARK_WIDTH } from '../src/utils/remote-image';

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
   * The width we ask for must be one the deployment will SERVE. Vercel answers
   * a `w` outside `images.sizes` with a 400, which would take out every
   * uploaded mark on the board at once — and the hostname list in
   * `remotePatterns` is the real allowlist for where our own edge will fetch
   * from, which is why the helper keeps no second copy of it.
   */
  it('asks for a width vercel.json actually serves, from a host it allows', () => {
    const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(vercel.images?.sizes).toContain(REMOTE_MARK_WIDTH);
    expect(vercel.images?.remotePatterns).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ protocol: 'https', hostname: '**.myfantasyleague.com' }),
      ]),
    );
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

  it('crops with cover and fits everything else with contain', () => {
    expect(boardCss).toMatch(/\.lv-side__crest img \{[^}]*object-fit: contain;/);
    expect(boardCss).toMatch(/\.lv-side__crest--crop img \{[^}]*object-fit: cover;/);
    expect(togglesCss).toMatch(/\.mls__mark img \{[^}]*object-fit: contain;/);
    expect(togglesCss).toMatch(/\.mls__mark--crop img \{[^}]*object-fit: cover;/);
  });
});
