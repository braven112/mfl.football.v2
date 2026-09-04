import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { getConferenceDraftKind } from '../src/utils/afl-conference';
import { aflPickUrlFor } from '../src/utils/afl-draft-room';
import { LEAGUES } from '../src/config/leagues';

/**
 * "The AL drafts live, the NL drafts by email" is now written in TWO places:
 *
 *  1. `afl.config.json`'s conferences, read by the draft ROOM through
 *     `getConferenceDraftKind`;
 *  2. `afl-hero-resolver.ts`, which encodes it structurally in separate
 *     `afl-al-draft` / `afl-nl-draft` card builders — each hardcoding its own
 *     MFL URL, with draft-day CTA logic too subtle to safely rewrite as a
 *     config lookup.
 *
 * One source of truth would be better. Since there are two, this test makes
 * them agree: if someone changes the config, or swaps a URL in the hero, the
 * disagreement is caught here rather than by an owner opening the wrong MFL
 * page on the morning of their draft.
 *
 * If the league ever changes how a conference drafts, BOTH move together —
 * and this test is the list of what to edit.
 */

const AFL = LEAGUES['afl-fantasy'];
const hero = readFileSync('src/utils/afl-hero-resolver.ts', 'utf-8');

/** The source of one conference's draft-day card, up to the next card. */
function heroCard(cardId: 'afl-al-draft' | 'afl-nl-draft'): string {
  const start = hero.indexOf(`'${cardId}': (event`);
  expect(start, `${cardId} card not found in afl-hero-resolver`).toBeGreaterThan(-1);
  const rest = hero.slice(start + 1);
  const next = rest.search(/\n  '[a-z0-9-]+': \(event/);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('the AL/NL draft-kind fact, in both places that hold it', () => {
  it('config says AL live, NL email', () => {
    expect(getConferenceDraftKind('00')).toBe('live');
    expect(getConferenceDraftKind('01')).toBe('email');
  });

  it('the hero leads the AL with the room URL and the NL with the email-draft URL', () => {
    const al = heroCard('afl-al-draft');
    const nl = heroCard('afl-nl-draft');

    // Each card offers its OWN conference's page and never the other's — the
    // crossing this whole arrangement exists to prevent.
    expect(al).toContain('roomUrl');
    expect(al).not.toContain('emailDraftUrl');
    expect(nl).toContain('emailDraftUrl');
    expect(nl).not.toContain('roomUrl');
  });

  it('the room sends each conference to the SAME page the hero does', () => {
    const opts = { leagueId: AFL.id, year: 2026, host: `https://${AFL.mflHost}` };
    const roomAl = aflPickUrlFor(getConferenceDraftKind('00'), opts);
    const roomNl = aflPickUrlFor(getConferenceDraftKind('01'), opts);

    // The hero builds these with the same two helpers; asserting the SHAPE
    // catches a swap without duplicating its CTA logic here.
    expect(roomAl).toContain('ajax_ld');
    expect(roomNl).toContain('O=52');
    expect(roomAl).not.toBe(roomNl);

    // And the hero's own builders are still the ones it uses.
    expect(hero).toContain('buildMflLiveDraftUrl');
    expect(hero).toContain('MFL_EMAIL_DRAFT_OPTION');
  });
});
