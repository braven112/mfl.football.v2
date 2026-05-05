#!/usr/bin/env node
/**
 * One-shot Redis migration: copy missing data from the old Vercel KV
 * (KV_REST_API_URL / KV_REST_API_TOKEN — falls back to STORAGE_REST_API_*)
 * into the new Upstash Redis (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN).
 *
 * Default policy — current data wins, source augments only:
 *   string : copied only if key absent on destination
 *   hash   : copied wholesale if absent; otherwise only fields missing on dest
 *   set    : copied wholesale if absent; otherwise only members missing on dest
 *   zset   : copied wholesale if absent; otherwise missing members added with
 *            ZADD NX so any existing scores on dest are preserved
 *   list   : copied only if absent (lists can't be merged safely — duplicates
 *            and order); skipped + reported when dest already has the key
 *
 * TTLs are copied only on fresh-key writes; augmented keys keep dest's TTL.
 *
 * The script is resumable: SCAN cursor + counters are checkpointed to
 * .migrate-redis.state.json (gitignored). If you hit the Upstash command
 * budget, ctrl-C, wait, then re-run with --resume.
 *
 * Usage:
 *   pnpm vercel env pull            # if running locally
 *   node scripts/migrate-redis.mjs --dry-run        # preview
 *   node scripts/migrate-redis.mjs                  # do it
 *   node scripts/migrate-redis.mjs --resume         # continue after interrupt
 *   node scripts/migrate-redis.mjs --prefix=activity:  --limit=500
 *
 * Flags:
 *   --dry-run       Don't write to destination; just count what would happen.
 *   --resume        Continue from the saved cursor.
 *   --reset         Delete the state file before starting.
 *   --prefix=X      Only consider keys whose name starts with X.
 *   --batch=N       SCAN COUNT hint (default 200).
 *   --limit=N       Stop after processing N keys this run.
 *   --quiet         Suppress per-batch progress lines.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Redis } from '@upstash/redis';

const STATE_FILE = path.join(process.cwd(), '.migrate-redis.state.json');

// ── flags ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = {
	dryRun: argv.includes('--dry-run'),
	resume: argv.includes('--resume'),
	reset: argv.includes('--reset'),
	quiet: argv.includes('--quiet'),
	prefix: '',
	batch: 200,
	limit: Infinity,
};
for (const a of argv) {
	if (a.startsWith('--prefix=')) flags.prefix = a.slice('--prefix='.length);
	else if (a.startsWith('--batch=')) flags.batch = Number(a.slice('--batch='.length)) || 200;
	else if (a.startsWith('--limit=')) flags.limit = Number(a.slice('--limit='.length)) || Infinity;
}

// ── env / clients ───────────────────────────────────────────────────────
const sourceUrl = process.env.KV_REST_API_URL || process.env.STORAGE_REST_API_URL;
const sourceToken = process.env.KV_REST_API_TOKEN || process.env.STORAGE_REST_API_TOKEN;
const destUrl = process.env.UPSTASH_REDIS_REST_URL;
const destToken = process.env.UPSTASH_REDIS_REST_TOKEN;

if (!sourceUrl || !sourceToken) {
	console.error('Missing source DB. Set KV_REST_API_URL / KV_REST_API_TOKEN');
	console.error('(or STORAGE_REST_API_URL / STORAGE_REST_API_TOKEN — old Vercel KV).');
	process.exit(1);
}
if (!destUrl || !destToken) {
	console.error('Missing destination DB. Set UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN.');
	process.exit(1);
}
if (sourceUrl === destUrl) {
	console.error('Source and destination URLs are identical. Refusing to migrate.');
	process.exit(1);
}

const src = new Redis({ url: sourceUrl, token: sourceToken });
const dst = new Redis({ url: destUrl, token: destToken });

// ── counters ────────────────────────────────────────────────────────────
const counts = { src: 0, dst: 0 };
const bump = (which, n = 1) => { counts[which] += n; };

// ── state (resume support) ──────────────────────────────────────────────
let state = {
	cursor: '0',
	startedAt: new Date().toISOString(),
	scanned: 0,
	copied: 0,
	augmented: 0,
	skippedExisting: 0,
	skippedListExisting: 0,
	errors: 0,
	prefix: flags.prefix,
};

if (flags.reset && fs.existsSync(STATE_FILE)) fs.unlinkSync(STATE_FILE);
if (flags.resume && fs.existsSync(STATE_FILE)) {
	try {
		const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
		state = { ...state, ...saved };
		console.log(`Resuming from cursor=${state.cursor} (already scanned=${state.scanned}).`);
	} catch (e) {
		console.warn('Could not read state file; starting fresh.', e.message);
	}
}

function saveState() {
	try {
		fs.writeFileSync(STATE_FILE, JSON.stringify({ ...state, counts }, null, 2));
	} catch (e) {
		console.warn('Could not save state:', e.message);
	}
}

const log = (...args) => { if (!flags.quiet) console.log(...args); };

// ── per-key copy ────────────────────────────────────────────────────────
async function migrateKey(key) {
	bump('src');
	const type = await src.type(key);
	if (!type || type === 'none') return;

	bump('dst');
	const destExists = (await dst.exists(key)) > 0;

	switch (type) {
		case 'string': {
			if (destExists) { state.skippedExisting++; return; }
			bump('src');
			const val = await src.get(key);
			bump('src');
			const ttl = await src.pttl(key);
			if (val == null) return;
			if (flags.dryRun) { state.copied++; return; }
			bump('dst');
			if (typeof ttl === 'number' && ttl > 0) await dst.set(key, val, { px: ttl });
			else await dst.set(key, val);
			state.copied++;
			return;
		}

		case 'hash': {
			bump('src');
			const all = await src.hgetall(key);
			if (!all || Object.keys(all).length === 0) return;
			if (!destExists) {
				if (flags.dryRun) { state.copied++; return; }
				bump('dst');
				await dst.hset(key, all);
				bump('src');
				const ttl = await src.pttl(key);
				if (typeof ttl === 'number' && ttl > 0) {
					bump('dst');
					await dst.pexpire(key, ttl);
				}
				state.copied++;
			} else {
				bump('dst');
				const destAll = (await dst.hgetall(key)) ?? {};
				const missing = {};
				for (const [field, value] of Object.entries(all)) {
					if (!(field in destAll)) missing[field] = value;
				}
				if (Object.keys(missing).length === 0) { state.skippedExisting++; return; }
				if (flags.dryRun) { state.augmented++; return; }
				bump('dst');
				await dst.hset(key, missing);
				state.augmented++;
			}
			return;
		}

		case 'set': {
			bump('src');
			const members = await src.smembers(key);
			if (!members?.length) return;
			if (!destExists) {
				if (flags.dryRun) { state.copied++; return; }
				bump('dst');
				await dst.sadd(key, members[0], ...members.slice(1));
				bump('src');
				const ttl = await src.pttl(key);
				if (typeof ttl === 'number' && ttl > 0) {
					bump('dst');
					await dst.pexpire(key, ttl);
				}
				state.copied++;
			} else {
				bump('dst');
				const destMembers = new Set(await dst.smembers(key));
				const missing = members.filter((m) => !destMembers.has(m));
				if (!missing.length) { state.skippedExisting++; return; }
				if (flags.dryRun) { state.augmented++; return; }
				bump('dst');
				await dst.sadd(key, missing[0], ...missing.slice(1));
				state.augmented++;
			}
			return;
		}

		case 'zset': {
			bump('src');
			// withScores returns [member, score, member, score, ...]
			const flat = await src.zrange(key, 0, -1, { withScores: true });
			if (!flat?.length) return;
			const pairs = [];
			for (let i = 0; i < flat.length; i += 2) {
				pairs.push({ score: Number(flat[i + 1]), member: flat[i] });
			}
			if (!destExists) {
				if (flags.dryRun) { state.copied++; return; }
				bump('dst');
				await dst.zadd(key, pairs[0], ...pairs.slice(1));
				bump('src');
				const ttl = await src.pttl(key);
				if (typeof ttl === 'number' && ttl > 0) {
					bump('dst');
					await dst.pexpire(key, ttl);
				}
				state.copied++;
			} else {
				bump('dst');
				const destMembersArr = await dst.zrange(key, 0, -1);
				const destMembers = new Set(destMembersArr);
				const missing = pairs.filter((p) => !destMembers.has(p.member));
				if (!missing.length) { state.skippedExisting++; return; }
				if (flags.dryRun) { state.augmented++; return; }
				bump('dst');
				// NX so existing scores never change
				await dst.zadd(key, { nx: true }, missing[0], ...missing.slice(1));
				state.augmented++;
			}
			return;
		}

		case 'list': {
			if (destExists) { state.skippedListExisting++; return; }
			bump('src');
			const items = await src.lrange(key, 0, -1);
			if (!items?.length) return;
			if (flags.dryRun) { state.copied++; return; }
			bump('dst');
			await dst.rpush(key, items[0], ...items.slice(1));
			bump('src');
			const ttl = await src.pttl(key);
			if (typeof ttl === 'number' && ttl > 0) {
				bump('dst');
				await dst.pexpire(key, ttl);
			}
			state.copied++;
			return;
		}

		default:
			log(`? unsupported type "${type}" for key ${key}`);
	}
}

// ── main ────────────────────────────────────────────────────────────────
console.log(`Source:      ${sourceUrl}`);
console.log(`Destination: ${destUrl}`);
console.log(
	`Mode: ${flags.dryRun ? 'DRY-RUN' : 'LIVE'} | prefix=${flags.prefix || '(all)'} | batch=${flags.batch} | limit=${flags.limit === Infinity ? 'inf' : flags.limit}`,
);
console.log('');

let cursor = state.cursor;
const startScanned = state.scanned;
const startedAt = Date.now();

let stopRequested = false;
process.on('SIGINT', () => {
	if (stopRequested) process.exit(130);
	stopRequested = true;
	console.log('\nSIGINT — finishing current batch and saving state…');
});

try {
	while (!stopRequested) {
		bump('src');
		const scanOpts = { count: flags.batch };
		if (flags.prefix) scanOpts.match = `${flags.prefix}*`;
		const [next, keys] = await src.scan(cursor, scanOpts);
		cursor = String(next);

		for (const key of keys) {
			if (stopRequested) break;
			if (state.scanned - startScanned >= flags.limit) break;
			try {
				await migrateKey(key);
			} catch (e) {
				state.errors++;
				console.warn(`! ${key}: ${e?.message ?? e}`);
			}
			state.scanned++;
			if (state.scanned % 100 === 0) {
				log(
					`scanned=${state.scanned} copied=${state.copied} augmented=${state.augmented} skipped=${state.skippedExisting} listSkipped=${state.skippedListExisting} errors=${state.errors} cmd[src=${counts.src} dst=${counts.dst}]`,
				);
				state.cursor = cursor;
				saveState();
			}
		}

		state.cursor = cursor;
		saveState();
		if (cursor === '0') break;
		if (state.scanned - startScanned >= flags.limit) break;
	}
} finally {
	state.cursor = cursor;
	saveState();
}

const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
console.log('');
console.log('────────── DONE ──────────');
console.log(`Scanned:           ${state.scanned}`);
console.log(`Copied (new key):  ${state.copied}`);
console.log(`Augmented:         ${state.augmented}    (missing fields/members added; existing untouched)`);
console.log(`Skipped existing:  ${state.skippedExisting}    (string/collection already complete on dest)`);
console.log(`Skipped lists:     ${state.skippedListExisting}    (list key existed on dest — not merged)`);
console.log(`Errors:            ${state.errors}`);
console.log(`Source commands:   ${counts.src}`);
console.log(`Dest commands:     ${counts.dst}`);
console.log(`Elapsed:           ${elapsedSec}s`);
console.log(
	cursor === '0'
		? 'Full scan complete. You can delete .migrate-redis.state.json.'
		: `Stopped at cursor=${cursor}. Re-run with --resume to continue.`,
);
