/**
 * Fetch MFL's selectedKeepers export for a league and print a per-franchise
 * report of who has (and hasn't) submitted keeper selections.
 *
 * The endpoint is auth-restricted: an owner login sees only their own
 * franchise; a commissioner login sees every franchise (unless Lockout is
 * on). So run this where MFL credentials are available — in practice the
 * roster-sync GitHub Actions environment.
 *
 * Verified live 2026-07-15 (AFL, commissioner account, Lockout ON): MFL
 * seals ALL selections until the keeper window closes — every request,
 * including FRANCHISE= probes, returns only the caller's own franchise.
 * League-wide data only becomes readable after lockout lifts.
 *
 * Env:
 *   MFL_LEAGUE_ID  (optional) - defaults to the AFL ('19621')
 *   MFL_YEAR       (optional) - defaults to the current calendar year
 *   MFL_USER_ID + (optional) MFL_IS_COMMISH  preferred (cookie-based, no login)
 *   MFL_USERNAME + MFL_PASSWORD              fallback (logs in to get cookie)
 *   MFL_APIKEY / MFL_API_KEY (optional)      appended as APIKEY= query param
 *
 * Usage:
 *   node scripts/fetch-selected-keepers.mjs            # print report
 *   node scripts/fetch-selected-keepers.mjs --out FILE # also write raw JSON
 */
import fs from 'node:fs';
import path from 'node:path';
import { getLeagueById, LEAGUES } from '../src/config/leagues-data.mjs';

const leagueId = process.env.MFL_LEAGUE_ID || LEAGUES['afl-fantasy'].id;
const year = process.env.MFL_YEAR || String(new Date().getFullYear());
const apiKey = process.env.MFL_APIKEY || process.env.MFL_API_KEY;

const outFlagIdx = process.argv.indexOf('--out');
const outFile = outFlagIdx !== -1 ? process.argv[outFlagIdx + 1] : null;

// ── MFL auth + fetch (same pattern as sync-draft-pick-contracts.mjs) ──

/**
 * Manual-redirect fetch that re-attaches the Cookie header on every hop.
 * Node's undici strips Cookie on cross-origin 302s, and MFL's api.* host
 * redirects authenticated calls to the league's www*.* host.
 */
async function mflFetch(url, cookies, timeoutMs = 10_000) {
  let currentUrl = url;
  const cookieHeader = Object.entries(cookies)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');

  for (let hop = 0; hop <= 3; hop++) {
    const res = await fetch(currentUrl, {
      headers: cookieHeader ? { Cookie: cookieHeader } : {},
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status < 300 || res.status >= 400) return res;
    const location = res.headers.get('location');
    if (!location) return res;
    currentUrl = location.startsWith('http')
      ? location
      : new URL(location, currentUrl).href;
  }
  throw new Error(`mflFetch exceeded redirect limit for ${url}`);
}

async function loginToMFL(username, password) {
  const loginUrl = `https://api.myfantasyleague.com/${year}/login`;
  const params = new URLSearchParams({ USERNAME: username, PASSWORD: password, XML: '1' });
  const res = await fetch(`${loginUrl}?${params.toString()}`, {
    redirect: 'follow',
    signal: AbortSignal.timeout(8000),
  });
  const text = await res.text();
  const errorMatch = text.match(/<error[^>]*>(.*?)<\/error>/s);
  if (errorMatch) throw new Error(`MFL login failed: ${errorMatch[1].trim()}`);
  const cookieMatch = text.match(/MFL_USER_ID="([^"]+)"/);
  if (!cookieMatch) {
    throw new Error(`MFL login: no MFL_USER_ID in response: ${text.slice(0, 200)}`);
  }
  return cookieMatch[1];
}

// ── Name lookups from the committed feed snapshots (best-effort) ──

function loadFeedJson(league, file) {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(league.dataPath, 'mfl-feeds', year, file), 'utf-8')
    );
  } catch {
    return null;
  }
}

function buildNameMaps(league) {
  const franchiseNames = new Map();
  const playerNames = new Map();
  const leagueJson = loadFeedJson(league, 'league.json');
  for (const f of leagueJson?.league?.franchises?.franchise ?? []) {
    franchiseNames.set(f.id, f.name);
  }
  const playersJson = loadFeedJson(league, 'players.json');
  for (const p of playersJson?.players?.player ?? []) {
    playerNames.set(p.id, `${p.name} (${p.position} ${p.team})`);
  }
  return { franchiseNames, playerNames };
}

// ── Main ──

async function main() {
  const league = getLeagueById(leagueId);
  if (!league) throw new Error(`Unknown league id ${leagueId} — add it to leagues-data.mjs`);

  const cookies = {
    MFL_USER_ID: process.env.MFL_USER_ID,
    MFL_IS_COMMISH: process.env.MFL_IS_COMMISH,
  };
  if (!cookies.MFL_USER_ID && process.env.MFL_USERNAME && process.env.MFL_PASSWORD) {
    console.log('[selected-keepers] Logging into MFL with MFL_USERNAME/MFL_PASSWORD…');
    cookies.MFL_USER_ID = await loginToMFL(process.env.MFL_USERNAME, process.env.MFL_PASSWORD);
  }
  if (!cookies.MFL_USER_ID && !apiKey) {
    throw new Error(
      'No MFL credentials. Set MFL_USER_ID (preferred), MFL_USERNAME+MFL_PASSWORD, or MFL_APIKEY.'
    );
  }

  const fetchSelectedKeepers = async (franchiseId) => {
    let url = `https://api.myfantasyleague.com/${year}/export?TYPE=selectedKeepers&L=${leagueId}&JSON=1`;
    if (franchiseId) url += `&FRANCHISE=${franchiseId}`;
    if (apiKey) url += `&APIKEY=${encodeURIComponent(apiKey)}`;
    const res = await mflFetch(url, cookies);
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`selectedKeepers HTTP ${res.status}: ${text.slice(0, 300)}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`selectedKeepers returned non-JSON: ${text.slice(0, 300)}`);
    }
  };

  const data = await fetchSelectedKeepers();
  if (data.error) {
    throw new Error(`selectedKeepers API error: ${JSON.stringify(data.error)}`);
  }

  if (outFile) {
    fs.mkdirSync(path.dirname(outFile), { recursive: true });
    fs.writeFileSync(outFile, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`[selected-keepers] Raw response written to ${outFile}`);
  }

  console.log('[selected-keepers] Raw response:');
  console.log(JSON.stringify(data, null, 2));

  // Observed shape (2026-07-14, owner auth): { selectedKeepers: { franchises:
  // { id: '0001' } } } — key is "franchises", players absent when none selected.
  let franchises =
    data.selectedKeepers?.franchises ?? data.selectedKeepers?.franchise ?? [];
  if (!Array.isArray(franchises)) franchises = [franchises];

  const { franchiseNames, playerNames } = buildNameMaps(league);
  const selectedIds = new Set();

  console.log(`\n=== ${league.name} (${leagueId}) keeper selections — ${year} ===`);
  for (const f of franchises) {
    selectedIds.add(f.id);
    let players = f.player ?? [];
    if (!Array.isArray(players)) players = [players];
    const name = franchiseNames.get(f.id) ?? '?';
    console.log(`\n${f.id} ${name} — ${players.length} keeper(s) selected:`);
    for (const p of players) {
      const pid = typeof p === 'string' ? p : p.id;
      console.log(`  ${pid}  ${playerNames.get(pid) ?? ''}`);
    }
  }

  const missing = [...franchiseNames.keys()].filter((id) => !selectedIds.has(id)).sort();
  if (missing.length) {
    console.log(`\nNo selections visible for ${missing.length} franchise(s):`);
    for (const id of missing) console.log(`  ${id} ${franchiseNames.get(id)}`);
    console.log(
      '\n(Note: a non-commissioner login only sees its own franchise, so "missing" is' +
        ' only meaningful when running with commissioner access.)'
    );
  }

  // --sweep: probe FRANCHISE=<id> for every franchise in the league. The docs
  // say the param is commissioner-only; this shows exactly what our credential
  // can and cannot see, one compact line per franchise.
  if (process.argv.includes('--sweep')) {
    console.log('\n=== FRANCHISE= sweep (commissioner-only param per MFL docs) ===');
    for (const id of [...franchiseNames.keys()].sort()) {
      try {
        const d = await fetchSelectedKeepers(id);
        console.log(`${id} ${franchiseNames.get(id)}: ${JSON.stringify(d)}`);
      } catch (err) {
        console.log(`${id} ${franchiseNames.get(id)}: ERROR ${err.message}`);
      }
      await new Promise((r) => setTimeout(r, 1200)); // stay friendly to MFL rate limits
    }
  }
}

main().catch((err) => {
  console.error(`[selected-keepers] FAILED: ${err.message}`);
  process.exit(1);
});
