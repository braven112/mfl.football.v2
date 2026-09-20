/**
 * How hard we lean on MFL for one league's week, and what we say when it says no.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 * `/live` showed both leagues as unreadable while its own poll was answering
 * 200 (owner screenshot, 2026-09-20 10:33 PT). Two things about the read path
 * made that both likelier and unfalsifiable:
 *
 *  - **Nothing was cached and every week asked for the playoff bracket.** One
 *    board poll cost TWO MFL requests per league, at a 25s cadence, per open
 *    tab, per device — and MFL answers a client it considers noisy with an
 *    HTML page under a 200, which `loadLiveScoringPayload` correctly reads as
 *    a failed read. The bracket half of that was pure waste in Week 2: there
 *    is no bracket to merge before the playoffs.
 *  - **Every failure was silent.** Timeout, refused connection, HTTP error,
 *    HTML-under-a-200 and an MFL `error` key all became the same `ok: false`
 *    with nothing written down, so the only evidence was the screenshot. Same
 *    signature as the 2026-09-09 outage in docs/claude/rules/live-scoring.md.
 *
 * The rules below are what keep those fixed. The cache one is the dangerous
 * one to get wrong in the other direction: remembering a FAILURE would pin an
 * outage in front of every reader sharing the process, which is the mistake
 * `PROJECTION_EMPTY_TTL_MS` and `/api/nfl-game-detail`'s never-memoize-a-
 * partial-read rule are each written to avoid.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  clearLiveScoringPayloadCache,
  loadLiveScoringPayload,
} from '../src/utils/live-scoring-source';
import { PLAYOFFS_START_WEEK } from '../src/utils/fantasy-bracket.mjs';
import { getLeagueBySlug } from '../src/config/leagues';

const LEAGUE = getLeagueBySlug('theleague')!;

/** A healthy, empty-but-readable liveScoring body. */
const healthy = () =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ liveScoring: { matchup: [] } }),
  }) as unknown as Response;

function typesFetched(mock: ReturnType<typeof vi.fn>): string[] {
  return mock.mock.calls.map((c) => new URL(String(c[0])).searchParams.get('TYPE') ?? '');
}

describe('one league-week costs as little of MFL as it can', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearLiveScoringPayloadCache();
    fetchMock = vi.fn().mockResolvedValue(healthy());
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('the playoff bracket is a playoff-week read', () => {
    it('does NOT ask for it during the regular season', async () => {
      await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      expect(typesFetched(fetchMock)).toEqual(['liveScoring']);
    });

    it('DOES ask for it once the bracket can cover the week', async () => {
      await loadLiveScoringPayload({
        leagueId: LEAGUE.id,
        year: 2026,
        week: PLAYOFFS_START_WEEK,
      });
      expect(typesFetched(fetchMock)).toContain('playoffBrackets');
    });

    it('asks one week EARLY, so a league whose bracket opens sooner still merges', () => {
      // Deliberate slack, and cheap: one request per league in one week of the
      // year. Tightening it to `>= PLAYOFFS_START_WEEK` would make a league
      // with a four-round bracket silently lose its first-round pairings.
      const src = readFileSync(
        resolve(__dirname, '../src/utils/live-scoring-source.ts'),
        'utf8',
      );
      expect(src).toMatch(/Number\(week\) >= PLAYOFFS_START_WEEK - 1/);
    });
  });

  describe('a recent read is reused; a failed one never is', () => {
    it('serves a second reader from the first read', async () => {
      await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('never serves one league-week under another key', async () => {
      // `L` and the host are one composite key — MFL answers a league id a
      // host does not carry with that host's OWN league — so a cache key that
      // dropped either could hand back another league's scores.
      await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 3 });
      await loadLiveScoringPayload({ leagueId: getLeagueBySlug('afl-fantasy')!.id, year: 2026, week: 2 });
      await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2025, week: 2 });
      expect(fetchMock).toHaveBeenCalledTimes(4);
    });

    it('does NOT remember a throttled read — an outage must stay cheap to retry', async () => {
      // The exact failure shape: HTTP 200 carrying an HTML page.
      fetchMock.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token <');
        },
      } as unknown as Response);

      const first = await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      expect(first.ok).toBe(false);

      fetchMock.mockResolvedValue(healthy());
      const second = await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      // A cached failure would have served `ok: false` here for 20 seconds, to
      // everyone, from one bad poll.
      expect(second.ok).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('hands each caller its own object — the snapshot is read-only by contract', async () => {
      const a = await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      const b = await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      expect(b).not.toBe(a);
    });

    it('expires below the live poll cadence, so a viewer is never shown a stale read for want of asking', () => {
      const src = readFileSync(
        resolve(__dirname, '../src/utils/live-scoring-source.ts'),
        'utf8',
      );
      const ttl = Number(/LIVE_PAYLOAD_TTL_MS = ([\d_]+)/.exec(src)?.[1]?.replace(/_/g, ''));
      const poll = Number(
        /POLL_LIVE_MS = ([\d_]+)/
          .exec(readFileSync(resolve(__dirname, '../src/components/shared/live/LiveBoard.tsx'), 'utf8'))?.[1]
          ?.replace(/_/g, ''),
      );
      expect(ttl).toBeGreaterThan(0);
      expect(poll).toBeGreaterThan(0);
      expect(ttl).toBeLessThan(poll);
    });
  });

  describe('a failed read says why', () => {
    it.each([
      [
        'an HTML page under a 200',
        { ok: true, status: 200, json: async () => { throw new SyntaxError('<'); } },
        /did not parse as JSON/,
      ],
      [
        'an HTTP error',
        { ok: false, status: 503, json: async () => ({}) },
        /HTTP 503/,
      ],
      [
        'an MFL error key',
        { ok: true, status: 200, json: async () => ({ error: 'Live scoring is not available' }) },
        /MFL error/,
      ],
    ])('names %s', async (_label, response, expected) => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchMock.mockResolvedValue(response as unknown as Response);

      const payload = await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      expect(payload.ok).toBe(false);
      expect(warn.mock.calls.flat().join(' ')).toMatch(expected);
    });

    it('names a timeout, which is otherwise the same `null` as a refusal', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      fetchMock.mockRejectedValue(
        Object.assign(new Error('The operation was aborted due to timeout'), {
          name: 'TimeoutError',
        }),
      );

      const payload = await loadLiveScoringPayload({ leagueId: LEAGUE.id, year: 2026, week: 2 });
      expect(payload.ok).toBe(false);
      expect(warn.mock.calls.flat().join(' ')).toMatch(/TimeoutError/);
    });

    it('logs at warn, not error — one dead league is survivable and a paging level gets muted', () => {
      const src = readFileSync(
        resolve(__dirname, '../src/utils/live-scoring-source.ts'),
        'utf8',
      );
      expect(src).toMatch(/console\.warn\(`\[live-scoring\]/);
      expect(src).not.toMatch(/console\.error\(`\[live-scoring\]/);
    });
  });
});
