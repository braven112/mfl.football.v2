/**
 * Is the signed-in owner the commissioner of this MFL league? For ANY MFL
 * league the MFL Football app serves, not just the ones this site runs.
 *
 * The site's own `isCommissionerOrAdmin` (src/utils/auth.ts) cannot answer it:
 * it trusts a login-time role and a registry admin list, and refuses every
 * league outside the registry. MFL never issues `MFL_IS_COMMISH` either
 * (docs/claude/insights/domains/mfl-api.md). What MFL DOES do is widen
 * `TYPE=league` for a commissioner's own cookie: each franchise gains
 * `lastVisit` (and the league gains `commish_username`), which a plain owner
 * never sees (2026-08-30 probe, `scripts/probe-mfl-franchise-fields.ts`).
 * So we ask MFL for the league AS this owner and look for those fields.
 *
 * Three answers, and the third matters: an anonymous or failed read is missing
 * `lastVisit` too, so "not the commissioner" needs proof the cookie was
 * honoured (the owner-only `username` / `mail_event` fields). Anything else is
 * `unknown`, and every caller must treat `unknown` as "no" (fail closed) while
 * telling the owner it could not check, rather than that they are not allowed.
 *
 * The owner's own cookie only, never the server's env credentials
 * (tests/auth-league-scope.test.ts). The response carries every owner's email,
 * phone and address for a commissioner: nothing from it is kept or logged.
 */

import { mflFetch } from '../mfl-fetch';
import { buildMflExportUrl } from '../mfl-url';
import { asArray } from '../mfl-normalize';
import type { OwnerLeague } from './owner-league';

export type CommissionerAnswer = 'commissioner' | 'not-commissioner' | 'unknown';

const present = (v: unknown) => v !== undefined && v !== null && `${v}` !== '';

/** Read a `TYPE=league` payload fetched with the owner's cookie. */
export function commissionerFromLeague(payload: unknown): CommissionerAnswer {
  const l = (payload as any)?.league;
  if (!l || typeof l !== 'object') return 'unknown';
  const franchises = asArray<any>(l.franchises?.franchise);
  if (present(l.commish_username) || franchises.some((f) => present(f?.lastVisit))) return 'commissioner';
  // Owner-only fields: the cookie was honoured, and still no commissioner view.
  if (franchises.some((f) => present(f?.username) || present(f?.mail_event))) return 'not-commissioner';
  return 'unknown';
}

export async function checkCommissioner(league: OwnerLeague, mflUserCookie: string): Promise<CommissionerAnswer> {
  if (!mflUserCookie) return 'unknown';
  try {
    const url = buildMflExportUrl({
      type: 'league',
      leagueId: league.leagueId,
      year: league.year,
      host: league.host ?? undefined,
    });
    const response = await mflFetch({ url, method: 'GET', mflUserCookie });
    if (!response.ok) return 'unknown';
    const body = await response.json().catch(() => null);
    if (!body || typeof body !== 'object' || 'error' in (body as object)) return 'unknown';
    return commissionerFromLeague(body);
  } catch {
    return 'unknown';
  }
}
