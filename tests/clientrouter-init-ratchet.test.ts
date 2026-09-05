import { describe, it, expect } from 'vitest';
import { join } from 'node:path';
import { collectClientRouterOffenders } from '../scripts/lib/ratchet-measures.mjs';
import baseline from './fixtures/clientrouter-init-baseline.json';

/**
 * ClientRouter init ratchet.
 *
 * `TheLeagueLayout` mounts Astro's `<ClientRouter />`, so a bundled
 * `<script>` in a page or component is evaluated ONCE per browser session
 * and the DOM is swapped underneath it on every in-site navigation. Code
 * that wires itself up on `DOMContentLoaded` therefore runs on the first
 * full load and never again: the page comes back inert on a return visit
 * and nothing throws. Salary Analytics, both Set Lineup pages, the AFL
 * trade builder, the Asset Library and MatchupSelector each shipped exactly
 * that bug and each got its own after-the-fact test (see the
 * `*-clientrouter.test.ts` suites). This is the generic guard.
 *
 * The rule (docs/claude/insights/domains/frontend.md, "Astro and
 * ClientRouter"): interactive scripts re-init on `astro:page-load`, which
 * also fires on the initial load, so DOMContentLoaded is never needed.
 *
 * A ratchet rather than a hard fail because 20-odd files predate the rule.
 * The baseline may only SHRINK: a new file that inits on DOMContentLoaded
 * without astro:page-load fails, and a listed file that was fixed fails too
 * so the list is retightened (`node scripts/ratchet.mjs --write`).
 * `is:inline` scripts are exempt — they run per document, not per session.
 */

const SRC = join(process.cwd(), 'src');

describe('ClientRouter init ratchet', () => {
  const now = collectClientRouterOffenders(SRC);
  const recorded = new Set<string>(baseline.files);

  it('finds the known offenders (guards against a scanner that matches nothing)', () => {
    expect(now.length).toBeGreaterThan(0);
  });

  it('adds no new file that initialises only on DOMContentLoaded', () => {
    const added = now.filter((f) => !recorded.has(f));
    expect(
      added,
      added.length === 0
        ? ''
        : `New DOMContentLoaded-only init under the ClientRouter:\n  ${added.join('\n  ')}\n\n` +
            `Wire the init to astro:page-load instead — it fires on the first load too, so ` +
            `DOMContentLoaded is never needed — and re-read every element inside it ` +
            `(see tests/salary-page-clientrouter.test.ts for the shape). Do not add the ` +
            `file to tests/fixtures/clientrouter-init-baseline.json: the list only shrinks.`,
    ).toEqual([]);
  });

  it('has no stale baseline entries — retighten when a file is fixed', () => {
    const stale = baseline.files.filter((f) => !now.includes(f));
    expect(
      stale,
      stale.length === 0
        ? ''
        : `Fixed since the baseline was recorded — remove from the fixture (node scripts/ratchet.mjs --write):\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });
});
