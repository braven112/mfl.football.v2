/**
 * Brandon's private rankings board — read at REQUEST time from the private
 * braven112/brandon-fantasy repo, never from this one.
 *
 * WHY NOT A FILE HERE. This repository is public. The board joins paid
 * subscription data (Footballguys, DLF) and Matt Waldman's Rookie Scouting
 * Portfolio, which is for Brandon's eyes only, so it may not be committed
 * here, compiled into the bundle, or written to shared storage. The private
 * repo's own workflows build `data/rankings-board/<league>.json` after every
 * scrape; this module fetches that one file with a read-only token and keeps
 * it in the function's memory for a few minutes.
 *
 * TOKEN. `BRANDON_FANTASY_TOKEN`: a fine-grained GitHub token with read-only
 * Contents access to braven112/brandon-fantasy and nothing else, set in
 * Vercel. Without it the page says so instead of rendering an empty board.
 * `BRANDON_FANTASY_REF` (optional) reads a branch other than the default one.
 * `BRANDON_FANTASY_DIR` (local dev only) reads a local clone of the private
 * repo instead of GitHub; it is never set in Vercel.
 *
 * SERVER-ONLY: the token and the data stay on the server. The page renders
 * HTML from them and ships no rankings JSON to the browser.
 */

import type { BoardFile } from './private-rankings-view';

export const BOARD_REPO = 'braven112/brandon-fantasy';
/** The board leagues, keyed by the registry slug of the page reading them. */
export const BOARD_KEY_BY_SLUG: Readonly<Record<string, string>> = {
  theleague: 'theleague',
  'afl-fantasy': 'afl',
};

const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { at: number; board: BoardFile }>();

export type BoardLoad =
  | { ok: true; board: BoardFile }
  | { ok: false; reason: 'no-token' | 'not-found' | 'error'; message: string };

export function boardToken(env: Record<string, string | undefined> = process.env): string | null {
  return env.BRANDON_FANTASY_TOKEN || null;
}

/**
 * The board for one league. `fresh` skips the memory cache (the page's
 * Refresh link). A failed fetch serves the last good copy when there is one.
 */
export async function loadPrivateBoard(
  boardKey: string,
  { fresh = false, fetchImpl = fetch, env = process.env }: { fresh?: boolean; fetchImpl?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<BoardLoad> {
  if (!/^[a-z-]+$/.test(boardKey)) return { ok: false, reason: 'not-found', message: `No board named ${boardKey}.` };
  const hit = cache.get(boardKey);
  if (hit && !fresh && Date.now() - hit.at < TTL_MS) return { ok: true, board: hit.board };

  if (env.BRANDON_FANTASY_DIR) {
    try {
      const { readFile } = await import('node:fs/promises');
      const board = JSON.parse(await readFile(`${env.BRANDON_FANTASY_DIR}/data/rankings-board/${boardKey}.json`, 'utf8')) as BoardFile;
      cache.set(boardKey, { at: Date.now(), board });
      return { ok: true, board };
    } catch (err) {
      return { ok: false, reason: 'error', message: `Could not read the local board: ${(err as Error).message}` };
    }
  }

  const token = boardToken(env);
  if (!token) return { ok: false, reason: 'no-token', message: 'BRANDON_FANTASY_TOKEN is not set in this deployment.' };

  try {
    const ref = env.BRANDON_FANTASY_REF ? `?ref=${encodeURIComponent(env.BRANDON_FANTASY_REF)}` : '';
    const res = await fetchImpl(`https://api.github.com/repos/${BOARD_REPO}/contents/data/rankings-board/${boardKey}.json${ref}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.raw+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'mfl-football-site',
      },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404) {
      return hit ? { ok: true, board: hit.board } : { ok: false, reason: 'not-found', message: `The private repo has no ${boardKey} board yet.` };
    }
    if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
    const board = (await res.json()) as BoardFile;
    if (!board || !Array.isArray(board.players)) throw new Error('the board file has no players');
    cache.set(boardKey, { at: Date.now(), board });
    return { ok: true, board };
  } catch (err) {
    if (hit) return { ok: true, board: hit.board };
    return { ok: false, reason: 'error', message: `Could not read the board: ${(err as Error).message}` };
  }
}

/** Test hook. */
export function clearPrivateBoardCache(): void {
  cache.clear();
}
