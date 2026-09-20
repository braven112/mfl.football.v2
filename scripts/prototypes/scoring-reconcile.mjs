/**
 * PROTOTYPE — Phase 0 proof: score a week from NFLverse and diff it against
 * MFL's own numbers.
 *
 * This is not production code. It exists to substantiate one claim in
 * docs/plans/phase-0-own-the-stats.md: that we can reproduce MFL's fantasy
 * points exactly, from free data, for both leagues' rule sets.
 *
 * Result on first run (2026-09-20): 416 / 416 EXACT for TheLeague, weeks 1-2.
 *
 * Usage:
 *   node scripts/prototypes/scoring-reconcile.mjs                  # theleague, 2026
 *   node scripts/prototypes/scoring-reconcile.mjs --league afl-fantasy
 *   node scripts/prototypes/scoring-reconcile.mjs --year 2025 --verbose
 *
 * Downloads are cached under .cache/nflverse/ so re-runs are offline.
 *
 * WHERE THINGS BELONG WHEN THIS GRADUATES
 * ---------------------------------------
 * - SCORING_RULES  -> per-league registry entry (src/config/leagues-data.mjs),
 *                     NOT a constant here. Two leagues already disagree.
 * - scorePlayerWeek -> scripts/lib/scoring-engine.mjs, pure + fixture-tested.
 * - parseCsv        -> shared. See the warning on it below.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { LEAGUES } from '../../src/config/leagues-data.mjs';

// ── Sources ─────────────────────────────────────────────────────────────────
const CROSSWALK_URL =
  'https://raw.githubusercontent.com/dynastyprocess/data/master/files/db_playerids.csv';
const statsUrl = (year) =>
  `https://github.com/nflverse/nflverse-data/releases/download/stats_player/stats_player_week_${year}.csv`;
const pbpUrl = (year) =>
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/play_by_play_${year}.csv.gz`;
/** MFL publishes the LIVE scoring config here, free and unauthenticated. */
const rulesUrl = (league, year) =>
  `https://${league.mflHost}/${year}/export?TYPE=rules&L=${league.id}&JSON=1`;

const CACHE_DIR = '.cache/nflverse';

// ── Scoring rule sets ───────────────────────────────────────────────────────
// Transcribed from docs/claude/league-rules.md and docs/claude/afl-rules.md.
// The ONLY difference between them today is `ppr` and `pointsAllowed`, which
// is exactly why this must be config and never a hardcoded scorer.
const SCORING_RULES = {
  theleague: {
    passYd: 0.04, passTd: 6, interception: -2, twoPt: 2,
    rushYd: 0.1, rushTd: 6,
    recYd: 0.1, recTd: 6,
    ppr: { TE: 1.0, WR: 0.5, RB: 0.25 },
    fumbleLost: -2,
    xp: 1, fgFlatMaxYards: 30, fgFlat: 3, fgPerYard: 0.1,
    returnYd: 0.03,
  },
  'afl-fantasy': {
    passYd: 0.04, passTd: 6, interception: -2, twoPt: 2,
    rushYd: 0.1, rushTd: 6,
    recYd: 0.1, recTd: 6,
    ppr: { TE: 1.5, WR: 1.0, RB: 1.0 },
    fumbleLost: -2,
    xp: 1, fgFlatMaxYards: 30, fgFlat: 3, fgPerYard: 0.1,
    /**
     * ZERO, and docs/claude/afl-rules.md says 0.03. UNRESOLVED — do not
     * "fix" either side without a ruling.
     *
     * Reconciliation is unambiguous about MFL's BEHAVIOUR: 0.03 scores
     * 348/416 (83.65%), and every one of the 68 misses is a kick/punt
     * returner scored too HIGH by exactly their return yardage. Zero scores
     * 416/416.
     *
     * So MFL is not awarding the AFL return yards. Either the constitution
     * is wrong, or the AFL's MFL league is MISCONFIGURED and returners have
     * been underscored for an unknown number of seasons. That is a
     * commissioner's call, not a code change.
     */
    returnYd: 0,
  },
};

// ── CSV ─────────────────────────────────────────────────────────────────────
/**
 * RFC4180 parser. DO NOT substitute the `parseCSV` in scripts/lib/snap-counts.mjs
 * here: it splits on bare commas, and this feed quotes `headshot_url`, whose
 * value contains `f_auto,q_auto`. That shifts every column after it by one and
 * fails silently — every number downstream would be the neighbouring column.
 */
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') { quoted = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift();
  return rows
    .filter((r) => r.length === headers.length)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i]])));
}

/** NFLverse and DynastyProcess both write the literal string `NA` for null. */
const isBlank = (v) => {
  const s = (v ?? '').trim();
  return s === '' || s.toUpperCase() === 'NA';
};
const num = (v) => {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// ── Fetch + cache ───────────────────────────────────────────────────────────
async function cached(url, name) {
  const path = join(CACHE_DIR, name);
  if (existsSync(path)) return readFileSync(path, 'utf8');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const text = name.endsWith('.gz') ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return text;
}

// ── The scorer ──────────────────────────────────────────────────────────────
/**
 * Three rules here were DISCOVERED by reconciliation, not read off the rules
 * doc, and each one is a real MFL behaviour the constitution does not state:
 *
 *  1. `fumbles_lost_total`, not the rushing/receiving/sack components. MFL
 *     charges -2 for a fumble lost on a RETURN too, and the component columns
 *     are all zero for those. Cost: 2 players in week 1.
 *  2. Return yardage is NETTED across punt + kickoff before scoring.
 *  3. ...and then clamped at zero. A -5 yard punt return scores 0, not -0.15.
 *     Clamping each return type separately is wrong — that was a 0.15 miss on
 *     a player with -5 punt and +62 kickoff.
 */
function scorePlayerWeek(row, position, rules) {
  let p = 0;
  p += num(row.passing_yards) * rules.passYd;
  p += num(row.passing_tds) * rules.passTd;
  p += num(row.passing_interceptions) * rules.interception;
  p += num(row.passing_2pt_conversions) * rules.twoPt;

  p += num(row.rushing_yards) * rules.rushYd;
  p += num(row.rushing_tds) * rules.rushTd;
  p += num(row.rushing_2pt_conversions) * rules.twoPt;

  p += num(row.receiving_yards) * rules.recYd;
  p += num(row.receiving_tds) * rules.recTd;
  p += num(row.receiving_2pt_conversions) * rules.twoPt;
  p += num(row.receptions) * (rules.ppr[position] ?? 0);

  p += num(row.fumbles_lost_total) * rules.fumbleLost;          // (1)
  p += num(row.pat_made) * rules.xp;

  // fg_made_list is SEMICOLON separated ('51;43'), not comma.
  if (!isBlank(row.fg_made_list)) {
    for (const part of String(row.fg_made_list).split(';')) {
      const yards = Number.parseInt(part.trim(), 10);
      if (!Number.isFinite(yards)) continue;
      p += yards <= rules.fgFlatMaxYards ? rules.fgFlat : yards * rules.fgPerYard;
    }
  }

  const returnYards = Math.max(                                  // (2) + (3)
    0,
    num(row.punt_return_yards) + num(row.kickoff_return_yards),
  );
  p += returnYards * rules.returnYd;

  return Math.round(p * 100) / 100;
}

// ── Main ────────────────────────────────────────────────────────────────────
const argOf = (flag, fallback) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const slug = argOf('--league', 'theleague');
const year = argOf('--year', '2026');
const verbose = process.argv.includes('--verbose');

const league = LEAGUES[slug];
if (!league) throw new Error(`unknown league '${slug}' — not in the registry`);
const rules = SCORING_RULES[slug];
if (!rules) throw new Error(`no scoring rules transcribed for '${slug}'`);

const feedDir = join(league.dataPath, 'mfl-feeds', year);

const crosswalk = parseCsv(await cached(CROSSWALK_URL, 'db_playerids.csv'));
const gsisToMfl = new Map();
for (const r of crosswalk) {
  if (!isBlank(r.gsis_id) && !isBlank(r.mfl_id)) gsisToMfl.set(r.gsis_id.trim(), r.mfl_id.trim());
}

const stats = parseCsv(await cached(statsUrl(year), `stats_player_week_${year}.csv`));

const truthPath = join(feedDir, 'playerScores-by-week.json');
if (!existsSync(truthPath)) {
  console.error(`No MFL truth file at ${truthPath} — nothing to reconcile against.`);
  process.exit(1);
}
const truth = JSON.parse(readFileSync(truthPath, 'utf8')).weeks ?? {};

const positions = new Map();
for (const pl of JSON.parse(readFileSync(join(feedDir, 'players.json'), 'utf8')).players.player) {
  positions.set(String(pl.id), pl.position);
}

console.log(`\n${league.name} ${year} — NFLverse vs MFL\n`);
let grandOk = 0;
let grandTotal = 0;

for (const week of Object.keys(truth).sort((a, b) => Number(a) - Number(b))) {
  const expected = truth[week];
  let ok = 0;
  const misses = [];
  for (const row of stats) {
    if (row.week !== week) continue;
    const mflId = gsisToMfl.get(row.player_id);
    if (!mflId || !(mflId in expected)) continue;
    const ours = scorePlayerWeek(row, positions.get(mflId), rules);
    const theirs = Math.round(Number(expected[mflId]) * 100) / 100;
    const diff = Math.round((ours - theirs) * 100) / 100;
    if (Math.abs(diff) < 0.01) ok++;
    else misses.push({ name: row.player_display_name, theirs, ours, diff });
  }
  const total = ok + misses.length;
  if (!total) continue;
  grandOk += ok; grandTotal += total;
  const pct = ((100 * ok) / total).toFixed(2);
  console.log(`  Week ${String(week).padStart(2)}:  ${ok}/${total} exact (${pct}%)`);
  if (verbose || misses.length) {
    for (const m of misses.slice(0, 10)) {
      console.log(
        `      ${m.name.padEnd(26)} MFL=${m.theirs.toFixed(2).padStart(7)}` +
        `  ours=${m.ours.toFixed(2).padStart(7)}  diff=${m.diff > 0 ? '+' : ''}${m.diff}`,
      );
    }
  }
}

// ── Team defense ────────────────────────────────────────────────────────────
/**
 * DST is scored from PLAY-BY-PLAY, not from `stats_team_week`. Three reasons,
 * each one a miss the aggregate caused (17/34 -> 33/33):
 *
 *  1. `def_fumbles` is not MFL's `FC`. Recoveries must be credited to
 *     `fumble_recovery_1_team`, and crucially NOT filtered on `defteam`: on a
 *     punt or kickoff nflverse makes the KICKING team `posteam`, so a muffed
 *     punt recovered by the kicking team never matches a defteam filter. One
 *     of those cost CHI exactly 2.00.
 *  2. MFL's points allowed counts only what the opponent's OFFENSE scored. A
 *     pick-six against your own offense is not charged to your defense —
 *     worth 6 points of PA, which at 0.6/pt is a 3.60 error.
 *  3. ...and the extra point AFTER such a TD is excluded too. That last point
 *     is the difference between -0.60 and exact.
 */
const OPA_RULES = {};   // slug -> [{ lo, hi, flat, mult }]

function parseOpaRules(rulesJson) {
  const groups = rulesJson?.rules?.positionRules ?? [];
  const out = [];
  for (const group of Array.isArray(groups) ? groups : [groups]) {
    if (!String(group.positions ?? '').split('|').includes('Def')) continue;
    const rs = group.rule ?? [];
    for (const r of Array.isArray(rs) ? rs : [rs]) {
      if (r?.event?.$t !== 'OPA') continue;
      const [lo, hi] = String(r.range?.$t ?? '').split('-').map(Number);
      const pts = String(r.points?.$t ?? '');
      out.push(
        pts.startsWith('*')
          ? { lo, hi, flat: 0, mult: Number.parseFloat(pts.slice(1)) }
          : { lo, hi, flat: Number.parseFloat(pts), mult: 0 },
      );
    }
  }
  return out;
}

/**
 * Generic: sum every OPA rule whose range contains the value. This one
 * evaluator handles TheLeague's two STACKING rules (`15` over 0-35 plus
 * `*-.6` over 1-35, which is why a flat 15 was never right) and the AFL's 36
 * single-point rules identically, with no per-league code. Derived from MFL's
 * own export, so it cannot drift from what MFL scores.
 */
const scoreOpa = (rules, pa) =>
  rules.reduce((sum, r) => (pa >= r.lo && pa <= r.hi ? sum + r.flat + r.mult * pa : sum), 0);

const NFLVERSE_TEAM = { LA: 'LAR', OAK: 'LV', SD: 'LAC', STL: 'LAR' };
const MFL_TEAM = {
  GBP: 'GB', KCC: 'KC', NEP: 'NE', NOS: 'NO', SFO: 'SF', TBB: 'TB',
  LVR: 'LV', HST: 'HOU', BLT: 'BAL', CLV: 'CLE', ARZ: 'ARI', JAC: 'JAX',
};
const nt = (c) => NFLVERSE_TEAM[c] ?? c ?? '';

const pbp = parseCsv(await cached(pbpUrl(year), `play_by_play_${year}.csv.gz`))
  .filter((r) => r.season_type === 'REG')
  .sort((a, b) => (a.game_id === b.game_id
    ? num(a.play_id) - num(b.play_id)
    : a.game_id.localeCompare(b.game_id)));

const pointsAllowed = new Map();
const events = new Map();
const bump = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const evKey = (team, wk, ev) => `${team}|${wk}|${ev}`;
const lastTdWasOffensive = new Map();

for (const r of pbp) {
  const post = nt(r.posteam), def = nt(r.defteam), wk = r.week, g = r.game_id;

  // Recovery goes to whoever recovered — never filtered on defteam. See (1).
  if (num(r.fumble_lost) === 1 && nt(r.fumble_recovery_1_team)) {
    bump(events, evKey(nt(r.fumble_recovery_1_team), wk, 'FC'));
  }
  if (!post || !def) continue;

  if (num(r.touchdown) === 1) {
    const offensive = nt(r.td_team) === post;
    lastTdWasOffensive.set(g, offensive);
    if (offensive) bump(pointsAllowed, `${def}|${wk}`, 6);            // (2)
    else bump(events, evKey(def, wk, 'TD'));
  }
  if (r.field_goal_result === 'made') bump(pointsAllowed, `${def}|${wk}`, 3);
  if (r.extra_point_result === 'good' && lastTdWasOffensive.get(g) !== false) {
    bump(pointsAllowed, `${def}|${wk}`, 1);                           // (3)
  }
  if (r.two_point_conv_result === 'success' && lastTdWasOffensive.get(g) !== false) {
    bump(pointsAllowed, `${def}|${wk}`, 2);
  }
  if (num(r.safety) === 1) {
    bump(pointsAllowed, `${post}|${wk}`, 2);
    bump(events, evKey(def, wk, 'SF'));
  }
  if (num(r.sack) === 1) bump(events, evKey(def, wk, 'SK'));
  if (num(r.interception) === 1) bump(events, evKey(def, wk, 'IC'));
  if (r.field_goal_result === 'blocked' || r.extra_point_result === 'blocked'
      || num(r.punt_blocked) === 1) bump(events, evKey(def, wk, 'BL'));
}

OPA_RULES[slug] = parseOpaRules(JSON.parse(await cached(rulesUrl(league, year), `rules_${slug}_${year}.json`)));

const defsByTeam = new Map();
for (const pl of JSON.parse(readFileSync(join(feedDir, 'players.json'), 'utf8')).players.player) {
  if (pl.position === 'Def') defsByTeam.set(MFL_TEAM[pl.team] ?? pl.team, String(pl.id));
}

let dstOk = 0, dstTotal = 0;
const dstMisses = [];
for (const [team, mflId] of defsByTeam) {
  for (const week of Object.keys(truth)) {
    const expected = truth[week]?.[mflId];
    if (expected === undefined) continue;
    const pa = pointsAllowed.get(`${team}|${week}`);
    if (pa === undefined) continue;
    const e = (ev) => events.get(evKey(team, week, ev)) ?? 0;
    const ours = Math.round((
      e('SK') * 1 + e('IC') * 2 + e('FC') * 2 + e('SF') * 2
      + e('BL') * 2 + e('TD') * 6 + scoreOpa(OPA_RULES[slug], pa)
    ) * 100) / 100;
    const theirs = Math.round(Number(expected) * 100) / 100;
    dstTotal++;
    if (Math.abs(ours - theirs) < 0.01) dstOk++;
    else dstMisses.push({ team, week, pa, ours, theirs, diff: Math.round((ours - theirs) * 100) / 100 });
  }
}
if (dstTotal) {
  console.log(`  Team defense:  ${dstOk}/${dstTotal} exact `
    + `(${((100 * dstOk) / dstTotal).toFixed(2)}%)`);
  for (const m of dstMisses.slice(0, 10)) {
    console.log(`      ${m.team.padEnd(5)} wk${m.week}  PA=${String(m.pa).padStart(3)}`
      + `  MFL=${m.theirs.toFixed(2).padStart(7)}  ours=${m.ours.toFixed(2).padStart(7)}`
      + `  diff=${m.diff > 0 ? '+' : ''}${m.diff}`);
  }
}
grandOk += dstOk; grandTotal += dstTotal;

const pct = grandTotal ? ((100 * grandOk) / grandTotal).toFixed(2) : '0.00';
console.log(`\n  TOTAL: ${grandOk}/${grandTotal} exact (${pct}%)\n`);
process.exit(grandOk === grandTotal ? 0 : 1);
