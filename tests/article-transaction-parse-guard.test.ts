import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFactSheet } from '../scripts/article-types/waiver-pickups.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * MFL's roster-move `transaction` string is POSITIONAL and its add side
 * carries a TRAILING COMMA:
 *
 *   FREE_AGENT / WAIVER:  "addId,|dropId,"     (either side may be empty)
 *   BBID_WAIVER:          "addId,|bid|dropId,"
 *
 * Two bugs shipped a whole waiver column off one ad-hoc
 * `.split('|').filter(Boolean)` in scripts/article-types/waiver-pickups.mjs:
 *
 *  1. `parts[0]` was "16171," — with the comma, a key no player map holds — so
 *     EVERY claim fell through to the `Player ${id}` placeholder and the
 *     published article read "dropping three-quarters of a million on Player
 *     16171" instead of naming Kendre Miller. The same bad key also missed
 *     `playerMeta`, so pickHeroPlayer returned null and the article lost its
 *     composite hero silently.
 *  2. `.filter(Boolean)` erased the EMPTY add segment that marks a pure drop
 *     ("|15749,"), promoting the dropped player to a phantom free pickup — the
 *     article credited Bring The Pain with "snagging Player 15749 at no cost"
 *     on a week they had DROPPED Isiah Pacheco.
 *
 * scripts/lib/roster-move-parse.mjs#parseRosterMove is the one parser that
 * gets this right; its header documents bug 2 shipping once already in the
 * scanner. These tests pin that the article pipeline routes through it.
 */
describe('waiver article transaction parsing', () => {
  const players = {
    players: {
      player: [
        { id: '16171', name: 'Miller, Kendre', position: 'RB', team: 'NOS', espn_id: '1' },
        { id: '15749', name: 'Pacheco, Isiah', position: 'RB', team: 'DET', espn_id: '2' },
        { id: '17668', name: 'Smack, Trey', position: 'PK', team: 'GBP', espn_id: '3' },
      ],
    },
  };

  const sheetFor = async (transactions: Array<Record<string, string>>) => {
    const now = Math.floor(Date.now() / 1000);
    const { factSheet, enrichment } = await buildFactSheet(
      {
        players,
        transactions: {
          transactions: {
            transaction: transactions.map((t) => ({ timestamp: String(now - 3600), ...t })),
          },
        },
        league: {},
      },
      1,
      2026,
      ROOT,
      { league: 'theleague' },
    );
    return { factSheet, enrichment };
  };

  it('resolves real player names through the trailing comma on a BBID bid', async () => {
    const { factSheet } = await sheetFor([
      { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171,|775000|15749,' },
    ]);
    expect(factSheet).toContain('Kendre Miller');
    expect(factSheet).toContain('$775K');
    // The placeholder is the bug's fingerprint — it must never reach the model.
    expect(factSheet).not.toMatch(/Player \d+/);
    expect(factSheet).not.toContain('??');
  });

  it('resolves real names on a free-agent add too', async () => {
    const { factSheet } = await sheetFor([
      { type: 'FREE_AGENT', franchise: '0016', transaction: '17668,|' },
    ]);
    expect(factSheet).toContain('Trey Smack');
    expect(factSheet).not.toMatch(/Player \d+/);
  });

  it('never counts a pure drop as a pickup', async () => {
    const { factSheet } = await sheetFor([
      { type: 'FREE_AGENT', franchise: '0008', transaction: '|15749,' },
    ]);
    expect(factSheet).toContain('No waiver claims or free agent pickups this week.');
    expect(factSheet).toContain('Total claims this week: 0');
    expect(factSheet).not.toContain('Isiah Pacheco');
  });

  it('counts claims, not transaction rows, when drops share the week', async () => {
    const { factSheet } = await sheetFor([
      { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171,|775000|' },
      { type: 'FREE_AGENT', franchise: '0008', transaction: '|15749,' },
      { type: 'FREE_AGENT', franchise: '0016', transaction: '17668,|' },
    ]);
    expect(factSheet).toContain('Total claims this week: 2');
    expect(factSheet).toContain('Total spent: $775K');
  });

  it('attributes a bid only to the player it bought, never to a free add', async () => {
    const { factSheet } = await sheetFor([
      { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171,|775000|' },
      { type: 'FREE_AGENT', franchise: '0016', transaction: '17668,|' },
    ]);
    expect(factSheet).toContain('RB Kendre Miller ($775K)');
    expect(factSheet).toContain('PK Trey Smack ($0) [FA]');
    expect(factSheet).toContain('Highest single bid: $775K for Kendre Miller');
  });

  it('prices a pre-2017 comma-less BBID claim at its real bid, not $0', async () => {
    // A shape the BBID pattern misses falls through to the FREE_AGENT branch,
    // where the bid becomes a "dropped player" and the claim prices as $0 —
    // wrong money in the prose, with nothing to signal it.
    const { factSheet } = await sheetFor([
      { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171|775000|15749' },
    ]);
    expect(factSheet).toContain('Kendre Miller');
    expect(factSheet).toContain('$775K');
    expect(factSheet).not.toContain('($0)');
  });

  it('skips a BBID claim whose bid cannot be read rather than pricing it $0', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { factSheet } = await sheetFor([
        // A BBID row whose string carries no bid segment: the add id reads
        // fine, so this is not caught by the empty-add skip above.
        { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171,|' },
        { type: 'FREE_AGENT', franchise: '0016', transaction: '17668,|' },
      ]);
      // The free add still reports; the unreadable claim does not appear at $0.
      expect(factSheet).toContain('Trey Smack');
      expect(factSheet).not.toContain('Kendre Miller');
      expect(factSheet).toContain('Total claims this week: 1');
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('warns on an unreadable BBID row even when it yields no add at all', async () => {
    // #1158 F3. The bid check used to sit BELOW the "nothing added" skip, so a
    // BBID string mangled badly enough to lose its add id was classified as a
    // plain drop and vanished in silence — while the very same row with a
    // readable add warned three lines later. The quiet half is the dangerous
    // one: a claim that never reaches the fact sheet cannot be noticed in the
    // published prose either. Both halves warn now.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { factSheet } = await sheetFor([
        { type: 'BBID_WAIVER', franchise: '0015', transaction: '|' },
        { type: 'FREE_AGENT', franchise: '0016', transaction: '17668,|' },
      ]);
      expect(warn).toHaveBeenCalled();
      expect(factSheet).toContain('Total claims this week: 1');
      expect(factSheet).toContain('Trey Smack');
    } finally {
      warn.mockRestore();
    }
  });

  it('stays silent on an ordinary drop, which is not an unreadable row', async () => {
    // The other side of the ordering: a pure drop is a normal row, not a parse
    // failure. Warning on it would train the operator to ignore the warning.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await sheetFor([{ type: 'FREE_AGENT', franchise: '0008', transaction: '|15749,' }]);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('writes "1 claim", not "1 claims"', async () => {
    // #1158 F4. The fact sheet is the model's only source of truth and it is
    // read as prose, so a broken plural is a sentence the column can echo.
    const { factSheet } = await sheetFor([
      { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171,|775000|' },
    ]);
    expect(factSheet).toContain('(1 claim,');
    expect(factSheet).not.toContain('(1 claims,');
  });

  it('pluralizes a team with more than one claim', async () => {
    const { factSheet } = await sheetFor([
      { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171,|775000|' },
      { type: 'FREE_AGENT', franchise: '0015', transaction: '17668,|' },
    ]);
    expect(factSheet).toContain('(2 claims,');
  });

  it('never prints a blank highest-bid line on an all-free-agent week', async () => {
    // highestBid's {0, '', ''} seed rendered as "Highest single bid: $0 for  by "
    // — blank player and team into the model's only source of truth. The AFL has
    // never had a BBID row, so that is every AFL week.
    const { factSheet } = await sheetFor([
      { type: 'FREE_AGENT', franchise: '0016', transaction: '17668,|' },
      { type: 'FREE_AGENT', franchise: '0008', transaction: '15749,|' },
    ]);
    expect(factSheet).not.toMatch(/Highest single bid: \$0 for\s+by\s*$/m);
    expect(factSheet).toContain('Highest single bid: none');
  });

  it('names the genuinely featured player on the composite hero', async () => {
    const { enrichment } = await sheetFor([
      { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171,|775000|' },
      { type: 'FREE_AGENT', franchise: '0016', transaction: '17668,|' },
    ]);
    // A comma-suffixed id misses playerMeta and drops the hero to null.
    expect(enrichment.heroPlayerId).toBe('16171');
  });

  it('reports the busiest team by claim COUNT, not by spend', async () => {
    const { factSheet } = await sheetFor([
      { type: 'BBID_WAIVER', franchise: '0015', transaction: '16171,|775000|' },
      { type: 'FREE_AGENT', franchise: '0016', transaction: '17668,|' },
      { type: 'FREE_AGENT', franchise: '0016', transaction: '15749,|' },
    ]);
    // sortedTeams is ordered by SPEND, so [0] is the top spender; reading its
    // claim count called a one-bid team the week's busiest.
    expect(factSheet).toMatch(/Most claims: .* \(2\)/);
  });
});

/**
 * The scan half: no article type or article util may re-grow its own
 * transaction-string parser. One ad-hoc split is what shipped both bugs above.
 */
describe('article pipeline does not hand-parse MFL transaction strings', () => {
  const DIRS = ['scripts/article-types', 'scripts/article-utils'];

  const files = DIRS.flatMap((dir) => {
    const abs = path.join(ROOT, dir);
    return fs
      .readdirSync(abs)
      .filter((f) => f.endsWith('.mjs'))
      .map((f) => ({ rel: `${dir}/${f}`, source: fs.readFileSync(path.join(abs, f), 'utf8') }));
  });

  it('does not flag a comment that quotes the pattern', () => {
    // The guard reads real files, so this pins the filter directly: a rule is
    // usually quoted in the prose explaining it, and a guard that fails on its
    // own documentation blocks every edit in the schefter-columns domain.
    const commentLines = [
      "// never use .split('|') here",
      "  * a `.split('|')` erases the empty add segment",
      "/* .split('|') is wrong */",
    ];
    for (const line of commentLines) {
      const trimmed = line.trim();
      const flagged =
        /\.split\(\s*['"`]\|['"`]\s*\)/.test(trimmed) &&
        !trimmed.startsWith('*') &&
        !trimmed.startsWith('//') &&
        !trimmed.startsWith('/*');
      expect(flagged, line).toBe(false);
    }
  });

  it('finds article sources to scan', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it.each(files.map((f) => f.rel))('%s does not split a transaction string on "|"', (rel) => {
    const { source } = files.find((f) => f.rel === rel)!;
    const offenders = source
      .split('\n')
      .map((line, i) => ({ line: line.trim(), no: i + 1 }))
      // Skip comment lines: a rule is often quoted in the prose that explains it,
      // and a guard that fails on its own documentation blocks every edit in the
      // domain (this file's own header quotes the pattern).
      .filter(
        ({ line }) =>
          /\.split\(\s*['"`]\|['"`]\s*\)/.test(line) &&
          !line.startsWith('*') &&
          !line.startsWith('//') &&
          !line.startsWith('/*'),
      );
    expect(
      offenders,
      `${rel} hand-parses an MFL transaction string. Use parseRosterMove from ` +
        `scripts/lib/roster-move-parse.mjs — the add side has a trailing comma ` +
        `and an empty add segment means a DROP.`,
    ).toEqual([]);
  });
});
