import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MFL_LOGIN_DEFAULT_REDIRECT,
  resolveMflLoginRedirect,
} from '../src/utils/mfl-login-redirect';

const ROOT = join(__dirname, '..');

/**
 * The MFL app's post-login destination.
 *
 * Two rules, and the second is why this file exists at all:
 *
 *  1. It comes BACK to the app. TheLeague's login validates `?redirect=` with
 *     `startsWith('/theleague')` and falls back to `/theleague`, so a sign-in
 *     that started at /live landed on TheLeague's homepage — the bug this
 *     resolver was written to fix.
 *  2. It never leaves the origin. A login page is the highest-value place in
 *     an app to plant an open redirect: the victim is mid-authentication and
 *     expects to be sent somewhere.
 */
describe('resolveMflLoginRedirect', () => {
  describe('the default is the board, never a league homepage', () => {
    it('defaults to /live', () => {
      expect(resolveMflLoginRedirect(null)).toBe('/live');
      expect(MFL_LOGIN_DEFAULT_REDIRECT).toBe('/live');
    });

    it.each([null, undefined, '', '   '])('falls back for %o', (input) => {
      expect(resolveMflLoginRedirect(input)).toBe('/live');
    });

    it('never returns a league homepage for an absent redirect', () => {
      // The actual regression: the old behaviour was '/theleague'.
      expect(resolveMflLoginRedirect(null)).not.toBe('/theleague');
    });

    it('honours an explicit fallback, for a caller that has a better one', () => {
      expect(resolveMflLoginRedirect(null, '/live/settings')).toBe('/live/settings');
    });
  });

  describe('same-origin paths are kept', () => {
    it.each([
      '/live',
      '/live/settings',
      '/theleague/rosters',
      '/afl-fantasy/lineup',
    ])('keeps %s', (path) => {
      expect(resolveMflLoginRedirect(path)).toBe(path);
    });

    it('keeps a query string, so a deep link survives sign-in', () => {
      expect(resolveMflLoginRedirect('/live?week=3')).toBe('/live?week=3');
    });

    it('drops a fragment, which never reached the server anyway', () => {
      expect(resolveMflLoginRedirect('/live#top')).toBe('/live');
      expect(resolveMflLoginRedirect('/live?week=3#top')).toBe('/live?week=3');
    });

    it('trims surrounding whitespace rather than rejecting the path', () => {
      expect(resolveMflLoginRedirect('  /live  ')).toBe('/live');
    });

    /**
     * `/live` is one FEATURE, not the app's root, so the resolver must not be
     * written as a `/live` prefix check — the next feature added beside it
     * would silently stop being a valid destination.
     */
    it('allows app routes outside /live', () => {
      expect(resolveMflLoginRedirect('/some-future-feature')).toBe('/some-future-feature');
    });
  });

  describe('off-origin destinations are refused', () => {
    it.each([
      ['absolute http', 'http://evil.com'],
      ['absolute https', 'https://evil.com/live'],
      ['protocol-relative', '//evil.com'],
      ['protocol-relative with path', '//evil.com/live'],
      ['javascript:', 'javascript:alert(1)'],
      ['data:', 'data:text/html,<script>alert(1)</script>'],
      ['bare relative', 'live'],
      ['parent relative', '../admin'],
      ['backslash escape', '/\\evil.com'],
      ['backslash only', '\\\\evil.com'],
      ['embedded newline', '/live\nSet-Cookie: x=1'],
      ['embedded CR', '/live\r\nLocation: http://evil.com'],
      ['null byte', '/live\x00'],
      ['tab', '/live\tx'],
    ])('refuses %s', (_label, input) => {
      expect(resolveMflLoginRedirect(input)).toBe('/live');
    });

    it('refuses a non-string', () => {
      expect(resolveMflLoginRedirect(42 as unknown as string)).toBe('/live');
      expect(resolveMflLoginRedirect({} as unknown as string)).toBe('/live');
    });

    /**
     * The property that matters more than any single case above: whatever
     * comes back is always a same-origin absolute path.
     */
    it('always returns a path starting with a single /', () => {
      const inputs = [
        null, '', '   ', '/live', '//evil.com', 'https://evil.com', 'javascript:x',
        '/\\evil.com', '../x', '/live#f', '/live?a=b', '\x00', 'live', '/login',
      ];
      for (const input of inputs) {
        const out = resolveMflLoginRedirect(input as string | null);
        expect(out.startsWith('/'), `${JSON.stringify(input)} -> ${out}`).toBe(true);
        expect(out.startsWith('//'), `${JSON.stringify(input)} -> ${out}`).toBe(false);
      }
    });
  });

  describe('the login page is never a destination', () => {
    it('refuses /login, which would bounce on arrival', () => {
      expect(resolveMflLoginRedirect('/login')).toBe('/live');
    });

    it('refuses a nested login path', () => {
      expect(resolveMflLoginRedirect('/login/whatever')).toBe('/live');
    });

    it('refuses /login even when it carries its own redirect', () => {
      expect(resolveMflLoginRedirect('/login?redirect=/live')).toBe('/live');
    });

    it('does not refuse a path that merely starts with the same letters', () => {
      expect(resolveMflLoginRedirect('/login-help')).toBe('/login-help');
    });
  });
});

/**
 * The wiring, scanned rather than rendered.
 *
 * The resolver being correct is worth nothing if the pages still point at
 * TheLeague's login — which is the form the bug actually took.
 */
describe('MFL app sign-in wiring', () => {
  const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');

  const SURFACES = [
    'src/layouts/MflAppLayout.astro',
    'src/pages/live/index.astro',
    'src/pages/live/settings.astro',
  ];

  it.each(SURFACES)('%s links to /login, not a league login page', (rel) => {
    const src = read(rel);
    // Comments explain the history and legitimately name the old path, so the
    // scan looks for it as an href rather than anywhere in the file.
    expect(src).not.toMatch(/href=["'][^"']*\/theleague\/login/);
    expect(src).not.toMatch(/href=["'][^"']*\/afl-fantasy\/login/);
  });

  it('the login route defaults its redirect to the board', () => {
    const src = read('src/pages/login.astro');
    expect(src).toContain('resolveMflLoginRedirect');
    expect(src).toContain('MFL_LOGIN_DEFAULT_REDIRECT');
    // The shared form must be told the app's fallback, or its own '/theleague'
    // default applies on the paths that reassign finalUrl.
    expect(src).toMatch(/fallbackRedirect=\{MFL_LOGIN_DEFAULT_REDIRECT\}/);
  });

  it('the login route is SSR — it reads the session and the host', () => {
    expect(read('src/pages/login.astro')).toMatch(/export const prerender = false/);
  });

  /**
   * `isSharedAppHost` lists exactly two hostnames, so gating this page on it
   * would make it unreachable on every Vercel preview — the only environment
   * it can actually be tested in before release.
   */
  it('gates the league redirect on the host->slug map, not isSharedAppHost', () => {
    const src = read('src/pages/login.astro');
    expect(src).toContain('buildHostToSlugMap');
    // The page's own comment explains why this helper is the wrong gate, so
    // the scan looks for a CALL and for the import, not for the name.
    expect(src).not.toMatch(/isSharedAppHost\s*\(/);
    expect(src).not.toMatch(/import[^;]*isSharedAppHost[^;]*from/s);
  });
});

/**
 * The shared LoginForm is no longer TheLeague's alone.
 */
describe('LoginForm is league-neutral where it has to be', () => {
  const src = readFileSync(join(ROOT, 'src/components/theleague/LoginForm.astro'), 'utf8');

  it('takes the post-login fallback as a prop', () => {
    expect(src).toMatch(/fallbackRedirect\?: string/);
  });

  it('resolves the post-login fallback per league, with no /theleague literal left', () => {
    // THE INVARIANT: no branch of the client redirect can land on a hardcoded
    // league. It used to be spelled `finalUrl = '/theleague'` in three places
    // (the initial resolve, the bad-URL catch, the not-same-origin guard), and
    // the first fix threaded a `fallbackRedirect` prop through all three.
    //
    // The mechanism has since moved SERVER-side: the three branches collapsed
    // into resolveFinalUrl(), whose floor is `data-fallback-path` — the
    // consumer's own fallback when it passed one (the MFL app passes /live),
    // else THIS form's league home from the registry. That is strictly more
    // correct than the prop default it replaced, which was still '/theleague'
    // and therefore still the wrong league on two of the three league pages.
    //
    // So the assertion follows the invariant, not the old spelling.
    const script = src.slice(src.indexOf('<script>'));
    expect(script.match(/finalUrl = '\/theleague'/g) ?? []).toEqual([]);
    // CODE only — the comment above resolveFinalUrl names the old literal to
    // explain why it is gone, and a scan that fails on its own documentation
    // teaches people to delete the documentation.
    const code = script
      .split('\n')
      .filter((l) => {
        const t = l.trim();
        return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*');
      })
      .join('\n');
    expect(code).not.toMatch(/'\/theleague'/);

    // The fallback still reaches the client, and is still resolved rather than
    // assumed: server side from the prop, client side off the data attribute.
    expect(src).toMatch(/const effectiveFallback = fallbackRedirect \?\? loginFallbackPath\(formLeague\)/);
    expect(src).toMatch(/data-fallback-path=\{effectiveFallback\}/);
    expect(script).toContain("formWrapper.dataset.fallbackPath");
  });

  it('names the form from a prop rather than hardcoding The League', () => {
    expect(src).toMatch(/aria-label=\{formLabel\}/);
  });

  /**
   * Both layouts that render this form mount the ClientRouter. A module-scope
   * binding runs once per DOCUMENT, so /login -> /live -> /login swapped in a
   * form whose Sign In button did nothing.
   */
  it('binds on astro:page-load, with a guard against stacking handlers', () => {
    expect(src).toContain("document.addEventListener('astro:page-load'");
    expect(src).toMatch(/dataset\.loginBound/);
  });
});
