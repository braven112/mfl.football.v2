/**
 * ESPN game-detail parser tests.
 *
 * These run against COMMITTED fixtures (tests/fixtures/espn-*.json), captured
 * live from ESPN on 2026-08-20, because ESPN's hosts are intermittently 403
 * from the dev sandbox and CI has no network at all. Every assertion here is
 * about the parsers' BEHAVIOR on a real payload — not about the source text —
 * so deleting a guard makes a case fail rather than leaving greps green.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildPlaysUrl,
  buildSummaryUrl,
  buildTeamCodesById,
  canonicalNflCode,
  DEF_STAT_LINE,
  formatStatLine,
  parseBoxScore,
  parseGameSituation,
  parseIdFromRef,
  parseScoringPlays,
  parseClockSeconds,
  comparePlaysChronologically,
  type EspnBoxScoreLine,
} from '../src/utils/espn-game-detail';

const fixture = (name: string) =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests/fixtures', name), 'utf-8'));

const SUMMARY = fixture('espn-game-summary.json');
const PLAYS = fixture('espn-game-plays.json');
const SCOREBOARD = fixture('espn-nfl-scoreboard.json');
const SCOREBOARD_LIVE = fixture('espn-nfl-scoreboard-live.json');

describe('canonicalNflCode', () => {
  it('round-trips ESPN codes back to the app-canonical form', () => {
    // The two normalizers pull in opposite directions; composing them must be
    // idempotent on ESPN's own spellings or the box-score join silently misses
    // Washington and Jacksonville.
    expect(canonicalNflCode('WSH')).toBe('WSH');
    expect(canonicalNflCode('JAX')).toBe('JAX');
    expect(canonicalNflCode('KC')).toBe('KC');
  });

  it('folds MFL and legacy spellings onto the same canonical code', () => {
    expect(canonicalNflCode('WAS')).toBe('WSH');
    expect(canonicalNflCode('JAC')).toBe('JAX');
    expect(canonicalNflCode('OAK')).toBe('LV');
    expect(canonicalNflCode('STL')).toBe('LAR');
    expect(canonicalNflCode('sdc')).toBe('LAC');
  });

  it('returns empty for missing input rather than throwing', () => {
    expect(canonicalNflCode('')).toBe('');
    expect(canonicalNflCode(null)).toBe('');
    expect(canonicalNflCode(undefined)).toBe('');
  });
});

describe('URL builders reject anything that is not a plain ESPN id', () => {
  it('builds real URLs for numeric ids', () => {
    expect(buildSummaryUrl('401772510')).toContain('summary?event=401772510');
    expect(buildPlaysUrl('401772510', '401772510')).toContain(
      '/events/401772510/competitions/401772510/plays?limit=',
    );
  });

  it('refuses path traversal, full URLs and non-digits', () => {
    for (const bad of ['../../secrets', 'https://evil.example/x', '1;2', '', '  ', null, 12345]) {
      expect(buildSummaryUrl(bad as unknown)).toBeNull();
      expect(buildPlaysUrl(bad as unknown, '401772510')).toBeNull();
      expect(buildPlaysUrl('401772510', bad as unknown)).toBeNull();
    }
  });

  it('clamps an out-of-range plays limit instead of forwarding it', () => {
    expect(buildPlaysUrl('1', '1', 99999)).toContain('limit=300');
    expect(buildPlaysUrl('1', '1', -5)).toContain('limit=300');
    expect(buildPlaysUrl('1', '1', 50)).toContain('limit=50');
  });
});

describe('parseIdFromRef', () => {
  it('pulls the athlete id out of a core-API $ref', () => {
    expect(
      parseIdFromRef(
        'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/athletes/4361579?lang=en&region=us',
        'athletes',
      ),
    ).toBe('4361579');
  });

  it('pulls the team id, not the season year, out of a team $ref', () => {
    expect(
      parseIdFromRef(
        'http://sports.core.api.espn.com/v2/sports/football/leagues/nfl/seasons/2025/teams/6?lang=en&region=us',
        'teams',
      ),
    ).toBe('6');
  });

  it('returns null for a missing segment, a non-numeric id, or a non-string', () => {
    expect(parseIdFromRef('.../athletes/abc', 'athletes')).toBeNull();
    expect(parseIdFromRef('.../teams/6', 'athletes')).toBeNull();
    expect(parseIdFromRef(undefined, 'athletes')).toBeNull();
    expect(parseIdFromRef({ $ref: 'x' } as unknown, 'athletes')).toBeNull();
  });
});

describe('parseGameSituation', () => {
  const liveComp = (i: number) => SCOREBOARD_LIVE.events[i].competitions[0];

  it('returns null when the game has no situation (pre-kickoff / final)', () => {
    // Every event in the real captured scoreboard is final, so none carry a
    // situation. That is the normal shape, not a parse failure.
    for (const event of SCOREBOARD.events) {
      expect(parseGameSituation(event.competitions[0])).toBeNull();
    }
    expect(parseGameSituation(undefined)).toBeNull();
    expect(parseGameSituation({})).toBeNull();
  });

  it('resolves possession from the numeric team id, not an abbreviation', () => {
    const s = parseGameSituation(liveComp(0))!;
    // ESPN reports possession as team id "12"; the competitor with that id is KC.
    expect(s.possession).toBe('KC');
    expect(s.isRedZone).toBe(true);
    expect(s.downDistanceText).toBe('1st & Goal at WSH 8');
    expect(s.shortDownDistanceText).toBe('1st & Goal');
    expect(s.lastPlay).toContain('T.Kelce');
  });

  it('canonicalizes the possessing team code', () => {
    // Team id 26 is Seattle here; the point is that a WSH/JAX possession would
    // come back in the same spelling PlayerMeta.nflTeam uses.
    const s = parseGameSituation(liveComp(1))!;
    expect(s.possession).toBe('SEA');
    expect(s.isRedZone).toBe(false);
  });

  it('degrades every optional field instead of throwing', () => {
    const s = parseGameSituation({ competitors: [], situation: {} })!;
    expect(s).toEqual({
      isRedZone: false,
      possession: '',
      downDistanceText: '',
      shortDownDistanceText: '',
      lastPlay: '',
    });
  });

  it('does not treat a core-API $ref lastPlay as displayable text', () => {
    const s = parseGameSituation({
      competitors: [],
      situation: { isRedZone: true, lastPlay: { $ref: 'http://example/plays/1' } },
    })!;
    expect(s.lastPlay).toBe('');
  });

  it('only reports the red zone on an explicit boolean true', () => {
    for (const raw of ['true', 1, 'yes', null, undefined]) {
      expect(parseGameSituation({ situation: { isRedZone: raw } })!.isRedZone).toBe(false);
    }
  });
});

describe('buildTeamCodesById', () => {
  it('maps every competitor team id in the payload to a canonical code', () => {
    const map = buildTeamCodesById(SCOREBOARD);
    expect(map.get('21')).toBe('PHI');
    expect(map.get('6')).toBe('DAL');
    expect(map.size).toBe(SCOREBOARD.events.length * 2);
  });

  it('is empty, not thrown, for a malformed payload', () => {
    expect(buildTeamCodesById(null).size).toBe(0);
    expect(buildTeamCodesById({ events: [{}] }).size).toBe(0);
  });
});

describe('parseBoxScore', () => {
  const lines = parseBoxScore(SUMMARY);
  const byId = new Map(lines.map((l) => [l.espnAthleteId, l]));

  it('produces one entry per athlete, merging his stat groups', () => {
    expect(lines.length).toBeGreaterThan(0);
    expect(new Set(lines.map((l) => l.espnAthleteId)).size).toBe(lines.length);
    // CeeDee Lamb: 7 rec, 110 yds, 13 targets in the captured game.
    const lamb = byId.get('4241389')!;
    expect(lamb.athleteName).toBe('CeeDee Lamb');
    expect(lamb.teamCode).toBe('DAL');
    const rec = lamb.groups.find((g) => g.name === 'receiving')!.stats;
    expect(rec.receptions).toBe('7');
    expect(rec.receivingYards).toBe('110');
    expect(rec.receivingTargets).toBe('13');
  });

  it('zips values against `keys`, never the display `labels`', () => {
    // labels collide across groups (passing YDS and rushing YDS are both
    // "YDS"), so a labels-keyed map would clobber one with the other.
    for (const line of lines) {
      for (const group of line.groups) {
        expect(Object.keys(group.stats).every((k) => k !== 'YDS' && k !== 'TD')).toBe(true);
      }
    }
  });

  it('skips rows with no athlete id, no stats, or a malformed id', () => {
    const junk = {
      boxscore: {
        players: [
          {
            team: { abbreviation: 'KC' },
            statistics: [
              {
                name: 'receiving',
                keys: ['receptions'],
                athletes: [
                  { athlete: { id: 'not-a-number', displayName: 'X' }, stats: ['1'] },
                  { athlete: { displayName: 'No Id' }, stats: ['1'] },
                  { athlete: { id: '1234', displayName: 'No Stats' }, stats: [] },
                  { athlete: { id: '5678', displayName: 'Good' }, stats: ['4'] },
                ],
              },
            ],
          },
        ],
      },
    };
    const parsed = parseBoxScore(junk);
    expect(parsed.map((l) => l.espnAthleteId)).toEqual(['5678']);
  });

  it('returns an empty list for a malformed payload rather than throwing', () => {
    expect(parseBoxScore(null)).toEqual([]);
    expect(parseBoxScore({ boxscore: {} })).toEqual([]);
  });

  it('carries no DEF/ST entry — the payload is athlete-keyed', () => {
    // Documents the deliberate gap; see DEF_STAT_LINE.
    expect(DEF_STAT_LINE).toBe('');
    expect(lines.every((l) => /^[A-Z]/.test(l.athleteName))).toBe(true);
  });
});

describe('formatStatLine', () => {
  const line = (groups: EspnBoxScoreLine['groups']): EspnBoxScoreLine => ({
    espnAthleteId: '1',
    athleteName: 'Test Player',
    teamCode: 'KC',
    groups,
  });

  it('formats a real QB line from the fixture', () => {
    const dak = parseBoxScore(SUMMARY).find((l) => l.athleteName === 'Dak Prescott')!;
    expect(formatStatLine(dak)).toMatch(/^\d+\/\d+, \d+ yds/);
  });

  it('reads made/attempted out of the slash-named key', () => {
    const out = formatStatLine(
      line([
        {
          name: 'passing',
          stats: {
            'completions/passingAttempts': '18/27',
            passingYards: '245',
            passingTouchdowns: '2',
            interceptions: '1',
          },
        },
      ]),
    );
    expect(out).toBe('18/27, 245 yds, 2 TD, 1 INT');
  });

  it('omits a zero touchdown / interception clause', () => {
    const out = formatStatLine(
      line([
        {
          name: 'passing',
          stats: {
            'completions/passingAttempts': '9/14',
            passingYards: '88',
            passingTouchdowns: '0',
            interceptions: '0',
          },
        },
      ]),
    );
    expect(out).toBe('9/14, 88 yds');
  });

  it('joins a dual-threat back’s rushing and receiving lines', () => {
    const out = formatStatLine(
      line([
        {
          name: 'rushing',
          stats: { rushingAttempts: '14', rushingYards: '78', rushingTouchdowns: '1' },
        },
        {
          name: 'receiving',
          stats: {
            receptions: '3',
            receivingYards: '22',
            receivingTouchdowns: '0',
            receivingTargets: '4',
          },
        },
      ]),
    );
    expect(out).toBe('14 car, 78 yds, 1 TD · 3 rec (4 tgt), 22 yds');
  });

  it('shows a target-only receiver (0 catches) rather than nothing', () => {
    const out = formatStatLine(
      line([
        {
          name: 'receiving',
          stats: { receptions: '0', receivingYards: '0', receivingTargets: '3' },
        },
      ]),
    );
    expect(out).toBe('0 rec (3 tgt), 0 yds');
  });

  it('formats a kicker from both slash-named kicking keys', () => {
    const out = formatStatLine(
      line([
        {
          name: 'kicking',
          stats: {
            'fieldGoalsMade/fieldGoalAttempts': '2/3',
            'extraPointsMade/extraPointAttempts': '3/3',
          },
        },
      ]),
    );
    expect(out).toBe('2/3 FG, 3/3 XP');
  });

  it('appends lost fumbles but ignores fumbles that were recovered', () => {
    const base = { name: 'rushing', stats: { rushingAttempts: '5', rushingYards: '20' } };
    expect(formatStatLine(line([base, { name: 'fumbles', stats: { fumbles: '1', fumblesLost: '0' } }])))
      .toBe('5 car, 20 yds');
    expect(formatStatLine(line([base, { name: 'fumbles', stats: { fumbles: '1', fumblesLost: '1' } }])))
      .toBe('5 car, 20 yds · 1 FUM lost');
  });

  it('returns EMPTY for a player who has not touched the ball', () => {
    // Empty string is the caller's "no stat line YET" signal, and it must be
    // distinguishable from a failed fetch — never render it as an error.
    expect(formatStatLine(line([]))).toBe('');
    expect(
      formatStatLine(
        line([{ name: 'rushing', stats: { rushingAttempts: '0', rushingYards: '0' } }]),
      ),
    ).toBe('');
    expect(
      formatStatLine(
        line([{ name: 'defensive', stats: { totalTackles: '6', sacks: '1' } }]),
      ),
    ).toBe('');
  });
});

describe('parseScoringPlays', () => {
  const codes = buildTeamCodesById(SCOREBOARD);
  const plays = parseScoringPlays(PLAYS, codes);

  it('keeps only scoring plays out of the mixed fixture', () => {
    expect(PLAYS.items.length).toBeGreaterThan(plays.length);
    expect(plays.length).toBe(PLAYS.items.filter((i: any) => i.scoringPlay).length);
  });

  it('attributes each play to an ESPN athlete id parsed from the $ref', () => {
    const td = plays.find((p) => p.text.includes('Javonte Williams'))!;
    expect(td.espnAthleteIds).toContain('4361579');
    expect(td.typeAbbrev).toBe('TD');
    expect(td.period).toBe(1);
    expect(td.clock).toBe('11:49');
    expect(td.teamCode).toBe('DAL');
  });

  it('dedupes an athlete credited in more than one participant role', () => {
    for (const p of plays) {
      expect(new Set(p.espnAthleteIds).size).toBe(p.espnAthleteIds.length);
    }
  });

  it('returns one game’s plays in chronological order', () => {
    const seqs = plays.map((p) => p.sequence);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
  });

  it('leaves teamCode empty rather than guessing when the id is unknown', () => {
    const unmapped = parseScoringPlays(PLAYS, new Map());
    expect(unmapped.length).toBe(plays.length);
    expect(unmapped.every((p) => p.teamCode === '')).toBe(true);
  });

  it('drops a play whose id is not a plain ESPN id', () => {
    const junk = {
      items: [
        { id: '../../etc', scoringPlay: true, participants: [] },
        { id: '999', scoringPlay: true, sequenceNumber: '1', participants: [] },
      ],
    };
    expect(parseScoringPlays(junk).map((p) => p.playId)).toEqual(['999']);
  });

  it('returns an empty list for a malformed payload', () => {
    expect(parseScoringPlays(null)).toEqual([]);
    expect(parseScoringPlays({ items: 'nope' })).toEqual([]);
  });
});

describe('parseClockSeconds', () => {
  it('reads a game clock', () => {
    expect(parseClockSeconds('11:49')).toBe(709);
    expect(parseClockSeconds('0:32')).toBe(32);
    expect(parseClockSeconds('15:00')).toBe(900);
  });
  it('returns null for anything it cannot read', () => {
    for (const bad of ['', 'Final', '1:2', '1:234', null, 709]) {
      expect(parseClockSeconds(bad as unknown)).toBeNull();
    }
  });
});

describe('comparePlaysChronologically', () => {
  const p = (period: number, clock: string, sequence = 0) => ({ period, clock, sequence });

  it('orders across DIFFERENT games by the shared game clock, not by sequence', () => {
    // `sequenceNumber` only orders plays within one game. Merging a 16-game
    // slate on it interleaved quarters into a timeline that was not one — a
    // fourth-quarter score landed between two third-quarter ones on screen.
    const slate = [
      p(4, '6:21', 900),
      p(3, '0:32', 100),
      p(4, '11:42', 50),
      p(3, '7:26', 990),
      p(4, '1:34', 10),
    ];
    expect(slate.sort(comparePlaysChronologically).map((x) => `Q${x.period} ${x.clock}`)).toEqual([
      'Q3 7:26',
      'Q3 0:32',
      'Q4 11:42',
      'Q4 6:21',
      'Q4 1:34',
    ]);
  });

  it('treats a LOWER clock as LATER within a period — the NFL clock counts down', () => {
    expect(comparePlaysChronologically(p(2, '10:00'), p(2, '2:00'))).toBeLessThan(0);
  });

  it('falls back to sequence when period and clock tie', () => {
    expect(comparePlaysChronologically(p(1, '5:00', 2), p(1, '5:00', 1))).toBeGreaterThan(0);
  });

  it('sorts an unreadable clock to the end of its period instead of the front', () => {
    const out = [p(1, ''), p(1, '9:00')].sort(comparePlaysChronologically);
    expect(out[0].clock).toBe('9:00');
  });
});
