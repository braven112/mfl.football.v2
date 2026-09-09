#!/usr/bin/env node
/**
 * Export a completed best-ball official draft from the on-site draft room
 * (PartyKit session) to MyFantasyLeague — the "import it when done" step.
 * There is deliberately NO live syncing: the draft happens entirely on-site,
 * then this script pushes the final results to MFL in one commissioner write.
 *
 * What it does:
 *   1. Fetches the official session (`mock-{navSlug}-official-{year}`) from
 *      the PartyKit host — or reads it from --session-file for offline use.
 *   2. Validates it's the draft of record (official: true) and completed.
 *   3. Writes a committed JSON snapshot to
 *      {dataPath}/draft/{year}-draft-results.json — the durable record the
 *      site can render even if the PartyKit room is ever recycled.
 *   4. With --commit, POSTs the picks to MFL's commissioner import endpoint
 *      (same auth plumbing as apply-pending-contracts.mjs). Default is
 *      dry-run: print the XML payload and stop.
 *
 * Usage:
 *   node scripts/export-best-ball-draft.mjs [--league best-ball-1] [--year 2026]
 *        [--session-file path.json] [--force] [--commit]
 *
 * Env:
 *   PUBLIC_PARTYKIT_HOST                     PartyKit host (session fetch)
 *   MFL_USER_ID + (optional) MFL_IS_COMMISH  preferred (cookie-based, no login)
 *   MFL_USERNAME + MFL_PASSWORD              fallback (logs in to get cookie)
 *   MFL_WRITE_HOST                           override for the commissioner
 *                                            write host. REQUIRED while the
 *                                            registry's mflHost for the league
 *                                            is the api-gateway placeholder —
 *                                            commissioner imports fail on
 *                                            api.myfantasyleague.com.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { getLeagueBySlug } from '../src/config/leagues-data.mjs';
import { mflFetch, loginToMFL } from './lib/mfl-api.mjs';

function parseArgs(argv) {
  const args = { league: 'best-ball-1', year: null, sessionFile: null, commit: false, force: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--league') args.league = argv[++i];
    else if (a === '--year') args.year = argv[++i];
    else if (a === '--session-file') args.sessionFile = argv[++i];
    else if (a === '--commit') args.commit = true;
    else if (a === '--force') args.force = true;
    else if (a === '--dry-run') args.commit = false;
  }
  return args;
}

async function fetchSessionFromParty(navSlug, year) {
  const raw = process.env.PUBLIC_PARTYKIT_HOST;
  if (!raw) throw new Error('PUBLIC_PARTYKIT_HOST is not set (or pass --session-file).');
  const host = raw.startsWith('http') ? raw : `https://${raw}`;
  const url = `${host}/party/mock-${navSlug}-official-${year}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`PartyKit session fetch failed: HTTP ${res.status} (${url})`);
  const data = await res.json();
  if (!data?.session) throw new Error('PartyKit response had no session.');
  return data.session;
}

function resolveWriteHost(league) {
  const override = process.env.MFL_WRITE_HOST;
  if (override) return override.replace(/\/+$/, '');
  if (league.mflHost && !league.mflHost.startsWith('api.')) {
    return `https://${league.mflHost}`;
  }
  throw new Error(
    `League '${league.slug}' has no commissioner-writable MFL host yet ` +
      `(registry mflHost is '${league.mflHost}'). Commissioner imports fail on the ` +
      `api gateway — set MFL_WRITE_HOST (https://wwwXX.myfantasyleague.com) or ` +
      `update the registry with the league's real wwwXX host.`,
  );
}

/**
 * Default league year from the registry's rollover date (bb1 rolls June 1) —
 * a bare calendar-year default would target the wrong official session for
 * part of the year (e.g. next January–May still belongs to this season's
 * league year).
 */
function defaultLeagueYear(league, now = new Date()) {
  const rollover = league.leagueYearRollover;
  const y = now.getFullYear();
  if (!rollover) return String(y);
  const rolled = now >= new Date(y, rollover.month - 1, rollover.day);
  return String(rolled ? y : y - 1);
}

async function resolveCookies() {
  const envUserId = process.env.MFL_USER_ID;
  const envCommish = process.env.MFL_IS_COMMISH;
  const username = process.env.MFL_USERNAME;
  const password = process.env.MFL_PASSWORD;
  if (envUserId) {
    return { MFL_USER_ID: envUserId, MFL_IS_COMMISH: envCommish };
  }
  if (username && password) {
    const { mflUserId, mflIsCommish } = await loginToMFL(username, password);
    return { MFL_USER_ID: mflUserId, MFL_IS_COMMISH: mflIsCommish };
  }
  throw new Error('No MFL credentials. Set MFL_USER_ID (preferred) or MFL_USERNAME + MFL_PASSWORD.');
}

/**
 * Build the MFL commissioner-import XML for draft results, mirroring the
 * shape of MFL's own draftResults export (draftUnit → draftPick with
 * franchise/round/pick/player/timestamp attributes). Verify against a
 * dry-run before the first real import — MFL's import formats are
 * documented by example, not schema.
 */
function buildDraftResultsXml(session) {
  const pad2 = (n) => String(n).padStart(2, '0');
  const picks = session.picks
    .filter((p) => p.playerId)
    .sort((a, b) => a.overallPickNumber - b.overallPickNumber)
    .map((p) => {
      const ts = p.pickedAt ? Math.floor(new Date(p.pickedAt).getTime() / 1000) : '';
      return (
        `<draftPick franchise="${p.franchiseId}" round="${pad2(p.round)}" ` +
        `pick="${pad2(p.pickInRound)}" player="${p.playerId}" timestamp="${ts}" />`
      );
    })
    .join('');
  return `<draftResults><draftUnit unit="LEAGUE">${picks}</draftUnit></draftResults>`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const league = getLeagueBySlug(args.league);
  if (!league) throw new Error(`Unknown league slug: ${args.league}`);
  if (!league.bestBall) {
    throw new Error(`League '${league.slug}' is not a best-ball league — refusing to export.`);
  }
  const year = args.year || defaultLeagueYear(league);

  // ── 1. Load the session ──
  const session = args.sessionFile
    ? JSON.parse(readFileSync(args.sessionFile, 'utf-8')).session ??
      JSON.parse(readFileSync(args.sessionFile, 'utf-8'))
    : await fetchSessionFromParty(league.navSlug, year);

  // ── 2. Validate it's the completed draft of record ──
  if (!session.official) {
    throw new Error('Session is not marked official — refusing to export a mock draft to MFL.');
  }
  const madePicks = session.picks.filter((p) => p.playerId);
  const totalPicks = session.totalRounds * session.picksPerRound;
  if (session.status !== 'completed' && !args.force) {
    throw new Error(
      `Draft status is '${session.status}' (${madePicks.length}/${totalPicks} picks). ` +
        `Export runs after completion — pass --force to override.`,
    );
  }

  // ── 3. Durable snapshot (always) ──
  const snapshotPath = join(process.cwd(), league.dataPath, 'draft', `${year}-draft-results.json`);
  mkdirSync(dirname(snapshotPath), { recursive: true });
  writeFileSync(
    snapshotPath,
    JSON.stringify(
      {
        $comment: 'Official on-site draft results snapshot — written by scripts/export-best-ball-draft.mjs.',
        exportedAt: new Date().toISOString(),
        leagueId: session.leagueId,
        leagueYear: session.leagueYear,
        status: session.status,
        totalRounds: session.totalRounds,
        picksPerRound: session.picksPerRound,
        picks: session.picks,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`✅ Snapshot written: ${snapshotPath} (${madePicks.length}/${totalPicks} picks)`);

  // ── 4. MFL import ──
  const xml = buildDraftResultsXml(session);
  if (!args.commit) {
    console.log('\n── DRY RUN (pass --commit to import to MFL) ──');
    console.log(`Would POST to: <write-host>/${year}/import?TYPE=draftResults&L=${league.id}`);
    console.log(xml.length > 2000 ? xml.slice(0, 2000) + `… (${xml.length} chars total)` : xml);
    return;
  }

  const writeHost = resolveWriteHost(league);
  const cookies = await resolveCookies();
  const url = `${writeHost}/${year}/import?TYPE=draftResults&L=${league.id}`;
  const body = new URLSearchParams({ DATA: xml }).toString();

  const delays = [500, 1500, 4000];
  let lastError = '';
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    const res = await mflFetch({ url, method: 'POST', cookies, body, timeoutMs: 30_000 });
    if (res.ok) {
      const text = await res.text();
      if (text.toLowerCase().includes('error')) {
        lastError = `MFL error response: ${text.slice(0, 300)}`;
      } else {
        console.log(`✅ Draft imported to MFL (${madePicks.length} picks).`);
        return;
      }
    } else {
      lastError = `HTTP ${res.status}`;
    }
    if (attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
  throw new Error(`MFL import failed after retries: ${lastError}`);
}

main().catch((err) => {
  console.error(`❌ ${err.message}`);
  process.exit(1);
});
