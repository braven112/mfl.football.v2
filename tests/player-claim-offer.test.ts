/**
 * The claim offer — where it may appear, and what has to be true before it does.
 *
 * The acquisition used to be a column on the two free-agent tables. It is now
 * a button inside PlayerDetailsModal, so "any free agent can be added from the
 * modal" holds on every page the modal is mounted on (Sep 2026). That move
 * created three ways to ship a button that does nothing, and each one is
 * pinned below.
 *
 * 1. THE FORM MUST TRAVEL WITH THE MODAL. WaiverClaimModal is mounted by
 *    PlayerDetailsModal itself, not per page — and therefore by NO page, or
 *    the document carries two `#waiver-claim-modal` dialogs and every
 *    getElementById wires whichever came first.
 *
 * 2. THE OFFER IS A SERVER VERDICT, NOT A PAGE'S GUESS. player-claim-client
 *    asks /api/claim-context, which resolves the league from the SESSION.
 *    Both leagues have a franchise 0001, so a client-supplied league is how a
 *    claim gets filed into the wrong one.
 *
 * 3. THE ORDERING RACE. The context can land before WaiverClaimModal's module
 *    has evaluated, in which case `window.configureWaiverClaim` does not exist
 *    to be called and the optional call swallows it. Caught in verification:
 *    the button rendered, the drop list filled in, and the click opened
 *    nothing. Both directions are covered — the client parks the context, the
 *    modal reads the parked copy at init — and init must NOT tear down wiring
 *    it already did, or the submit button ends up with two listeners and files
 *    two claims.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');

const MODAL = 'src/components/theleague/PlayerDetailsModal.astro';
const FORM = 'src/components/shared/WaiverClaimModal.astro';
const CLIENT = 'src/utils/player-claim-client.ts';
const SERVER = 'src/utils/claim-context.ts';
const ENDPOINT = 'src/pages/api/claim-context.ts';
const PAGES = ['src/pages/theleague/players.astro', 'src/pages/afl-fantasy/players.astro'];

describe('the claim form travels with the player modal', () => {
  it('PlayerDetailsModal mounts it', () => {
    expect(read(MODAL)).toContain('<WaiverClaimModal />');
  });

  it('no page mounts a second copy', () => {
    for (const page of PAGES) {
      expect(read(page), `${page} would give the document two claim dialogs`)
        .not.toContain('<WaiverClaimModal');
    }
  });

  it('its config prop is optional, so a page without one still renders valid JSON', () => {
    const src = read(FORM);
    expect(src).toMatch(/config\?: WaiverClaimConfig/);
    // `undefined` here makes init's JSON.parse throw and takes the page script
    // with it — the whole modal, not just the claim form.
    expect(src).toContain("JSON.stringify(config ?? { canClaim: false })");
  });
});

describe('the offer comes from the session, never from the page', () => {
  it('the endpoint reads the league off the session, with ?league= only as a check', () => {
    const src = read(ENDPOINT);
    expect(src).toContain('getAuthUser(request)');
    // The league is resolved from the session; the param is compared to it and
    // never substituted for it. MFL player ids are GLOBAL, so a TheLeague
    // owner answered for TheLeague while browsing an AFL page sees AFL free
    // agents who happen to be unrostered in TheLeague come back claimable —
    // a button on the wrong league's page that files a real bid in the other.
    expect(src).toContain('rankingsScopeForLeagueId(user.leagueId)');
    expect(src).toMatch(/searchParams\.get\('league'\)/);
    expect(src, 'a mismatch must be refused, not served').toMatch(
      /requested !== rankingsScopeForLeagueId[\s\S]{0,120}unauthorized/,
    );
  });

  it('the client sends the page league it is actually on, re-read per call', () => {
    const src = read(CLIENT);
    expect(src).toContain('activeRankingsScope()');
    expect(src).toMatch(/\/api\/claim-context\?league=/);
    // Captured at module load it would be the previous page's league — one
    // module instance survives a ClientRouter hop.
    expect(src, 'the scope must not be captured at module scope').not.toMatch(
      /^const scope = activeRankingsScope\(\);/m,
    );
  });

  it('the rate limit is keyed per user, not per franchise', () => {
    // Both leagues have a franchise 0001, so a franchise-keyed bucket has two
    // owners sharing one limit — and a 429 here renders as "no claim button".
    expect(read(ENDPOINT)).toContain("checkRateLimit('claim-context', user.id");
  });

  it('the offseason auction closes the in-place claim', () => {
    // TheLeague's page has always deep-linked to MFL's Place Bid page while
    // the auction is open. The modal has to agree with it rather than offer a
    // waiver form beside it — and the window comes from the shared resolver,
    // never re-derived (a second copy of a date formula is how two surfaces
    // end up disagreeing about what season it is).
    const src = read(SERVER);
    expect(src).toContain("from './auction-window'");
    expect(src).toMatch(/canClaim: roster\.length > 0 && !auctionOpen/);
    const page = read('src/pages/theleague/players.astro');
    expect(page).toContain('resolveAuctionWindow(');
    expect(page, 'the page must not keep its own copy of the window').not.toContain(
      'getNthDayOfMonth(auctionWindowYear',
    );
  });

  it('the endpoint never caches a body carrying the viewer’s own roster', () => {
    expect(read(ENDPOINT)).toContain('JSON_HEADERS_NO_STORE');
  });

  it('availability is conference-scoped, as the write endpoint scopes it', () => {
    const src = read(SERVER);
    // A rival conference's roster says nothing about your availability in a
    // duplicate-player league; counting it rejects legal claims.
    expect(src).toContain('freeAgencyIsLeagueWide');
    expect(src).toContain('conferenceOfFranchise');
  });

  it('a degraded MFL read answers "cannot claim", not "everything is free"', () => {
    const src = read(SERVER);
    // Every early return hands back `base`, whose canClaim is false — the
    // gate the client honours. Its empty rosteredIds must never be the thing
    // deciding, or a bad read lights the button up on the whole league.
    expect(src).toMatch(/canClaim: false/);
    for (const guard of ['if (!leaguePayload) return base;', 'return base;']) {
      expect(src).toContain(guard);
    }
  });
});

describe('the button cannot outrun the form it opens', () => {
  const client = read(CLIENT);
  const form = read(FORM);

  it('the client parks the context as well as calling into the form', () => {
    // The optional call is the fast path; the parked copy is what makes the
    // other module-evaluation order work.
    expect(client).toContain('window.__playerClaimContext = context');
    expect(client).toContain('window.configureWaiverClaim?.(context)');
  });

  it('a context that resolves after a league hop is not published', () => {
    // A fetch begun before a ClientRouter navigation resolves after it, and
    // handing that league's config to the claim form is the same cross-league
    // write the ?league= check exists to stop.
    expect(client).toMatch(/scope !== activeRankingsScope\(\)/);
  });

  it('the form reads the parked context at init', () => {
    expect(form).toContain('window.__playerClaimContext');
  });

  it('the form refuses to submit without a player', () => {
    // openFor is a public entry point (window.openWaiverClaim, and the
    // declarative .claim-open path), so a caller can open it on a payload
    // with no id; posting addPlayerId: null returns a server error that
    // tells the owner nothing.
    expect(form).toMatch(/if \(!activeId\) \{[\s\S]{0,120}showError/);
  });

  it('init does not re-wire a dialog it already wired', () => {
    // Re-wiring the same nodes stacks a second submit listener: two POSTs,
    // two claims, from one click.
    expect(form).toMatch(
      /if \(wiredDialog && wiredDialog === document\.getElementById\('waiver-claim-modal'\)\) return;/,
    );
  });

  it('state is keyed by league rather than reset on navigation', () => {
    // A blanket reset on `astro:page-load` fired on the SAME dispatch as
    // WatchListBridge's warm-up: it threw away a fetch already in flight, whose
    // late `.then` then repopulated what it had just cleared. Keying the state
    // by league makes the reset unnecessary — a hop already reads the right
    // bucket — so the reset must not come back.
    expect(client).toMatch(/const states = new Map<RankingsScope, ScopeState>\(\)/);
    expect(read(MODAL), 'the per-navigation reset raced the warm-up').not.toMatch(
      /astro:page-load['"],\s*\(\) => resetClaimContext\(\)/,
    );
  });

  it('the claims-changed listener paints THIS page’s nodes', () => {
    // Bound once per document, so closing over the first init's painter leaves
    // it repainting a dialog ClientRouter detached two navigations ago — the
    // documented stale-closure split. repaintWatch solves it the same way.
    const src = read(MODAL);
    expect(src).toMatch(/repaintClaim = paintClaim;/);
    expect(src).toMatch(/waiver-claims:changed[\s\S]{0,220}repaintClaim\(\)/);
  });
});

describe('the league’s own verb, everywhere', () => {
  it('one resolver decides it', () => {
    const shape = read('src/utils/claim-context-shape.ts');
    expect(shape).toMatch(/export function claimVerb/);
    expect(shape).toContain("system === 'bbid' ? 'Bid' : 'Claim'");
  });

  it('the player modal takes the verb from the offer, not a literal', () => {
    const src = read(MODAL);
    expect(src).toContain('${offer.verb} player');
    // A hardcoded 'Claim player' label would call TheLeague's blind bid
    // something it is not.
    expect(src).not.toMatch(/pdm-claim-label'\)[^\n]*textContent = '(Claim|Bid) player'/);
  });

  it('the shape module stays free of the server chain', () => {
    // player-claim-client ships to the browser inside PlayerDetailsModal. A
    // plain `import type` from claim-context.ts still drags auth, mfl-fetch
    // and the MFL client into the module graph as far as the Storybook
    // dependency scan is concerned (tests/chromatic-path-filter.test.ts).
    const shape = read('src/utils/claim-context-shape.ts');
    for (const forbidden of ['./auth', './mfl-fetch', './mfl-matchup-api', './claim-context']) {
      expect(shape, `claim-context-shape must not import ${forbidden}`)
        .not.toContain(`from '${forbidden}'`);
    }
    expect(read(CLIENT)).toContain("from './claim-context-shape'");
    expect(read(CLIENT), 'the client half must not import the server resolver')
      .not.toMatch(/from '\.\/claim-context'/);
  });
});
