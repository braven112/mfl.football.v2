/**
 * Best-ball official draft helpers.
 *
 * A best-ball league has exactly ONE official draft session per league year,
 * living in the mock-draft engine under a deterministic session id —
 * `{navSlug}-official-{year}` — created commissioner-only via
 * /api/best-ball-draft/create. These helpers give the league's pages
 * (draft room, draft board, rosters, home) one shared way to locate and
 * fetch that session server-side.
 */

import type { LeagueDefinition } from '../config/leagues';
import type { MockDraftSession } from '../types/draft-room';
import { getLeagueYearForSlug } from './league-year';
import { isDemoDeploy } from './deploy-environment';
import { fetchMockSession } from './mock-draft-session';

/** Deterministic official-session id for a best-ball league + year. */
export function officialDraftSessionId(league: LeagueDefinition, year?: number): string {
  const leagueYear = year ?? getLeagueYearForSlug(league.slug);
  // The custom-site demo's official draft is fiction and must never share a
  // stored session with the real league's (docs/plans/custom-site-demo.md).
  return `${isDemoDeploy() ? 'demo-' : ''}${league.navSlug}-official-${leagueYear}`;
}

/**
 * The demo's completed fictional draft, written by the demo build
 * (scripts/demo/lib/bestball.mjs). Lazy, and absent from every real build's
 * data, so the glob resolves to nothing there.
 */
const DEMO_DRAFTS = import.meta.glob<MockDraftSession>('../../data/*/demo-official-draft.json', { import: 'default' });

async function demoOfficialDraft(league: LeagueDefinition, year?: number): Promise<MockDraftSession | null> {
  const load = DEMO_DRAFTS[`../../${league.dataPath}/demo-official-draft.json`];
  if (!load) return null;
  const session = await load();
  const leagueYear = year ?? getLeagueYearForSlug(league.slug);
  return { ...session, leagueYear, id: officialDraftSessionId(league, leagueYear) };
}

/**
 * Fetch the league's official draft session (server-side).
 * Returns null when the session doesn't exist yet or the store can't be
 * read — callers render their "draft not scheduled yet" state in both cases.
 */
export async function fetchOfficialDraftSession(
  league: LeagueDefinition,
  year?: number,
): Promise<MockDraftSession | null> {
  // On the demo the league of record is fiction, served from the build —
  // never the real league's stored draft.
  if (isDemoDeploy()) return demoOfficialDraft(league, year);
  const session = (await fetchMockSession(officialDraftSessionId(league, year))) as MockDraftSession | null;
  // Only ever surface the draft of record — a mock that somehow landed on
  // this id must not render as the official draft.
  return session?.official ? session : null;
}
