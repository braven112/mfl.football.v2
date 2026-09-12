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
