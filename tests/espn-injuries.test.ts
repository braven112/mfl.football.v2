/**
 * Doc Rivers' ESPN injury parser, against a sample recorded 2026-11-16.
 *
 * Doc posted nothing for months because ESPN changed this response and the
 * old parser found no rows without throwing (scripts/lib/espn-injuries.mjs
 * has the shape history). These cases pin today's two shapes, the athlete id
 * that now lives only in a link, and the ESPN-id join to MFL.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  espnAthleteId,
  mflPlayersByEspnId,
  parseEspnInjuries,
} from '../scripts/lib/espn-injuries.mjs';

const sample = JSON.parse(readFileSync(new URL('./fixtures/espn-nfl-injuries.json', import.meta.url), 'utf8'));

describe('parseEspnInjuries — the league-wide response (teams → injuries)', () => {
  const parsed = parseEspnInjuries(sample.leagueWide);

  it('finds the injured players — the old parser found zero', () => {
    expect(parsed.size).toBeGreaterThan(0);
  });

  it('reads the athlete id out of the player-card link (ESPN no longer sends athlete.id)', () => {
    const raw = sample.leagueWide.injuries[0].injuries.find((e: any) => e.status === 'Questionable');
    expect(raw.athlete.id).toBeUndefined();
    const id = espnAthleteId(raw.athlete);
    expect(id).toMatch(/^\d+$/);
    expect(parsed.get(id!)).toMatchObject({
      name: raw.athlete.displayName,
      status: 'Questionable',
      nflTeam: 'ARI',
      position: raw.athlete.position.abbreviation,
      detail: 'Knee',
    });
  });

  it('drops Active rows — the report lists healthy players too', () => {
    for (const inj of parsed.values()) expect(inj.status).not.toBe('Active');
    const active = sample.leagueWide.injuries[0].injuries.find((e: any) => e.status === 'Active');
    expect(parsed.has(espnAthleteId(active.athlete)!)).toBe(false);
  });

  it('keeps Out and Injured Reserve rows', () => {
    const statuses = new Set([...parsed.values()].map((i) => i.status));
    expect(statuses.has('Out')).toBe(true);
    expect(statuses.has('Injured Reserve')).toBe(true);
  });

  it('never prints ESPN’s "Not Specified" placeholder as a detail', () => {
    for (const inj of parsed.values()) expect(inj.detail.toLowerCase()).not.toBe('not specified');
  });
});

describe('parseEspnInjuries — the per-team response (flat entries)', () => {
  it('reads a flat list with the club in data.team', () => {
    const parsed = parseEspnInjuries(sample.perTeam);
    expect([...parsed.values()].map((i) => i.status).sort()).toEqual(['Out', 'Questionable']);
    for (const inj of parsed.values()) expect(inj.nflTeam).toBe('KC');
  });
});

describe('parseEspnInjuries — the original grouped shape still parses', () => {
  it('reads injuries[].entries[] with athlete.id', () => {
    const parsed = parseEspnInjuries({
      team: { abbreviation: 'SEA' },
      injuries: [
        {
          entries: [
            { status: 'Out', athlete: { id: 123, displayName: 'A Player', position: { abbreviation: 'WR' } }, details: { type: 'Ankle' } },
          ],
        },
      ],
    });
    expect(parsed.get('123')).toMatchObject({ name: 'A Player', nflTeam: 'SEA', status: 'Out', detail: 'Ankle' });
  });

  it('returns an empty map for a response with no injuries', () => {
    expect(parseEspnInjuries({}).size).toBe(0);
    expect(parseEspnInjuries(null).size).toBe(0);
  });
});

describe('mflPlayersByEspnId — the join is on ESPN id, never on name', () => {
  it('keys MFL players by espn_id and skips players without one', () => {
    const map = mflPlayersByEspnId({
      players: {
        player: [
          { id: '16620', name: 'Worthy, Xavier', position: 'WR', team: 'KCC', espn_id: '4683062' },
          { id: '0151', name: 'Bills, Buffalo', position: 'TMWR', team: 'BUF' },
        ],
      },
    });
    expect(map.size).toBe(1);
    expect(map.get('4683062')).toMatchObject({ id: '16620', position: 'WR' });
  });
});
