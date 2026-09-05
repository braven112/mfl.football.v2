/**
 * Schefter player tagger — prose names → MFL ids.
 *
 * The rules each case pins are the false positives a name matcher has
 * already produced here: a bare last name tagging a coach, a team defense
 * tagging every story about its NFL team, an ambiguous name resolved to the
 * wrong person when the story named the position.
 */
import { describe, it, expect } from 'vitest';
import {
  buildPlayerNameIndex,
  findPlayerIdsInText,
  tagPost,
  tagFeed,
  normalizeMflName,
} from '../src/utils/schefter-player-tagger.mjs';

const players = [
  { id: '1', name: 'Allen, Josh', position: 'QB', team: 'BUF' },
  { id: '2', name: 'Allen, Josh', position: 'DE', team: 'JAC' },
  { id: '3', name: 'Harrison Jr., Marvin', position: 'WR', team: 'ARI' },
  { id: '4', name: "Robinson, Wan'Dale", position: 'WR', team: 'NYG' },
  { id: '5', name: 'Bills, Buffalo', position: 'DEF', team: 'BUF' },
  { id: '6', name: 'Brown, Chase', position: 'RB', team: 'CIN' },
  { id: '7', name: 'Buffalo, Bills', position: 'TMQB', team: 'BUF' },
  { id: '8', name: 'St. Brown, Amon-Ra', position: 'WR', team: 'DET' },
];
const index = buildPlayerNameIndex(players);

describe('normalizeMflName', () => {
  it('flips Last, First, drops suffixes and apostrophes, keeps hyphens', () => {
    expect(normalizeMflName('Harrison Jr., Marvin')).toBe('marvin harrison');
    expect(normalizeMflName("Robinson, Wan'Dale")).toBe('wandale robinson');
    expect(normalizeMflName('St. Brown, Amon-Ra')).toBe('amon-ra st brown');
  });
});

describe('findPlayerIdsInText', () => {
  it('matches a full name in prose', () => {
    expect(findPlayerIdsInText('Why Chase Brown will not be overlooked', index)).toEqual(['6']);
  });

  it('never matches a bare last name', () => {
    expect(findPlayerIdsInText('Head coach Brown praised the offense', index)).toEqual([]);
  });

  it('never indexes a team defense or a team slot', () => {
    expect(findPlayerIdsInText('The Buffalo Bills won again', index)).toEqual([]);
  });

  it('tags every player sharing an ambiguous name when the text gives no hint', () => {
    expect(findPlayerIdsInText('Josh Allen had a big day', index)).toEqual(['1', '2']);
  });

  it('narrows an ambiguous name by position or team when the text names one', () => {
    expect(findPlayerIdsInText('Bills quarterback Josh Allen threw four touchdowns', index)).toEqual(['1']);
    expect(findPlayerIdsInText('Jaguars pass rusher Josh Allen recorded two sacks', index)).toEqual(['2']);
    expect(findPlayerIdsInText('Josh Allen is a defensive end', index)).toEqual(['2']);
  });

  it('matches suffixed, apostrophe and hyphenated names as written in prose', () => {
    expect(findPlayerIdsInText("Marvin Harrison Jr. and Wan'Dale Robinson shine", index)).toEqual(['3', '4']);
    expect(findPlayerIdsInText('Amon-Ra St. Brown extension talks', index)).toEqual(['8']);
  });

  it('reads through HTML in article content', () => {
    expect(findPlayerIdsInText('<p><strong>Chase Brown</strong> &amp; friends</p>', index)).toEqual(['6']);
  });
});

describe('tagPost / tagFeed', () => {
  it('adds ids after any existing structural ids and keeps the hero id first', () => {
    const post = { id: 'a', type: 'transaction', playerIds: ['9'], headline: 'Chase Brown signed' };
    const tagged = tagPost(post, index);
    expect(tagged).not.toBe(post);
    expect(tagged.playerIds).toEqual(['9', '6']);
  });

  it('returns the same object when nothing is named, and omits the key', () => {
    const post = { id: 'b', type: 'external', headline: 'League expands playoffs' };
    expect(tagPost(post, index)).toBe(post);
    expect('playerIds' in tagPost(post, index)).toBe(false);
  });

  it('leaves GroupMe chatter alone', () => {
    const post = { id: 'c', type: 'groupme', body: 'Chase Brown is a bust' };
    expect(tagPost(post, index)).toBe(post);
  });

  it('tagFeed reports the count and returns the same feed when unchanged', () => {
    const feed = { posts: [{ id: 'x', type: 'external', headline: 'Nothing here' }] };
    expect(tagFeed(feed, index)).toEqual({ feed, changed: 0 });
    const feed2 = { posts: [{ id: 'y', type: 'external', headline: 'Chase Brown update' }] };
    const res = tagFeed(feed2, index);
    expect(res.changed).toBe(1);
    expect(res.feed.posts[0].playerIds).toEqual(['6']);
  });
});
