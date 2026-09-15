import { describe, it } from 'vitest';
import { expectClean, scanForbidden } from './helpers/scan-guard';

/**
 * Sign-in URLs are BUILT, never spelled out.
 *
 * Three login pages each validated the return path with their own
 * `startsWith('/<slug>')`, and the gates feeding them disagreed on the param
 * name: TheLeague emitted `?redirect=`, the AFL `?next=`, and
 * `best-ball-1/login` read `next` ALONE — so a `?redirect=` link there was
 * silently dropped and the owner landed on the league home. Six more gates
 * carried no return path at all, including mock-draft deep links whose session
 * id is unguessable.
 *
 * `src/utils/login-redirect.ts` is now the one builder. It picks the param,
 * validates the path against the league being signed into (not merely
 * same-origin — both leagues have a franchise 0001), and emits the URL in the
 * shape the host serves, which is what keeps an apex domain from 302-ing into
 * a redirect the edge 301s straight back. A hand-built URL skips all of it.
 *
 * `?redirect=` stays READABLE forever — links sit in GroupMe messages and
 * owners' bookmarks — so this guards what we EMIT, not what we accept.
 * See docs/plans/login-redirect.md.
 *
 * Exemptions: the builder itself, its tests, and MFL's own remote login
 * endpoint (`api.myfantasyleague.com/<year>/login` — not a route on this
 * site). Comment lines are skipped structurally: several modules explain the
 * old shape in prose, and a guard that fails on its own documentation teaches
 * people to delete the documentation.
 */
describe('login redirect guard', () => {
  it('never hand-builds a sign-in URL, and never emits ?redirect=', () => {
    const result = scanForbidden({
      roots: ['src', 'scripts'],
      extensions: ['.ts', '.tsx', '.mjs', '.astro'],
      forbidden: [
        {
          // `/theleague/login?redirect=…`, `?next=…` — the param belongs to
          // the builder, which is also what carries the apex-host shape.
          name: 'hand-built login query',
          pattern: /\/login\?(?:next|redirect)=/,
        },
        {
          // A login path assembled from a slug or a base variable:
          // `${base}/login`, `/${league.slug}/login`, `${prefix}/login`.
          name: 'interpolated login path',
          pattern: /\$\{[^}]+\}\/login\b/,
        },
        {
          // The param name itself, wherever a URL is being written.
          name: 'redirect param',
          pattern: /[?&]redirect=/,
        },
      ],
      allowlist: [],
      exempt: ({ file, line, name }) => {
        // The builder and its own tests must name the strings they own.
        if (file === 'src/utils/login-redirect.ts') return true;
        if (file.startsWith('tests/')) return true;

        // Prose. Every module that fixed this bug explains it in a comment.
        const t = line.trim();
        if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return true;

        // MFL's OWN login endpoint is a remote API on another host, not a
        // route on this site, so the builder has nothing to say about it. It
        // is recognisable by shape rather than by hostname, because the host
        // is always a variable (`mflHost` from the registry, or a `host` arg
        // in the probe scripts): MFL puts a SEASON YEAR segment before
        // `/login`, which none of our own routes do.
        // Three spellings in the tree, all of them MFL: the literal hostname,
        // the registry's `mflHost`, and a bare `host` arg in the probe
        // scripts — the last recognisable only by MFL's season-year segment,
        // which none of our own routes have.
        const looksLikeMfl =
          /myfantasyleague\.com|mflHost|\/\$\{(?:season)?[Yy]ear\}\/login/.test(line);
        if (name === 'interpolated login path' && looksLikeMfl) return true;

        return false;
      },
    });

    expectClean(
      result,
      'Build every sign-in URL with loginUrlFor/loginUrlForRequest from ' +
        'src/utils/login-redirect.ts — it picks the param, validates the return ' +
        'path against the league, and emits the apex-host shape. ' +
        'See docs/plans/login-redirect.md.',
    );
  });
});
