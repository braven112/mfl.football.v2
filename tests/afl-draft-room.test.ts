import { describe, it, expect } from 'vitest';
import aflConfig from '../data/afl-fantasy/afl.config.json';
import { LEAGUES } from '../src/config/leagues';
import {
  aflPickUrlFor,
  aflRoomConferences,
  aflRoomTeams,
  resolveAflRoomFor,
  viewerConferenceOf,
  MFL_EMAIL_DRAFT_OPTION,
} from '../src/utils/afl-draft-room';
import { getConferenceDraftKind } from '../src/utils/afl-conference';
import { resolveRoomConference } from '../src/utils/draft-room-data';
import { buildMflLiveDraftUrl, buildMflOptionUrl } from '../src/utils/mfl-url';

/**
 * The AFL drafts TWICE, and the two drafts must never be crossed.
 *
 * The AL meets in person and picks in MFL's live-draft applet; the NL runs a
 * slow email draft over days off MFL's email-draft page. Different events,
 * different pages, different clocks. Every test here is about not showing an
 * owner the other conference's draft — the failure that matters on the one
 * day the page is load-bearing.
 */

const AFL = LEAGUES['afl-fantasy'];
const CONFS = aflConfig.conferences as Array<{ code: string; name: string }>;

describe('how each conference drafts', () => {
  it('reads live/email off the league config, not MFL’s league-wide draft_kind', () => {
    // MFL's league.json says "email" for the WHOLE league, which is wrong for
    // the AL. That is why the fact is configured rather than inferred.
    expect(getConferenceDraftKind('00')).toBe('live');
    expect(getConferenceDraftKind('01')).toBe('email');
  });

  it('declares a draft kind for every conference', () => {
    for (const c of CONFS) {
      expect(
        (c as { draftKind?: string }).draftKind,
        `conference ${c.code} has no draftKind`
      ).toMatch(/^(live|email)$/);
    }
  });

  it('labels the chips with how that conference drafts', () => {
    const rooms = aflRoomConferences(CONFS);
    expect(rooms.map((c) => [c.short, c.draftKind])).toEqual([
      ['AL', 'live'],
      ['NL', 'email'],
    ]);
  });
});

describe('where each conference actually picks on MFL', () => {
  const opts = { leagueId: AFL.id, year: 2026, host: `https://${AFL.mflHost}` };

  it('sends the LIVE conference to the live-draft applet', () => {
    expect(aflPickUrlFor('live', opts)).toBe(buildMflLiveDraftUrl(opts));
    expect(aflPickUrlFor('live', opts)).toContain('ajax_ld');
  });

  it('sends the EMAIL conference to the email-draft option page', () => {
    expect(aflPickUrlFor('email', opts)).toBe(
      buildMflOptionUrl({ ...opts, option: MFL_EMAIL_DRAFT_OPTION })
    );
    expect(aflPickUrlFor('email', opts)).toContain(`O=${MFL_EMAIL_DRAFT_OPTION}`);
  });

  it('never hands one conference the other’s page', () => {
    expect(aflPickUrlFor('live', opts)).not.toContain(`O=${MFL_EMAIL_DRAFT_OPTION}`);
    expect(aflPickUrlFor('email', opts)).not.toContain('ajax_ld');
  });
});

describe('which conference the room opens on', () => {
  const codes = ['00', '01'];

  it('prefers the viewer’s OWN conference over any default', () => {
    // On draft day the room an owner wants is overwhelmingly the one they
    // pick in. Landing an NL owner on the AL board is the failure here.
    expect(resolveRoomConference(null, '01', codes)).toBe('01');
    expect(resolveRoomConference(undefined, '00', codes)).toBe('00');
  });

  it('honours an explicit ?conference= over the viewer’s own', () => {
    expect(resolveRoomConference('00', '01', codes)).toBe('00');
    expect(resolveRoomConference('01', '00', codes)).toBe('01');
  });

  it('falls back to the first conference for a visitor who owns nothing', () => {
    expect(resolveRoomConference(null, null, codes)).toBe('00');
  });

  it('accepts MFL’s unit id as well as the bare code', () => {
    // The broadcast board links `?conference=00` and Draft Results' matcher
    // takes either form. A URL copied between the three pages must land on
    // the conference it names, not silently on the reader's own.
    expect(resolveRoomConference('CONFERENCE01', '00', codes)).toBe('01');
    expect(resolveRoomConference('conference01', '00', codes)).toBe('01');
    expect(resolveRoomConference('CONFERENCE00', '01', codes)).toBe('00');
  });

  it('ignores an unrecognised ?conference= rather than erroring', () => {
    expect(resolveRoomConference('99', '01', codes)).toBe('01');
    expect(resolveRoomConference('', '01', codes)).toBe('01');
  });
});

describe('resolveAflRoomFor', () => {
  const alTeam = (aflConfig.teams as any[]).find((t) => t.conference === '00')!.franchiseId;
  const nlTeam = (aflConfig.teams as any[]).find((t) => t.conference === '01')!.franchiseId;

  it('opens an NL owner on the NL board, with their team highlighted', () => {
    const room = resolveAflRoomFor(CONFS, null, nlTeam);
    expect(room.conference).toBe('01');
    expect(room.selected.draftKind).toBe('email');
    expect(room.unit).toBe('CONFERENCE01');
    expect(room.isViewersConference).toBe(true);
    expect(room.userTeamId).toBe(nlTeam);
  });

  it('scopes the board to that conference’s twelve franchises only', () => {
    const room = resolveAflRoomFor(CONFS, null, nlTeam);
    expect(room.teams).toHaveLength(12);
    expect(room.teams.some((t) => t.franchiseId === alTeam)).toBe(false);
    expect(room.teams.some((t) => t.franchiseId === nlTeam)).toBe(true);
  });

  it('does NOT highlight a team on the other conference’s board', () => {
    // The island highlights "your" team and scrolls to your pick. Doing that
    // on a draft the viewer has no part in is a lie about whose turn it is.
    const room = resolveAflRoomFor(CONFS, '00', nlTeam);
    expect(room.conference).toBe('00');
    expect(room.isViewersConference).toBe(false);
    expect(room.userTeamId).toBe('');
  });

  it('treats a visitor who owns nothing as belonging wherever they look', () => {
    const room = resolveAflRoomFor(CONFS, '01', undefined);
    expect(room.viewerConference).toBeNull();
    expect(room.isViewersConference).toBe(true);
    expect(room.userTeamId).toBe('');
  });

  it('polls the unit matching the board it shows', () => {
    // /api/draft/status returns the FIRST unit when none is named, so a wrong
    // or missing unit shows an NL owner the AL's picks.
    expect(resolveAflRoomFor(CONFS, '00', nlTeam).unit).toBe('CONFERENCE00');
    expect(resolveAflRoomFor(CONFS, '01', alTeam).unit).toBe('CONFERENCE01');
  });
});

describe('the franchise → conference lookup the room depends on', () => {
  it('places every AFL franchise in exactly one conference', () => {
    for (const t of aflConfig.teams as any[]) {
      expect(viewerConferenceOf(t.franchiseId), t.franchiseId).toBe(t.conference);
    }
  });

  it('returns null for a franchise that is not the AFL’s', () => {
    expect(viewerConferenceOf('9999')).toBeNull();
    expect(viewerConferenceOf(undefined)).toBeNull();
  });

  it('splits the league 12 and 12', () => {
    expect(aflRoomTeams('00')).toHaveLength(12);
    expect(aflRoomTeams('01')).toHaveLength(12);
  });
});
