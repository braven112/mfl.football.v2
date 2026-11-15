/**
 * "The Tight End Files" — running-bit meta-awareness for owner-submitted
 * tight-end jokes.
 *
 * Multiple owners across multiple weeks have been submitting variations of
 * the same tight-end joke. Schefter's response is meta-awareness — he files
 * on the SUBMISSION pattern itself rather than retelling the joke. The bit
 * also has a glacially-rare "Schefter unprompted" path (1-in-50) where he
 * makes an original line about the cataloging absurdity itself.
 *
 * The running-bit lore itself now lives in the private beat-reporter repo,
 * whose tests/lore.test.mjs pins the trigger conditions, frequency caps and
 * anti-leak rules. What stays here is the loader contract. The lore is
 * loaded into the system prompt by `loadLore` (scripts/lib/schefter-lore.mjs),
 * so changes to running-bits.md are read at runtime — no scanner restart
 * required, but the prompt cache (`_cache` closure in loadLore) lives for
 * the lifetime of the Node process.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), 'utf8');
}

describe('lore loader picks up the new bit', () => {
  // The scanner imports loadLore from scripts/lib/schefter-lore.mjs, which
  // reads running-bits.md and assembles the system-prompt suffix. Verify
  // the loader still references the running-bits file so the new section
  // gets pulled in automatically.
  const loaderSrc = read('scripts/lib/schefter-lore.mjs');

  it('loadLore reads running-bits.md', () => {
    expect(loaderSrc).toMatch(/running-bits\.md/);
  });

  it('appends bits content under the "## RUNNING BITS" header', () => {
    expect(loaderSrc).toMatch(/##\s*RUNNING BITS/);
  });
});
