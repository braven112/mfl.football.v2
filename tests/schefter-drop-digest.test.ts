/**
 * GroupMe drop digest — TheLeague's drop announcements.
 *
 * Unit tests pin the digest copy shapes, and source-level tests pin the
 * scanner invariants: feed-first ordering, the TheLeague-only feature gate,
 * and per-league bot routing for the shared pending queue.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { buildDropDigest, MAX_DIGEST_LINES } from '../scripts/lib/schefter-drop-digest.mjs';

describe('buildDropDigest', () => {
  it('returns null when there is nothing to say', () => {
    expect(buildDropDigest([])).toBeNull();
    expect(buildDropDigest(undefined as any)).toBeNull();
  });

  it('passes a single-player drop through as its own post copy', () => {
    const digest = buildDropDigest([
      {
        headline: 'Pacific Pigskins waive Julio Jones',
        body: 'Pacific Pigskins cut Julio Jones loose. The roster spot opens up.',
        team: 'Pacific Pigskins',
        playerNames: ['Julio Jones'],
      },
    ]);
    expect(digest).toEqual({
      headline: 'Pacific Pigskins waive Julio Jones',
      body: 'Pacific Pigskins cut Julio Jones loose. The roster spot opens up.',
    });
  });

  it('names every player in a single bulk-drop transaction', () => {
    const digest = buildDropDigest([
      {
        headline: 'Freak Show waive Ezekiel Elliott',
        body: 'unused',
        team: 'Freak Show',
        playerNames: ['Ezekiel Elliott', 'Tank Bigsby', 'Julio Jones'],
      },
    ]);
    expect(digest!.headline).toBe('Freak Show cut 3 players');
    expect(digest!.body).toBe(
      'Freak Show cut Ezekiel Elliott, Tank Bigsby, and Julio Jones. All free agents now.',
    );
  });

  it('combines multiple drop posts into one bulleted digest', () => {
    const digest = buildDropDigest([
      {
        headline: 'Pacific Pigskins waive Julio Jones',
        body: 'unused',
        team: 'Pacific Pigskins',
        playerNames: ['Julio Jones'],
      },
      {
        headline: 'Dark Magicians cut Tank Bigsby',
        body: 'unused',
        team: 'Dark Magicians',
        playerNames: ['Tank Bigsby'],
      },
      {
        headline: 'Freak Show release Ezekiel Elliott',
        body: 'unused',
        team: 'Freak Show',
        playerNames: ['Ezekiel Elliott', 'Josh Allen'],
      },
    ]);
    expect(digest!.headline).toBe('Roster cuts: 4 players hit the wire');
    expect(digest!.body).toBe(
      [
        '• Pacific Pigskins waive Julio Jones',
        '• Dark Magicians cut Tank Bigsby',
        '• Freak Show cut Ezekiel Elliott and Josh Allen',
        '',
        'All free agents now — first come, first served.',
      ].join('\n'),
    );
  });

  it('truncates past MAX_DIGEST_LINES with an overflow line', () => {
    const drops = Array.from({ length: MAX_DIGEST_LINES + 3 }, (_, i) => ({
      headline: `Team ${i} waive Player ${i}`,
      body: 'unused',
      team: `Team ${i}`,
      playerNames: [`Player ${i}`],
    }));
    const digest = buildDropDigest(drops);
    const lines = digest!.body.split('\n');
    expect(lines.filter(l => l.startsWith('•'))).toHaveLength(MAX_DIGEST_LINES);
    expect(digest!.body).toContain('…plus 3 more cuts.');
    // Stay comfortably under GroupMe's ~1000-char message cap.
    expect(digest!.headline.length + digest!.body.length).toBeLessThan(900);
  });
});

describe('schefter-scan.mjs — drop-digest scanner invariants', () => {
  const src = readFileSync(path.join(process.cwd(), 'scripts/schefter-scan.mjs'), 'utf8');

  const scanMatch = src.match(/async function scanLeague[\s\S]+?\n\}\n/);
  if (!scanMatch) throw new Error('scanLeague not found in scanner');
  const scanBody = scanMatch[0];

  it('writes the feed BEFORE enqueueing the drop digest (feed-first invariant)', () => {
    const writeIdx = scanBody.indexOf('await fs.writeFile(league.feedPath');
    const digestIdx = scanBody.indexOf('await enqueueDropDigest(');
    expect(writeIdx).toBeGreaterThan(-1);
    expect(digestIdx).toBeGreaterThan(-1);
    expect(writeIdx).toBeLessThan(digestIdx);
  });

  it('gates the digest on the groupMeDropDigest league feature', () => {
    expect(src).toMatch(/if \(!league\.features\.groupMeDropDigest\) return;/);
    // TheLeague announces drops; AFL keeps its directGroupMe lane only.
    const theleague = src.match(/buildSchefterLeague\('theleague',[\s\S]+?\n  \}\)/)?.[0] ?? '';
    const afl = src.match(/buildSchefterLeague\('afl-fantasy',[\s\S]+?\n  \}\)/)?.[0] ?? '';
    expect(theleague).toMatch(/groupMeDropDigest: true/);
    expect(afl).toMatch(/groupMeDropDigest: false/);
  });

  it('routes pending-queue pings to the entry league own bot', () => {
    const flushMatch = src.match(/async function flushPendingBigDrops[\s\S]+?\n\}\n/);
    expect(flushMatch).not.toBeNull();
    const flushBody = flushMatch![0];
    expect(flushBody).toContain("entry.league === 'afl'");
    expect(flushBody).toContain('GROUPME_AFL_SCHEFTER_BOT_ID');
  });

  it('excludes big drops from the digest (they ping individually)', () => {
    expect(src).toMatch(/p\.drop && !p\.bigDrop/);
  });
});
