import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { isEspnCdnUrl } from '../src/utils/espn-cdn';
import { isCompositable, heroModelHasCutout } from '../src/utils/hero-casting';
import { isSplashCutoutEligible } from '../src/utils/pick-reveal';
import { resolveCutoutUrl } from '../src/utils/player-modal-band';
import { isCompositableTradePlayer } from '../src/components/theleague/trade-builder/TradeCompositeStrip';

const NFL = 'https://a.espncdn.com/i/headshots/nfl/players/full/4362628.png';
const COLLEGE = 'https://a.espncdn.com/i/headshots/college-football/players/full/4890973.png';
const MFL_JPG = 'https://www49.myfantasyleague.com/player_photos_big_2014/13116_thumb.jpg';

describe('isEspnCdnUrl', () => {
  it('accepts the real ESPN headshot URLs both feeds produce', () => {
    expect(isEspnCdnUrl(NFL)).toBe(true);
    expect(isEspnCdnUrl(COLLEGE)).toBe(true);
    // Bare apex and other subdomains, for completeness
    expect(isEspnCdnUrl('https://espncdn.com/x.png')).toBe(true);
    expect(isEspnCdnUrl('https://secure.espncdn.com/x.png')).toBe(true);
    expect(isEspnCdnUrl('http://a.espncdn.com/x.png')).toBe(true);
  });

  it('rejects the lookalikes a substring test let through', () => {
    // The two shapes CodeQL's js/incomplete-url-substring-sanitization names:
    // the string in the PATH, and a registrable domain that merely starts with it.
    expect(isEspnCdnUrl('https://evil.com/espncdn.com/x.png')).toBe(false);
    expect(isEspnCdnUrl('https://espncdn.com.evil.com/x.png')).toBe(false);
    expect(isEspnCdnUrl('https://evil.com/?x=a.espncdn.com')).toBe(false);
    expect(isEspnCdnUrl('https://notespncdn.com/x.png')).toBe(false);
  });

  it('rejects non-ESPN sources without throwing', () => {
    expect(isEspnCdnUrl(MFL_JPG)).toBe(false);
    expect(isEspnCdnUrl('data:image/svg+xml,%3Csvg%3E%3C/svg%3E')).toBe(false);
    expect(isEspnCdnUrl('not a url espncdn.com')).toBe(false);
    expect(isEspnCdnUrl('/i/headshots/nfl/players/full/1.png')).toBe(false);
    // A relative path is not a host — and this is the one relative shape the
    // old substring test WOULD have accepted, which is the point of rejecting it.
    expect(isEspnCdnUrl('/espncdn.com/x.png')).toBe(false);
    expect(isEspnCdnUrl('')).toBe(false);
    expect(isEspnCdnUrl(null)).toBe(false);
    expect(isEspnCdnUrl(undefined)).toBe(false);
  });

  it('rejects a non-http(s) scheme even with an ESPN authority', () => {
    // `javascript:`, `data:` and `ftp:` are not "special" schemes, so the
    // WHATWG parser reads `//a.espncdn.com/...` after them as a real authority
    // and `.hostname` really is `a.espncdn.com`. A host-only check passes these.
    expect(isEspnCdnUrl('javascript://a.espncdn.com/%0aalert(1)')).toBe(false);
    expect(isEspnCdnUrl('data://a.espncdn.com/x')).toBe(false);
    expect(isEspnCdnUrl('ftp://a.espncdn.com/x.png')).toBe(false);
  });

  it('is not fooled by the usual host-confusion tricks', () => {
    // Userinfo: the parsed host is what follows `@`, so this is evil.com.
    expect(isEspnCdnUrl('https://a.espncdn.com@evil.com/x.png')).toBe(false);
    // Backslashes normalize to slashes in a special scheme's authority.
    expect(isEspnCdnUrl('https://evil.com\\@a.espncdn.com/x.png')).toBe(false);
    // A trailing dot is a distinct host, not espncdn.com.
    expect(isEspnCdnUrl('https://a.espncdn.com./x.png')).toBe(false);
    // Case is normalized by the parser, so an uppercase host still matches.
    expect(isEspnCdnUrl('https://A.ESPNCDN.COM/x.png')).toBe(true);
    // `.endsWith('.espncdn.com')` must not accept a host that merely ends in
    // the same letters without the dot boundary.
    expect(isEspnCdnUrl('https://xespncdn.com/x.png')).toBe(false);
  });

  it('accepts protocol-relative ESPN URLs', () => {
    // `new URL()` throws on these, so a naive host check would return false —
    // but the substring test this replaces accepted them. Resolving against
    // https: is what keeps the tightening behavior-preserving. The lookalike
    // rules still apply through the same parse.
    expect(isEspnCdnUrl('//a.espncdn.com/i/headshots/nfl/players/full/1.png')).toBe(true);
    expect(isEspnCdnUrl('//espncdn.com.evil.com/x.png')).toBe(false);
  });
});

describe('every composite gate agrees with the shared helper', () => {
  // One definition means these can't drift. Each entry is (label, predicate)
  // applied to a non-DEF player whose only variable is the headshot URL.
  const gates: Array<[string, (url: string) => boolean]> = [
    ['hero-casting isCompositable', (headshot) =>
      isCompositable({ mflId: '1', name: 'A B', position: 'RB', nflTeam: 'BAL', headshot, espnId: '1', nflEspnId: '1', draftYear: '2024' })],
    ['hero-casting heroModelHasCutout', (headshot) =>
      heroModelHasCutout({ mflId: '1', name: 'A B', position: 'RB', nflTeam: 'BAL', headshot, descriptor: '' })],
    ['pick-reveal isSplashCutoutEligible', (headshot) =>
      isSplashCutoutEligible({ id: '1', name: 'A B', position: 'RB', nflTeam: 'BAL', headshot })],
    ['player-modal-band resolveCutoutUrl', (headshot) =>
      resolveCutoutUrl({ position: 'RB', headshot }) !== null],
    ['TradeCompositeStrip isCompositableTradePlayer', (headshot) =>
      isCompositableTradePlayer({ id: '1', name: 'A B', position: 'RB', team: 'BAL', headshot } as never)],
  ];

  const urls = [
    NFL,
    COLLEGE,
    MFL_JPG,
    'https://evil.com/espncdn.com/x.png',
    'https://espncdn.com.evil.com/x.png',
    'not a url espncdn.com',
    '',
  ];

  for (const [label, gate] of gates) {
    it(label, () => {
      for (const url of urls) {
        expect(gate(url), `${label} disagreed on ${url || '<empty>'}`).toBe(isEspnCdnUrl(url));
      }
    });
  }
});

describe('scan guard', () => {
  it('keeps a substring espncdn check from coming back', () => {
    // Eight production sites answered "is this an ESPN CDN image?" with
    // `url.includes('espncdn.com')`. Two files had already been hardened to a
    // host check — and that left no tripwire, which is exactly why the other
    // eight survived. This is the tripwire: one definition, and the build fails
    // if a substring test reappears anywhere in src/.
    //
    // Same walk idiom as tests/afl-hero-casting.test.ts — node:fs globSync
    // isn't in this TS lib's types, and the ratchet counts that as an error.
    const CODE = new Set(['.ts', '.tsx', '.astro', '.mjs', '.js']);
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(full));
        else if (CODE.has(extname(entry.name))) out.push(full);
      }
      return out;
    };
    // Comments are stripped first so espn-cdn.ts's own doc block — which has to
    // NAME the banned pattern to explain itself — needs no allowlist entry.
    // Nothing is exempt: an allowlist is how the second copy became eight.
    //
    // Only block comments and WHOLE-LINE `//` comments are removed. A line that
    // has code on it is never touched, because a regex cannot tell a comment
    // from a `//` inside a string literal: `x === '//foo' && a.includes('espncdn.com')`
    // would have the real check stripped along with the fake comment, and the
    // guard would pass on offending code. Erring this way can only produce a
    // FALSE POSITIVE (a trailing comment that names the pattern gets flagged) —
    // loud, and fixable by moving the note to its own line. A false negative
    // here is the exact silence this whole guard exists to prevent.
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');

    const files = walk('src');
    expect(files.length).toBeGreaterThan(100);
    const offenders: string[] = [];
    for (const file of files) {
      const src = stripComments(readFileSync(file, 'utf8'));
      // `.includes('espncdn.com')` / `.indexOf(...) !== -1` / a bare regex, in
      // any quoting, with or without the `a.` subdomain prefix.
      if (/\.(includes|indexOf|search|match)\s*\(\s*[`'"/][^`'")]*espncdn\.com/.test(src)) {
        offenders.push(`${file}: substring espncdn check`);
      }
    }
    expect(
      offenders,
      'match ESPN URLs on the parsed HOST — import isEspnCdnUrl from src/utils/espn-cdn.ts',
    ).toEqual([]);
  });
});
