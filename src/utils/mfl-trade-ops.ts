/**
 * MFL trade reads and writes, for ANY MFL league, as the owner.
 *
 * The site's `/api/trades/*` routes (TheLeague and the AFL, `getAuthUser`) and
 * the app's `/api/mfl-live/trade*` routes (any league, `requireOwnerLeague`)
 * both call these, so the rules live once:
 *
 * - Every call carries the OWNER's own `MFL_USER_ID` cookie and nothing else:
 *   no `MFL_IS_COMMISH`, no env credentials (`tests/auth-league-scope.test.ts`).
 * - MFL answers an import error as HTTP 200 with `<error>` in the body, so the
 *   body is read before the status (`docs/claude/rules/lineups.md`).
 * - A proposal may only offer players on the proposer's own roster.
 *
 * A staging/preview deployment refuses every MFL write; that refusal comes
 * back as `{ ok: false, status: 503, blocked: true }` with the owner-facing
 * message (mfl-fetch#describeMflFailure). Any other network error is thrown.
 */

import { describeMflFailure, mflFetch } from './mfl-fetch';
import { buildMflExportUrl } from './mfl-url';

const DEFAULT_HOST = 'https://api.myfantasyleague.com';

export type TradeOpResult =
  | { ok: true; message: string }
  | { ok: false; status: number; message: string; blocked?: boolean };

export const TRADE_RESPONSES = ['accept', 'reject', 'revoke'] as const;
export type TradeResponseKind = (typeof TRADE_RESPONSES)[number];

/** POST an import as the owner; a staging refusal becomes a result, anything else throws. */
async function postImport(
  year: number,
  mflUserCookie: string,
  params: URLSearchParams,
): Promise<{ res: Response; text: string } | TradeOpResult> {
  try {
    // Owner mode: only MFL_USER_ID cookie, no MFL_IS_COMMISH.
    const res = await mflFetch({
      url: `${DEFAULT_HOST}/${year}/import`,
      method: 'POST',
      mflUserCookie,
      body: params.toString(),
    });
    return { res, text: await res.text() };
  } catch (error) {
    const failure = describeMflFailure(error);
    if (failure.blocked) return { ok: false, status: 503, message: failure.message, blocked: true };
    throw error;
  }
}

const RESPONSE_LABELS: Record<TradeResponseKind, string> = {
  accept: 'Trade accepted',
  reject: 'Trade rejected',
  revoke: 'Trade withdrawn',
};

/** One asset code MFL's trade import takes: a player, a future or current pick, a blind bid. */
const ASSET_CODE = /^(\d+|FP_\d{4}_\d{4}_\d+|DP_\d+_\d+|BB_\d+(\.\d+)?)$/;

export function isTradeAssetCode(code: string): boolean {
  return ASSET_CODE.test(code);
}

/**
 * Read an MFL import reply. Order matters: an error body comes back as a 200,
 * and a login page comes back as a 200 too.
 */
export function readMflImportReply(
  status: number,
  ok: boolean,
  text: string,
  {
    rejected,
    success,
    notProcessed = 'MFL did not process the request. Please try again.',
  }: { rejected: string; success: string; notProcessed?: string },
): TradeOpResult {
  if (text.includes('<error>') || text.includes('"error"')) {
    const match = text.match(/<error[^>]*>(.*?)<\/error>/s) || text.match(/"error"\s*:\s*"([^"]+)"/);
    return { ok: false, status: 400, message: match?.[1] || rejected };
  }
  if (!ok) return { ok: false, status: 502, message: `MFL API error: ${status}` };
  if (text.includes('<html') || text.includes('<!DOCTYPE')) {
    return { ok: false, status: 502, message: notProcessed };
  }
  return { ok: true, message: success };
}

function asArray<T>(value: T | T[] | null | undefined): T[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

function padFid(value: unknown): string {
  const s = String(value ?? '').trim();
  return s ? s.padStart(4, '0') : '';
}

/** `rosters` export → franchiseId → player ids. Throws when MFL gives no rosters. */
export async function fetchRosterIds(opts: {
  leagueId: string;
  year: number;
  mflUserCookie: string;
  host?: string | null;
}): Promise<Record<string, string[]>> {
  const url = buildMflExportUrl({ type: 'rosters', leagueId: opts.leagueId, year: opts.year, host: opts.host || DEFAULT_HOST });
  const res = await mflFetch({ url, method: 'GET', mflUserCookie: opts.mflUserCookie });
  if (!res.ok) throw new Error(`MFL rosters HTTP ${res.status}`);
  const data: any = await res.json();
  const franchises = asArray<any>(data?.rosters?.franchise);
  if (!data?.rosters) throw new Error('MFL rosters unreadable');
  const out: Record<string, string[]> = {};
  for (const f of franchises) {
    out[padFid(f?.id)] = asArray<any>(f?.player).map((p) => String(p?.id ?? '')).filter(Boolean);
  }
  return out;
}

/** Propose a trade as `franchiseId`. */
export async function proposeTrade(opts: {
  leagueId: string;
  year: number;
  mflUserCookie: string;
  franchiseId: string;
  offeredTo: string;
  /** Comma-separated asset codes. */
  willGiveUp: string;
  willReceive: string;
  comments?: string;
  host?: string | null;
}): Promise<TradeOpResult> {
  const offeredPlayerIds = opts.willGiveUp
    .split(',')
    .map((s) => s.trim())
    .filter((id) => id && /^\d+$/.test(id));

  if (offeredPlayerIds.length > 0) {
    const rosters = await fetchRosterIds(opts);
    const mine = rosters[padFid(opts.franchiseId)] || [];
    if (offeredPlayerIds.some((pid) => !mine.includes(pid))) {
      return { ok: false, status: 403, message: 'You can only offer players from your own roster.' };
    }
  }

  const params = new URLSearchParams({
    TYPE: 'tradeProposal',
    L: opts.leagueId,
    OFFEREDTO: opts.offeredTo,
    WILL_GIVE_UP: opts.willGiveUp,
    WILL_RECEIVE: opts.willReceive,
  });
  if (opts.comments?.trim()) params.set('COMMENTS', opts.comments.trim());

  const sent = await postImport(opts.year, opts.mflUserCookie, params);
  if ('ok' in sent) return sent;
  const { res, text } = sent;
  console.log('[mfl-trade-ops] tradeProposal:', res.status, text.substring(0, 500));
  return readMflImportReply(res.status, res.ok, text, {
    rejected: 'MFL rejected the trade proposal',
    success: 'Trade proposal submitted',
    notProcessed: 'MFL did not process the trade. Please try again.',
  });
}

/** Accept, reject or withdraw a pending trade as the owner. */
export async function respondToTrade(opts: {
  leagueId: string;
  year: number;
  mflUserCookie: string;
  tradeId: string;
  response: TradeResponseKind;
  comments?: string;
}): Promise<TradeOpResult> {
  const params = new URLSearchParams({
    TYPE: 'tradeResponse',
    L: opts.leagueId,
    TRADE_ID: opts.tradeId,
    RESPONSE: opts.response,
  });
  if (opts.comments?.trim()) params.set('COMMENTS', opts.comments.trim());

  const sent = await postImport(opts.year, opts.mflUserCookie, params);
  if ('ok' in sent) return sent;
  const { res, text } = sent;
  console.log('[mfl-trade-ops] tradeResponse:', res.status, text.substring(0, 500));
  return readMflImportReply(res.status, res.ok, text, {
    rejected: 'MFL rejected the trade response',
    success: RESPONSE_LABELS[opts.response],
  });
}

/** Raw `pendingTrades` rows the cookie can see; `franchiseId: '0000'` is the commissioner's queue. */
export async function fetchPendingTradeRows(opts: {
  leagueId: string;
  year: number;
  mflUserCookie: string;
  franchiseId?: string;
  host?: string | null;
}): Promise<{ trades: any[] | null; error?: string }> {
  const url = buildMflExportUrl({
    type: 'pendingTrades',
    leagueId: opts.leagueId,
    year: opts.year,
    // An empty string omits the param entirely rather than sending FRANCHISE_ID=.
    params: { FRANCHISE_ID: opts.franchiseId || undefined },
    host: opts.host || DEFAULT_HOST,
  });

  const res = await mflFetch({ url, method: 'GET', mflUserCookie: opts.mflUserCookie });
  if (!res.ok) return { trades: null, error: `MFL HTTP ${res.status}` };

  const text = await res.text();
  let data: any;
  try { data = JSON.parse(text); } catch { return { trades: null, error: 'Invalid JSON' }; }
  if (data?.error) return { trades: null, error: 'MFL auth error' };

  const pending = data?.pendingTrades;
  const raw = pending?.pendingTrade ?? pending?.trade;
  if (!raw) return { trades: [] };
  return { trades: asArray(raw) };
}

/**
 * Who proposed an owner-view `pendingTrades` row. That view has no
 * originator field: `offeredto` is always the OTHER team, so when it is not
 * the viewer the viewer proposed it; otherwise the proposer's name is read
 * from MFL's description ("Pacific Pigskins proposed a trade to …").
 * `''` when the name matches no team.
 */
export function resolveTradeProposer(
  raw: Record<string, unknown>,
  viewerFranchiseId: string,
  teamNameToFid: Map<string, string>,
): string {
  const viewer = padFid(viewerFranchiseId);
  const offeredTo = padFid(raw.offeredto ?? raw.franchise2);
  if (offeredTo !== viewer) return viewer;
  const match = String(raw.description ?? '').match(/^(.+?)\s+proposed a trade to\s/i);
  if (match) {
    const fid = teamNameToFid.get(match[1].trim().toLowerCase());
    if (fid) return padFid(fid);
  }
  return '';
}
