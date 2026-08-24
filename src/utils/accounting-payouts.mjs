/**
 * Season payout planner — who won what, and what that writes to the ledger.
 *
 * PURE. No fetch, no fs, no clock, no registry lookups: every input is passed
 * in. That is what lets the API route, a test, and (later) a CLI produce the
 * same plan from the same season, and it is why a "why did it pay that" bug is
 * answerable by replaying the inputs rather than re-running a cron.
 *
 * WHY .mjs: same reason as afl-bracket-kind.mjs, which it imports — a node
 * script cannot import a .ts, and two copies of prize derivation would be free
 * to drift on exactly the seasons nobody re-checks.
 *
 * ── WHAT THIS DOES NOT DO ─────────────────────────────────────────────────
 * It does not write anything, and it does not decide to write. It returns a
 * plan whose lines are each already-paid, payable, or unresolved. A prize whose
 * winner cannot be derived is NEVER silently dropped and NEVER paid to nobody —
 * it comes back in `unresolved` with the reason, because a payout run that
 * quietly skips the NIT looks identical to one where nobody won it.
 *
 * ── IDEMPOTENCY ───────────────────────────────────────────────────────────
 * Each line's description is deterministic ("2025 League Champion"), and that
 * string is the idempotency handle: a plan run against a ledger that already
 * contains it marks the line `already-paid` instead of planning it again. This
 * is the whole safety net for a re-run — MFL's import has no upsert, so a
 * second run without this check pays every prize twice. A record matching the
 * description but NOT the amount is `conflict`, never payable: that is either
 * a hand-edited ledger or a changed prize table, and both need a human.
 */

import {
  bracketKindFromName,
  isTitleBracket,
  placementFromName,
} from './afl-bracket-kind.mjs';

/**
 * Brackets that crown a consolation winner rather than a finishing place.
 * `isTitleBracket` answers "does this decide a placement", which is TRUE for
 * the Toilet Bowl and the NIT — both would otherwise claim 1st overall.
 */
const CONSOLATION_NAME = /toilet\s*bowl|consolation|\bNIT\b|\bcup\b/i;

const asArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

const padFranchise = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^\d+$/.test(text) ? text.padStart(4, '0') : text;
};

/** Round to cents. Split prizes ($3 three ways) must not carry float dust. */
const toCents = (value) => Math.round(value * 100) / 100;

/**
 * The two franchises in a bracket's final, decided on points.
 * Returns null while the game is unplayed — 0-0 is "not yet", not a tie.
 */
function finalResult(bracket) {
  const rounds = asArray(bracket?.playoffBracket?.playoffRound);
  if (!rounds.length) return null;
  const games = asArray(rounds[rounds.length - 1]?.playoffGame);
  const game = games[0];
  if (!game) return null;

  const homePoints = parseFloat(game.home?.points ?? '0');
  const awayPoints = parseFloat(game.away?.points ?? '0');
  if (!(homePoints > 0) && !(awayPoints > 0)) return null;
  if (homePoints === awayPoints) return null;

  const homeWon = homePoints > awayPoints;
  return {
    winner: padFranchise(homeWon ? game.home?.franchise_id : game.away?.franchise_id),
    loser: padFranchise(homeWon ? game.away?.franchise_id : game.home?.franchise_id),
  };
}

/**
 * Final standings by place, from the placement brackets.
 *
 * Each bracket's final decides two places at once: its winner takes the place
 * the bracket is named for, its loser the one below. A league's championship
 * bracket is the unnamed case and decides 1st and 2nd.
 *
 * @returns {Map<number, string>} place -> franchiseId
 */
export function resolvePlacements(bracketMeta, brackets) {
  const places = new Map();
  const candidates = [];

  for (const meta of asArray(bracketMeta)) {
    const name = String(meta?.name ?? '');
    if (CONSOLATION_NAME.test(name)) continue;
    if (bracketKindFromName(name, String(meta?.id)) !== 'championship') continue;
    const place = isTitleBracket(name) ? 1 : placementFromName(name);
    if (!place) continue;
    candidates.push({ id: String(meta?.id), place, teams: Number(meta?.teamsInvolved ?? 0) });
  }

  // Two brackets can both look like "the title bracket" in a malformed or
  // reconstructed season. The real one is the bigger field; the rest are
  // dropped rather than allowed to overwrite 1st place at random.
  const byPlace = new Map();
  for (const candidate of candidates) {
    const held = byPlace.get(candidate.place);
    if (!held || candidate.teams > held.teams) byPlace.set(candidate.place, candidate);
  }

  for (const { id, place } of byPlace.values()) {
    const result = finalResult(brackets?.[id]);
    if (!result) continue;
    if (result.winner) places.set(place, result.winner);
    // The loser of the Nth-place game finishes N+1 — but never overwrite a
    // place another bracket decided outright.
    if (result.loser && !places.has(place + 1)) places.set(place + 1, result.loser);
  }

  return places;
}

/**
 * Playoff seeds, per conference bracket.
 *
 * Read off the FIRST round, where MFL stamps `seed` on each participant. Later
 * rounds carry winner_of_game refs instead, so seeding is only recoverable at
 * the opening round.
 *
 * @returns {Map<number, string[]>} seed -> franchiseIds (one per conference)
 */
export function resolvePlayoffSeeds(bracketMeta, brackets) {
  const bySeed = new Map();

  for (const meta of asArray(bracketMeta)) {
    const name = String(meta?.name ?? '');
    const kind = bracketKindFromName(name, String(meta?.id));
    // Conference brackets only. The league-wide championship bracket's seeds
    // would double-count teams that also appear in their conference bracket.
    if (kind !== 'al' && kind !== 'nl') continue;

    const rounds = asArray(brackets?.[String(meta?.id)]?.playoffBracket?.playoffRound);
    if (!rounds.length) continue;

    for (const game of asArray(rounds[0]?.playoffGame)) {
      for (const side of [game?.home, game?.away]) {
        const seed = Number(side?.seed);
        const franchiseId = padFranchise(side?.franchise_id);
        if (!Number.isInteger(seed) || seed <= 0 || !franchiseId) continue;
        const held = bySeed.get(seed) ?? [];
        if (!held.includes(franchiseId)) held.push(franchiseId);
        bySeed.set(seed, held);
      }
    }
  }

  return bySeed;
}

/**
 * Weekly high scorers, one entry per played week.
 *
 * Ties SPLIT the prize — both constitutions say so explicitly, and a
 * winner-takes-all tiebreak here would quietly underpay one owner every time
 * two teams land on the same score.
 *
 * Only weeks that were actually played count. A week present in the feed with
 * every score at zero is an unplayed week, not a 16-way tie.
 */
export function resolveWeeklyHighScores(weeklyScores, { throughWeek } = {}) {
  const results = [];

  for (const entry of asArray(weeklyScores)) {
    const week = Number(entry?.week);
    if (!Number.isInteger(week) || week <= 0) continue;
    if (throughWeek && week > throughWeek) continue;

    const scores = entry?.scores ?? {};
    let best = 0;
    let winners = [];
    for (const [franchiseId, raw] of Object.entries(scores)) {
      const points = Number(raw);
      if (!Number.isFinite(points) || points <= 0) continue;
      if (points > best) {
        best = points;
        winners = [padFranchise(franchiseId)];
      } else if (points === best) {
        winners.push(padFranchise(franchiseId));
      }
    }
    if (!winners.length) continue;
    results.push({ week, winners, points: best });
  }

  results.sort((a, b) => a.week - b.week);
  return results;
}

/** Normalize the ledger once so idempotency lookups are O(1) per prize. */
function indexLedger(existingRecords) {
  const index = new Map();
  for (const record of asArray(existingRecords)) {
    const key = `${padFranchise(record?.franchiseId)}|${String(record?.description ?? '').trim().toLowerCase()}`;
    const held = index.get(key) ?? [];
    held.push(record);
    index.set(key, held);
  }
  return index;
}

/**
 * Build one plan line, resolving it against the existing ledger.
 * Exported for tests; not part of the planner's public surface otherwise.
 */
function buildLine({ prize, franchiseId, amount, description, ledgerIndex, detail }) {
  const matches = ledgerIndex.get(`${franchiseId}|${description.trim().toLowerCase()}`) ?? [];
  const exact = matches.find((record) => toCents(record.amount) === toCents(amount));

  let status = 'payable';
  if (exact) status = 'already-paid';
  else if (matches.length) status = 'conflict';

  return {
    key: prize.key,
    label: prize.label,
    franchiseId,
    amount: toCents(amount),
    description,
    status,
    ...(detail ? { detail } : {}),
    ...(status === 'conflict'
      ? {
          conflictWith: matches.map((record) => ({
            amount: record.amount,
            description: record.description,
          })),
        }
      : {}),
  };
}

/**
 * Plan a season's payouts.
 *
 * @param {object} options
 * @param {number|string} options.year Season being paid. Appears in every description.
 * @param {{prizePool: number, prizes: Array}} options.payouts The league's registry prize table.
 * @param {object} options.data Injected season data (see the resolvers above).
 * @param {Array} [options.existingRecords] The current ledger, for idempotency.
 * @returns {{lines: Array, unresolved: Array, totals: object}}
 */
export function planPayouts({ year, payouts, data = {}, existingRecords = [] }) {
  const lines = [];
  const unresolved = [];
  const ledgerIndex = indexLedger(existingRecords);
  const season = String(year);

  const { bracketMeta, brackets, awards = {}, weeklyScores, tierTable = {} } = data;

  const placements = resolvePlacements(bracketMeta, brackets);
  const seeds = resolvePlayoffSeeds(bracketMeta, brackets);

  // The regular season ends where the playoffs start. Derived, not assumed:
  // TheLeague's weekly-high prize is documented as 14 weeks, but the week the
  // playoffs actually begin is what decides which weeks were regular season.
  const playoffStart = asArray(bracketMeta)
    .map((meta) => Number(meta?.startWeek))
    .filter((week) => Number.isInteger(week) && week > 0)
    .sort((a, b) => a - b)[0];

  for (const prize of payouts?.prizes ?? []) {
    const source = prize.source ?? {};

    if (source.kind === 'placement') {
      const franchiseId = placements.get(source.place);
      if (!franchiseId) {
        unresolved.push({
          key: prize.key,
          label: prize.label,
          amount: prize.amount,
          reason: `No franchise resolved for place ${source.place} — the deciding game may be unplayed.`,
        });
        continue;
      }
      lines.push(
        buildLine({
          prize,
          franchiseId,
          amount: prize.amount,
          description: `${season} ${prize.label}`,
          ledgerIndex,
        })
      );
      continue;
    }

    if (source.kind === 'award') {
      const winner = awards?.[source.slug];
      const franchiseId = padFranchise(
        typeof winner === 'string' ? winner : winner?.franchiseId
      );
      if (!franchiseId) {
        unresolved.push({
          key: prize.key,
          label: prize.label,
          amount: prize.amount,
          reason: `No winner recorded for award "${source.slug}" in ${season}.`,
        });
        continue;
      }
      lines.push(
        buildLine({
          prize,
          franchiseId,
          amount: prize.amount,
          description: `${season} ${prize.label}`,
          ledgerIndex,
        })
      );
      continue;
    }

    if (source.kind === 'playoff-seed') {
      const winners = [];
      for (const seed of source.seeds ?? []) {
        for (const franchiseId of seeds.get(seed) ?? []) {
          winners.push({ seed, franchiseId });
        }
      }
      if (!winners.length) {
        unresolved.push({
          key: prize.key,
          label: prize.label,
          amount: prize.amount,
          reason: `No franchises found at playoff seeds ${(source.seeds ?? []).join(', ')} — conference brackets may not be posted yet.`,
        });
        continue;
      }
      for (const { seed, franchiseId } of winners) {
        lines.push(
          buildLine({
            prize,
            franchiseId,
            amount: prize.amount,
            // The seed is IN the description: two teams share this prize's
            // label, so without it their ledger lines are indistinguishable
            // and the idempotency check would treat the second as a repeat.
            description: `${season} ${prize.label} (seed ${seed})`,
            ledgerIndex,
            detail: `Seed ${seed}`,
          })
        );
      }
      continue;
    }

    if (source.kind === 'tier-rank') {
      const table = asArray(tierTable?.[source.tier]).map(padFranchise).filter(Boolean);
      const franchiseId = table[source.rank - 1];
      if (!franchiseId) {
        unresolved.push({
          key: prize.key,
          label: prize.label,
          amount: prize.amount,
          reason: `No franchise at ${source.tier} rank ${source.rank} — the all-play table is missing or short.`,
        });
        continue;
      }
      lines.push(
        buildLine({
          prize,
          franchiseId,
          amount: prize.amount,
          description: `${season} ${prize.label}`,
          ledgerIndex,
        })
      );
      continue;
    }

    if (source.kind === 'weekly-high') {
      const weeks = resolveWeeklyHighScores(weeklyScores, {
        throughWeek: playoffStart ? playoffStart - 1 : undefined,
      });
      if (!weeks.length) {
        unresolved.push({
          key: prize.key,
          label: prize.label,
          amount: prize.amount,
          reason: 'No played regular-season weeks found in the results feed.',
        });
        continue;
      }
      for (const { week, winners, points } of weeks) {
        // Ties split — see resolveWeeklyHighScores.
        const share = toCents(prize.amount / winners.length);
        for (const franchiseId of winners) {
          lines.push(
            buildLine({
              prize,
              franchiseId,
              amount: share,
              description: `${season} ${prize.label} - Week ${week}`,
              ledgerIndex,
              detail:
                winners.length > 1
                  ? `Week ${week}, ${points} pts (split ${winners.length} ways)`
                  : `Week ${week}, ${points} pts`,
            })
          );
        }
      }
      // The prize table states how many weeks it expects to pay. A mismatch is
      // reported rather than corrected: a short season and a half-synced feed
      // look the same here, and only one of them should be paid.
      if (source.weeks && weeks.length !== source.weeks) {
        unresolved.push({
          key: `${prize.key}-week-count`,
          label: `${prize.label} week count`,
          amount: 0,
          reason: `Found ${weeks.length} played weeks, prize table expects ${source.weeks}. Check the results feed before paying.`,
        });
      }
      continue;
    }

    unresolved.push({
      key: prize.key,
      label: prize.label,
      amount: prize.amount,
      reason: `Unknown payout source "${source.kind}".`,
    });
  }

  const sum = (predicate) =>
    toCents(lines.filter(predicate).reduce((total, line) => total + line.amount, 0));

  const payable = sum((line) => line.status === 'payable');
  const alreadyPaid = sum((line) => line.status === 'already-paid');

  return {
    lines,
    unresolved,
    totals: {
      payable,
      alreadyPaid,
      conflicts: lines.filter((line) => line.status === 'conflict').length,
      planned: toCents(payable + alreadyPaid),
      prizePool: payouts?.prizePool ?? null,
      // Positive means the plan pays MORE than the stated pool. Shown, never
      // acted on — see the registry note on the AFL's $2,225 vs $2,220.
      drift:
        payouts?.prizePool == null ? null : toCents(payable + alreadyPaid - payouts.prizePool),
    },
  };
}
