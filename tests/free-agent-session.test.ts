/**
 * Free agents — the page's signed-in verdict is computed ONCE and read back
 * from ONE place.
 *
 * Follow-up to #974 (F2). Both free-agent pages need the same answer to "is
 * this visitor an owner HERE?" for four things: the Claim/Bid column, the
 * waiver-priority gate, the on-site sign-in prompt and My Watch List. After
 * #971 each page derived it three ways (frontmatter, a define:vars copy for
 * the classic script, and WatchListBridge re-reading it from the DOM). They
 * agreed — but only because every copy happened to start from
 * `claimFranchiseId`, and both leagues have a franchise 0001, so a copy that
 * dropped the league test would silently offer the other league's owner a
 * Claim button the server refuses.
 *
 * Now: `franchiseIdForLeague` (src/utils/auth.ts) is the resolver, the page
 * passes its verdict to WatchListBridge, and every client-side reader —
 * the bridge's own module AND the page's classic script — reads it off
 * `#watch-list-bridge[data-signed-in]`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { franchiseIdForLeague, type AuthUser } from '../src/utils/auth';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const PAGES = ['src/pages/theleague/players.astro', 'src/pages/afl-fantasy/players.astro'];
const BRIDGE = 'src/components/shared/WatchListBridge.astro';

const owner = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'MFL_1',
  name: 'Owner',
  franchiseId: '0001',
  leagueId: '13522',
  role: 'owner',
  ...over,
});

describe('franchiseIdForLeague — the one signed-in verdict for a league-scoped page', () => {
  it('returns the franchise when the session belongs to the league', () => {
    expect(franchiseIdForLeague(owner(), '13522')).toBe('0001');
  });

  it('is null for a signed-out visitor', () => {
    expect(franchiseIdForLeague(null, '13522')).toBeNull();
    expect(franchiseIdForLeague(undefined, '13522')).toBeNull();
  });

  it('is null for a session scoped to the OTHER league, even with the same franchise id', () => {
    // Both leagues have a 0001 — the league test is what makes the id mean anything.
    expect(franchiseIdForLeague(owner({ leagueId: '19621' }), '13522')).toBeNull();
  });

  it('is null for a session with no franchise', () => {
    expect(franchiseIdForLeague(owner({ franchiseId: '' }), '13522')).toBeNull();
  });
});

describe('both free-agent pages derive their verdict through the resolver', () => {
  for (const page of PAGES) {
    const src = read(page);
    const frontmatter = src.slice(0, src.indexOf('\n---', 4));

    it(`${page}: claimFranchiseId comes from franchiseIdForLeague, not an inline leagueId compare`, () => {
      expect(frontmatter).toMatch(/import \{[^}]*franchiseIdForLeague[^}]*\} from '\.\.\/\.\.\/utils\/auth'/);
      expect(frontmatter).toMatch(/const claimFranchiseId = franchiseIdForLeague\(authUser, /);
      expect(frontmatter).not.toMatch(/authUser\.leagueId ===/);
    });

    it(`${page}: the classic script reads the verdict off the bridge element, not a define:vars copy`, () => {
      // A define:vars copy is a second source that can drift; the bridge
      // element is rendered above the script, so it is already in the DOM at
      // script eval — which is when the stored view preference is applied.
      const defineVars = src.match(/<script define:vars=\{\{([^}]*)\}\}/)?.[1] ?? '';
      expect(defineVars.split(',').map((s) => s.trim())).not.toContain('watchSignedIn');
      expect(src).toMatch(
        /const watchListSignedIn = \(\) =>\s*document\.getElementById\('watch-list-bridge'\)\?\.dataset\.signedIn === 'true'/,
      );
    });

    it(`${page}: the bridge is mounted with the page's own verdict`, () => {
      expect(src).toMatch(/<WatchListBridge signedIn=\{watchSignedIn\} \/>/);
      expect(frontmatter).toContain('const watchSignedIn = !!claimFranchiseId;');
    });
  }
});

describe('no page re-derives a league-scoped franchise id inline', () => {
  // The exact expression the helper replaced. It survived in both news pages
  // after the players pages moved (caught in review of the follow-up PR), so
  // the scan is repo-wide: a page that wants "the session's franchise in THIS
  // league" calls franchiseIdForLeague, where the league test cannot be
  // dropped by accident.
  const INLINE_DERIVATION = /authUser\s*&&\s*authUser\.leagueId\s*===\s*[^?]+\?\s*\(?authUser\.franchiseId\s*\?\?\s*null\)?\s*:\s*null/;
  const pages = (function walk(dir: string): string[] {
    return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((d) => {
      const p = `${dir}/${d.name}`;
      if (d.isDirectory()) return walk(p);
      return d.name.endsWith('.astro') ? [p] : [];
    });
  })('src/pages');

  it('every src/pages/**/*.astro goes through franchiseIdForLeague for that derivation', () => {
    const offenders = pages.filter((p) => INLINE_DERIVATION.test(read(p)));
    expect(offenders, 'inline `authUser.leagueId === … ? franchiseId : null` — use franchiseIdForLeague').toEqual([]);
  });
});

describe('WatchListBridge exposes the verdict on one element and reads it from there', () => {
  const src = read(BRIDGE);

  it('renders data-signed-in from the page prop', () => {
    expect(src).toContain(`<div id="watch-list-bridge" data-signed-in={signedIn ? 'true' : 'false'} hidden></div>`);
  });

  it('its own module reads the same attribute back', () => {
    expect(src).toMatch(/document\.getElementById\('watch-list-bridge'\)\?\.dataset\.signedIn === 'true'/);
  });
});
