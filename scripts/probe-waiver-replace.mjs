/**
 * Does `import?TYPE=waiverRequest` with `REPLACE=1` actually write?
 *
 * MFL documents REPLACE as the reorder primitive: "the ones specified via the
 * PICKS parameter are added to the existing request unless this parameter is
 * set in which case it replaces the current entries." If it works, reordering a
 * round is one atomic call. If it does not, we need MFL's own edit form.
 *
 * The doubt is earned: on 2026-09-02 this endpoint answered an authenticated,
 * correctly-hosted, correctly-formed waiver request with an EMPTY 200 and stored
 * nothing. It was never explained — the fix went through `add_drop` instead. So
 * this settles it by experiment rather than by reading the docs again.
 *
 * ── This one WRITES. Read the safety design before running it. ──
 *
 *  1. Read the round's current picks.
 *  2. Re-send those SAME picks, unchanged, with REPLACE=1. A working endpoint
 *     therefore lands the owner exactly where they started.
 *  3. Read back. The discriminator is the TIMESTAMP: same picks + new timestamp
 *     means it wrote; same picks + same timestamp means it no-opped.
 *  4. If the claim VANISHED, refile it immediately via the add_drop path that is
 *     known to work (FORCE_WAIVER=on + SUBMIT=Submit Request), and verify the
 *     restore. The failure mode this guards against — REPLACE clearing the round
 *     and then failing to re-add — is the only way this test can hurt.
 *
 * Nothing is hardcoded: the league comes from the registry by slug, and the
 * picks come from what is actually filed. If no claim is pending it refuses to
 * run, because then there is nothing to replay and a write would be inventing a
 * claim the owner never made.
 *
 * Usage:  MFL_USER_ID=… node scripts/probe-waiver-replace.mjs --league=afl-fantasy
 */
import { mflFetch } from './lib/mfl-api.mjs';
import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { getNonEmpty } from './lib/env.mjs';

const slug = getNonEmpty(process.argv.find((a) => a.startsWith('--league='))?.split('=')[1]) || DEFAULT_LEAGUE_SLUG;
const league = getLeagueBySlug(slug);
if (!league) {
  console.error(`Unknown league slug: ${slug}`);
  process.exit(1);
}
const cookie = getNonEmpty(process.env.MFL_USER_ID);
if (!cookie) {
  console.error('MFL_USER_ID is required.');
  process.exit(1);
}
const year = Number(getNonEmpty(process.env.MFL_YEAR)) || new Date().getFullYear();
const host = league.mflHost;

const get = async (qs) => {
  const res = await mflFetch({
    url: `https://${host}/${year}/export?${qs}&_=${Date.now()}`,
    cookies: { MFL_USER_ID: cookie },
    timeoutMs: 20_000,
  });
  return JSON.parse(await res.text());
};

/** The round's filed requests, normalised — MFL collapses a single one to an object. */
const readRequests = async () => {
  const body = await get(`TYPE=pendingWaivers&L=${league.id}&JSON=1`);
  const pending = body?.pendingWaivers;
  if (!pending || typeof pending !== 'object') return [];
  const raw = pending.waiverRequest ?? pending.waiver ?? [];
  return Array.isArray(raw) ? raw : [raw];
};

const before = await readRequests();
console.log('BEFORE:', JSON.stringify(before));
if (before.length === 0 || !before[0]?.addsDrops) {
  console.log('\nNO PENDING CLAIM — refusing to run.');
  console.log('This test replays an EXISTING claim. With none filed there is nothing to');
  console.log('replay, and writing anything would invent a claim the owner never made.');
  process.exit(0);
}

const target = before[0];
const picks = String(target.addsDrops);
const round = String(target.round ?? '1');
const addIds = picks.split(',').map((p) => p.trim().split('_')[0]).filter(Boolean);
console.log(`\nREPLAYING round ${round} picks "${picks}" with REPLACE=1 (unchanged).`);

const body = new URLSearchParams({ L: league.id, ROUND: round, PICKS: picks, REPLACE: '1' }).toString();
const url = `https://${host}/${year}/import?TYPE=waiverRequest&L=${league.id}`;
console.log(`POST ${url} (${body})`);
const res = await mflFetch({ url, method: 'POST', cookies: { MFL_USER_ID: cookie }, body, timeoutMs: 20_000 });
const text = (await res.text()).trim();
console.log(`RESPONSE: ${res.status} ${JSON.stringify(text.slice(0, 300))}`);

const after = await readRequests();
console.log('\nAFTER:', JSON.stringify(after));

const stillThere = after.some((r) => String(r?.addsDrops ?? '') === picks);
if (stillThere) {
  const t0 = String(target.timestamp ?? '');
  const t1 = String(after.find((r) => String(r?.addsDrops ?? '') === picks)?.timestamp ?? '');
  console.log('\nCLAIM INTACT.');
  console.log(`timestamp before=${t0} after=${t1}`);
  console.log(t0 && t1 && t0 !== t1
    ? 'VERDICT: REPLACE WROTE — the timestamp moved. Option A is viable.'
    : 'VERDICT: REPLACE NO-OPPED — same timestamp, nothing changed. Option A is dead.');
  process.exit(0);
}

// ── The claim is gone. Put it back, now. ───────────────────────────────────
console.error('\nCLAIM MISSING AFTER REPLACE — restoring via add_drop.');
for (const pick of picks.split(',')) {
  const [addPid, dropPid] = pick.trim().split('_');
  const restore = new URLSearchParams({
    L: league.id,
    add_settings: '',
    PROJSRC: 'mfl',
    add_pid: addPid ?? '',
    drop_pid: dropPid && dropPid !== '0000' ? dropPid : '',
    FORCE_WAIVER: 'on',
    ROUND: round,
    COMMENTS: '',
    SUBMIT: 'Submit Request',
  }).toString();
  console.error(`RESTORE POST add_drop (${restore})`);
  await mflFetch({
    url: `https://${host}/${year}/add_drop`,
    method: 'POST',
    cookies: { MFL_USER_ID: cookie },
    body: restore,
    timeoutMs: 20_000,
  });
}
const restored = await readRequests();
console.error('AFTER RESTORE:', JSON.stringify(restored));
const ok = restored.some((r) => addIds.every((id) => String(r?.addsDrops ?? '').includes(id)));
console.error(ok
  ? 'RESTORED. VERDICT: REPLACE cleared the round without re-adding — Option A is unsafe.'
  : 'RESTORE FAILED — REFILE THE CLAIM ON MFL BY HAND, NOW.');
process.exit(ok ? 0 : 1);
