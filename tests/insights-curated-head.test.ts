import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Curated-head guardrail for the big insight domain files.
 *
 * `docs/claude/insights/domains/` is written to constantly and read almost
 * never, because three of its files grew past the point where "read this before
 * each task" is a followable instruction: 151 KB, 141 KB and 129 KB — each one
 * larger than the 84 KB CLAUDE.md that got split into a router in Aug 2026.
 * `/feature` step 1 told every agent to read `frontend.md` *always*. An agent
 * handed 35k tokens of dated journal skims it, and the accumulated knowledge
 * silently stops being applied.
 *
 * So each of those files now opens with a CURATED HEAD: the rules that still
 * apply, in a couple of KB, followed by the dated archive as evidence. Agents
 * read the head and grep the archive.
 *
 * That only holds if the head stays small. This test is what stops it becoming
 * a second encyclopedia — the exact failure the split was undoing.
 */

const ROOT = process.cwd();
const DOMAINS = 'docs/claude/insights/domains';
const FEATURES = 'docs/claude/insights/features';

/**
 * The files big enough that reading them whole is not a real instruction.
 *
 * `features/player-composites.md` is a reference spec rather than a journal, so
 * its head is its own Context/Key Files/Insights/Casting Rules front matter and
 * the "archive" is the per-surface implementation notes. Same contract either
 * way: a bounded thing to read, and a grep hint for the rest.
 */
const CURATED = [
  `${DOMAINS}/frontend.md`,
  `${DOMAINS}/design-system.md`,
  `${DOMAINS}/mfl-api.md`,
  `${FEATURES}/player-composites.md`,
];

/** Past this, "read this file before each task" stops being followable. */
const OVERSIZED_BYTES = 64 * 1024;

const OPEN = '<!-- CURATED-HEAD -->';
const CLOSE = '<!-- /CURATED-HEAD -->';

/**
 * 8 KB ≈ 2k tokens — the cost an agent pays to load a domain's rules before
 * starting work, against 32-38k for the file it replaces.
 *
 * Deliberately not tighter. The failure mode worth catching is someone pasting
 * a full journal entry into the head, not someone adding a line to an existing
 * rule; a cap with no slack just gets raised on the first legitimate addition,
 * which teaches everyone the number is negotiable.
 */
const MAX_HEAD_BYTES = 8 * 1024;

/** Below this, the "head" is a stub that isn't carrying the domain's rules. */
const MIN_HEAD_BYTES = 800;

function readCurated(rel: string): string {
  const path = join(ROOT, rel);
  expect(existsSync(path), `${rel} is missing`).toBe(true);
  return readFileSync(path, 'utf8');
}

function extractHead(body: string, file: string): string {
  const start = body.indexOf(OPEN);
  const end = body.indexOf(CLOSE);
  expect(start, `${file} has no ${OPEN} marker`).toBeGreaterThanOrEqual(0);
  expect(end, `${file} has no ${CLOSE} marker`).toBeGreaterThan(start);
  return body.slice(start + OPEN.length, end);
}

describe('insights curated heads', () => {
  it.each(CURATED)('%s has a curated head within the size budget', (file) => {
    const head = extractHead(readCurated(file), file);
    const bytes = Buffer.byteLength(head, 'utf8');

    expect(
      bytes,
      `${file}'s curated head is ${bytes} bytes (max ${MAX_HEAD_BYTES}). ` +
        'The head is loaded by every agent that works in this domain, so it holds the ' +
        'RULE and the archive below holds the evidence. Move the detail into a dated ' +
        'entry and leave a one-line rule plus a grep hint — do not raise this cap.',
    ).toBeLessThanOrEqual(MAX_HEAD_BYTES);

    expect(
      bytes,
      `${file}'s curated head is only ${bytes} bytes — that is a stub, not ` +
        'a summary of the domain. It should carry the rules a session needs before ' +
        'touching this area.',
    ).toBeGreaterThanOrEqual(MIN_HEAD_BYTES);
  });

  it.each(CURATED)('%s tells the reader not to read the archive', (file) => {
    const head = extractHead(readCurated(file), file);

    // The head is only useful if it also stops the read it replaces. Without
    // this line an agent reads the head AND continues into the 130 KB below it,
    // which costs more than having no head at all.
    expect(
      /grep/i.test(head),
      `${file}'s head must tell the reader to grep the archive rather than ` +
        'read it — that instruction is the whole point of the split.',
    ).toBe(true);
  });

  it('the archive still carries dated entries below the head', () => {
    // Guards against a well-meaning "cleanup" that replaces the journal with the
    // summary. The archive is the evidence for every rule in the head; a rule
    // whose incident is gone can't be re-checked when it looks wrong later.
    for (const file of CURATED) {
      const body = readCurated(file);
      const closeAt = body.indexOf(CLOSE);
      // Without this, indexOf's -1 makes the slice start inside the HEAD, and the
      // dated-entry count below passes on the head's own content.
      expect(closeAt, `${file} has no ${CLOSE} marker`).toBeGreaterThan(0);
      const archive = body.slice(closeAt + CLOSE.length);
      const dated = archive.match(/^## .*\d{4}-\d{2}-\d{2}/gm) ?? [];

      expect(
        dated.length,
        `${file} has ${dated.length} dated entries left below the head. ` +
          'The archive is the evidence for the head — do not delete it.',
      ).toBeGreaterThan(10);
    }
  });

  it('every domain file is either curated or small enough to read whole', () => {
    // The list above is not the point — the threshold is. A file that grows past
    // it needs a head too, and this is what says so.
    const oversized: string[] = [];

    for (const dir of [DOMAINS, FEATURES]) {
      for (const file of readdirSync(join(ROOT, dir))) {
        if (!file.endsWith('.md')) continue;
        const rel = `${dir}/${file}`;
        if (CURATED.includes(rel)) continue;
        const bytes = Buffer.byteLength(readFileSync(join(ROOT, rel), 'utf8'), 'utf8');
        if (bytes > OVERSIZED_BYTES) oversized.push(`${rel} (${Math.round(bytes / 1024)} KB)`);
      }
    }

    expect(
      oversized,
      'These insight files have grown past 64 KB with no curated head, so any agent ' +
        'told to "read this before each task" will skim or truncate it. Add a ' +
        `${OPEN} block and register the file in CURATED.`,
    ).toEqual([]);
  });
});
