import { describe, expect, it } from 'vitest';
import type { GroupMeApiMessage } from '../src/types/groupme';
import { LEAGUES } from '../src/config/leagues';
import {
  buildGroupMeChatView,
  countUnreadGroupMe,
  groupMeConfigFor,
  relayPrefix,
} from '../src/utils/live/league-groupme-chat';

function msg(over: Partial<GroupMeApiMessage>): GroupMeApiMessage {
  return {
    id: '100',
    group_id: 'g',
    user_id: 'u1',
    name: 'Brandon R',
    text: 'hello',
    avatar_url: 'https://i.groupme.com/a.jpeg',
    created_at: 1_761_590_000,
    sender_type: 'user',
    favorited_by: [],
    attachments: [],
    ...over,
  };
}

const teams = { '0001': 'Bring The Pain', '0002': 'Bring The Pain II', '0003': 'Da Dangsters' };

describe('which leagues show GroupMe in the app chat', () => {
  it('is the registry leagues whose chat is GroupMe, by MFL id', () => {
    expect(groupMeConfigFor(LEAGUES.theleague.id)?.league.slug).toBe('theleague');
    expect(groupMeConfigFor(LEAGUES['afl-fantasy'].id)?.league.slug).toBe('afl-fantasy');
  });

  it('is never a Slack league or a league we do not run', () => {
    expect(groupMeConfigFor(LEAGUES.archies.id)).toBeNull();
    expect(groupMeConfigFor('55555')).toBeNull();
  });
});

describe('buildGroupMeChatView', () => {
  it('shows a person under their GroupMe name, with no team', () => {
    const [m] = buildGroupMeChatView([msg({})], '0001', teams);
    expect(m).toMatchObject({ franchiseId: '', franchiseName: 'Brandon R', text: 'hello', mine: false });
    expect(m.postedAt).toBe(new Date(1_761_590_000 * 1000).toISOString());
    expect(m.avatarUrl).toBe('https://i.groupme.com/a.jpeg');
  });

  it('shows a relayed bot message as the team that sent it, without the prefix', () => {
    const view = buildGroupMeChatView(
      [msg({ sender_type: 'bot', text: `${relayPrefix('Da Dangsters')}trade?` })],
      '0003',
      teams,
    );
    expect(view[0]).toMatchObject({ franchiseId: '0003', franchiseName: 'Da Dangsters', text: 'trade?', mine: true });
    expect(view[0].avatarUrl).toBeNull();
  });

  it('matches the longest team name, so a prefix of another name never wins', () => {
    const view = buildGroupMeChatView(
      [msg({ sender_type: 'bot', text: `${relayPrefix('Bring The Pain II')}hi` })],
      '0001',
      teams,
    );
    expect(view[0]).toMatchObject({ franchiseId: '0002', mine: false, text: 'hi' });
  });

  it('never reads a person typing "Team:" as that team', () => {
    const view = buildGroupMeChatView([msg({ text: `${relayPrefix('Da Dangsters')}fake` })], '0003', teams);
    expect(view[0]).toMatchObject({ franchiseId: '', mine: false });
  });

  it('drops system messages and empty ones, keeps photo-only messages', () => {
    const view = buildGroupMeChatView(
      [
        msg({ id: '1', sender_type: 'system', text: 'Todd joined the group' }),
        msg({ id: '2', text: '' }),
        msg({ id: '3', text: null, attachments: [{ type: 'image', url: 'https://i.groupme.com/p.jpeg' }] }),
      ],
      '0001',
      teams,
    );
    expect(view.map((m) => m.id)).toEqual(['3']);
    expect(view[0].imageUrls).toEqual(['https://i.groupme.com/p.jpeg']);
  });
});

describe('countUnreadGroupMe', () => {
  const view = buildGroupMeChatView(
    [
      msg({ id: '98' }),
      msg({ id: '99', sender_type: 'bot', text: `${relayPrefix('Da Dangsters')}mine` }),
      msg({ id: '100' }),
      msg({ id: '101' }),
    ],
    '0003',
    teams,
  );

  it('counts other people after the marker, never my own', () => {
    expect(countUnreadGroupMe(view, '98')).toBe(2);
  });

  it('orders by id when the marker has scrolled out of the page', () => {
    expect(countUnreadGroupMe(view, '97')).toBe(3);
    expect(countUnreadGroupMe(view, '9999')).toBe(0);
  });

  it('is zero with no marker (first look counts from now)', () => {
    expect(countUnreadGroupMe(view, null)).toBe(0);
  });
});

