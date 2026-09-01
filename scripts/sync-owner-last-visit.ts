#!/usr/bin/env node
/**
 * Sync each franchise's MFL `lastVisit` into a committed data file.
 *
 * MFL DOES publish a last-online number — but it is undocumented, and it is
 * returned ONLY to a commissioner session. `export?TYPE=league` adds ~20
 * private fields when called with a commissioner cookie, and one of them is
 * `lastVisit`: epoch SECONDS of that owner's last MFL login, populated for
 * every franchise. Anonymously the field does not exist at all, which is why
 * every `league.json` committed in this repo lacks it and why the API looked
 * for years like it had no such value. (Proved by
 * `scripts/probe-mfl-franchise-fields.ts`; see the write-up in
 * `docs/claude/insights/domains/mfl-api.md`.)
 *
 * WHY A COMMITTED FILE rather than a live fetch: the commissioner cookie lives
 * in GitHub secrets, not in the Vercel runtime, so a page cannot fetch this at
 * render time. Same shape as `fetch-owner-names.mjs` — Actions holds the
 * credential, the repo holds the result.
 *
 * PRIVACY — the load-bearing part. The authenticated response carries EMAIL
 * ADDRESSES, phone numbers, street addresses and real names. This script
 * whitelists exactly two fields per franchise (`id`, `lastVisit`) and then
 * asserts the payload it is about to write contains nothing contact-shaped.
 * (Named distinctly from `fetch-owner-names.mjs`'s `assertNoContactInfo`,
 * which guards a single name STRING — same concern, different shape.)
 * It throws rather than write if that assertion fails. Never widen the
 * whitelist without re-reading that check.
 *
 * WHICH YEAR. Each MFL league-year is a separate league, and the leagues here
 * do NOT roll over on the same date — TheLeague on Feb 14, the AFL and
 * best-ball on Jun 1 (`leagueYearRollover` in the registry). The calendar year
 * is therefore the wrong number for months at a time: on Jan 2 it asks MFL for
 * a 2027 league that will not exist until Feb 14, gets an anonymous payload
 * back, and reports it as expired credentials every 6 hours. Resolve it through
 * `getLeagueYearForSlug`, never `new Date().getFullYear()` and never a re-port
 * of the formula (CLAUDE.md: that one has shipped wrong in five files).
 *
 * This is a `.ts` script run through tsx for exactly that reason —
 * `league-year.ts` is the authority and a plain `.mjs` cannot import it.
 *
 * Usage:
 *   MFL_USER_ID=... MFL_IS_COMMISH=... pnpm exec tsx scripts/sync-owner-last-visit.ts
 *   pnpm exec tsx scripts/sync-owner-last-visit.ts --league=theleague --dry-run
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mflFetch } from './lib/mfl-api.mjs';
import { resolveCookies } from './fetch-owner-names.mjs';
import { writeJsonIfChanged as writeJsonIfChangedUntyped } from './lib/canonical-json.mjs';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { getLeagueYearForSlug } from '../src/utils/league-year';

/**
 * `canonical-json.mjs` is untyped JS, so TS infers its `ignoreKeys = []`
 * default as `never[]` and rejects any real key list. Give it its actual
 * signature once here rather than casting at the call site.
 */
const writeJsonIfChanged = writeJsonIfChangedUntyped as (
	filePath: string,
	data: unknown,
	opts?: { ignoreKeys?: string[] },
) => boolean;

/** The registry shape this script needs. */
interface LeagueEntry {
	id: string;
	slug: string;
	name: string;
	mflHost: string;
	dataPath: string;
}

/** What gets written to disk — id -> epoch SECONDS, and nothing else. */
interface LastVisitPayload {
	generatedAt: string;
	leagueId: string;
	year: number;
	source: string;
	lastVisit: Record<string, number>;
}

type Cookies = Record<string, string | undefined>;

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const args = process.argv.slice(2);
const onlyLeague = args.find((a) => a.startsWith('--league='))?.split('=')[1];
const dryRun = args.includes('--dry-run');

/** The ONLY fields allowed out of the authenticated response. */
const ALLOWED_FIELDS = ['id', 'lastVisit'];

/** Epoch seconds bounds — anything outside is not a plausible visit time. */
const MIN_EPOCH_SECONDS = 946_684_800; // 2000-01-01
const MAX_EPOCH_SECONDS = 4_102_444_800; // 2100-01-01

export function outputPathFor(league: Pick<LeagueEntry, 'dataPath'>): string {
	return path.join(ROOT, league.dataPath, 'owner-last-visit.json');
}

/**
 * Refuse to write anything that looks like contact information.
 *
 * The whitelist above should make this unreachable — which is exactly why it
 * is here. A future edit that widens the whitelist, or an MFL change that
 * renames `lastVisit` into something carrying a string, hits this instead of
 * committing an owner's email address to a public git history.
 */
export function assertPayloadHasNoContactInfo(payload: Partial<LastVisitPayload> & Record<string, unknown>): void {
	// Shape first, patterns second. Matching only email/URL shapes would let a
	// real name ("John Smith") or a bare phone number ("5555555555") straight
	// through the guard whose entire job is to stop them — and those are three
	// of the fields sitting beside `lastVisit` in the same MFL response. So the
	// payload is pinned to an exact shape: known keys, numbers only.
	const EXPECTED_KEYS = ['generatedAt', 'leagueId', 'year', 'source', 'lastVisit'];
	const unexpected = Object.keys(payload).filter((k) => !EXPECTED_KEYS.includes(k));
	if (unexpected.length > 0) {
		throw new Error(`Refusing to write: unexpected top-level key(s) ${unexpected.join(', ')}.`);
	}

	for (const [franchiseId, value] of Object.entries(payload.lastVisit ?? {})) {
		// A number cannot be a name, an address or an email. This one check is
		// what actually makes the file safe; the pattern scan below is a
		// belt-and-braces catch for the metadata strings.
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			throw new Error(`Refusing to write: franchise ${franchiseId} lastVisit is not a number.`);
		}
		if (!/^\d{4}$/.test(franchiseId)) {
			throw new Error(`Refusing to write: "${franchiseId}" is not a franchise id.`);
		}
	}

	// Scan the METADATA only. `lastVisit` is already proven to be 4-digit keys
	// mapping to finite numbers, and a 10-digit epoch trips any phone-number
	// pattern — scanning it would fail every real sync.
	const { lastVisit: _validated, generatedAt: _ts, source: _src, ...metadata } = payload;
	const CONTACT_SHAPED = /@|\bhttps?:\/\/|\.com\b|\.net\b|\.org\b|\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/i;
	if (CONTACT_SHAPED.test(JSON.stringify(metadata))) {
		throw new Error('Refusing to write: payload contains contact-shaped text.');
	}
}

/** Pull `{ franchiseId: epochSeconds }` out of an authenticated league export. */
export function extractLastVisits(payload: unknown): Record<string, number> {
	const raw = (payload as { league?: { franchises?: { franchise?: unknown } } })?.league?.franchises
		?.franchise;
	const franchises: Record<string, unknown>[] = Array.isArray(raw)
		? (raw as Record<string, unknown>[])
		: raw && typeof raw === 'object'
			? [raw as Record<string, unknown>]
			: [];
	const out: Record<string, number> = {};
	for (const franchise of franchises) {
		// Whitelist, rather than delete-the-rest: an unknown new private field
		// is then never carried along by accident.
		const picked = Object.fromEntries(
			ALLOWED_FIELDS.filter((k) => k in franchise).map((k) => [k, franchise[k]]),
		);
		const id = typeof picked.id === 'string' ? picked.id : '';
		if (!id) continue;
		const seconds = Number(picked.lastVisit);
		if (!Number.isFinite(seconds) || seconds < MIN_EPOCH_SECONDS || seconds > MAX_EPOCH_SECONDS) continue;
		out[id] = seconds;
	}
	return out;
}

async function syncLeague(league: LeagueEntry, cookies: Cookies): Promise<boolean> {
	const year = getLeagueYearForSlug(league.slug);
	const url = `https://${league.mflHost}/${year}/export?TYPE=league&L=${league.id}&JSON=1`;
	// `body` is optional for a GET; the helper is untyped .mjs and infers it
	// as required, so pass it explicitly rather than casting the call away.
	const res = await mflFetch({ url, cookies, body: undefined, timeoutMs: 20_000 });
	const text = await res.text();
	if (!res.ok) throw new Error(`HTTP ${res.status}`);

	let parsed;
	try {
		parsed = JSON.parse(text);
	} catch {
		// MFL answers errors with HTTP 200 and an HTML body.
		throw new Error(`Non-JSON response (first 120 chars): ${text.slice(0, 120)}`);
	}

	const lastVisit = extractLastVisits(parsed);
	const franchiseCount = Object.keys(lastVisit).length;

	// An anonymous response parses fine and simply has no lastVisit anywhere,
	// so an empty result is never a write — it would silently blank the feature.
	//
	// But "empty" means two different things and they must not be confused:
	// a league this account is only an OWNER in never had lastVisit (MFL gives
	// it to commissioners), which is routine and must stay quiet, or the run
	// would cry wolf every 6 hours. A league that HAS a committed file and now
	// returns nothing is a credential regression, and that must be loud.
	if (franchiseCount === 0) {
		const hadDataBefore = fs.existsSync(outputPathFor(league));
		if (hadDataBefore) {
			throw new Error(
				'lastVisit disappeared for a league that previously had it — the commissioner ' +
					'session no longer takes. Refresh MFL_USER_ID / MFL_IS_COMMISH.',
			);
		}
		console.log(`${league.slug}: no lastVisit (not a commissioner here) — skipping.`);
		return false;
	}

	const payload = {
		generatedAt: new Date().toISOString(),
		leagueId: league.id,
		year,
		source: 'MFL export?TYPE=league (commissioner session)',
		lastVisit,
	};
	assertPayloadHasNoContactInfo(payload);

	const outPath = outputPathFor(league);
	const newest = Math.max(...Object.values(lastVisit));
	const oldest = Math.min(...Object.values(lastVisit));
	console.log(
		`${league.slug}: ${franchiseCount} franchises, most recent ${new Date(newest * 1000).toISOString()}, ` +
			`least recent ${new Date(oldest * 1000).toISOString()}`,
	);

	if (dryRun) {
		console.log(`  (dry run — would write ${path.relative(ROOT, outPath)})`);
		return false;
	}

	// generatedAt is volatile by construction; excluding it keeps a run that
	// found no new visits from committing a byte-shuffle.
	const wrote = writeJsonIfChanged(outPath, payload, { ignoreKeys: ['generatedAt'] });
	console.log(`  ${wrote ? 'wrote' : 'unchanged'} ${path.relative(ROOT, outPath)}`);
	return wrote;
}

async function main(): Promise<void> {
	const cookies = await resolveCookies();
	const targets = Object.values(LEAGUES).filter((l) => !onlyLeague || l.slug === onlyLeague);

	// A typo'd --league= would otherwise select nothing, sync nothing, and exit
	// 0 — a green run that did no work is worse than a red one.
	if (targets.length === 0) {
		console.error(
			`No league matches --league=${onlyLeague}. Known slugs: ${Object.keys(LEAGUES).join(', ')}`,
		);
		process.exit(1);
	}

	let failures = 0;
	for (const league of targets) {
		try {
			await syncLeague(league, cookies);
		} catch (err) {
			// Keep going so one league's failure does not lose the others' sync,
			// but remember it — the exit code below reports it.
			console.error(`${league.slug}: ${err instanceof Error ? err.message : String(err)}`);
			failures++;
		}
	}

	// Any hard failure fails the run. A "not a commissioner here" skip is not a
	// failure and never reaches this counter.
	if (failures > 0) {
		console.error(`${failures} league(s) failed.`);
		process.exitCode = 1;
	}
}

const isMain =
	process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
	main().catch((err: unknown) => {
		console.error(err);
		process.exit(1);
	});
}
