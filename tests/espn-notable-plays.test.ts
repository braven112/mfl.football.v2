/**
 * Big plays: the reveal trigger that is NOT a score.
 *
 * The broadcast board interrupts itself for a 40+ yard gain or a takeaway, and
 * neither is in `parseScoringPlays` — it skips everything with
 * `scoringPlay !== true`. So the board reads the SAME already-fetched plays
 * page a second way, and this file pins what that second read may and may not
 * put on a 65-inch screen.
 *
 * The fixture is real (WAS@GB, recorded 2026-09-12 from the core plays API)
 * and was chosen for its traps, not its highlights: it carries a 58-yard and a
 * 48-yard MISSED field goal and two long kickoff returns, all of which clear a
 * naive 40-yard threshold and none of which is a big play.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BIG_PLAY_YARDS,
  isNotablePlay,
  isTwoPointConversion,
  parseNotablePlays,
  parseScoringPlays,
} from '../src/utils/espn-game-detail';

const plays = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/espn-game-plays-notable.json'), 'utf8'),
);

const itemsWhere = (pred: (i: any) => boolean) => plays.items.filter(pred);
const textOf = (p: { text: string }) => p.text;

describe('parseNotablePlays — the type allowlist, not the yardage alone', () => {
  it('never treats a long MISSED field goal as a big play', () => {
    const missed = itemsWhere((i: any) => /Field Goal Missed/i.test(i.type?.text ?? ''));
    // The fixture exists to carry these: 58 and 48 yards, both over the bar.
    expect(missed.length).toBeGreaterThan(0);
    expect(missed.every((i: any) => Number(i.statYardage) >= BIG_PLAY_YARDS)).toBe(true);

    for (const item of missed) expect(isNotablePlay(item)).toBe(false);

    const parsed = parseNotablePlays(plays);
    expect(parsed.map(textOf).join(' | ')).not.toMatch(/Missed/i);
  });

  it('never treats a long kickoff return as a big play', () => {
    const returns = itemsWhere((i: any) => /Kickoff/i.test(i.type?.text ?? ''));
    expect(returns.length).toBeGreaterThan(0);
    for (const item of returns) expect(isNotablePlay(item)).toBe(false);

    expect(parseNotablePlays(plays).map(textOf).join(' | ')).not.toMatch(/Kickoff/i);
  });

  it('surfaces a long gain from scrimmage', () => {
    const parsed = parseNotablePlays(plays);
    const long = parsed.find((p) => /57 Yds/.test(p.text));
    expect(long).toBeDefined();
    expect(long!.yards).toBe(57);
    expect(long!.scoreValue).toBe(0);
  });

  it('leaves a gain UNDER the threshold alone', () => {
    // 37 yards: a real reception, genuinely good, and not worth taking the
    // screen away from the scoreboard for.
    const parsed = parseNotablePlays(plays);
    expect(parsed.map(textOf).join(' | ')).not.toMatch(/37 Yds/);
  });

  it('does not re-emit scoring plays — those have their own parse', () => {
    const notable = parseNotablePlays(plays);
    const scoring = parseScoringPlays(plays);
    expect(scoring.length).toBeGreaterThan(0);

    const scoringIds = new Set(scoring.map((p) => p.playId));
    for (const p of notable) expect(scoringIds.has(p.playId)).toBe(false);
  });

  it('counts a takeaway at any yardage, but only on a turnover type', () => {
    const pick = {
      id: '401772936999',
      sequenceNumber: '9990',
      type: { text: 'Interception Return', abbreviation: 'INT' },
      shortText: 'Derwin James 0 Yd Interception Return',
      period: { number: 2 },
      clock: { displayValue: '4:20' },
      scoringPlay: false,
      statYardage: 0,
      isTurnover: true,
      participants: [],
    };
    expect(isNotablePlay(pick)).toBe(true);

    // The same flag on a type that is not a takeaway is not one. ESPN sets
    // `isTurnover` on a turnover on downs too, and a 4th-and-2 stop is not a
    // play this board wakes up for.
    expect(isNotablePlay({ ...pick, type: { text: 'Punt' }, isTurnover: true })).toBe(false);
  });

  it('ignores ESPN `priority` — it is false on every play, not a notability flag', () => {
    expect(plays.items.every((i: any) => i.priority !== true)).toBe(true);
  });
});

describe('isTwoPointConversion', () => {
  it('reads the conversion off the TOUCHDOWN play, not a play of its own', () => {
    const twoPointers = plays.items.filter((i: any) => isTwoPointConversion(i));
    expect(twoPointers.length).toBeGreaterThan(0);
    expect(String(twoPointers[0].pointAfterAttempt.text)).toMatch(/^Two Point/i);

    // There is no standalone two-point play to find — a board that looks for
    // one silently never fires this trigger.
    const standalone = plays.items.filter((i: any) => /two point/i.test(i.type?.text ?? ''));
    expect(standalone).toHaveLength(0);
  });

  it('does not fire on a normal extra point', () => {
    const kicks = plays.items.filter((i: any) =>
      /Extra Point Good/i.test(i.pointAfterAttempt?.text ?? ''),
    );
    expect(kicks.length).toBeGreaterThan(0);
    for (const k of kicks) expect(isTwoPointConversion(k)).toBe(false);
  });
});

describe('only play-appropriate participants are credited', () => {
  // ESPN lists everyone INVOLVED, not everyone credited. Read these three
  // together and the trap is `kicker`:
  //
  //   Field Goal Good    kicker, scorer, snapper, holder
  //   Rushing Touchdown  rusher, scorer, kicker, patScorer
  //   Kickoff            kicker, returner, tackler, penalized, other
  //
  // On the field goal the kicker IS the scorer; on the kickoff he is the OTHER
  // team's placekicker, credited on a return he was trying to prevent.
  const roleOf = (item: any, type: string) =>
    (item.participants ?? []).find((p: any) => p.type === type);
  const athleteId = (p: any) =>
    String(p?.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1] ?? '';

  const allPlays = [
    ...JSON.parse(
      readFileSync(join(process.cwd(), 'tests/fixtures/espn-game-plays.json'), 'utf8'),
    ).items,
    ...plays.items,
  ];

  it('never credits a kickoff to the KICKING team’s placekicker', () => {
    const kickoffs = allPlays.filter((i: any) => /^Kickoff$/i.test(i.type?.text ?? ''));
    expect(kickoffs.length).toBeGreaterThan(0);

    for (const item of kickoffs) {
      const kicker = roleOf(item, 'kicker');
      if (!kicker) continue;
      const parsed = parseNotablePlays({ items: [item] });
      for (const p of parsed) expect(p.espnAthleteIds).not.toContain(athleteId(kicker));
    }
  });

  it('still credits a field goal to its kicker — via `scorer`', () => {
    const fgs = allPlays.filter((i: any) => /Field Goal Good/i.test(i.type?.text ?? ''));
    expect(fgs.length).toBeGreaterThan(0);

    for (const item of fgs) {
      const scorer = roleOf(item, 'scorer');
      if (!scorer) continue;
      const parsed = parseScoringPlays({ items: [item] });
      expect(parsed[0].espnAthleteIds).toContain(athleteId(scorer));
    }
  });

  it('drops the snapper and the holder from a field goal', () => {
    const fgs = allPlays.filter((i: any) => /Field Goal Good/i.test(i.type?.text ?? ''));
    for (const item of fgs) {
      const parsed = parseScoringPlays({ items: [item] });
      for (const role of ['snapper', 'holder']) {
        const p = roleOf(item, role);
        if (p) expect(parsed[0].espnAthleteIds).not.toContain(athleteId(p));
      }
    }
  });

  it('drops the tackler, the penalized player and `other` everywhere', () => {
    for (const item of allPlays) {
      const parsed = [
        ...parseScoringPlays({ items: [item] }),
        ...parseNotablePlays({ items: [item] }),
      ];
      if (parsed.length === 0) continue;
      for (const role of ['tackler', 'penalized', 'other']) {
        const p = roleOf(item, role);
        if (!p) continue;
        for (const q of parsed) expect(q.espnAthleteIds).not.toContain(athleteId(p));
      }
    }
  });

  it('credits the rusher on a rushing touchdown, not the extra-point kicker', () => {
    const tds = allPlays.filter((i: any) => /Rushing Touchdown/i.test(i.type?.text ?? ''));
    expect(tds.length).toBeGreaterThan(0);

    for (const item of tds) {
      const parsed = parseScoringPlays({ items: [item] });
      const rusher = roleOf(item, 'rusher');
      const pat = roleOf(item, 'patScorer');
      if (rusher) expect(parsed[0].espnAthleteIds).toContain(athleteId(rusher));
      // A full-screen TOUCHDOWN takeover naming your kicker, for someone
      // else's touchdown, is the wrong framing for one extra point.
      if (pat) expect(parsed[0].espnAthleteIds).not.toContain(athleteId(pat));
    }
  });

  it('falls back to every participant only when NONE carries a type', () => {
    const untyped = {
      items: [{
        id: '401772510999',
        scoringPlay: true,
        sequenceNumber: 1,
        type: { text: 'Rushing Touchdown', abbreviation: 'TD' },
        participants: [
          { athlete: { $ref: 'https://x/athletes/4361307?lang=en' }, order: 1 },
        ],
      }],
    };
    // Crediting nobody would silently delete the reveal; this narrow fallback
    // restores the old behaviour for exactly the "we cannot tell" case.
    expect(parseScoringPlays(untyped)[0].espnAthleteIds).toEqual(['4361307']);
  });
});

describe('a turnover credits the side that TOOK the ball, never the side that lost it', () => {
  // Recorded from four real games because no fixture in the repo carried a
  // single turnover — so the role split and the DEF join had nothing to assert
  // against, and both are the kind of join that resolves the WRONG person
  // rather than failing.
  const turnovers = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/espn-game-plays-turnovers.json'), 'utf8'),
  );
  const roleOf = (item: any, type: string) =>
    (item.participants ?? []).find((p: any) => p.type === type);
  const athleteId = (p: any) =>
    String(p?.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1] ?? '';
  const parseBoth = (item: any) => [
    ...parseScoringPlays({ items: [item] }),
    ...parseNotablePlays({ items: [item] }),
  ];

  const actualTurnovers = turnovers.items.filter((i: any) => i.isTurnover === true);

  it('has real turnovers to assert against', () => {
    expect(actualTurnovers.length).toBeGreaterThanOrEqual(8);
  });

  it('never credits the quarterback who threw the interception', () => {
    const picks = actualTurnovers.filter((i: any) => /Interception/i.test(i.type?.text ?? ''));
    expect(picks.length).toBeGreaterThan(0);
    for (const item of picks) {
      const passer = roleOf(item, 'passer');
      if (!passer) continue;
      for (const p of parseBoth(item)) {
        expect(p.espnAthleteIds).not.toContain(athleteId(passer));
      }
    }
  });

  it('never credits the receiver who fumbled it away', () => {
    for (const item of actualTurnovers) {
      for (const role of ['receiver', 'rusher', 'fumbler']) {
        const p = roleOf(item, role);
        if (!p) continue;
        for (const q of parseBoth(item)) {
          expect(q.espnAthleteIds).not.toContain(athleteId(p));
        }
      }
    }
  });

  it('does credit the defender who returned it', () => {
    const returns = actualTurnovers.filter((i: any) => roleOf(i, 'returner'));
    expect(returns.length).toBeGreaterThan(0);
    for (const item of returns) {
      const parsed = parseBoth(item);
      if (parsed.length === 0) continue;
      const returner = roleOf(item, 'returner');
      expect(parsed.some((p) => p.espnAthleteIds.includes(athleteId(returner)))).toBe(true);
    }
  });

  it('leaves an OWN fumble recovery on the offense — it is not a turnover', () => {
    const own = turnovers.items.filter((i: any) => /Fumble Recovery \(Own\)/i.test(i.type?.text ?? ''));
    expect(own.length).toBeGreaterThan(0);
    // ESPN sets isTurnover exactly when possession changed, so the team that
    // fell on its own fumble keeps the ordinary offensive credit.
    for (const item of own) expect(item.isTurnover).not.toBe(true);
  });

  it('attributes every turnover to the team that ENDED with the ball', () => {
    // This is the join the DEF-unit reveal rests on: `item.team` is the
    // defense on a turnover, so the play's NFL team is the club whose team
    // defense scored it. Backwards, it would credit the opposing DEF — and
    // read as perfectly plausible on screen.
    const teamId = (ref: string) => String(ref ?? '').match(/teams\/(\d+)/)?.[1] ?? '';
    for (const item of actualTurnovers) {
      expect(teamId(item.team?.$ref)).toBe(teamId(item.end?.team?.$ref));
      expect(teamId(item.start?.team?.$ref)).not.toBe(teamId(item.end?.team?.$ref));
    }
  });
});

describe('a safety is the defense’s too, and ESPN does not flag it', () => {
  const turnovers = JSON.parse(
    readFileSync(join(process.cwd(), 'tests/fixtures/espn-game-plays-turnovers.json'), 'utf8'),
  );
  const safeties = turnovers.items.filter((i: any) => /\bsafety\b/i.test(i.type?.text ?? ''));
  const roleOf = (item: any, type: string) =>
    (item.participants ?? []).find((p: any) => p.type === type);
  const athleteId = (p: any) =>
    String(p?.athlete?.$ref ?? '').match(/athletes\/(\d+)/)?.[1] ?? '';
  const teamId = (ref: string) => String(ref ?? '').match(/teams\/(\d+)/)?.[1] ?? '';

  it('has real safeties to assert against', () => {
    expect(safeties.length).toBeGreaterThanOrEqual(2);
  });

  it('is NOT a turnover — so it has to be named separately', () => {
    // The whole reason this needs its own branch: gating the defensive-credit
    // rules on `isTurnover` alone silently excludes every safety.
    for (const item of safeties) expect(item.isTurnover).not.toBe(true);
  });

  it('still attributes the play to the SCORING side', () => {
    for (const item of safeties) {
      expect(teamId(item.team?.$ref)).toBe(teamId(item.end?.team?.$ref));
      expect(teamId(item.start?.team?.$ref)).not.toBe(teamId(item.end?.team?.$ref));
    }
  });

  it('never credits the quarterback who gave up the safety', () => {
    // One recorded safety is "Penalty Dillon Gabriel Intentional Grounding for
    // Safety", roles `passer, penalized`. Under the ordinary allowlist that is
    // a full-screen SAFETY takeover on the screen of the owner who started him.
    for (const item of safeties) {
      const parsed = parseScoringPlays({ items: [item] });
      if (parsed.length === 0) continue;
      for (const role of ['passer', 'rusher', 'receiver', 'fumbler', 'penalized']) {
        const p = roleOf(item, role);
        if (!p) continue;
        expect(parsed[0].espnAthleteIds).not.toContain(athleteId(p));
      }
    }
  });
});
