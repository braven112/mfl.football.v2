/**
 * Commissioner accounts on Owner Activity — visits recorded by MFL ACCOUNT,
 * not by franchise.
 *
 * Everything else on the report is keyed by franchise number, which cannot
 * tell two commissioner logins apart: a head commissioner and a
 * co-commissioner who hold no team both sign in as the league's commissioner
 * slot, so their visits merge into one hidden row. The owner asked (Oct 2026)
 * to see whether a league's commissioner has actually signed in and looked
 * at the site, which needs the account name.
 *
 * Only sessions that are NOT plain owners are recorded (MFL commissioner or
 * co-commissioner, or a platform admin), and only for the league the session
 * belongs to, so this never becomes a per-owner name log. One hash per
 * league, `activity:accounts:<leagueId>`, fields `<account>|seen`,
 * `<account>|login`, `<account>|views`, bounded by how many commissioner
 * accounts a league has. Never throws: analytics must never break a page
 * view or a sign-in.
 */
import { getRedis } from './redis-client';
import { isPlatformAdmin } from './league-admin';
import type { AuthUser } from './auth';

export function commissionerAccountsKey(leagueId: string): string {
	return `activity:accounts:${leagueId}`;
}

/** The account name to record under, or null when this session is not tracked. */
export function trackedAccountName(
	user: Pick<AuthUser, 'name' | 'role' | 'leagueId'> | null | undefined,
	leagueId: string,
): string | null {
	if (!user || user.leagueId !== leagueId) return null;
	if (user.role === 'owner' && !isPlatformAdmin(user)) return null;
	const name = typeof user.name === 'string' ? user.name.trim().toLowerCase() : '';
	// `|` separates the field parts; MFL account names never contain one.
	if (!name || name.includes('|')) return null;
	return name;
}

/** A page view by a commissioner account. */
export async function recordCommissionerVisit(leagueId: string, account: string, now = Date.now()): Promise<void> {
	try {
		const redis = await getRedis();
		if (!redis) return;
		const key = commissionerAccountsKey(leagueId);
		await Promise.all([
			redis.hset(key, { [`${account}|seen`]: String(now) }),
			redis.hincrby(key, `${account}|views`, 1),
		]);
	} catch (err) {
		console.warn('[commissioner-visits] visit write failed:', err);
	}
}

/** A sign-in by a commissioner account. */
export async function recordCommissionerLogin(leagueId: string, account: string, now = Date.now()): Promise<void> {
	try {
		const redis = await getRedis();
		if (!redis) return;
		await redis.hset(commissionerAccountsKey(leagueId), { [`${account}|login`]: String(now) });
	} catch (err) {
		console.warn('[commissioner-visits] login write failed:', err);
	}
}

export interface CommissionerAccountRow {
	account: string;
	/** Epoch ms of the last page view, or null. */
	lastSeen: number | null;
	/** Epoch ms of the last sign-in, or null. */
	lastLogin: number | null;
	views: number;
}

/** Parse the hash into rows, most recently active first. Pure, for tests. */
export function parseCommissionerAccounts(raw: Record<string, unknown> | null | undefined): CommissionerAccountRow[] {
	const rows = new Map<string, CommissionerAccountRow>();
	for (const [field, value] of Object.entries(raw ?? {})) {
		const cut = field.lastIndexOf('|');
		if (cut <= 0) continue;
		const account = field.slice(0, cut);
		const kind = field.slice(cut + 1);
		const n = Number(value);
		if (!Number.isFinite(n) || n <= 0) continue;
		const row = rows.get(account) ?? { account, lastSeen: null, lastLogin: null, views: 0 };
		if (kind === 'seen') row.lastSeen = n;
		else if (kind === 'login') row.lastLogin = n;
		else if (kind === 'views') row.views = n;
		else continue;
		rows.set(account, row);
	}
	const latest = (r: CommissionerAccountRow) => Math.max(r.lastSeen ?? 0, r.lastLogin ?? 0);
	return [...rows.values()].sort((a, b) => latest(b) - latest(a) || a.account.localeCompare(b.account));
}

export async function getCommissionerAccounts(leagueId: string): Promise<CommissionerAccountRow[]> {
	try {
		const redis = await getRedis();
		if (!redis) return [];
		return parseCommissionerAccounts((await redis.hgetall(commissionerAccountsKey(leagueId))) as Record<string, unknown> | null);
	} catch {
		return [];
	}
}
