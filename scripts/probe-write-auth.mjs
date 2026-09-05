/**
 * Does an MFL commissioner write actually need MFL_IS_COMMISH — or just the
 * right host?
 *
 * This repo's rule says commissioner writes need the `www##` host AND both
 * cookies. But the experiment recorded for it
 * (docs/claude/insights/domains/mfl-api.md, 2026-03) sent BOTH cookies on both
 * sides and only varied the HOST:
 *
 *   FAILS  api.myfantasyleague.com/…/import?TYPE=salaries   both cookies
 *   WORKS  www49.myfantasyleague.com/…/import?TYPE=salaries both cookies
 *
 * That proves the host matters. It says nothing about the second cookie — and
 * MFL's own import sample sends only `Cookie: MFL_USER_ID=…`, with no
 * commissioner cookie anywhere. So the rule we have been building on for a
 * week may be an artifact of an experiment that never isolated it.
 *
 * ── WHY THIS IS SAFE TO RUN ───────────────────────────────────────────────
 * It writes to the TEST league only (36189, the one the integration suite
 * already writes to on every push), and it writes each player's CURRENT
 * values back unchanged. Every attempt is a genuine authenticated write, so
 * MFL's answer is real — but a successful one is a no-op by construction, so
 * there is nothing to revert and no window in which the data is wrong.
 *
 * Run: node scripts/probe-write-auth.mjs
 */

import { mflFetch } from './lib/mfl-api.mjs';
// The write host comes from the REGISTRY, never a literal — the test league
// is not a registry entry, so it borrows the default league's host, which is
// the one this repo's contract writer already targets for 36189.
import { LEAGUES, DEFAULT_LEAGUE_SLUG } from '../src/config/leagues-data.mjs';

const username = process.env.MFL_USERNAME;
const password = process.env.MFL_PASSWORD;
const leagueId = process.env.MFL_LEAGUE_ID || '36189';
const storedCommish = process.env.MFL_IS_COMMISH || '';
const year = Number(process.env.MFL_YEAR) || new Date().getFullYear();
const registryHost = LEAGUES[DEFAULT_LEAGUE_SLUG].mflHost;

if (!username || !password) {
  console.error('Set MFL_USERNAME and MFL_PASSWORD.');
  process.exit(1);
}

// ── Step 1: log in ────────────────────────────────────────────────────────
const loginUrl = `https://api.myfantasyleague.com/${year}/login?XML=1`;
const loginRes = await fetch(loginUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ USERNAME: username, PASSWORD: password }).toString(),
  signal: AbortSignal.timeout(10000),
});
const loginText = await loginRes.text();
const userCookie = loginText.match(/MFL_USER_ID="([^"]+)"/)?.[1] ?? '';
if (!userCookie) {
  console.error(`Login failed: ${loginText.slice(0, 200)}`);
  process.exit(1);
}
console.log('Logged in. Session cookie acquired.\n');

// ── Step 2: where does MFL say this league lives? ─────────────────────────
// The step MFL's own export sample does and this repo never has.
const mlRes = await mflFetch({
  url: `https://api.myfantasyleague.com/${year}/export?TYPE=myleagues`,
  method: 'GET',
  cookies: { MFL_USER_ID: userCookie },
});
const mlXml = await mlRes.text();
const discoveredHost =
  mlXml.match(new RegExp(`url="https?://([a-z0-9]+\\.myfantasyleague\\.com)/${year}/home/${leagueId}"`))?.[1] ?? '';
console.log(`Host — registry assumes: ${registryHost}`);
console.log(`Host — MFL reports:      ${discoveredHost || '(league not listed for this account)'}`);
console.log(
  discoveredHost && discoveredHost !== registryHost
    ? '  MISMATCH — this alone would explain every "requires commissioner access".\n'
    : discoveredHost
      ? '  match\n'
      : '  could not resolve; the account may not be a member of this league\n'
);

// ── Step 3: read the current values, so the write can be a no-op ──────────
const readHost = discoveredHost || registryHost;
const salRes = await mflFetch({
  url: `https://${readHost}/${year}/export?TYPE=salaries&L=${leagueId}&JSON=1`,
  method: 'GET',
  cookies: { MFL_USER_ID: userCookie },
});
let player;
try {
  const data = JSON.parse(await salRes.text());
  const list = data?.salaries?.leagueUnit?.player;
  player = Array.isArray(list) ? list[0] : list;
} catch {
  /* handled below */
}
if (!player?.id) {
  console.error('Could not read a player from the test league — cannot build a no-op write.');
  process.exit(1);
}
console.log(
  `No-op payload: player ${player.id} — writing its CURRENT values back `
    + `(salary ${player.salary}, year ${player.contractYear ?? ''}, info "${player.contractInfo ?? ''}").\n`
);

const xml =
  '<salaries><leagueUnit unit="LEAGUE">'
  + `<player id="${player.id}" salary="${player.salary}" `
  + `contractYear="${player.contractYear ?? ''}" contractInfo="${player.contractInfo ?? ''}" />`
  + '</leagueUnit></salaries>';
const body = new URLSearchParams({ DATA: xml }).toString();

// ── Step 4: the matrix ────────────────────────────────────────────────────
async function attempt(label, { host, cookies }) {
  const url = `https://${host}/${year}/import?TYPE=salaries&L=${leagueId}`;
  try {
    const res = await mflFetch({ url, method: 'POST', cookies, body });
    const text = (await res.text()).trim();
    const err = text.match(/<error[^>]*>(.*?)<\/error>/s)?.[1];
    const ok = /<status[^>]*>OK<\/status>|<status>OK</i.test(text);
    console.log(
      `${label}\n`
        + `   ${ok ? 'ACCEPTED  <<<<<<' : err ? `refused: ${err.trim()}` : `unclear: ${text.slice(0, 120) || '(empty body)'}`}\n`
    );
    return ok;
  } catch (error) {
    console.log(`${label}\n   request failed: ${error.message}\n`);
    return false;
  }
}

const hosts = [...new Set([registryHost, discoveredHost].filter(Boolean))];
const results = {};
for (const host of hosts) {
  results[`${host} | user cookie only`] = await attempt(
    `${host} — MFL_USER_ID only (what MFL's own sample sends)`,
    { host, cookies: { MFL_USER_ID: userCookie } }
  );
  if (storedCommish) {
    results[`${host} | both cookies`] = await attempt(
      `${host} — MFL_USER_ID + stored MFL_IS_COMMISH`,
      { host, cookies: { MFL_USER_ID: userCookie, MFL_IS_COMMISH: storedCommish } }
    );
  }
}

console.log('── Verdict ───────────────────────────────────────────────');
for (const [k, v] of Object.entries(results)) console.log(`   ${v ? 'ACCEPTED' : 'refused '}  ${k}`);
const userOnlyWorked = Object.entries(results).some(([k, v]) => v && k.includes('user cookie only'));
console.log(
  userOnlyWorked
    ? '\nMFL_IS_COMMISH is NOT required for this write. The accounting gate that\ndemands it is the thing blocking the console, and it can come out.'
    : '\nNo configuration was accepted with the session cookie alone.'
);
