import { describe, expect, it, vi } from 'vitest';
import {
  MOVE_STORY_VERSION,
  applyMoveStory,
  buildMovePrompt,
  factsFromRawMove,
  parseMoveStory,
  readableName,
  writeMoveStory,
} from '../scripts/lib/schefter-move-story.mjs';
import { parseRosterMove } from '../scripts/lib/roster-move-parse.mjs';
import { mergeFeed } from '../scripts/lib/merge-schefter-feed.mjs';
import { findRawRow } from '../scripts/schefter-backfill-move-stories.mjs';

const players = new Map([
  ['15001', { name: 'Johnson, Roschon', position: 'RB', nflTeam: 'CHI' }],
  ['15002', { name: 'Washington, Darnell', position: 'TE', nflTeam: 'PIT' }],
  ['15003', { name: 'Washington Jr., Mike', position: 'RB', nflTeam: 'LVR' }],
  ['0518', { name: 'Saints, New Orleans', position: 'Def', nflTeam: 'NOS' }],
]);
const teams = new Map([['0007', { name: 'Da Dangsters' }]]);
const ctx = { players, parseRosterMove, leagueName: 'AFL Fantasy', hasSalaries: false };

describe('move facts', () => {
  it('pairs the add with its drop and reads names the way a reader says them', () => {
    const facts = factsFromRawMove({ type: 'WAIVER', franchise: '0007', transaction: '15001,|15002,' }, ctx)!;
    expect(facts.added.map((p) => p.name)).toEqual(['Roschon Johnson']);
    expect(facts.dropped.map((p) => p.name)).toEqual(['Darnell Washington']);
    expect(facts.team).toBe('{{TEAM:0007}}');
    expect(readableName(players.get('0518')!)).toBe('the New Orleans Saints defense');
  });

  it('never hands the model a franchise name', () => {
    const facts = factsFromRawMove({ type: 'FREE_AGENT', franchise: '0007', transaction: '15001,|' }, ctx)!;
    const { system, user } = buildMovePrompt(facts);
    expect(`${system}\n${user}`).not.toContain('Da Dangsters');
    // The example's id must not be a live franchise, or a copied token resolves.
    expect(system).toContain('{{TEAM:9999}}');
  });

  it('prices only a real salary, and only in a salary league', () => {
    const bid = { type: 'BBID_WAIVER', franchise: '0007', transaction: '15001,|475000|15002,' };
    expect(factsFromRawMove(bid, { ...ctx, hasSalaries: true })!.price).toBe('$475K');
    expect(factsFromRawMove(bid, ctx)!.price).toBeNull();
    // An FCFS add carries no price: the model must not be the one to call it free.
    const fcfs = { type: 'FREE_AGENT', franchise: '0007', transaction: '15001,|' };
    expect(factsFromRawMove(fcfs, { ...ctx, hasSalaries: true })!.price).toBeNull();
  });

  it("reads the AFL's field-form WAIVER rows, which carry no transaction string", () => {
    const facts = factsFromRawMove({ type: 'WAIVER', franchise: '0007', added: '15001,', dropped: '15002,' }, ctx)!;
    expect(facts.added.map((p) => p.id)).toEqual(['15001']);
    expect(facts.dropped.map((p) => p.id)).toEqual(['15002']);
  });

  it('declines a move with a player it cannot name', () => {
    expect(factsFromRawMove({ type: 'FREE_AGENT', franchise: '0007', transaction: '99999,|' }, ctx)).toBeNull();
  });
});

describe('parsing the model reply', () => {
  const facts = factsFromRawMove({ type: 'WAIVER', franchise: '0007', transaction: '15003,|15002,' }, ctx)!;

  it('resolves the team token in code', () => {
    const story = parseMoveStory(
      JSON.stringify({
        headline: '{{TEAM:0007}} claim Mike Washington Jr.',
        body: "I'm told {{TEAM:0007}} put in for Mike Washington Jr. and let Darnell Washington walk.",
      }),
      facts,
      teams,
    );
    expect(story?.headline).toBe('Da Dangsters claim Mike Washington Jr.');
  });

  it('fails on any surviving token, including the copied example id', () => {
    const reply = (headline: string) => JSON.stringify({ headline, body: 'Mike Washington Jr. heads over in a depth move.' });
    expect(parseMoveStory(reply('{{TEAM:9999}} claim Mike Washington Jr.'), facts, teams)).toBeNull();
    expect(parseMoveStory(reply('{{TEAM_NICKNAME}} claim Mike Washington Jr.'), facts, teams)).toBeNull();
  });

  it('fails when the story is about someone else', () => {
    const reply = JSON.stringify({ headline: '{{TEAM:0007}} make a move', body: 'A quiet depth signing for {{TEAM:0007}} today.' });
    expect(parseMoveStory(reply, facts, teams)).toBeNull();
  });

  it('fails when the story leaves out the drop, or names a placeholder', () => {
    const swap = factsFromRawMove({ type: 'WAIVER', franchise: '0007', transaction: '15001,|15002,' }, ctx)!;
    const reply = (body: string) => JSON.stringify({ headline: '{{TEAM:0007}} claim Roschon Johnson', body });
    expect(parseMoveStory(reply('I hear {{TEAM:0007}} wanted Roschon Johnson badly.'), swap, teams)).toBeNull();
    expect(parseMoveStory(reply('Roschon Johnson in, Darnell Washington out for player 12.'), swap, teams)).toBeNull();
    expect(parseMoveStory(reply('Roschon Johnson in, Darnell Washington out.'), swap, teams)).not.toBeNull();
  });

  it("fails on a first-come pickup called waivers, or a drop that did not happen", () => {
    const fcfs = factsFromRawMove({ type: 'FREE_AGENT', franchise: '0007', transaction: '15001,|' }, ctx)!;
    const reply = (body: string) => JSON.stringify({ headline: '{{TEAM:0007}} sign Roschon Johnson', body });
    expect(parseMoveStory(reply('{{TEAM:0007}} grabbed Roschon Johnson off waivers.'), fcfs, teams)).toBeNull();
    expect(parseMoveStory(reply('{{TEAM:0007}} added Roschon Johnson with no drops needed.'), fcfs, teams)).toBeNull();
    expect(parseMoveStory(reply('{{TEAM:0007}} signed Roschon Johnson off the free-agent wire.'), fcfs, teams)).not.toBeNull();
  });

  it('keeps the template when the call fails', async () => {
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 529 }));
    expect(await writeMoveStory({ facts, teams, apiKey: 'k', fetchImpl })).toBeNull();
    expect(await writeMoveStory({ facts, teams, apiKey: '', fetchImpl })).toBeNull();
  });
});

describe('backfill', () => {
  it('finds the MFL row a post came from, narrowed by player on a shared timestamp', () => {
    const a = { type: 'BBID_WAIVER', franchise: '0007', timestamp: '100', transaction: '15001,|10|' };
    const b = { type: 'BBID_WAIVER', franchise: '0007', timestamp: '100', transaction: '15003,|5|' };
    const index = new Map([['100|0007', [a, b]]]);
    const post = { transactionSubType: 'FREE_AGENT', sourceTimestamp: '100', franchiseIds: ['0007'], playerIds: ['15003'] };
    expect(findRawRow(post, index)).toBe(b);
    expect(findRawRow({ ...post, playerIds: undefined }, index)).toBeNull();
  });

  it('a stale scan cannot push the template back over a story', () => {
    const story = applyMoveStory(
      { id: 'sf_1', timestamp: '2026-10-01T00:00:00Z', headline: 'old', body: 'old' },
      { headline: 'new', body: 'new' },
      { added: [{ id: '15001' }], dropped: [] },
    );
    expect(story.storyVersion).toBe(MOVE_STORY_VERSION);
    const stale = { id: 'sf_1', timestamp: '2026-10-01T00:00:00Z', headline: 'old', body: 'old' };
    expect(mergeFeed({ posts: [story] }, { posts: [stale] }).posts[0].headline).toBe('new');
    expect(mergeFeed({ posts: [stale] }, { posts: [story] }).posts[0].headline).toBe('new');
  });
});
