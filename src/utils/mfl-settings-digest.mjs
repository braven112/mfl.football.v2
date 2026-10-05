/**
 * A league's rules AS CONFIGURED ON MFL, in plain words: roster and lineup
 * limits, waivers, trades, draft, standings and the scoring table.
 *
 * Ask Roger answers from a league's written rulebook first and falls back to
 * this where the rulebook is silent or the league has none (the owner's rule,
 * Oct 2026). It is also what a league with no written rulebook shows on its
 * Rules page. MFL is the system that actually enforces these settings, so for
 * anything it covers it is ground truth; what it cannot say (playoff format,
 * dues, payouts, commissioner policy) is listed as not covered, so Roger says
 * "not in the settings" instead of guessing.
 *
 * Pure: takes the parsed `league.json` and `rules.json` exports (as written by
 * scripts/fetch-mfl-feeds.mjs) and the code dictionary
 * (src/data/mfl-scoring-codes.json). Plain .mjs so node scripts can use it.
 */

const arrayOf = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const txt = (v) => {
  const raw = v && typeof v === 'object' && '$t' in v ? v.$t : v;
  return typeof raw === 'string' ? raw.trim() : raw;
};
const yes = (v) => /^(y|yes|1|true)$/i.test(String(v ?? ''));

const WAIVER_TYPES = {
  BBID: 'blind bidding (FAAB)',
  BBID_FCFS: 'blind bidding (FAAB), then first-come first-served once bidding closes',
  FCFS: 'first-come first-served (no waiver claims)',
  STANDARD: 'standard waiver priority',
  STANDARD_FCFS: 'standard waiver priority, then first-come first-served',
  WAIVER_WIRE: 'waiver wire',
  NONE: 'no waivers',
};

const LIMIT_UNITS = {
  LEAGUE: 'once in the whole league',
  CONFERENCE: 'once per conference',
  DIVISION: 'once per division',
};

/** "1-2" → "1–2", "2" → "2", "0-6" → "up to 6". */
function limit(v) {
  const s = String(txt(v) ?? '').trim();
  const m = s.match(/^(\d+)-(\d+)$/);
  if (!m) return s;
  if (m[1] === m[2]) return m[1];
  return m[1] === '0' ? `up to ${m[2]}` : `${m[1]}–${m[2]}`;
}

function positionLimits(block) {
  return arrayOf(block?.position)
    .map((p) => `${txt(p.name)} ${limit(p.limit)}`)
    .join(', ');
}

/** "*4" → "4 per", "6" → "6", "*-.3" → "-0.3 per", ".1/2.5" → "0.1 per 2.5". */
function points(p) {
  const s = String(txt(p) ?? '').trim();
  const ratio = s.match(/^\*?(-?[\d.]+)\/([\d.]+)$/);
  if (ratio) return `${Number(ratio[1])} per ${Number(ratio[2])}`;
  const per = s.startsWith('*');
  const n = Number(per ? s.slice(1) : s);
  const val = Number.isFinite(n) ? String(n) : s.replace(/^\*/, '');
  return per ? `${val} per` : val;
}

function scoringLines(rules, codes) {
  // Group identical rule lists so "QB, RB, WR, TE" reads once.
  const groups = new Map();
  for (const block of arrayOf(rules?.positionRules)) {
    const positions = String(txt(block.positions) ?? '').replace(/\|/g, ', ');
    // MFL returns each position's rules in its own order; sort so identical
    // tables compare equal and the digest is stable run to run.
    const lines = arrayOf(block.rule).map((r) => {
      const code = String(txt(r.event) ?? '');
      const label = codes[code] ?? code;
      const range = String(txt(r.range) ?? '');
      return `- ${label} (${code}): ${points(r.points)}${range ? ` [range ${range}]` : ''}`;
    }).sort();
    const key = lines.join('\n');
    if (!lines.length) continue;
    groups.set(key, [...(groups.get(key) ?? []), positions]);
  }
  return [...groups].flatMap(([lines, positions]) => ['', `**${positions.join(', ')}**`, '', lines]);
}

/**
 * The digest as plain text. `leagueExport` / `rulesExport` are the raw JSON
 * (with or without the outer `league` / `rules` key); either may be missing.
 */
export function mflSettingsDigest(leagueExport, rulesExport, codes = {}) {
  const l = leagueExport?.league ?? leagueExport ?? null;
  const rules = rulesExport?.rules ?? rulesExport ?? null;
  const out = [];
  if (l && typeof l === 'object' && Object.keys(l).length) {
    const franchises = arrayOf(l.franchises?.franchise);
    const divisions = arrayOf(l.divisions?.division).map((d) => txt(d.name)).filter(Boolean);
    const conferences = arrayOf(l.conferences?.conference).map((c) => txt(c.name)).filter(Boolean);
    out.push('### League');
    if (franchises.length || l.franchises?.count) out.push(`- Teams: ${franchises.length || l.franchises.count}`);
    if (conferences.length) out.push(`- Conferences (${conferences.length}): ${conferences.join(', ')}`);
    if (divisions.length) out.push(`- Divisions (${divisions.length}): ${divisions.join(', ')}`);
    if (l.startWeek || l.endWeek) {
      out.push(
        `- Season: NFL weeks ${l.startWeek ?? '?'}–${l.endWeek ?? '?'}` +
          (l.lastRegularSeasonWeek ? `; regular season ends after week ${l.lastRegularSeasonWeek}` : ''),
      );
    }
    if (l.h2h) out.push(`- Head-to-head matchups: ${yes(l.h2h) ? 'yes' : 'no'}`);
    if (l.standingsSort) {
      out.push(`- Standings order: ${String(l.standingsSort).split(',').filter(Boolean).join(', then ').replace(/_/g, ' ').toLowerCase()}`);
    }
    if (l.victoryPointsWin !== undefined) {
      out.push(
        `- Victory points: ${l.victoryPointsWin} for a win, ${l.victoryPointsTie ?? 0} for a tie, ${l.victoryPointsLoss ?? 0} for a loss` +
          (l.victoryPointsBuckets ? ` (weekly points buckets: ${l.victoryPointsBuckets})` : ''),
      );
    }
    if (l.playerLimitUnit) {
      out.push(`- Each NFL player can be rostered ${LIMIT_UNITS[String(l.playerLimitUnit).toUpperCase()] ?? String(l.playerLimitUnit).toLowerCase()}`);
    }

    out.push('', '### Rosters and lineups');
    if (l.rosterSize) out.push(`- Roster size: ${l.rosterSize}`);
    if (Number(l.injuredReserve) > 0) out.push(`- Injured reserve slots: ${l.injuredReserve}`);
    out.push(`- Taxi squad slots: ${Number(l.taxiSquad) > 0 ? l.taxiSquad : 'none'}`);
    if (l.rosterLimits) out.push(`- Roster limits by position: ${positionLimits(l.rosterLimits)}`);
    if (l.starters) {
      out.push(`- Starters: ${limit(l.starters.count)} per week — ${positionLimits(l.starters)}`);
      if (l.starters.idp_starters) out.push(`- IDP starters: ${limit(l.starters.idp_starters)}`);
    }
    if (l.partialLineupAllowed) out.push(`- Partial lineups allowed: ${yes(l.partialLineupAllowed) ? 'yes' : 'no'}`);
    if (yes(l.bestLineup)) out.push('- Best ball: MFL sets each lineup automatically to its best score');

    out.push('', '### Waivers and trades');
    if (l.currentWaiverType) {
      out.push(`- Waivers: ${WAIVER_TYPES[String(l.currentWaiverType).toUpperCase()] ?? String(l.currentWaiverType)}`);
    }
    if (String(l.currentWaiverType ?? '').toUpperCase().startsWith('BBID')) {
      if (l.bbidSeasonLimit) out.push(`- Blind-bid budget: $${l.bbidSeasonLimit} per season`);
      if (l.bbidIncrement) out.push(`- Minimum bid increment: $${l.bbidIncrement}`);
      if (l.bbidConditional) out.push(`- Conditional bids: ${yes(l.bbidConditional) ? 'allowed' : 'not allowed'}`);
      if (l.bbidTiebreaker) out.push(`- Tied bids broken by: ${String(l.bbidTiebreaker).toLowerCase()}`);
      if (Number(l.bbidFCFSCharge) > 0) out.push(`- First-come pickups cost $${l.bbidFCFSCharge} of the budget`);
    }
    if (l.maxWaiverRounds) out.push(`- Waiver rounds per run: ${l.maxWaiverRounds}`);
    if (l.defaultTradeExpirationDays) out.push(`- Trade offers expire after ${l.defaultTradeExpirationDays} days by default`);

    out.push('', '### Draft and keepers');
    if (l.draft_kind) out.push(`- Draft type: ${String(l.draft_kind).replace(/_/g, ' ')}`);
    if (l.draftPlayerPool) out.push(`- Draft player pool: ${l.draftPlayerPool}`);
    if (l.draftLimitHours) out.push(`- Time per pick: ${l.draftLimitHours} (hours:minutes)`);
    const keeper = String(l.keeperType ?? '').toLowerCase();
    out.push(`- Keepers: ${keeper && keeper !== 'none' ? keeper : 'none'}`);
    out.push(`- Salaries / contracts: ${yes(l.usesSalaries) || yes(l.usesContractYear) ? 'yes' : 'none'}`);
  }

  const scoring = rules ? scoringLines(rules, codes) : [];
  if (scoring.length) out.push('', '### Scoring', ...scoring);

  if (!out.length) return '';
  out.push(
    '',
    '### Not in the MFL settings',
    '',
    'Only the league rulebook or the commissioner can answer these: playoff format and seeding, ' +
      'entry fees and payouts, trade deadline and review policy, tiebreakers beyond the standings order, ' +
      'keeper/contract deadlines, and any league custom.',
  );
  return out.join('\n');
}
