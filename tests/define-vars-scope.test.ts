/**
 * A `define:vars` script can only see what is PASSED to it.
 *
 * `<script define:vars={{ a, b }}>` serializes those values into the browser
 * bundle. Every other frontmatter const is server-only and referencing one
 * inside the script body is a ReferenceError at runtime.
 *
 * This is invisible to everything else: `astro check` type-checks the script
 * against the module scope and sees the frontmatter, the unit suite never
 * renders the page, and the build succeeds. The only symptom is the browser
 * console — and if the throw happens inside a row-rendering loop, the table
 * silently comes up EMPTY.
 *
 * That shipped twice in one session: `claimConfig` was referenced from the
 * row builder on both players pages after it was dropped from define:vars,
 * and every player row vanished on both.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/** Pages whose client scripts render list content — the costly place to fail. */
const PAGES = [
  'src/pages/theleague/players.astro',
  'src/pages/afl-fantasy/players.astro',
];

/** Extract `{{ a, b, c: d }}` keys from a define:vars attribute. */
function passedNames(attr: string): Set<string> {
  const names = new Set<string>();
  for (const part of attr.split(',')) {
    const name = part.split(':')[0].replace(/[{}\s]/g, '');
    if (name) names.add(name);
  }
  return names;
}

describe('define:vars scripts only reference values that were passed', () => {
  for (const rel of PAGES) {
    it(`${rel} passes every frontmatter const its client script uses`, () => {
      const source = fs.readFileSync(path.join(process.cwd(), rel), 'utf-8');

      // Frontmatter consts — the pool of server-only names.
      const frontmatter = source.slice(0, source.indexOf('\n---', 3));
      const declared = new Set(
        [...frontmatter.matchAll(/^const\s+([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => m[1])
      );

      const scripts = [...source.matchAll(/<script define:vars=\{\{([^}]*)\}\}>([\s\S]*?)<\/script>/g)];
      expect(scripts.length, 'expected at least one define:vars script').toBeGreaterThan(0);

      for (const [, attr, rawBody] of scripts) {
        const passed = passedNames(attr);
        // Strip what only LOOKS like a reference: comments, string literals and
        // template literals. `case 'salaryYear1':` and a comment mentioning
        // `snapshot` are not references, and flagging them would make the guard
        // untrustworthy on its first run.
        // ORDER MATTERS: strings first. Stripping `//` comments first would
        // eat the rest of any line containing a URL like `https://...` inside
        // a string, unbalancing its quotes so no later string strips cleanly —
        // which is exactly how `case 'salaryYear1':` kept reading as a
        // reference.
        const body = rawBody
          .replace(/'(?:\\.|[^'\\\n])*'/g, "''")
          .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
          .replace(/`(?:\\.|[^`\\])*`/g, '``')
          .replace(/\/\*[\s\S]*?\*\//g, ' ')
          .replace(/\/\/[^\n]*/g, ' ');
        // Names the script BODY references that are frontmatter consts but were
        // not handed over. Locally-declared names shadow, so exclude anything
        // the script declares itself.
        const localDecls = new Set(
          [...body.matchAll(/\b(?:const|let|var|function)\s+([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
        );
        const offenders = [...declared].filter(
          (name) =>
            !passed.has(name) &&
            !localDecls.has(name) &&
            // A bare identifier — not `obj.name` and not `{ name: ... }` as a key.
            new RegExp(`(?<![.\\w$])${name}\\b(?!\\s*:)`).test(body)
        );
        expect(
          offenders,
          `These frontmatter consts are referenced in a define:vars script but not passed to it, ` +
            `so they are ReferenceErrors in the browser: ${offenders.join(', ')}`
        ).toEqual([]);
      }
    });
  }
});
