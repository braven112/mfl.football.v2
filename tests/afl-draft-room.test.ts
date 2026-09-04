import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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
import { queueScope } from '../src/utils/draft-queue-storage';
import { resolveAFLTeamSelection } from '../src/utils/team-preferences';
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

describe('the chat channel is scoped by conference too', () => {
  // Scoping the PICKS but not the chat still crosses the two drafts, just
  // more quietly: leagueId and leagueYear are identical for the AL and the
  // NL, so the draft unit is the only thing that can separate their rooms.
  const roomIdFrom = readFileSync(
    'src/components/theleague/draft-room/DraftRoom.tsx',
    'utf-8'
  );

  /** Mirrors the template in DraftRoom.tsx — kept in step by the test below. */
  const partyRoomId = (leagueId: string, year: number, unit?: string) =>
    `league-${leagueId}-draft-${year}${unit ? `-${unit.toLowerCase()}` : ''}`;

  it('builds a DIFFERENT room id for each AFL conference', () => {
    const al = partyRoomId('19621', 2026, 'CONFERENCE00');
    const nl = partyRoomId('19621', 2026, 'CONFERENCE01');
    expect(al).not.toBe(nl);
  });

  it('leaves a single-unit league’s room id byte-for-byte unchanged', () => {
    // Changing TheLeague's would orphan its existing chat history.
    expect(partyRoomId('13522', 2026)).toBe('league-13522-draft-2026');
  });

  it('actually derives the suffix from pollUnit in the component', () => {
    // The helper above only proves the shape; this proves the component uses
    // it, and conditionally.
    expect(roomIdFrom).toMatch(/league-\$\{state\.leagueId\}-draft-\$\{state\.leagueYear\}/);
    expect(roomIdFrom).toMatch(/data\.pollUnit \? `-\$\{data\.pollUnit\.toLowerCase\(\)\}` : ''/);
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

describe('licensed RSP data is not handed out by a browse-as id', () => {
  /**
   * The bug this pins: `resolveAFLTeamSelection` defaults to '0001' when there
   * is no param, cookie or session — and '0001' is the one franchise the RSP
   * licence covers. Feeding that browse-as selection to `buildDraftPlayers`
   * gave every LOGGED-OUT visitor to the AFL draft room licensed scouting
   * data. Every league has an 0001, and they are different people.
   */
  const roomSrc = readFileSync('src/utils/afl-draft-room.ts', 'utf-8');
  const poolSrc = readFileSync('src/utils/build-draft-players.ts', 'utf-8');

  it('confirms the default really is the licensed franchise', () => {
    // If this ever stops being true the finding changes shape, so assert the
    // premise rather than trusting the comment.
    expect(resolveAFLTeamSelection({})).toBe('0001');
  });

  it('the AFL room passes NO viewer franchise into the player pool', () => {
    const call = roomSrc.match(/buildDraftPlayers\([^)]*\)/s)?.[0] ?? '';
    expect(call).not.toContain('viewerFranchiseId');
  });

  it('the gate requires the licensed LEAGUE, not just the id', () => {
    expect(poolSrc).toContain('viewerLeagueSlug === RSP_LICENSED_LEAGUE');
  });
});

describe('the draft queue is scoped per board', () => {
  /**
   * The AFL is `duplicatePlayers: true` — the same NFL player can be rostered
   * by a franchise in each conference. So a player taken on the AL board is
   * still perfectly draftable on the NL one, and the queues must not share a
   * localStorage key: merely OPENING the other board let its picks purge your
   * own queue of players you could still have had.
   */
  it('gives each AFL conference its own queue key', () => {
    expect(queueScope('19621', 'CONFERENCE00')).not.toBe(queueScope('19621', 'CONFERENCE01'));
  });

  it('leaves a single-unit league’s key byte-for-byte unchanged', () => {
    // Changing it would silently empty every queue already saved.
    expect(queueScope('13522')).toBe('13522');
    expect(queueScope('13522', null)).toBe('13522');
    expect(queueScope('13522', undefined)).toBe('13522');
  });

  it('the room actually scopes its queue by the polled unit', () => {
    const src = readFileSync('src/components/theleague/draft-room/DraftRoom.tsx', 'utf-8');
    expect(src).toContain('queueScope(data.leagueId, data.pollUnit)');
    // and never reverts to the unscoped id for queue reads/writes
    expect(src).not.toMatch(/(saveQueue|getQueue)\(state\.leagueId/);
  });
});

describe('no page outside TheLeague can unlock its licensed RSP', () => {
  /**
   * Generalises the leak Codex found. `RSP_AUTHORIZED_FRANCHISES` holds bare
   * franchise ids, and EVERY league in this app has an `0001` who is a
   * different person — so any caller passing its own league's franchise id
   * without saying which league it is inherits TheLeague's licence by
   * collision. Fixing the one page that prompted this would have left two
   * others leaking, which is why the rule is asserted over all of them.
   */
  // readdirSync, not a glob: this repo has no glob dependency and node:fs
  // does not export globSync at the pinned @types/node — an import of it
  // passes at runtime while the astro check ratchet goes red.
  const walkAstro = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const path = join(dir, e.name);
      if (e.isDirectory()) return walkAstro(path);
      return e.name.endsWith('.astro') ? [path] : [];
    });

  const CALLERS = walkAstro('src/pages').filter((f) =>
    readFileSync(f, 'utf-8').includes('buildDraftPlayers(')
  );

  it('finds the callers it means to check', () => {
    expect(CALLERS.length).toBeGreaterThan(3);
  });

  for (const file of CALLERS) {
    const isTheLeague = file.startsWith('src/pages/theleague/');
    it(`${file.replace('src/pages/', '')} ${isTheLeague ? 'may rely on the default league' : 'declares its own league or passes no franchise'}`, () => {
      const src = readFileSync(file, 'utf-8');
      const call = src.slice(src.indexOf('buildDraftPlayers('));
      const args = call.slice(0, call.indexOf('});') + 1);
      // A comment mentioning the field is not passing it — match the property.
      const passesFranchise = /^\s*viewerFranchiseId:/m.test(args);
      if (isTheLeague || !passesFranchise) return;
      expect(
        /^\s*viewerLeagueSlug:/m.test(args),
        `${file} passes viewerFranchiseId without viewerLeagueSlug — its 0001 would inherit TheLeague's RSP licence`
      ).toBe(true);
    });
  }
});
