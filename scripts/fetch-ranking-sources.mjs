/**
 * Fetch the BUILT-IN ranking sources for the Import Rankings page.
 *
 * These are the sources every owner gets without importing anything:
 *
 *   - MFL ADP          (TYPE=adp)        — real ADP across hundreds of drafts
 *   - FantasySharks    (TYPE=playerRanks) — expert ranks, MFL's default source
 *   - Sleeper          (players/nfl)      — Sleeper's search-popularity order
 *
 * Both MFL feeds key on GLOBAL MFL player ids, so they need no name matching
 * at all and resolve to 100% of the player pool by construction. Sleeper uses
 * its own ids, so it is matched to MFL ids HERE, once, at build time rather
 * than in every visitor's browser.
 *
 * Matching at build time also cleans the list for free: Sleeper's
 * `search_rank` is search POPULARITY, not ADP, so it happily ranks retired
 * stars (Drew Brees ~#101, Todd Gurley ~#34, Antonio Brown, Julian Edelman).
 * None of them exist in the MFL feed, so dropping unmatched players removes
 * them without a hand-maintained retirement list.
 *
 * Output is ONE league-independent file per year — every source here is a
 * cross-site aggregate keyed by global MFL player id, so a per-league copy
 * would be the same bytes twice.
 *
 * Usage:
 *   node scripts/fetch-ranking-sources.mjs
 *   node scripts/fetch-ranking-sources.mjs --year 2026
 */
import fs from 'node:fs';
import path from 'node:path';
import { fetchWithRetry } from './lib/fetch-retry.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';

const MFL_HOST = 'https://api.myfantasyleague.com';
const SLEEPER_URL = 'https://api.sleeper.app/v1/players/nfl';
const OUT_DIR = path.join('data', 'ranking-sources');

/** Positions the rankings board carries. Mirrors the import UI. */
const VALID_POSITIONS = new Set(['QB', 'RB', 'WR', 'TE']);
/** Sleeper's list is long and its tail is noise; cap it like the UI does. */
const SLEEPER_TOP_N = 500;

// ── Year ────────────────────────────────────────────────────────────────────
// Mirrors league-year.ts: base year rolls at Labor Day, league year at Feb 14.
// Deliberately the LEAGUE year — draft rankings describe the season about to
// be played, and owners prep long before the season clock rolls.
const getLaborDay = (yr) => {
  const sept1 = new Date(yr, 8, 1);
  const dow = sept1.getDay();
  return new Date(yr, 8, 1 + (dow === 1 ? 0 : dow === 0 ? 1 : 8 - dow));
};
const resolveYear = () => {
  const flag = process.argv.indexOf('--year');
  if (flag !== -1 && process.argv[flag + 1]) return Number(process.argv[flag + 1]);
  const now = new Date();
  const cal = now.getFullYear();
  const base = now >= getLaborDay(cal) ? cal : cal - 1;
  const febCutoff = new Date(Date.UTC(cal, 1, 15, 4, 45, 0, 0));
  return now >= febCutoff ? base + 1 : base;
};

const fetchJson = (url) =>
  fetchWithRetry(url, {
    attempts: 3,
    baseDelayMs: 1500,
    parse: 'json',
    onRetry: (err, attempt, wait) =>
      console.warn(`  retry ${attempt + 1} for ${url} in ${wait}ms (${err.message})`),
  });

// ── Name matching (Sleeper → MFL ids) ───────────────────────────────────────

/** Strip case, punctuation and generational suffixes so "A.J. Brown Jr." keys
 *  the same as "Brown, A.J.". Deliberately conservative — this is an EXACT
 *  index, and anything it can't resolve is dropped rather than guessed. */
const normalizeName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[.'`]/g, '')
    .replace(/\b(jr|sr|ii|iii|iv|v)\b/g, '')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * MFL team codes are its own dialect (TBB/NOS/GBP/WAS…) while every external
 * source speaks ESPN's (TB/NO/GB/WSH). Team is used to break name ties, so
 * comparing the raw strings silently fails for a third of the league.
 * Mirrors TEAM_CODE_MAP in src/utils/nfl-logo.ts — keep the two in step.
 */
const TEAM_ALIASES = {
  WAS: 'WSH', JAC: 'JAX', GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO',
  SFO: 'SF', TBB: 'TB', LVR: 'LV', HST: 'HOU', BLT: 'BAL', CLV: 'CLE',
  ARZ: 'ARI', OAK: 'LV', SDC: 'LAC', SD: 'LAC', RAM: 'LAR', STL: 'LAR',
};
const normalizeTeam = (team) => {
  const t = String(team || '').trim().toUpperCase();
  return TEAM_ALIASES[t] ?? t;
};

/** MFL stores "Last, First"; sources send "First Last". */
const mflDisplayName = (raw) => {
  const s = String(raw || '');
  const i = s.indexOf(',');
  return i === -1 ? s : `${s.slice(i + 1).trim()} ${s.slice(0, i).trim()}`;
};

const surnameOf = (full) => {
  const parts = normalizeName(full).split(' ');
  return parts.length > 1 ? parts[parts.length - 1] : parts[0] || '';
};
const initialOf = (full) => (normalizeName(full)[0] || '');

const buildMflIndex = (players) => {
  const byKey = new Map();
  // id → position, so every source can be trimmed to the positions the
  // rankings board actually renders. FantasySharks returns the whole league
  // (1394 rows: kickers, team defenses, IDP), and MFL ADP carries ids the
  // players feed doesn't — both would show up as unrenderable rows.
  const positionById = new Map();
  // Secondary index for the legal-name vs nickname gap: MFL carries
  // "Gainwell, Kenneth" and "Okonkwo, Chigoziem" where every source says
  // "Kenny Gainwell" and "Chig Okonkwo". Exact matching drops those, and they
  // are current starters, not noise.
  const bySurname = new Map();
  for (const p of players) {
    const pos = p.position === 'Def' ? 'DEF' : p.position;
    if (!VALID_POSITIONS.has(pos)) continue;
    const display = mflDisplayName(p.name);
    const key = `${pos}:${normalizeName(display)}`;
    const bucket = byKey.get(key);
    // Keep every candidate — same name + position is real, and team breaks it.
    if (bucket) bucket.push(p);
    else byKey.set(key, [p]);

    positionById.set(String(p.id), pos);

    const sKey = `${pos}:${surnameOf(display)}`;
    const sBucket = bySurname.get(sKey);
    if (sBucket) sBucket.push({ player: p, initial: initialOf(display) });
    else bySurname.set(sKey, [{ player: p, initial: initialOf(display) }]);
  }
  return { byKey, bySurname, positionById };
};

const resolveMflId = (index, name, pos, team) => {
  const want = normalizeTeam(team);
  const pick = (candidates) => {
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0].id;
    const onTeam = want && candidates.find((c) => normalizeTeam(c.team) === want);
    // Ambiguous with no team signal: refuse rather than coin-flip.
    return onTeam ? onTeam.id : null;
  };

  const exact = pick(index.byKey.get(`${pos}:${normalizeName(name)}`));
  if (exact) return exact;

  // Nickname fallback. Deliberately narrow — same position, same surname,
  // same first initial, AND same team. That is enough to resolve
  // Kenny/Kenneth Gainwell without ever pairing two different people, and it
  // refuses outright when the source gives no team to confirm against.
  if (!want) return null;
  const bySurname = index.bySurname.get(`${pos}:${surnameOf(name)}`);
  if (!bySurname) return null;
  const initial = initialOf(name);
  const hits = bySurname.filter(
    (c) => c.initial === initial && normalizeTeam(c.player.team) === want,
  );
  return hits.length === 1 ? hits[0].player.id : null;
};

// ── Sources ─────────────────────────────────────────────────────────────────

const fetchMflAdp = async (year) => {
  const url = `${MFL_HOST}/${year}/export?TYPE=adp&IS_PPR=1&IS_MOCK=0&JSON=1`;
  const data = await fetchJson(url);
  const rows = data?.adp?.player;
  if (data?.error || !Array.isArray(rows)) {
    throw new Error(data?.error?.$t ?? 'no adp.player in response');
  }
  return {
    id: 'mfl-adp',
    label: 'MFL ADP',
    type: 'adp',
    meta: {
      totalDrafts: Number(data.adp.totalDrafts) || null,
      totalPicks: Number(data.adp.totalPicks) || null,
    },
    players: rows
      .map((r) => ({ id: String(r.id), rank: Number(r.rank), averagePick: Number(r.averagePick) }))
      .filter((r) => r.id && Number.isFinite(r.rank))
      .sort((a, b) => a.rank - b.rank),
  };
};

const fetchSharks = async (year) => {
  // NOTE: playerRanks must go to api.myfantasyleague.com — a league host
  // (www49 etc.) answers with "This API request must go to api.…" and an
  // empty body, which reads exactly like "no data published yet".
  const url = `${MFL_HOST}/${year}/export?TYPE=playerRanks&JSON=1`;
  const data = await fetchJson(url);
  const rows = data?.player_ranks?.player;
  if (data?.error || !Array.isArray(rows)) {
    throw new Error(data?.error?.$t ?? 'no player_ranks.player in response');
  }
  return {
    id: 'sharks',
    label: 'FantasySharks',
    type: 'overall',
    meta: {},
    players: rows
      .map((r) => ({ id: String(r.id), rank: Number(r.rank) }))
      .filter((r) => r.id && Number.isFinite(r.rank))
      .sort((a, b) => a.rank - b.rank),
  };
};

const fetchSleeper = async (mflIndex) => {
  const data = await fetchJson(SLEEPER_URL);
  const entries = Object.values(data)
    .filter((p) => p && p.active && VALID_POSITIONS.has(p.position) && p.search_rank && p.search_rank < 9999)
    .sort((a, b) => a.search_rank - b.search_rank)
    .slice(0, SLEEPER_TOP_N);

  const players = [];
  let dropped = 0;
  for (const p of entries) {
    const name = `${p.first_name || ''} ${p.last_name || ''}`.trim();
    const id = resolveMflId(mflIndex, name, p.position, p.team);
    if (!id) { dropped++; continue; }
    players.push({ id, rank: players.length + 1 });
  }
  return {
    source: {
      id: 'sleeper-adp',
      label: 'Sleeper',
      type: 'adp',
      meta: { droppedUnmatched: dropped },
      players,
    },
    dropped,
  };
};

// ── Main ────────────────────────────────────────────────────────────────────

const run = async () => {
  const year = resolveYear();
  console.log(`Fetching built-in ranking sources for ${year}...`);

  // The MFL player universe is global (same file for every league), so one
  // read serves the Sleeper match pass for all of them.
  const playersPath = path.join('data', 'theleague', 'mfl-feeds', String(year), 'players.json');
  let mflIndex = null;
  try {
    const raw = JSON.parse(fs.readFileSync(playersPath, 'utf8'));
    mflIndex = buildMflIndex(raw?.players?.player ?? []);
    console.log(`  MFL player index: ${mflIndex.byKey.size} name keys`);
  } catch (err) {
    console.warn(`::warning::could not read ${playersPath} (${err.message}) — Sleeper will be skipped.`);
  }

  const sources = [];
  const tasks = [
    ['MFL ADP', () => fetchMflAdp(year)],
    ['FantasySharks', () => fetchSharks(year)],
  ];
  for (const [name, fn] of tasks) {
    try {
      const src = await fn();
      const before = src.players.length;
      if (mflIndex) {
        // Keep only renderable positions, then RE-RANK 1..n so the board sees
        // a dense sequence — leaving gaps where a kicker was makes every
        // downstream "rank" look wrong.
        src.players = src.players
          .filter((r) => mflIndex.positionById.has(r.id))
          .map((r, i) => ({ ...r, rank: i + 1 }));
      }
      sources.push(src);
      const trimmed = before - src.players.length;
      console.log(`  ${name} → ${src.players.length} players${trimmed ? ` (${trimmed} non-skill/unknown trimmed)` : ''}`);
    } catch (err) {
      // One bad source must not blank the file — the previous good snapshot
      // stays on disk and the build continues.
      console.warn(`::warning::${name} failed (${err.message}) — omitted from this run.`);
    }
  }

  if (mflIndex) {
    try {
      const { source, dropped } = await fetchSleeper(mflIndex);
      sources.push(source);
      console.log(`  Sleeper → ${source.players.length} players (${dropped} unmatched dropped)`);
    } catch (err) {
      console.warn(`::warning::Sleeper failed (${err.message}) — omitted from this run.`);
    }
  }

  if (sources.length === 0) {
    console.warn('::warning::no sources succeeded — keeping the existing snapshot.');
    return;
  }

  const file = path.join(OUT_DIR, `${year}.json`);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // generatedAt is volatile by design; ignoring it keeps an unchanged fetch
  // from producing a commit (the storage-churn rule in CLAUDE.md).
  const changed = writeJsonIfChanged(file, { year, generatedAt: new Date().toISOString(), sources },
    { ignoreKeys: ['generatedAt'] });
  console.log(changed ? `Wrote ${file}` : `${file} unchanged — skipped write`);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
