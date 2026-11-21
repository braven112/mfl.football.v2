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
 * TOKEN. No token of its own (Brandon, 2026-11-21: reuse the ones already set
 * up). It tries the GitHub tokens Vercel already holds, in BOARD_TOKEN_VARS
 * order, and remembers the first that can read the repo: the private-repo
 * token the build uses for Beat-Reporter, then the site's admin token. Each
 * needs read access to braven112/brandon-fantasy; a token without it answers
 * 404 and the next is tried. `PERSONAL_FANTASY_TOKEN` (the token Brandon made
 * for this repo) goes first, then `BRANDON_FANTASY_TOKEN` if ever set.
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
  | { ok: false; reason: 'no-token' | 'no-access' | 'not-found' | 'error'; message: string };

/** The env vars tried, in order. The same token under two names is tried once. */
export const BOARD_TOKEN_VARS = [
  'PERSONAL_FANTASY_TOKEN',
  'BRANDON_FANTASY_TOKEN',
  'VERCEL_BEAT_REPORTER_TOKEN',
  'BEAT_REPORTER_TOKEN',
  'GITHUB_ADMIN_TOKEN',
  'GH_ADMIN_TOKEN',
  'GH_TOKEN',
  'GITHUB_TOKEN',
] as const;

export function boardTokens(env: Record<string, string | undefined> = process.env): { name: string; token: string }[] {
  const seen = new Set<string>();
  const out: { name: string; token: string }[] = [];
  for (const name of BOARD_TOKEN_VARS) {
    const token = env[name];
    if (token && !seen.has(token)) {
      seen.add(token);
      out.push({ name, token });
    }
  }
  return out;
}

/** The env var whose token last read the repo, tried first next time. */
let workingTokenVar: string | null = null;

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

  const tokens = boardTokens(env);
  if (!tokens.length) return { ok: false, reason: 'no-token', message: 'This deployment has no GitHub token to read the private repo with.' };
  tokens.sort((a, b) => Number(b.name === workingTokenVar) - Number(a.name === workingTokenVar));

  try {
    const ref = env.BRANDON_FANTASY_REF ? `?ref=${encodeURIComponent(env.BRANDON_FANTASY_REF)}` : '';
    const url = `https://api.github.com/repos/${BOARD_REPO}/contents/data/rankings-board/${boardKey}.json${ref}`;
    let res: Response | null = null;
    const refused: string[] = [];
    for (const { name, token } of tokens) {
      res = await fetchImpl(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github.raw+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'mfl-football-site',
        },
        signal: AbortSignal.timeout(8000),
      });
      // GitHub answers 404 (not 403) when a token cannot see a private repo,
      // so a 404 moves on too; only a token that reads it is remembered.
      if (res.status === 401 || res.status === 403 || res.status === 404) {
        // The status says why: 401 = the value is wrong or expired, 403/404 =
        // the token is valid but has no access to this repo. Never the value.
        refused.push(`${name} ${res.status}`);
        continue;
      }
      workingTokenVar = name;
      break;
    }
    if (!res || refused.length === tokens.length) {
      if (hit) return { ok: true, board: hit.board };
      return {
        ok: false,
        reason: 'no-access',
        message: `None of the GitHub tokens this deployment has (${refused.join(', ')}) can read ${BOARD_REPO}, or it has no ${boardKey} board yet. (401: the token's value is wrong or expired. 403 or 404: the token works but cannot see this repo.)`,
      };
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
  workingTokenVar = null;
}
