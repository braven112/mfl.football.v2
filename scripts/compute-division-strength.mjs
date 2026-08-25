#!/usr/bin/env node
/**
 * Division strength — derived data for every league that runs the
 * franchise-history pipeline.
 *
 * Writes `data/<league>/derived/division-strength.json`: for every season, what
 * each division did as a bloc; for every pair of divisions, the head-to-head
 * ledger between them; all-time totals per division; and — because a division
 * is really just the owners who have sat in it — a per-owner breakdown of every
 * division's history.
 *
 * ── Inputs, and why each one ───────────────────────────────────────────────
 *
 *   derived/season-ledger.json   Every franchise-season INCLUDING the ones no
 *                                current franchise claims. Franchise pages are
 *                                owner-scoped and drop a third of league
 *                                history (110 of TheLeague's 320 rows, 230 of
 *                                the AFL's 576); a division record built from
 *                                them would be missing that third. The ledger
 *                                also already carries each season's REAL
 *                                division, read out of that year's own
 *                                league.json with the display aliases applied,
 *                                so nothing here re-derives alignment.
 *   derived/owner-tenures.json   franchise-season -> owner. This is what turns
 *                                "the Central" into "the Central under these
 *                                nine owners".
 *   mfl-feeds/<year>/league.json `lastRegularSeasonWeek` — the regular-season
 *                                gate. Playoff games are seeded, not scheduled,
 *                                so counting them would let a division's
 *                                strength depend on the bracket it earned.
 *   mfl-feeds/<year>/schedule.json  Game-level pairings + scores, the only
 *                                place a division-vs-division record can come
 *                                from. schedule.json is the copy that replays
 *                                to MFL's own standings exactly — see the note
 *                                in compute-franchise-history.mjs about
 *                                weekly-results-raw carrying FABRICATED AFL
 *                                pairings for 2012-2015. Do not add it as a
 *                                fallback here.
 *
 * ── Why the strength metric is the INTERDIVISIONAL record ──────────────────
 *
 * A division's overall record cannot measure it. Every intra-division game
 * hands one of its own teams a win and another a loss, so that slice cancels
 * to exactly .500 by arithmetic no matter how good the teams are, and both
 * leagues schedule a heavy in-division slate. Games against the rest of the
 * league are the only place a division can separate from the field. The
 * overall record is still reported — it is what an owner remembers — but it
 * never drives a ranking. See src/utils/division-strength.mjs.
 *
 * ── Divisions are keyed by NAME, not by MFL slot id ────────────────────────
 *
 * MFL's division ids are slots, and a slot's meaning does not survive a
 * realignment. The AFL's id "03" was the East through 2012 and has been the
 * West ever since; keying all-time records on the id would merge two different
 * divisions into one nonsense row. Names are stable across every realignment
 * on file, and reading TheLeague's 2011 rename as "the Pacific ran 2007-2010,
 * the Northwest since 2011" is both true and what an owner means.
 *
 * ── Four invariants enforced at RUN time, not just in tests ────────────────
 *
 * Same principle as compute-owner-tenures.mjs's assertConservation: a bad
 * input should fail the run rather than write a plausible-looking wrong file.
 *
 *   1. The schedule.json replay reproduces the ledger's W-L-T for every played
 *      franchise-season. It currently does, exactly, for all 44 played seasons
 *      across both leagues. Any drift means every division total is wrong in a
 *      way no reader could spot.
 *   2. Divisions PARTITION the season — every played franchise-season lands in
 *      exactly one bucket and the buckets sum to the season.
 *   3. Exactly one division winner per division-season (76/76 and 112/112
 *      today).
 *   4. A franchise-season is held by one owner, or by a declared set of
 *      co-owners. Anything else means the owner attribution is double-counting.
 *
 * ── The AFL's 2003 hole ────────────────────────────────────────────────────
 *
 * The AFL's 2003 feed has pairings but every score is 0 and every result is
 * "T" — the season's game log simply wasn't kept, in schedule.json and
 * weekly-results-raw alike. Standings survive, so the division W-L totals are
 * real; the division-vs-division ledger for that year cannot exist. The season
 * is emitted with `gamesResolved: false` and left OUT of the strength ranking
 * rather than ranked at zero. The same flag covers a season not yet played.
 *
 * Usage:
 *   node scripts/compute-division-strength.mjs                # every league
 *   node scripts/compute-division-strength.mjs --league=afl
 *   node scripts/compute-division-strength.mjs --dry-run
 *
 * Leagues with no season-ledger.json are skipped structurally — which is how
 * best-ball-1 is excluded, with no special-casing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAGUES } from '../src/config/leagues-data.mjs';
import { writeJsonIfChanged } from './lib/canonical-json.mjs';
import { LEAGUE_SLUGS, resolveLeagueArg } from './lib/owner-tenure-inputs.mjs';
import {
  addGame,
  contiguousRuns,
  divisionSlug,
  emptyRecord,
  finishPercentile,
  mergeRecord,
  rankDivisionsByStrength,
  recordGames,
  winPct,
} from '../src/utils/division-strength.mjs';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const readJson = (p) => (fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null);
const toArray = (v) => (Array.isArray(v) ? v : v == null ? [] : [v]);
const round2 = (n) => Math.round(n * 100) / 100;
const round3 = (n) => (n === null ? null : Math.round(n * 1000) / 1000);

function parseArgs() {
  const opts = { league: null, dryRun: false };
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--dry-run') opts.dryRun = true;
    else if (arg === '--league') opts.league = resolveLeagueArg(args[++i]);
    else if (arg.startsWith('--league=')) opts.league = resolveLeagueArg(arg.slice('--league='.length));
  }
  return opts;
}

/** Points come off MFL as floats; round on the way out so the file is stable. */
const finishRecord = (rec) => ({
  wins: rec.wins,
  losses: rec.losses,
  ties: rec.ties,
  games: recordGames(rec),
  pointsFor: round2(rec.pointsFor),
  pointsAgainst: round2(rec.pointsAgainst),
  winPct: round3(winPct(rec)),
});

/**
 * franchise-season -> the owners holding it.
 *
 * A season normally has exactly one holder. It has TWO when the slot is a
 * declared shared team — `compute-owner-tenures.mjs` fails its own run if a
 * season lands on two owners any other way, so a pair here is always a
 * legitimate co-ownership (invariant 4 re-checks it anyway, since this script
 * can be run against a hand-edited file).
 *
 * Consequence, and the reason this returns a LIST: an owner-era row for a
 * shared season appears under BOTH co-owners. Division totals are therefore
 * never summed from owner eras — they are summed from franchise-seasons, which
 * exist once each. `tests/division-strength-data.test.ts` pins that separation.
 */
/**
 * The most recent team name an owner used.
 *
 * The division report labels history by TEAM, not by owner — but an owner's
 * `title` concatenates every name they have worn ("Vit's Brother / Avenging
 * Amish / Broke Back 'lil Half Dead's Brother", 68 characters), which is not a
 * team name and wraps to three lines. The label is the LATEST name instead.
 *
 * "Latest" means latest within THIS OWNER's tenure, never the franchise's.
 * AFL franchise 0007 has had several owners; using the franchise's newest name
 * would stamp a stranger's team onto someone else's stint. Segmentation stays
 * keyed on the owner so a mid-tenure rename does not split one stint in two —
 * only the label changes.
 */
function latestIdentity(owner) {
  const identities = owner?.identities ?? [];
  if (!identities.length) return null;
  return identities.reduce((best, cur) => (cur.yearEnd > best.yearEnd ? cur : best), identities[0]);
}

function buildOwnersBySeason(ownerFile) {
  const bySeason = new Map();
  const sharedSlugs = new Map();
  for (const owner of ownerFile?.owners ?? []) {
    sharedSlugs.set(owner.slug, new Set((owner.coOwners ?? []).map((c) => c.slug)));
    const latest = latestIdentity(owner);
    for (const tenure of owner.tenures ?? []) {
      for (const season of tenure.seasons ?? []) {
        const key = `${season.year}|${tenure.franchiseId}`;
        if (!bySeason.has(key)) bySeason.set(key, []);
        bySeason.get(key).push({
          ownerId: owner.ownerId,
          slug: owner.slug,
          title: owner.title,
          latestName: latest?.name ?? null,
          latestNameMedium: latest?.nameMedium ?? latest?.name ?? null,
          // The crest has to come from the SAME identity as the label. `owner.icon`
          // is the dominant identity's, which for a one-name owner is also the
          // latest — but an owner who renamed or came back under a new team has
          // two, and the pair then contradicts itself: "Angry Irish" over the
          // Carolina Blues crest. Seven AFL owners already read that way.
          icon: latest?.icon ?? owner.icon ?? null,
          isCurrent: !!owner.isCurrent,
          isShared: !!owner.isShared,
        });
      }
    }
  }
  return { bySeason, sharedSlugs };
}

/**
 * Walk one season's regular-season games out of schedule.json.
 *
 * `resolved` is false when the feed carries no scored games at all — the AFL's
 * 2003 hole, and any season not yet played.
 */
function readSeasonGames(yearDir) {
  const leagueFeed = readJson(path.join(yearDir, 'league.json'));
  const schedule = readJson(path.join(yearDir, 'schedule.json'));
  const lastRegularSeasonWeek = Number(leagueFeed?.league?.lastRegularSeasonWeek) || 0;
  const games = [];
  if (!schedule || !lastRegularSeasonWeek) return { games, resolved: false, lastRegularSeasonWeek };

  for (const week of toArray(schedule.schedule?.weeklySchedule)) {
    const weekNum = Number(week.week);
    if (!weekNum || weekNum > lastRegularSeasonWeek) continue;
    for (const matchup of toArray(week.matchup)) {
      const sides = toArray(matchup.franchise);
      if (sides.length !== 2) continue;
      const [a, b] = sides;
      const aScore = Number(a.score) || 0;
      const bScore = Number(b.score) || 0;
      // A 0-0 pairing is an unplayed game, not a tie — both leagues publish the
      // full schedule before week 1, so every future week looks like this, and
      // so does all of the AFL's 2003.
      if (aScore === 0 && bScore === 0) continue;
      games.push({ week: weekNum, aId: a.id, bId: b.id, aScore, bScore });
    }
  }
  return { games, resolved: games.length > 0, lastRegularSeasonWeek };
}

function buildLeague(slug) {
  const league = LEAGUES[slug];
  const derivedDir = path.join(ROOT, league.dataPath, 'derived');
  const ledger = readJson(path.join(derivedDir, 'season-ledger.json'));
  if (!ledger) return null;

  const ownerFile = readJson(path.join(derivedDir, 'owner-tenures.json'));
  if (!ownerFile) {
    throw new Error(
      `[division-strength] ${slug}: owner-tenures.json is missing. Run compute:owner-tenures ` +
        `first — owner eras are half of this report, and a file written without them would ` +
        `look complete while silently omitting every owner.`
    );
  }
  const { bySeason: ownersBySeason, sharedSlugs } = buildOwnersBySeason(ownerFile);

  const rowsByYear = new Map();
  for (const row of ledger.rows) {
    if (!rowsByYear.has(row.year)) rowsByYear.set(row.year, []);
    rowsByYear.get(row.year).push(row);
  }
  const years = [...rowsByYear.keys()].sort((a, b) => a - b);

  // All-time accumulators, keyed by division NAME. See the header for why not id.
  const allTime = new Map();
  const ensureDivision = (name) => {
    if (!allTime.has(name)) {
      allTime.set(name, {
        name,
        slug: divisionSlug(name),
        years: [],
        divisionIds: new Set(),
        totals: emptyRecord(),
        interDivision: emptyRecord(),
        intraDivision: emptyRecord(),
        vs: new Map(),
        teamSeasons: 0,
        playoffBerths: 0,
        divisionTitles: 0,
        championships: 0,
        runnerUps: 0,
        thirdPlaces: 0,
        rankedYears: [],
        owners: new Map(),
        seasonRows: [],
      });
    }
    return allTime.get(name);
  };

  const yearPayloads = [];
  const problems = [];

  for (const year of years) {
    const rows = rowsByYear.get(year);
    const played = rows.filter((r) => !r.seasonNotStarted);
    const yearDir = path.join(ROOT, league.dataPath, 'mfl-feeds', String(year));
    const { games, resolved, lastRegularSeasonWeek } = readSeasonGames(yearDir);

    const divisionOf = new Map();
    const divisionIdOf = new Map();
    for (const row of rows) {
      if (!row.divisionName) continue;
      divisionOf.set(row.franchiseId, row.divisionName);
      divisionIdOf.set(row.franchiseId, row.divisionId);
    }

    const undivided = played.filter((r) => !divisionOf.has(r.franchiseId));
    if (undivided.length) {
      problems.push(
        `${year}: ${undivided.length} played franchise-season(s) carry no division ` +
          `(${undivided.slice(0, 3).map((r) => r.franchiseId).join(', ')})`
      );
    }

    const perFranchise = new Map();
    for (const row of played) {
      perFranchise.set(row.franchiseId, {
        row,
        replay: emptyRecord(),
        inter: emptyRecord(),
        intra: emptyRecord(),
      });
    }

    const divisionBuckets = new Map();
    const ensureBucket = (name) => {
      if (!divisionBuckets.has(name)) {
        divisionBuckets.set(name, {
          name,
          divisionId: null,
          teams: [],
          totals: emptyRecord(),
          interDivision: emptyRecord(),
          intraDivision: emptyRecord(),
          vs: new Map(),
        });
      }
      return divisionBuckets.get(name);
    };

    for (const game of games) {
      const divA = divisionOf.get(game.aId);
      const divB = divisionOf.get(game.bId);
      for (const [fid, scoreFor, scoreAgainst, own, other] of [
        [game.aId, game.aScore, game.bScore, divA, divB],
        [game.bId, game.bScore, game.aScore, divB, divA],
      ]) {
        const entry = perFranchise.get(fid);
        if (!entry) continue;
        addGame(entry.replay, scoreFor, scoreAgainst);
        if (!own || !other) continue;
        addGame(own === other ? entry.intra : entry.inter, scoreFor, scoreAgainst);
      }
      // Division-vs-division ledger, recorded from BOTH sides so each division's
      // `vs` map is complete on its own. The two halves are exact mirrors, which
      // the guard test asserts.
      if (divA && divB && divA !== divB) {
        for (const [own, opp, scoreFor, scoreAgainst] of [
          [divA, divB, game.aScore, game.bScore],
          [divB, divA, game.bScore, game.aScore],
        ]) {
          const bucket = ensureBucket(own);
          if (!bucket.vs.has(opp)) bucket.vs.set(opp, emptyRecord());
          addGame(bucket.vs.get(opp), scoreFor, scoreAgainst);
        }
      }
    }

    // INVARIANT 1 — the replay reconciles with MFL's standings.
    if (resolved) {
      for (const [fid, entry] of perFranchise) {
        const { row, replay } = entry;
        if (replay.wins !== row.wins || replay.losses !== row.losses || replay.ties !== row.ties) {
          problems.push(
            `${year}: franchise ${fid} replays ${replay.wins}-${replay.losses}-${replay.ties} out of ` +
              `schedule.json but the ledger says ${row.wins}-${row.losses}-${row.ties}`
          );
        }
      }
    }

    for (const [fid, entry] of perFranchise) {
      const { row } = entry;
      const name = divisionOf.get(fid);
      if (!name) continue;
      const bucket = ensureBucket(name);
      bucket.divisionId = divisionIdOf.get(fid) ?? bucket.divisionId;

      const holders = ownersBySeason.get(`${row.year}|${fid}`) ?? [];

      // INVARIANT 4 — one holding per franchise-season.
      if (holders.length === 0) {
        problems.push(`${year}: franchise ${fid} is held by no owner`);
      } else if (holders.length > 1) {
        const mutual = holders.every((h) =>
          holders.filter((x) => x !== h).every((x) => sharedSlugs.get(h.slug)?.has(x.slug))
        );
        if (!mutual) {
          problems.push(
            `${year}: franchise ${fid} is held by ${holders.length} owners who are not declared ` +
              `co-owners (${holders.map((h) => h.slug).join(', ')})`
          );
        }
      }

      // Standings points are authoritative for a team's season total (they carry
      // any commissioner adjustment); the replay supplies points AGAINST, which
      // the standings feed does not.
      const team = {
        franchiseId: fid,
        name: row.name,
        nameMedium: row.nameMedium,
        icon: row.icon,
        wins: row.wins,
        losses: row.losses,
        ties: row.ties,
        pointsFor: round2(row.pointsFor),
        pointsAgainst: resolved ? round2(entry.replay.pointsAgainst) : null,
        regSeasonRank: row.regSeasonRank,
        wonDivision: row.wonDivision,
        playoffResult: row.playoffResult,
        interDivision: resolved ? finishRecord(entry.inter) : null,
        intraDivision: resolved ? finishRecord(entry.intra) : null,
        owners: holders.map((h) => ({
          ownerId: h.ownerId,
          slug: h.slug,
          title: h.title,
          latestName: h.latestName,
          latestNameMedium: h.latestNameMedium,
          icon: h.icon,
        })),
        shared: holders.length > 1,
      };
      bucket.teams.push(team);

      // Division totals come from the STANDINGS row, so a season with no game
      // log still reports a real W-L. Points against only exists where games do.
      bucket.totals.wins += row.wins;
      bucket.totals.losses += row.losses;
      bucket.totals.ties += row.ties;
      bucket.totals.pointsFor += row.pointsFor;
      bucket.totals.pointsAgainst += resolved ? entry.replay.pointsAgainst : 0;
      mergeRecord(bucket.interDivision, entry.inter);
      mergeRecord(bucket.intraDivision, entry.intra);
    }

    // INVARIANT 2 — the divisions partition the season.
    const bucketed = [...divisionBuckets.values()].reduce((n, b) => n + b.teams.length, 0);
    if (bucketed !== played.length - undivided.length) {
      problems.push(
        `${year}: ${played.length} played franchise-seasons but ${bucketed} landed in a division bucket`
      );
    }

    const divisionList = [...divisionBuckets.values()].sort(
      (a, b) =>
        String(a.divisionId ?? '').localeCompare(String(b.divisionId ?? '')) ||
        a.name.localeCompare(b.name)
    );

    const ranks = resolved
      ? new Map(
          rankDivisionsByStrength(
            divisionList.map((d) => ({
              key: d.name,
              interDivision: d.interDivision,
              totals: d.totals,
            }))
          ).map((r) => [r.key, r.rank])
        )
      : new Map();

    // Division winners are recorded only once a season is COMPLETE:
    // compute-franchise-history.mjs gates `divisionTitleHolders` on
    // `seasonHasGames && seasonComplete`, so from Week 1 until the regular
    // season ends every division legitimately has zero. Asserting "exactly one"
    // unconditionally made invariant 3 unsatisfiable for the whole season —
    // and because prebuild treats a parallel step's failure as non-fatal, the
    // derived file would have stopped refreshing in silence at 2026 kickoff.
    //
    // The invariant that IS true year-round is all-or-nothing: a season either
    // has no winners yet, or has exactly one per division. A partial set is the
    // real corruption signal, and this still catches it.
    const seasonHasWinners = divisionList.some((d) => d.teams.some((t) => t.wonDivision));

    const yearDivisions = divisionList.map((d) => {
      d.teams.sort(
        (a, b) =>
          (a.regSeasonRank ?? 99) - (b.regSeasonRank ?? 99) ||
          b.wins - a.wins ||
          b.pointsFor - a.pointsFor
      );

      // INVARIANT 3 — exactly one division winner, once the season has any.
      const winners = d.teams.filter((t) => t.wonDivision);
      if (seasonHasWinners && winners.length !== 1) {
        problems.push(
          `${year} ${d.name}: ${winners.length} division winners recorded (expected exactly 1)`
        );
      }
      const champion = d.teams.find((t) => t.playoffResult === 'champion') ?? null;
      const brief = (t) =>
        t ? { franchiseId: t.franchiseId, name: t.name, icon: t.icon, owners: t.owners } : null;

      return {
        name: d.name,
        slug: divisionSlug(d.name),
        divisionId: d.divisionId,
        rank: ranks.get(d.name) ?? null,
        totals: finishRecord(d.totals),
        interDivision: resolved ? finishRecord(d.interDivision) : null,
        intraDivision: resolved ? finishRecord(d.intraDivision) : null,
        vs: resolved
          ? Object.fromEntries(
              [...d.vs].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, finishRecord(v)])
            )
          : {},
        playoffBerths: d.teams.filter((t) => t.playoffResult !== 'missed').length,
        divisionWinner: brief(winners[0] ?? null),
        champion: brief(champion),
        teams: d.teams,
      };
    });

    // A single season has no sample-size problem, so naming its strongest and
    // weakest is a fair claim — unlike the all-time view, which deliberately
    // makes no such verdict (see the payload's `summary`).
    const ranked = yearDivisions.filter((d) => d.rank !== null).sort((a, b) => a.rank - b.rank);
    yearPayloads.push({
      year,
      gamesResolved: resolved,
      lastRegularSeasonWeek: lastRegularSeasonWeek || null,
      leagueSize: played.length,
      divisionCount: yearDivisions.length,
      strongest: ranked.length ? ranked[0].name : null,
      weakest: ranked.length ? ranked[ranked.length - 1].name : null,
      divisions: yearDivisions,
    });

    for (const d of yearDivisions) {
      const at = ensureDivision(d.name);
      at.years.push(year);
      if (d.divisionId) at.divisionIds.add(d.divisionId);
      at.teamSeasons += d.teams.length;
      at.totals.wins += d.totals.wins;
      at.totals.losses += d.totals.losses;
      at.totals.ties += d.totals.ties;
      at.totals.pointsFor += d.totals.pointsFor;
      at.totals.pointsAgainst += d.totals.pointsAgainst;
      if (d.interDivision) {
        mergeRecord(at.interDivision, d.interDivision);
        mergeRecord(at.intraDivision, d.intraDivision);
        for (const [opp, rec] of Object.entries(d.vs)) {
          if (!at.vs.has(opp)) at.vs.set(opp, emptyRecord());
          mergeRecord(at.vs.get(opp), rec);
        }
      }
      at.playoffBerths += d.playoffBerths;
      // Kept so membership eras can be segmented after every season is in —
      // a division's identity is as much WHO IS IN IT as what it is called,
      // and that only becomes visible by comparing consecutive seasons.
      at.seasonRows.push({
        year,
        memberKey: d.teams.map((t) => t.franchiseId).sort().join(','),
        franchiseIds: d.teams.map((t) => t.franchiseId).sort(),
        totals: d.totals,
        interDivision: d.interDivision,
        rank: d.rank,
        of: yearDivisions.length,
        playoffBerths: d.playoffBerths,
        divisionTitles: d.teams.filter((t) => t.wonDivision).length,
        championships: d.teams.filter((t) => t.playoffResult === 'champion').length,
        teams: d.teams,
      });
      if (d.rank !== null) {
        at.rankedYears.push({
          year,
          rank: d.rank,
          of: yearDivisions.length,
          pct: round3(finishPercentile(d.rank, yearDivisions.length)),
        });
      }

      for (const team of d.teams) {
        if (team.wonDivision) at.divisionTitles += 1;
        if (team.playoffResult === 'champion') at.championships += 1;
        else if (team.playoffResult === 'runner-up') at.runnerUps += 1;
        else if (team.playoffResult === 'third-place') at.thirdPlaces += 1;

        // Owner eras. A shared season is credited to BOTH co-owners here; see
        // buildOwnersBySeason for why that never double-counts a division total.
        for (const holder of team.owners) {
          if (!at.owners.has(holder.ownerId)) {
            at.owners.set(holder.ownerId, {
              ownerId: holder.ownerId,
              slug: holder.slug,
              title: holder.title,
              latestName: holder.latestName,
              latestNameMedium: holder.latestNameMedium,
              icon: holder.icon,
              years: [],
              franchiseIds: new Set(),
              identities: new Map(),
              totals: emptyRecord(),
              interDivision: emptyRecord(),
              divisionTitles: 0,
              championships: 0,
              playoffBerths: 0,
              sharedSeasons: 0,
            });
          }
          const era = at.owners.get(holder.ownerId);
          era.years.push(year);
          era.franchiseIds.add(team.franchiseId);
          if (!era.identities.has(team.name)) era.identities.set(team.name, []);
          era.identities.get(team.name).push(year);
          era.totals.wins += team.wins;
          era.totals.losses += team.losses;
          era.totals.ties += team.ties;
          era.totals.pointsFor += team.pointsFor;
          era.totals.pointsAgainst += team.pointsAgainst ?? 0;
          if (team.interDivision) mergeRecord(era.interDivision, team.interDivision);
          if (team.wonDivision) era.divisionTitles += 1;
          if (team.playoffResult === 'champion') era.championships += 1;
          if (team.playoffResult !== 'missed') era.playoffBerths += 1;
          if (team.shared) era.sharedSeasons += 1;
        }
      }
    }
  }

  if (problems.length) {
    throw new Error(
      `[division-strength] ${slug} integrity check failed:\n  - ${problems.slice(0, 12).join('\n  - ')}` +
        (problems.length > 12 ? `\n  … and ${problems.length - 12} more` : '')
    );
  }

  // The latest season anyone actually PLAYED. Used for the active/retired flag:
  // an unplayed season carries an alignment but no record, so keying "active"
  // off the calendar's newest year would mark every division active forever.
  const latestPlayedYear = yearPayloads.filter((y) => y.divisions.length).at(-1)?.year ?? null;
  const latestAlignmentYear = years.at(-1) ?? null;

  const divisions = [...allTime.values()]
    .map((d) => {
      const rankedYears = [...d.rankedYears].sort((a, b) => a.year - b.year);
      const avgFinish = rankedYears.length
        ? round3(rankedYears.reduce((s, r) => s + r.rank, 0) / rankedYears.length)
        : null;
      // Era-normalized: the AFL ran six divisions through 2012 and four since,
      // so a raw rank average would silently mix two different scales.
      const avgFinishPct = rankedYears.length
        ? round3(rankedYears.reduce((s, r) => s + r.pct, 0) / rankedYears.length)
        : null;
      const best = rankedYears.reduce((b, r) => (!b || r.pct > b.pct ? r : b), null);
      const worst = rankedYears.reduce((w, r) => (!w || r.pct < w.pct ? r : w), null);

      const owners = [...d.owners.values()]
        .map((era) => ({
          ownerId: era.ownerId,
          slug: era.slug,
          title: era.title,
          latestName: era.latestName,
          latestNameMedium: era.latestNameMedium,
          icon: era.icon,
          seasons: era.years.length,
          yearStart: Math.min(...era.years),
          yearEnd: Math.max(...era.years),
          stints: contiguousRuns(era.years),
          years: [...era.years].sort((a, b) => a - b),
          franchiseIds: [...era.franchiseIds].sort(),
          identities: [...era.identities.entries()]
            .map(([name, ys]) => ({ name, yearStart: Math.min(...ys), yearEnd: Math.max(...ys) }))
            .sort((a, b) => a.yearStart - b.yearStart),
          totals: finishRecord(era.totals),
          interDivision: finishRecord(era.interDivision),
          divisionTitles: era.divisionTitles,
          championships: era.championships,
          playoffBerths: era.playoffBerths,
          sharedSeasons: era.sharedSeasons,
        }))
        .sort(
          (a, b) =>
            b.seasons - a.seasons ||
            (b.totals.winPct ?? 0) - (a.totals.winPct ?? 0) ||
            a.yearStart - b.yearStart
        );

      /**
       * Membership eras — runs of consecutive seasons with the SAME set of
       * franchises in the division.
       *
       * A division name is only half its identity; the other half is who is in
       * it. "The Northwest" that has fielded the same four since 2016 and a
       * division reshuffled two years ago are not comparable things, even
       * under one name. Segmenting on the member set is what makes
       * "as currently constituted" a question the data can answer, and it is
       * the only slice where two divisions are being compared as the same
       * group of teams over their whole span.
       *
       * A run breaks on a membership CHANGE or on a gap year — the AFL's
       * Pacific ran 2003-2005 and again 2007-2012, and treating that as one
       * unbroken era would claim a season the division did not exist.
       */
      const rows = [...d.seasonRows].sort((a, b) => a.year - b.year);
      const eraGroups = [];
      for (const row of rows) {
        const last = eraGroups[eraGroups.length - 1];
        if (last && last.memberKey === row.memberKey && last.yearEnd === row.year - 1) {
          last.yearEnd = row.year;
          last.rows.push(row);
        } else {
          eraGroups.push({ memberKey: row.memberKey, yearStart: row.year, yearEnd: row.year, rows: [row] });
        }
      }

      const membershipEras = eraGroups.map((group) => {
        const totals = emptyRecord();
        const inter = emptyRecord();
        let titles = 0;
        let champs = 0;
        let berths = 0;
        let ranked = 0;
        let pctSum = 0;
        for (const row of group.rows) {
          totals.wins += row.totals.wins;
          totals.losses += row.totals.losses;
          totals.ties += row.totals.ties;
          totals.pointsFor += row.totals.pointsFor;
          totals.pointsAgainst += row.totals.pointsAgainst;
          if (row.interDivision) mergeRecord(inter, row.interDivision);
          titles += row.divisionTitles;
          champs += row.championships;
          berths += row.playoffBerths;
          if (row.rank !== null) {
            ranked += 1;
            pctSum += finishPercentile(row.rank, row.of);
          }
        }
        // Identities come from the era's LAST season, so a lineup that is still
        // together is described by the names those franchises wear now.
        const lastRow = group.rows[group.rows.length - 1];
        return {
          yearStart: group.yearStart,
          yearEnd: group.yearEnd,
          seasons: group.rows.length,
          current: latestPlayedYear !== null && group.yearEnd === latestPlayedYear,
          franchiseIds: lastRow.franchiseIds,
          members: lastRow.teams.map((t) => ({
            franchiseId: t.franchiseId,
            name: t.name,
            nameMedium: t.nameMedium,
            icon: t.icon,
            owners: t.owners,
          })),
          totals: finishRecord(totals),
          interDivision: finishRecord(inter),
          avgFinishPct: ranked ? round3(pctSum / ranked) : null,
          divisionTitles: titles,
          championships: champs,
          playoffBerths: berths,
        };
      });

      const yearList = [...new Set(d.years)].sort((a, b) => a - b);
      return {
        membershipEras,
        currentEra: membershipEras.find((era) => era.current) ?? null,
        name: d.name,
        slug: d.slug,
        divisionIds: [...d.divisionIds].sort(),
        years: yearList,
        eras: contiguousRuns(yearList),
        firstYear: yearList[0],
        lastYear: yearList.at(-1),
        seasons: yearList.length,
        active: latestPlayedYear !== null && yearList.includes(latestPlayedYear),
        teamSeasons: d.teamSeasons,
        avgFinish,
        avgFinishPct,
        bestYear: best,
        worstYear: worst,
        rankedYears,
        totals: finishRecord(d.totals),
        interDivision: finishRecord(d.interDivision),
        intraDivision: finishRecord(d.intraDivision),
        vs: Object.fromEntries(
          [...d.vs].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => [k, finishRecord(v)])
        ),
        playoffBerths: d.playoffBerths,
        divisionTitles: d.divisionTitles,
        championships: d.championships,
        runnerUps: d.runnerUps,
        thirdPlaces: d.thirdPlaces,
        owners,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  // ── The upcoming alignment ───────────────────────────────────────────────
  //
  // Records must come from PLAYED seasons; "who is in this division" must not.
  // Between the last played season and the next kickoff, teams move and
  // franchises change hands — TheLeague's 0004 passed from Heavy Chevy to Dead
  // Cap Walking for 2026 — and a report whose "as currently constituted" table
  // is keyed off the last PLAYED year states last season's lineup as today's.
  // That is not a missing nicety, it is the table being wrong about the one
  // thing its heading promises.
  //
  // So membership and holdings are read from the LATEST season on file whether
  // or not it has been played, and every difference from the last played season
  // is called out rather than silently folded in.
  const buildUpcoming = () => {
    if (latestAlignmentYear === null || latestAlignmentYear === latestPlayedYear) return null;
    const rows = rowsByYear.get(latestAlignmentYear) ?? [];
    if (!rows.length) return null;

    const playedRows = latestPlayedYear === null ? [] : (rowsByYear.get(latestPlayedYear) ?? []);
    const prevDivisionOf = new Map(playedRows.map((r) => [r.franchiseId, r.divisionName]));
    const holdersFor = (year, fid) => ownersBySeason.get(`${year}|${fid}`) ?? [];

    const byDivision = new Map();
    for (const row of rows) {
      if (!row.divisionName) continue;
      if (!byDivision.has(row.divisionName)) byDivision.set(row.divisionName, []);
      const holders = holdersFor(latestAlignmentYear, row.franchiseId);
      const prevHolders = latestPlayedYear === null ? [] : holdersFor(latestPlayedYear, row.franchiseId);
      const prevIds = new Set(prevHolders.map((h) => h.ownerId));
      // A NEW owner is one holding the slot now who did not hold it in the last
      // played season. A slot that merely RENAMED keeps its ownerId and is not
      // flagged — the rename is already visible in the name, and calling it an
      // ownership change would be wrong.
      const incoming = holders.filter((h) => !prevIds.has(h.ownerId));
      const previousDivision = prevDivisionOf.get(row.franchiseId) ?? null;
      byDivision.get(row.divisionName).push({
        franchiseId: row.franchiseId,
        name: row.name,
        nameMedium: row.nameMedium,
        icon: row.icon,
        owners: holders.map((h) => ({ ownerId: h.ownerId, slug: h.slug, title: h.title, latestName: h.latestName, latestNameMedium: h.latestNameMedium, icon: h.icon })),
        newOwner: prevHolders.length > 0 && incoming.length > 0,
        newOwners: incoming.map((h) => ({ ownerId: h.ownerId, slug: h.slug, title: h.title, latestName: h.latestName, latestNameMedium: h.latestNameMedium, icon: h.icon })),
        previousOwners: prevHolders.map((h) => ({ ownerId: h.ownerId, slug: h.slug, title: h.title, latestName: h.latestName, latestNameMedium: h.latestNameMedium })),
        previousDivision,
        movedDivision: previousDivision !== null && previousDivision !== row.divisionName,
      });
    }

    // A division the realignment DISSOLVED has no row in the new alignment, so
    // keying only off `byDivision` would drop it entirely: its departures would
    // never be listed and `anyChange` could stay false while a whole division
    // disappeared. Seed it with an empty member list so it reports as dissolved.
    // Both leagues have retired divisions (Atlantic, Midwest, Pacific), so this
    // is a shape this data genuinely takes — it just has not landed on an
    // alignment boundary yet.
    for (const row of playedRows) {
      if (row.divisionName && !byDivision.has(row.divisionName)) byDivision.set(row.divisionName, []);
    }

    const divisionsOut = [...byDivision.entries()]
      .map(([name, members]) => {
        members.sort((a, b) => a.franchiseId.localeCompare(b.franchiseId));
        const prevMembers = new Set(
          playedRows.filter((r) => r.divisionName === name).map((r) => r.franchiseId)
        );
        const arrivals = members.filter((m) => !prevMembers.has(m.franchiseId));
        const departures = playedRows
          .filter((r) => r.divisionName === name && !members.some((m) => m.franchiseId === r.franchiseId))
          .map((r) => ({ franchiseId: r.franchiseId, name: r.name, icon: r.icon }));
        const newOwners = members.filter((m) => m.newOwner);
        return {
          name,
          slug: divisionSlug(name),
          members,
          arrivals,
          departures,
          newOwners,
          // True when the lineup AND every holding are unchanged, so the
          // membership era's record still describes this exact group.
          unchanged: arrivals.length === 0 && departures.length === 0 && newOwners.length === 0,
          isNewDivision: !allTime.has(name),
          /** Existed last played season, absent from the new alignment. */
          dissolved: members.length === 0,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));

    return {
      year: latestAlignmentYear,
      previousPlayedYear: latestPlayedYear,
      divisions: divisionsOut,
      totalNewOwners: divisionsOut.reduce((n, d) => n + d.newOwners.length, 0),
      totalMoves: divisionsOut.reduce((n, d) => n + d.arrivals.length, 0),
      anyChange: divisionsOut.some((d) => !d.unchanged),
    };
  };
  const upcoming = buildUpcoming();

  return {
    generatedAt: new Date().toISOString(),
    upcoming,
    league: slug,
    leagueName: league.name,
    yearsCovered: years,
    yearsWithGameLog: yearPayloads.filter((y) => y.gamesResolved).map((y) => y.year),
    yearsWithoutGameLog: yearPayloads.filter((y) => !y.gamesResolved).map((y) => y.year),
    latestPlayedYear,
    /**
     * Deliberately carries NO "strongest / weakest of all time". Raw all-time
     * interdivisional win% favors short-lived divisions — the AFL's Atlantic
     * existed for a single season at .556 and would top any such list — and
     * era-normalized average finish disagrees with it. The page presents both
     * metrics side by side and makes no verdict; only the per-season
     * `strongest`/`weakest` above are claims, and one season is a fair sample
     * of itself. Do not add a headline field here without re-deciding that.
     */
    summary: {
      divisionCount: divisions.length,
      activeDivisions: divisions.filter((d) => d.active).map((d) => d.name),
      retiredDivisions: divisions.filter((d) => !d.active).map((d) => d.name),
      // "Latest season on file, PLAYED OR NOT" — so it cannot read from the
      // year payload, whose divisions are built from played rows only and are
      // empty for a season that has not kicked off. That shipped
      // `currentAlignment: []` alongside `latestAlignmentYear: 2026`, a field
      // stating the opposite of its own contract. `upcoming` is the alignment
      // when there is one; the played year's payload is right the rest of the
      // time (in-season, when nothing is pending).
      currentAlignment: (upcoming
        ? upcoming.divisions.map((d) => d.name)
        : (yearPayloads.find((y) => y.year === latestAlignmentYear)?.divisions ?? []).map(
            (d) => d.name
          )
      ).sort((a, b) => a.localeCompare(b)),
      latestAlignmentYear,
    },
    divisions,
    years: yearPayloads,
  };
}

async function runLeague(slug, opts) {
  const league = LEAGUES[slug];
  const payload = buildLeague(slug);
  if (!payload) {
    console.log(`  [${slug}] no season-ledger.json — skipping (not an error)`);
    return null;
  }
  const out = path.join(ROOT, league.dataPath, 'derived', 'division-strength.json');
  const summary =
    `${payload.divisions.length} divisions (${payload.summary.activeDivisions.length} active, ` +
    `${payload.summary.retiredDivisions.length} retired) across ${payload.yearsCovered.length} seasons` +
    (payload.yearsWithoutGameLog.length
      ? `; no game log for ${payload.yearsWithoutGameLog.join(', ')}`
      : '');

  if (opts.dryRun) {
    console.log(`  [${slug}] dry-run — would write ${path.relative(ROOT, out)}: ${summary}`);
    return payload;
  }
  const wrote = writeJsonIfChanged(out, payload, { ignoreKeys: ['generatedAt'] });
  console.log(`  [${slug}] ${wrote ? 'wrote' : 'unchanged'} ${path.relative(ROOT, out)}: ${summary}`);
  return payload;
}

async function main() {
  const opts = parseArgs();
  const slugs = opts.league ? [opts.league] : LEAGUE_SLUGS;
  console.log(`\n🏟️  Division strength — ${slugs.join(', ')}\n`);
  // Leagues touch disjoint files — run them concurrently.
  await Promise.all(slugs.map((slug) => runLeague(slug, opts)));
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((err) => {
    console.error('Error:', err.message);
    process.exit(1);
  });
}

export { buildLeague };
