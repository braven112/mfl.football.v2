/**
 * Every inline `<script>` in every .astro file has to parse.
 *
 * This exists because of a near-miss that cost real time during Phase 6.1 of
 * docs/plans/rosters-page-split.md. A sed pass left
 * `cdmState.cutConfirmed: false,` inside an object literal in rosters.astro's
 * inline script — plainly invalid. The symptom was that `/theleague/rosters`
 * started serving the **404 page**, with no error in the dev server log, no
 * overlay, and no failing test. A whole page silently stopped existing.
 *
 * Worse, the obvious check passes. Running the file through
 * `@astrojs/compiler` and then esbuild reports OK, because a script carrying
 * any attribute is treated as `is:inline` and the compiler emits its body as
 * TEXT — so esbuild is handed a module with the broken code inside a string
 * literal and finds nothing wrong with it. `docs/plans/rosters-page-split.md`
 * says to verify this page "via @astrojs/compiler transform + esbuild parse",
 * which is what was done, and it still passed.
 *
 * So the body has to be pulled out and parsed on its own. That is all this
 * does, across every .astro file, which makes the failure mode mechanical
 * instead of something you discover by loading the page.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { globSync } from 'node:fs';
import * as esbuild from 'esbuild';

const files = globSync('src/**/*.astro');

/**
 * `<script>` bodies worth parsing — JSON payload blocks are data, not code.
 *
 * The tag and attribute matches are case-INSENSITIVE because HTML tag names
 * and attribute names are, so `<SCRIPT>` is a perfectly ordinary script
 * element. CodeQL's js/bad-tag-filter caught that this was not: its security
 * rationale (a sanitizer bypassed by case) does not apply to a test that reads
 * the repo's own source, but the defect it names does — a mis-cased tag would
 * have been skipped SILENTLY, leaving a file unchecked while the suite stayed
 * green. That is the exact failure this test exists to prevent, and the reason
 * it carries a non-vacuity case below.
 *
 * The closing tag allows whitespace before the `>` — `</script >` is valid
 * HTML and CodeQL flagged that as the SECOND defect in this same regex, once
 * the casing one was fixed. Same consequence either way: a skipped file, and
 * a suite that stays green while covering less than it claims.
 *
 * `set:html` is deliberately left case-SENSITIVE: it is an Astro directive,
 * not HTML, and Astro's compiler does not recognize `SET:HTML`. Matching it
 * loosely would skip a body that really does need parsing.
 */
function codeScripts(source: string): { body: string; startLine: number }[] {
  const out: { body: string; startLine: number }[] = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    const [full, attrs, body] = m;
    if (!body.trim()) continue;
    // `type="application/json"` / `type="speculationrules"` carry data, and
    // `set:html={...}` bodies are interpolated at render time.
    if (/type\s*=\s*["'](application\/json|speculationrules|importmap)["']/i.test(attrs)) continue;
    if (/\bset:html\b/.test(attrs)) continue;
    out.push({ body, startLine: source.slice(0, m.index).split('\n').length });
  }
  return out;
}

describe('inline <script> blocks parse', () => {
  it('finds scripts to check at all (so a broken glob cannot pass vacuously)', () => {
    expect(files.length).toBeGreaterThan(100);
    const total = files.reduce((n, f) => n + codeScripts(readFileSync(f, 'utf-8')).length, 0);
    expect(total).toBeGreaterThan(50);
  });

  it.each(files)('%s', async (file) => {
    const source = readFileSync(file, 'utf-8');
    for (const { body, startLine } of codeScripts(source)) {
      try {
        // `ts` because these scripts carry type annotations and Astro strips
        // them; JSX is not enabled anywhere in an .astro <script>.
        await esbuild.transform(body, { loader: 'ts' });
      } catch (err: any) {
        const e = err?.errors?.[0];
        throw new Error(
          `${file}: inline script starting at line ${startLine} does not parse\n` +
            `  ${e?.text}\n` +
            `  at ~line ${startLine + (e?.location?.line ?? 0)}: ${e?.location?.lineText ?? ''}`,
        );
      }
    }
  });
});
