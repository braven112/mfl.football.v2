/**
 * A page that renders the Owners' Poll lineup strip must import its stylesheet.
 *
 * `LineupBallotStrip` and the `BallotBuilder` it wraps are React islands, and
 * no React component in this feature imports CSS — `src/styles/owners-poll.css`
 * is the only definition of every class they emit (`op-lineup`, `op-slot`,
 * `op-card`, `op-pool`, `op-submit`, …). Astro bundles frontmatter CSS PER
 * PAGE, so a page that renders the island without the import ships raw
 * unstyled divs and buttons the moment a ballot opens — and only then, which
 * is why nothing catches it out of season.
 *
 * The ballot and voters routes do NOT need this: their shared *Astro*
 * component (`OwnersPollBallotPage` / `OwnersPollVotersPage`) carries its own
 * import, so every league route inherits it. A page rendering the React island
 * directly is the one case where the page itself has to remember.
 *
 * This shipped: the AFL port added the strip to `afl-fantasy/lineup.astro` and
 * not the import, and the diff could not show it because the correct half of
 * the pair — `theleague/lineup.astro`, which has had the import since the poll
 * launched — was the file that did not change.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';

const PAGES = 'src/pages';
const STYLESHEET = 'styles/owners-poll.css';
const ISLAND = 'owners-poll/LineupBallotStrip';

function astroPages(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) astroPages(full, out);
    else if (entry.endsWith('.astro')) out.push(full);
  }
  return out;
}

describe('Owners\' Poll lineup strip', () => {
  const renderers = astroPages(PAGES).filter((f) =>
    readFileSync(f, 'utf8').includes(ISLAND),
  );

  it('is rendered by at least one page, or this guard is testing nothing', () => {
    // Guards against the file being renamed out from under the scan and this
    // suite quietly passing over an empty list.
    expect(renderers.length).toBeGreaterThan(0);
  });

  it.each(renderers.map((f) => relative('.', f)))(
    '%s imports owners-poll.css',
    (file) => {
      const source = readFileSync(file, 'utf8');
      expect(
        source.includes(STYLESHEET),
        `${file} renders LineupBallotStrip but never imports ${STYLESHEET}; ` +
          'an open ballot will render unstyled there.',
      ).toBe(true);
    },
  );

  it('both league lineup pages render it, so the pair cannot drift again', () => {
    // The specific drift this guard exists for: the strip landing on one
    // league's lineup page and not the other's.
    expect(renderers.map((f) => relative('.', f)).sort()).toEqual([
      'src/pages/afl-fantasy/lineup.astro',
      'src/pages/theleague/lineup.astro',
    ]);
  });
});
