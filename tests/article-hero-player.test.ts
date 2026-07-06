import { describe, it, expect } from 'vitest';
import { pickHeroPlayer } from '../scripts/article-utils/hero-player.mjs';

/** Raw MFL feed record shape (only the fields the picker reads). */
function meta(entries: Array<[string, { position?: string; espn_id?: string }]>) {
  return new Map(entries);
}

describe('pickHeroPlayer', () => {
  it('picks the highest-scored compositable player', () => {
    const players = meta([
      ['10', { position: 'WR', espn_id: '3915416' }],
      ['11', { position: 'RB', espn_id: '4241457' }],
    ]);
    expect(pickHeroPlayer([{ id: '10', score: 12 }, { id: '11', score: 30 }], players)).toBe('11');
  });

  it('is order-independent (max chosen explicitly)', () => {
    const players = meta([
      ['10', { position: 'WR', espn_id: 'a' }],
      ['11', { position: 'RB', espn_id: 'b' }],
    ]);
    expect(pickHeroPlayer([{ id: '11', score: 30 }, { id: '10', score: 12 }], players)).toBe('11');
  });

  it('prefers non-DEF even when a DEF outscores it', () => {
    const players = meta([
      ['10', { position: 'WR', espn_id: 'a' }],
      ['99', { position: 'DEF', espn_id: '' }],
    ]);
    expect(pickHeroPlayer([{ id: '99', score: 50 }, { id: '10', score: 8 }], players)).toBe('10');
  });

  it('prefers players with an ESPN headshot over higher-scoring faceless ones', () => {
    const players = meta([
      ['10', { position: 'WR', espn_id: '' }],   // top score but no cutout
      ['11', { position: 'RB', espn_id: 'b' }],  // lower score, has cutout
    ]);
    expect(pickHeroPlayer([{ id: '10', score: 40 }, { id: '11', score: 15 }], players)).toBe('11');
  });

  it('still returns the top player when none are compositable (render falls back to logo)', () => {
    const players = meta([
      ['10', { position: 'WR', espn_id: '' }],
      ['11', { position: 'RB', espn_id: '' }],
    ]);
    expect(pickHeroPlayer([{ id: '10', score: 8 }, { id: '11', score: 20 }], players)).toBe('11');
  });

  it('breaks score ties by ascending id (stable output)', () => {
    const players = meta([
      ['22', { position: 'WR', espn_id: 'a' }],
      ['11', { position: 'RB', espn_id: 'b' }],
    ]);
    expect(pickHeroPlayer([{ id: '22', score: 10 }, { id: '11', score: 10 }], players)).toBe('11');
  });

  it('ignores candidates with no id or no feed record', () => {
    const players = meta([['10', { position: 'WR', espn_id: 'a' }]]);
    expect(pickHeroPlayer([{ id: '', score: 99 }, { score: 99 } as any, { id: '404', score: 99 }, { id: '10', score: 5 }], players)).toBe('10');
  });

  it('treats non-finite scores as zero', () => {
    const players = meta([
      ['10', { position: 'WR', espn_id: 'a' }],
      ['11', { position: 'RB', espn_id: 'b' }],
    ]);
    expect(pickHeroPlayer([{ id: '10', score: NaN }, { id: '11', score: 1 }], players)).toBe('11');
  });

  it('returns null for an empty or unmatched candidate list', () => {
    expect(pickHeroPlayer([], meta([]))).toBeNull();
    expect(pickHeroPlayer([{ id: '404', score: 9 }], meta([['10', { position: 'WR' }]]))).toBeNull();
  });
});
