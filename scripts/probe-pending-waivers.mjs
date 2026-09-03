/**
 * Print the RAW shape of MFL's `export?TYPE=pendingWaivers` for a league.
 *
 * Settles one question that has been blocking the AFL waiver claim: when a
 * claim IS filed, what does this export actually return? The route treats it as
 * proof of whether a write landed, and that parser
 * (`readPendingWaiverPlayerIds`) has only ever been tested against payloads
 * written by hand — the export is owner-gated, so nobody has seen a real one.
 *
 * That matters because the two failure modes are indistinguishable from the
 * outside: either the write is not landing, or the write IS landing and the
 * verification cannot see it. The second would report a filed claim as a
 * failure, which is exactly what an owner is currently being shown.
 *
 * Read-only. GET only. Writes nothing to MFL and commits nothing here.
 *
 * PRIVACY: prints the payload's structure and player ids. Those are public
 * league data. It does not touch `TYPE=league`, which is where owner emails,
 * addresses and phone numbers live under a commissioner cookie.
 *
 * Usage (needs MFL_USER_ID):
 *   MFL_USER_ID=… node scripts/probe-pending-waivers.mjs --league=afl-fantasy
 */
import { mflFetch } from './lib/mfl-api.mjs';
import { getLeagueBySlug, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';
import { getNonEmpty } from './lib/env.mjs';

const slugArg = process.argv.find((a) => a.startsWith('--league='))?.split('=')[1];
const slug = getNonEmpty(slugArg) || DEFAULT_LEAGUE_SLUG;
const league = getLeagueBySlug(slug);
if (!league) {
  console.error(`Unknown league slug: ${slug}`);
  process.exit(1);
}

const cookie = getNonEmpty(process.env.MFL_USER_ID);
if (!cookie) {
  console.error('MFL_USER_ID is required — the export is owner-gated.');
  process.exit(1);
}

const year = Number(getNonEmpty(process.env.MFL_YEAR)) || new Date().getFullYear();
const base = `https://${league.mflHost}/${year}/export`;

/** Cap what reaches a public Actions log, while keeping the shape legible. */
const show = (v, cap = 4000) => {
  const s = typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  return s.length > cap ? `${s.slice(0, cap)}\n…[truncated ${s.length - cap} chars]` : s;
};

for (const qs of [
  `TYPE=pendingWaivers&L=${league.id}&JSON=1`,
  // FRANCHISE_ID is documented as commissioner-only, but if the bare call comes
  // back empty while claims exist, scoping is the first thing to suspect.
  `TYPE=pendingWaivers&L=${league.id}&FRANCHISE_ID=0001&JSON=1`,
]) {
  const url = `${base}?${qs}&_=${Date.now()}`;
  console.log(`\n===== GET ${url.replace(/&_=\d+/, '')}`);
  try {
    const res = await mflFetch({ url, cookies: { MFL_USER_ID: cookie }, timeoutMs: 20_000 });
    const text = await res.text();
    console.log(`status ${res.status}, ${text.length} bytes`);
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.log('NOT JSON:', show(text, 800));
      continue;
    }
    console.log('TOP-LEVEL KEYS:', JSON.stringify(Object.keys(parsed)));
    if (parsed.error) console.log('ERROR:', show(parsed.error, 300));
    const pending = parsed.pendingWaivers ?? parsed.pendingWaiver;
    console.log('pendingWaivers TYPE:', pending === undefined ? 'ABSENT' : typeof pending);
    console.log('RAW:', show(parsed));
  } catch (err) {
    console.log('FETCH FAILED:', err.message);
  }
}

// ── The add/drop form region ────────────────────────────────────────────────
// GET only. The route's page diagnostic caps its excerpt and MFL's nav menu is
// longer than any sane cap, so every log so far captured the menu and none of
// the content. Slicing to the <form> skips the nav entirely.
{
  const url = `https://${league.mflHost}/${year}/add_drop?L=${league.id}`;
  console.log(`\n===== GET ${url}`);
  try {
    const res = await mflFetch({ url, cookies: { MFL_USER_ID: cookie }, timeoutMs: 20_000 });
    const html = await res.text();
    console.log(`status ${res.status}, ${html.length} bytes`);
    console.log('AUTHENTICATED:', !/PASSWORD/i.test(html));
    const strip = (h) => h
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<option[^>]*>[\s\S]*?<\/option>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const start = html.search(/<form[^>]*action=["\']?add_drop/i);
    if (start < 0) {
      console.log('NO add_drop FORM ON THE PAGE — that is itself the answer.');
      const text = strip(html);
      const navEnd = text.lastIndexOf('Select Keepers');
      console.log('TEXT AFTER NAV:', show(text.slice(navEnd < 0 ? 0 : navEnd + 14), 2500));
    } else {
      const region = html.slice(start, html.indexOf('</form>', start) + 7);
      console.log('FORM COPY:', show(strip(region), 2000));
      const notes = [...region.matchAll(/<(?:b|strong)>([\s\S]{0,200}?)<\/(?:b|strong)>/gi)]
        .map((m) => m[1].replace(/<[^>]*>/g, '').trim())
        .filter(Boolean);
      console.log('EMPHASISED COPY:', JSON.stringify(notes.slice(0, 20)));
    }
  } catch (err) {
    console.log('FETCH FAILED:', err.message);
  }
}
