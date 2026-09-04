import { describe, it, expect } from 'vitest';
import { resolveAflHeroState } from '../src/utils/afl-hero-resolver';
import { aflPickUrlFor } from '../src/utils/afl-draft-room';
import { getConferenceDraftKind } from '../src/utils/afl-conference';
import { buildMflLiveDraftUrl, buildMflOptionUrl, MFL_EMAIL_DRAFT_OPTION } from '../src/utils/mfl-url';
import { LEAGUES } from '../src/config/leagues';

/**
 * "The AL drafts live, the NL drafts by email" is written in TWO places:
 *
 *  1. `afl.config.json`'s conferences, read by the draft ROOM through
 *     `getConferenceDraftKind`;
 *  2. `afl-hero-resolver.ts`, which encodes it structurally in separate
 *     `afl-al-draft` / `afl-nl-draft` card builders whose draft-day CTA logic
 *     is too subtle to safely rewrite as a config lookup.
 *
 * One source of truth would be better. Since there are two, this makes them
 * AGREE: the room and the hero must send a given conference to the same MFL
 * page. If either moves, an owner opens the wrong page on the one morning it
 * matters.
 *
 * Asserted against what the hero RETURNS at real draft-day dates, not against
 * its source text — the pattern `afl-draft-room-link.test.ts` already uses.
 * A substring check on source would pass on code that never runs.
 *
 * 2026 anchors, matching that test: AL draft Sat Aug 29, NL draft Sun Aug 30.
 */

const AFL = LEAGUES['afl-fantasy'];
const urlOpts = { leagueId: AFL.id, year: 2026, host: `https://${AFL.mflHost}` };

/** The hero's CTA for a conference's own owner, on the morning of its draft. */
function heroCtaOn(date: Date, conference: '00' | '01'): string {
  const state = resolveAflHeroState({
    referenceDate: date,
    whatsNewEntries: [],
    userConferenceId: conference,
  });
  if (state.kind !== 'calendar-event') {
    throw new Error(`expected calendar-event state, got ${state.kind}`);
  }
  const { link } = state.view;
  // A draft-day card without a CTA is itself the regression this guards, so
  // fail loudly here rather than comparing against undefined below.
  if (!link) throw new Error(`conference ${conference} hero has no link on ${date.toISOString()}`);
  return link;
}

const AL_DRAFT_MORNING = new Date(2026, 7, 29, 8, 0);
const NL_DRAFT_MORNING = new Date(2026, 7, 30, 8, 0);

describe('the AL/NL draft-kind fact, in both places that hold it', () => {
  it('config says AL live, NL email', () => {
    // MFL's league.json says "email" for the WHOLE league, which is wrong for
    // the AL. That is why the fact is configured rather than inferred.
    expect(getConferenceDraftKind('00')).toBe('live');
    expect(getConferenceDraftKind('01')).toBe('email');
  });

  it('the ROOM sends each conference to the page its draft kind implies', () => {
    expect(aflPickUrlFor(getConferenceDraftKind('00'), urlOpts)).toBe(
      buildMflLiveDraftUrl(urlOpts)
    );
    expect(aflPickUrlFor(getConferenceDraftKind('01'), urlOpts)).toBe(
      buildMflOptionUrl({ ...urlOpts, option: MFL_EMAIL_DRAFT_OPTION })
    );
  });

  it('the HERO sends each conference to that SAME page on draft morning', () => {
    expect(heroCtaOn(AL_DRAFT_MORNING, '00')).toBe(buildMflLiveDraftUrl(urlOpts));
    expect(heroCtaOn(NL_DRAFT_MORNING, '01')).toBe(
      buildMflOptionUrl({ ...urlOpts, option: MFL_EMAIL_DRAFT_OPTION })
    );
  });

  it('room and hero agree exactly, per conference', () => {
    // The assertion that actually matters: whatever each side decides, they
    // decide the same thing.
    expect(heroCtaOn(AL_DRAFT_MORNING, '00')).toBe(
      aflPickUrlFor(getConferenceDraftKind('00'), urlOpts)
    );
    expect(heroCtaOn(NL_DRAFT_MORNING, '01')).toBe(
      aflPickUrlFor(getConferenceDraftKind('01'), urlOpts)
    );
  });

  it('neither ever hands a conference the OTHER’s page', () => {
    const al = heroCtaOn(AL_DRAFT_MORNING, '00');
    const nl = heroCtaOn(NL_DRAFT_MORNING, '01');
    expect(al).toContain('ajax_ld');
    expect(al).not.toContain(`O=${MFL_EMAIL_DRAFT_OPTION}`);
    expect(nl).toContain(`O=${MFL_EMAIL_DRAFT_OPTION}`);
    expect(nl).not.toContain('ajax_ld');
  });

  it('the email option number has ONE definition, shared by both', () => {
    // It used to be declared separately in the hero and the room, where a
    // divergence would be a valid URL to the wrong MFL page.
    expect(MFL_EMAIL_DRAFT_OPTION).toBe(52);
    expect(buildMflOptionUrl({ ...urlOpts, option: MFL_EMAIL_DRAFT_OPTION })).toContain('O=52');
  });
});
