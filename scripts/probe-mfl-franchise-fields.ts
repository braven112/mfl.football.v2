#!/usr/bin/env node
/**
 * Probe: does MFL's authenticated `TYPE=league` export carry a last-visit /
 * last-online value?
 *
 * WHY THIS EXISTS. MFL publishes no last-online number in any of its 59 export
 * types, and the franchise record returned to an ANONYMOUS caller carries only
 * id/name/abbrev/division/waiverSortOrder/icon/logo/bbidAvailableBalance/
 * salaryCapAmount/stadium/sound (verified across 60 public leagues). But MFL's
 * own docs say a commissioner cookie makes `TYPE=league` return "otherwise
 * private owner information, like owner names, email addresses, etc." — and
 * that "etc." is the one place a last-visit field could still be hiding.
 * `docs/claude/insights/domains/mfl-api.md` recorded it as untestable because
 * the credentials live in GitHub secrets, not in a dev container. This script
 * is how it gets tested: it runs in Actions, where those secrets are.
 *
 * WHAT IT PRINTS — and deliberately does NOT print. The authenticated response
 * carries real email addresses and owner names. This script therefore prints
 * FIELD NAMES and a redacted classification of each value's SHAPE, never a
 * value. The single exception is a field whose NAME looks time-shaped and whose
 * value parses as an epoch: that one is decoded to a date, because it is the
 * entire question being asked and a date is not contact information.
 *
 * THE CONTROL. A run that finds no last-visit field proves nothing unless the
 * commissioner session actually took — an anonymous response also has no
 * last-visit field. So the script asserts it can see owner-identifying fields
 * (their PRESENCE, never their content) and marks the run INCONCLUSIVE if it
 * cannot.
 *
 * Usage:
 *   MFL_USER_ID=... MFL_IS_COMMISH=... pnpm exec tsx scripts/probe-mfl-franchise-fields.ts
 *   pnpm exec tsx scripts/probe-mfl-franchise-fields.ts --league=theleague
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mflFetch } from './lib/mfl-api.mjs';
// A `.ts` script run through tsx so it can use the real league-year authority:
// each MFL league-year is its own league and they do not all roll over on the
// same date, so the calendar year asks for a league that does not exist yet for
// weeks at a time — and a probe that queries the wrong league is worse than no
// probe, because it answers confidently.
import { getLeagueYearForSlug } from '../src/utils/league-year';
import { resolveCookies } from './fetch-owner-names.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';

interface LeagueEntry {
	id: string;
	slug: string;
	name: string;
	mflHost: string;
}

type Cookies = Record<string, string | undefined>;

/** MFL's `TYPE=league` envelope, as far as this script reads it. */
interface LeagueExport {
	league?: {
		franchises?: { franchise?: unknown };
		[key: string]: unknown;
	};
}

/** One league's probe outcome — an error, or a full result. */
type ProbeResult =
	| { league: string; error: string }
	| {
			league: string;
			sessionProven: boolean;
			newKeys: string[];
			activityKeys: string[];
			lgActivity: string[];
		};

/** Narrow a result to the error arm. */
const isProbeError = (r: ProbeResult): r is { league: string; error: string } => 'error' in r;

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

const args = process.argv.slice(2);
const onlyLeague = args.find((a) => a.startsWith('--league='))?.split('=')[1];

/** Field names that would answer the question if they existed. */
const ACTIVITY_NAME_PATTERN = /visit|online|login|logon|seen|active|access|lastmod|last_/i;
/** Field names whose VALUE may be decoded to a date (never contact info). */
const TIMEISH_NAME_PATTERN = /visit|online|login|logon|seen|time|date|stamp|access/i;

/** Redacted description of a value — its shape, never its content. */
function classify(value: unknown): string {
	if (value === null || value === undefined) return 'null';
	if (typeof value === 'object') return Array.isArray(value) ? `array(${value.length})` : 'object';
	const str = String(value);
	if (str === '') return 'empty';
	if (/^\S+@\S+\.\S+$/.test(str)) return 'EMAIL-SHAPED (redacted)';
	if (/^https?:\/\//i.test(str)) return 'url';
	if (/^\d+$/.test(str)) {
		const n = Number(str);
		// MFL stamps epoch SECONDS. Flag anything in a plausible date range.
		if (n > 946_684_800 && n < 4_102_444_800) return `epoch-seconds-shaped (${str.length} digits)`;
		return `digits(${str.length})`;
	}
	if (/^\d{4}-\d{2}-\d{2}/.test(str) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) return 'date-shaped';
	return `text(len ${str.length})`;
}

/** Decode a value to a date when the field name says it is a time. */
function maybeDecodeDate(key: string, value: unknown): string | null {
	if (!TIMEISH_NAME_PATTERN.test(key)) return null;
	const str = String(value ?? '');
	if (/^\d+$/.test(str)) {
		const n = Number(str);
		if (n > 946_684_800 && n < 4_102_444_800) return new Date(n * 1000).toISOString();
		if (n > 946_684_800_000 && n < 4_102_444_800_000) return new Date(n).toISOString();
	}
	if (/^\d{4}-\d{2}-\d{2}/.test(str) || /^\d{1,2}\/\d{1,2}\/\d{2,4}/.test(str)) return str;
	return null;
}

async function fetchLeagueExport(
	league: LeagueEntry,
	year: number,
	cookies: Cookies,
): Promise<LeagueExport> {
	const url = `https://${league.mflHost}/${year}/export?TYPE=league&L=${league.id}&JSON=1`;
	// `body` is optional for a GET; the helper is untyped .mjs and infers it as
	// required, so pass it explicitly rather than casting the call away.
	const res = await mflFetch({ url, cookies, body: undefined, timeoutMs: 20_000 });
	const text = await res.text();
	if (!res.ok) throw new Error(`HTTP ${res.status} for ${league.slug}`);
	try {
		return JSON.parse(text);
	} catch {
		// MFL answers errors with HTTP 200 and an HTML body — never assume ok means data.
		throw new Error(`Non-JSON response for ${league.slug} (first 120 chars): ${text.slice(0, 120)}`);
	}
}

function franchisesOf(payload: LeagueExport): Record<string, unknown>[] {
	const raw = payload?.league?.franchises?.franchise;
	if (Array.isArray(raw)) return raw as Record<string, unknown>[];
	if (raw && typeof raw === 'object') return [raw as Record<string, unknown>];
	return [];
}

/** Every key on the league object itself, excluding the franchise list. */
function leagueLevelKeys(payload: LeagueExport): string[] {
	const lg = payload?.league ?? {};
	return Object.keys(lg).filter((k) => k !== 'franchises').sort();
}

async function probeLeague(league: LeagueEntry, cookies: Cookies): Promise<ProbeResult> {
	const year = getLeagueYearForSlug(league.slug);
	console.log(`\n${'='.repeat(72)}`);
	console.log(`${league.name} (L=${league.id}, ${year}, host ${league.mflHost})`);
	console.log('='.repeat(72));

	const [anon, auth] = await Promise.all([
		fetchLeagueExport(league, year, {}),
		fetchLeagueExport(league, year, cookies),
	]);

	const anonKeys = new Set(franchisesOf(anon).flatMap((f) => Object.keys(f)));
	const authFranchises = franchisesOf(auth);
	const authKeys = new Set(authFranchises.flatMap((f) => Object.keys(f)));

	console.log(`\nfranchises: ${authFranchises.length} (anonymous call saw ${franchisesOf(anon).length})`);
	console.log(`anonymous franchise fields (${anonKeys.size}): ${[...anonKeys].sort().join(' ')}`);

	const newKeys = [...authKeys].filter((k) => !anonKeys.has(k)).sort();

	// ── THE CONTROL ──────────────────────────────────────────────────────────
	// Owner-identifying fields appearing is proof the commissioner session took.
	// Without it, "no last-visit field" is indistinguishable from "not logged in".
	const OWNER_FIELD = /owner|email|name|user|phone|mobile|address/i;
	const ownerFieldsSeen = newKeys.filter((k) => OWNER_FIELD.test(k));
	const sessionProven = ownerFieldsSeen.length > 0;

	console.log(`\nfields the COMMISSIONER session adds (${newKeys.length}): ${newKeys.join(' ') || '(none)'}`);
	console.log(
		sessionProven
			? `CONTROL PASSED — owner-private fields present (${ownerFieldsSeen.join(' ')}), so the session took.`
			: 'CONTROL FAILED — no owner-private fields appeared. The cookie did not authenticate, ' +
					'and a null result here means NOTHING. Refresh MFL_USER_ID / MFL_IS_COMMISH.',
	);

	if (newKeys.length > 0) {
		console.log('\nper-field shape (values redacted):');
		for (const key of newKeys) {
			const populated = authFranchises.filter((f) => f[key] !== undefined && f[key] !== '').length;
			const sample = authFranchises.find((f) => f[key] !== undefined && f[key] !== '');
			const shape = sample ? classify(sample[key]) : 'always empty';
			console.log(`  ${key.padEnd(24)} ${String(populated).padStart(2)}/${authFranchises.length} populated  ${shape}`);
		}
	}

	// ── THE ANSWER ───────────────────────────────────────────────────────────
	const activityKeys = [...authKeys].filter((k) => ACTIVITY_NAME_PATTERN.test(k)).sort();
	console.log(`\nactivity-shaped franchise fields: ${activityKeys.join(' ') || 'NONE'}`);
	for (const key of activityKeys) {
		for (const f of authFranchises) {
			const decoded = maybeDecodeDate(key, f[key]);
			if (decoded) {
				console.log(`  ${key} on franchise ${f.id} decodes to ${decoded}`);
				break;
			}
		}
	}

	// A last-visit could also hang off the league object rather than a franchise.
	const lgKeys = leagueLevelKeys(auth);
	const lgActivity = lgKeys.filter((k) => ACTIVITY_NAME_PATTERN.test(k));
	console.log(`\nleague-level fields (${lgKeys.length}): ${lgKeys.join(' ')}`);
	console.log(`league-level activity-shaped: ${lgActivity.join(' ') || 'NONE'}`);

	return { league: league.slug, sessionProven, newKeys, activityKeys, lgActivity };
}

async function main(): Promise<void> {
	const cookies = await resolveCookies();
	console.log('Probing MFL authenticated TYPE=league for a last-visit / last-online field.');
	console.log('Values are redacted throughout; only field NAMES and shapes are printed.');

	const targets = Object.values(LEAGUES).filter((l) => !onlyLeague || l.slug === onlyLeague);
	const results: ProbeResult[] = [];
	for (const league of targets) {
		try {
			results.push(await probeLeague(league, cookies));
		} catch (err) {
			console.error(`\n${league.slug}: probe failed — ${messageOf(err)}`);
			results.push({ league: league.slug, error: messageOf(err) });
		}
	}

	console.log(`\n${'='.repeat(72)}\nVERDICT\n${'='.repeat(72)}`);
	let anyInconclusive = false;
	for (const r of results) {
		if (isProbeError(r)) {
			anyInconclusive = true;
			console.log(`${r.league}: ERROR — ${r.error}`);
			continue;
		}
		if (!r.sessionProven) {
			anyInconclusive = true;
			console.log(`${r.league}: INCONCLUSIVE — commissioner session did not take.`);
			continue;
		}
		const found = [...r.activityKeys, ...r.lgActivity];
		console.log(
			found.length > 0
				? `${r.league}: FOUND activity-shaped field(s): ${found.join(' ')}`
				: `${r.league}: CONFIRMED — no last-visit/last-online field, even authenticated as commissioner.`,
		);
	}
	if (anyInconclusive) process.exitCode = 1;
}

// Guarded like fetch-owner-names.mjs and the sync script: without this, merely
// importing the module fires live authenticated MFL requests and can
// process.exit(1) out of the middle of a test run.
const isMain =
	process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((err) => {
		console.error(err);
		process.exit(1);
	});
}
