import { describe, it, expect } from 'vitest';
import { parseMyLeagues } from '../src/utils/my-leagues';

describe('parseMyLeagues — every shape MFL has answered with', () => {
  it('reads the myleagues wrapper with a list', () => {
    const leagues = parseMyLeagues({
      myleagues: {
        league: [
          { id: '13522', name: 'TheLeague', franchise_id: '0003', franchise_name: 'Pacific Pigskins', url: 'https://www49.myfantasyleague.com/2026/home/13522' },
          { id: '19621', name: 'AFL', franchise_id: '12', franchise_name: 'CSKA Sofia', url: 'https://www44.myfantasyleague.com/2026/home/19621' },
        ],
      },
    });
    expect(leagues).toEqual([
      { id: '13522', name: 'TheLeague', franchiseId: '0003', franchiseName: 'Pacific Pigskins', host: 'https://www49.myfantasyleague.com' },
      { id: '19621', name: 'AFL', franchiseId: '0012', franchiseName: 'CSKA Sofia', host: 'https://www44.myfantasyleague.com' },
    ]);
  });

  it('reads the leagues wrapper and a one-league bare object', () => {
    const leagues = parseMyLeagues({ leagues: { league: { id: '37610', name: 'Best Ball #1', franchise_id: '0007' } } });
    expect(leagues).toEqual([{ id: '37610', name: 'Best Ball #1', franchiseId: '0007', franchiseName: '', host: null }]);
  });

  it('returns [] for the dead-cookie answer and null for a non-answer', () => {
    expect(parseMyLeagues({ leagues: {} })).toEqual([]);
    expect(parseMyLeagues({ myleagues: { league: [] } })).toEqual([]);
    expect(parseMyLeagues(null)).toBeNull();
    expect(parseMyLeagues('<html>')).toBeNull();
    expect(parseMyLeagues({ error: 'API requires a logged in user' })).toBeNull();
  });

  it('skips rows without an id and tolerates a bad url', () => {
    const leagues = parseMyLeagues({ myleagues: { league: [{ name: 'ghost' }, { id: '1', url: 'not a url' }] } });
    expect(leagues).toEqual([{ id: '1', name: '', franchiseId: '', franchiseName: '', host: null }]);
  });
});
