/**
 * The app's calls to the waiver endpoints (package L). Every write can come
 * back HTTP 200 with `success: false` (the server sends a handled failure as a
 * 200 because the edge eats a 5xx body), so `success` decides, never the
 * status alone. A 4xx with a message is an `ApiError` from `api.ts`.
 */

import type {
  MflLiveAppDropRequest,
  MflLiveAppManageClaim,
  MflLiveAppSubmitClaims,
  MflLiveAppWaivers,
  MflLiveAppWriteResult,
} from '@mfl/shared-types/mfl-live-app-l';
import { ApiError, apiGet, apiPost } from '../api';

const q = (leagueId: string) => `?league=${encodeURIComponent(leagueId)}`;

async function write(token: string, path: string, body: unknown): Promise<MflLiveAppWriteResult> {
  const result = await apiPost<MflLiveAppWriteResult>(token, path, body);
  if (!result?.success) {
    throw new ApiError(result?.message || 'MFL did not take that. Nothing was changed.', result?.status ?? 200);
  }
  return result;
}

export async function fetchWaivers(token: string, leagueId: string): Promise<MflLiveAppWaivers> {
  const body = await apiGet<MflLiveAppWaivers | MflLiveAppWriteResult>(token, `/api/mfl-live/waivers${q(leagueId)}`);
  if (!body?.success || !('context' in body)) {
    const failed = body as MflLiveAppWriteResult | null;
    throw new ApiError(failed?.message || 'MFL Football could not load your waivers just now.', failed?.status ?? 200);
  }
  return body;
}

/** Whole dollars with thousands separators; two decimals in a cents league (increment below 1). */
export function formatMoney(amount: number, increment = 1): string {
  const fixed = increment < 1 ? amount.toFixed(2) : String(Math.round(amount));
  const [whole, cents] = fixed.split('.');
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}${cents ? `.${cents}` : ''}`;
}

export function submitClaims(token: string, leagueId: string, body: MflLiveAppSubmitClaims) {
  return write(token, `/api/mfl-live/waivers${q(leagueId)}`, body);
}

export function manageClaim(token: string, leagueId: string, body: MflLiveAppManageClaim) {
  return write(token, `/api/mfl-live/waivers-manage${q(leagueId)}`, body);
}

export function dropPlayer(token: string, leagueId: string, body: MflLiveAppDropRequest) {
  return write(token, `/api/mfl-live/drop${q(leagueId)}`, body);
}
