/**
 * TheLeague's composite-hero showcase content.
 *
 * Transcribed verbatim from the page this replaced — the prose is the point of
 * a portfolio surface, so it moved unchanged rather than being genericized.
 * The AFL's module is a separate document, not a translation of this one.
 */
import type { ShowcaseContent } from '../../types/hero-showcase';

const content: ShowcaseContent = {
  pageTitle: 'Composite Hero System | The League',
  palette: {
    accent: '#1c497c',
    // Matches the global --color-primary dark remap this page used to inherit.
    accentDark: '#3b82f6',
    cardSurface: 'linear-gradient(115deg, #f4f8fc 0%, #e4eef8 52%, #d2e2f2 100%)',
    cardSolid: '#e4eef8',
    cardSurfaceDark: 'linear-gradient(115deg, #0d1b2c 0%, #16395e 52%, #1c497c 100%)',
    cardSolidDark: '#16395e',
    cardGlowDark: 'rgba(96, 165, 250, 0.3)',
  },
  logo: { light: '/assets/logos/theleague-logo.svg', dark: '/assets/logos/theleague-logo-dark.svg' },

  hero: {
    tag: 'Feature Deep-Dive',
    kicker: 'Homepage Hero System',
    title: ['Every hero puts a real player on screen.', 'The face always means something.'],
    deckHtml:
      "The homepage hero isn't decoration. A rules engine decides <em>which</em> player's face " +
      'appears on any given day, and a small image pipeline decides <em>how</em> it’s rendered — a ' +
      "free ESPN cutout composited over his NFL team's colors, personalized to the signed-in owner, " +
      'and stable for a full Pacific-Time day. This is how it works.',
    stack: ['Astro SSR', 'Deterministic casting', 'CSS composites over ESPN CDN', '14-phase state machine', 'Light + dark'],
  },

  gallery: [
    {
      key: 'feature', accent: 'blue', component: 'FeatureCompositeHero', wordmark: "WHAT'S NEW",
      pill: 'New this week', title: 'Dynamic top-player spotlight on Free Agents',
      summary:
        'The feature itself is the art — its screenshot in a browser frame. A player appears only when ' +
        'the entry names one (heroPlayerId): transparent ESPN cutout over the league-blue gradient, glow ' +
        'tinted by his NFL team.',
      model: { name: 'Ashton Jeanty', descriptor: 'Featured', pos: 'RB', code: 'LV', espnId: '4890973' },
      primary: '#101820',
    },
    {
      key: 'enhancement', accent: 'blue', component: 'FeatureCompositeHero · enhancement', wordmark: "WHAT'S NEW",
      pill: 'Improved this week', title: 'Trade Builder now shows live cap impact',
      summary:
        '“Same guy, leveled up” — an enhancement casts a rostered player in his first five NFL ' +
        'seasons. Strictly someone an owner invested in; the caption reads his year.',
      model: { name: 'Jahmyr Gibbs', descriptor: '4th Year', pos: 'RB', code: 'DET', espnId: '4429795' },
      primary: '#0076b6',
    },
    {
      key: 'auction', accent: 'amber', component: 'AuctionCompositeHero', wordmark: 'AUCTION',
      pill: 'Bidding open', title: 'The auction is live',
      summary:
        'Best available by dynasty ADP models the money window — the pick rotates daily so one face ' +
        'doesn’t own the whole auction. Amber money accent.',
      model: { name: "Ja'Marr Chase", descriptor: 'Best Available', pos: 'WR', code: 'CIN', espnId: '4362628' },
      primary: '#fb4f14',
    },
    {
      key: 'cut', accent: 'red', component: 'CutWatchCompositeHero', wordmark: 'CUT WATCH',
      pill: 'Final 30 days', title: 'Two teams are over the roster limit',
      summary:
        'Signed in, the hero casts a suggested cut candidate from YOUR team, chip reads “You +2.” ' +
        'The blue planning tier flips to this urgent red inside the final 30 days.',
      model: { name: 'Bijan Robinson', descriptor: 'Your bubble player', pos: 'RB', code: 'ATL', espnId: '4430807' },
      primary: '#a71930',
    },
    {
      key: 'kickoff', accent: 'green', component: 'PreseasonCompositeHero', wordmark: 'KICKOFF',
      pill: 'Season opener', title: 'Football is back Thursday night',
      summary:
        'The best projected starter in the week’s earliest game — and if you roster a player in that ' +
        'opener, you see your own best one. “Your Kickoff Starter.”',
      model: { name: 'Lamar Jackson', descriptor: 'Your Kickoff Starter', pos: 'QB', code: 'BAL', espnId: '3916387' },
      primary: '#241773',
    },
  ],
  galleryNote:
    'Reproductions of the shipped hero treatment — real players, real NFL team colors, and the exact ' +
    'gradient / radial glow / ghost-wordmark / frosted-caption CSS from the live components. Toggle your ' +
    'theme: the gradient, glow, and tokens re-resolve for dark mode.',

  sections: [
    {
      num: '01', title: 'The Premise',
      sub: "Why there's a real player on the hero at all — and the one rule that governs it",
      blocks: [
        {
          kind: 'prose-quote',
          html: [
            'Identifiable NFL action photography is rights-managed — Getty, AP, Imagn. A fantasy site ' +
              "can't ship it. The easy fallback is a gradient with a headline slapped on top, which is " +
              'exactly how most fantasy homepages look: fine, forgettable, decorative.',
            'The approach here is different. Every NFL player has a <strong>free, transparent headshot on ' +
              "ESPN's CDN</strong>. Layer that cutout over his team's colors with a little typography and " +
              'glow, and you get a branded, on-topic hero — automatically, for any player, with zero ' +
              'licensing. The constraint became the design language.',
            'That unlocks the actual rule, which is the whole point of the system:',
          ],
          quote: {
            label: 'Casting Rule — Brandon, binding',
            html:
              '“Every hero casts a <strong>semantically relevant</strong> player — the actual player in ' +
              'a breaking story, the rookie behind a new feature, a bubble player from <em>your</em> roster ' +
              'on cut watch. Never a random star for decoration.”',
          },
        },
      ],
    },
    {
      num: '02', title: 'The Image Pipeline',
      sub: 'How a name becomes a composite — and the gate that keeps it from breaking',
      blocks: [
        {
          kind: 'layers',
          layers: [
            { z: 'z-0', name: 'Team-color gradient + ghost wordmark', html: 'A diagonal gradient (league-blue base) with an oversized, barely-there wordmark — <code>WHAT’S&nbsp;NEW</code>, <code>AUCTION</code>, <code>CUT&nbsp;WATCH</code> — bled off the top edge.' },
            { z: 'z-1', name: 'Radial glow, tinted by NFL team color', html: '<code>hexToRgba(primary, 0.38)</code> in dark, <code>0.2</code> in light — the player’s team hue bleeds in from the corner behind him.' },
            { z: 'z-2', name: 'Transparent ESPN headshot cutout', html: 'Anchored bottom-right with a soft drop-shadow. On the real homepage hero it’s <code>loading="eager"</code> (above the fold); the reproductions above lazy-load. Always <code>decoding="async"</code>, decorative <code>alt=""</code>.' },
            { z: 'z-3', name: 'Frosted caption + editorial copy', html: 'Player name on a <code>backdrop-filter: blur(2px)</code> pill bottom-right; kicker, title, summary, CTA bottom-left with an <strong>explicit</strong> text color so global heading rules can’t restyle it.' },
          ],
        },
        {
          kind: 'prose-code',
          codeSide: 'left',
          code: {
            caption: 'src/utils/hero-casting.ts',
            body: `/** Composites need a transparent ESPN cutout —
    MFL JPGs have baked backgrounds. */
function isCompositable(player: PlayerIdentity): boolean {
  return player.position !== 'DEF'
    && isEspnCdnUrl(player.headshot);
}`,
          },
          html: [
            'Two failure modes get gated out before anything renders. <strong>Transparency is ' +
              "load-bearing:</strong> the ESPN headshot has an alpha channel; MFL's fallback JPG " +
              '(<code>player_photos_big_2014/…_thumb.jpg</code>) has a baked-in background that ruins the ' +
              'composite. So the gate requires an ESPN CDN URL — matched on the parsed <strong>host</strong>, ' +
              'never a substring, so a lookalike like <code>espncdn.com.evil.com</code> can’t slip a foreign ' +
              'image into an <code>&lt;img src&gt;</code>. And a <strong>team defense isn’t a person</strong> — ' +
              '<code>position === ‘DEF’</code> is excluded, since a "DEF player" is a logo, not a face.',
            'Even a valid ESPN id can 404 (deep free agents sometimes have no photo). The cutout carries an ' +
              'inline <code>onerror</code> that hides itself and its caption, and the hero swaps to the ' +
              '<strong>league-logo silhouette</strong> — a gradient with an empty flank reads as broken, so it ' +
              'never ships one.',
          ],
        },
        {
          kind: 'chips',
          chips: ['DEF → excluded', 'MFL JPG → excluded', '404 → league-logo silhouette', 'tabular-nums on every metric', 'prefers-reduced-motion guarded'],
        },
      ],
    },
    {
      num: '03', title: 'Branding &amp; Color',
      sub: "The player's NFL team paints the hero; his fantasy team rides alongside",
      blocks: [
        {
          kind: 'prose',
          html: [
            'Color comes from one source of truth: a <strong>32-team NFL brand-color map</strong> ' +
              '(<code>NFL_TEAM_COLORS</code>, keyed by ESPN codes) with a hand-picked primary and secondary ' +
              'per team — secondary deliberately skips near-white "official" colors that would be useless on ' +
              'a dark composite. The player’s NFL team drives the gradient anchor and the glow tint. ' +
              'Unknown or free-agent codes fall back to <strong>TheLeague blue, <code>#1c497c</code></strong>.',
          ],
        },
        {
          kind: 'cards',
          cards: [
            {
              head: 'Rostered player',
              html: 'The hero is about a fantasy team, so franchise identity rides alongside the NFL color — the owner’s <strong>crest and short name</strong> as a chip, a <strong>“You&nbsp;+N”</strong> marker when it’s your own player. Cut watch and the tagged-player showcase are the roster-branded surfaces.',
              tag: "franchise crest · chooseTeamName(…, 'short')",
            },
            {
              head: 'Free agent / unrostered',
              html: 'No fantasy team to brand to, so the hero leans on <strong>NFL identity</strong> — the team-color gradient and glow, the league logo as backdrop art on the live auction. Auction and UDFA are the free-agent surfaces; deep FAs fall back to league blue.',
              tag: 'NFL_TEAM_COLORS · #1c497c fallback',
            },
          ],
        },
        {
          kind: 'swatches',
          label: 'Sample NFL team colors',
          swatches: [
            { label: 'BAL', hex: '#241773' }, { label: 'CIN', hex: '#fb4f14' }, { label: 'CHI', hex: '#0b162a' },
            { label: 'ATL', hex: '#a71930' }, { label: 'KC', hex: '#e31837' }, { label: 'FA', hex: '#1c497c' },
          ],
        },
      ],
    },
    {
      num: '04', title: 'Personalization Without Randomness',
      sub: 'Signed-in owners see their own player; guests see a deterministic public pick',
      blocks: [
        {
          kind: 'prose-code',
          wideText: true,
          code: {
            caption: 'The deterministic daily pick',
            body: `// PT calendar day (YYYY-MM-DD) — the rotation seed
function ptDayKey(date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles', …
  }).format(date);
}

function dailyPick(pool, date, seedKey, keyOf) {
  if (pool.length === 0) return null;
  const sorted = [...pool].sort(
    (a, b) => keyOf(a).localeCompare(keyOf(b)));
  const i = hashSeed(\`\${ptDayKey(date)}:\${seedKey}\`)
            % sorted.length;
  return sorted[i];        // same all day, rotates at PT midnight
}`,
          },
          html: [
            'Same layout, different casting. The roster-action and kickoff heroes take an optional ' +
              '<code>userFranchiseId</code>. When it’s set and the owner has a relevant candidate, the pool ' +
              '<strong>narrows to their own players</strong> — your bubble cut, your kickoff starter, your ' +
              'suggested tag. When it’s empty (a guest, or an owner with no candidate), the hero falls back ' +
              'to a <strong>league-wide pick</strong>.',
            'The catch: this is server-rendered, and SSR can’t call <code>Math.random()</code> at request ' +
              'time — two loads of the same page would disagree, and the cache would be useless. So the pick ' +
              'is <strong>deterministic per Pacific-Time calendar day</strong>: an FNV-1a hash of the PT ' +
              'day-key plus a per-hero seed indexes into the sorted candidate pool. Stable across every ' +
              'request that day, then it rotates at midnight PT so one face doesn’t own the window.',
            'It’s testable, too — <code>?testDate=YYYY-MM-DD</code> drives both the phase and the rotation ' +
              'seed, so any day’s hero can be previewed on demand.',
          ],
        },
        {
          kind: 'persona',
          columns: [
            {
              who: 'Signed-in owner', tone: 'owner',
              lines: [
                'Cut watch → <strong>your</strong> suggested cut, chip reads “You&nbsp;+2”',
                'Kickoff → <strong>your</strong> best starter in the opener',
                'Pool narrows to <code>franchiseId === userFranchiseId</code>',
              ],
            },
            {
              who: 'Guest', tone: 'guest',
              lines: [
                'Cut watch → a league-wide bubble candidate',
                "Kickoff → the opener's highest projection",
                'Deterministic daily pick from the full pool',
              ],
            },
          ],
        },
      ],
    },
    {
      num: '05', title: 'The Casting Rules, by Category',
      sub: "What's New heroes show the feature itself — a player appears only when the entry names one",
      blocks: [
        {
          kind: 'categories',
          items: [
            { type: 'entry with screenshot', cast: 'The feature itself', desc: "The entry's screenshot in a browser frame — light/dark capture pair, hidden on mobile where the logo silhouette stands in." },
            { type: 'entry naming a player', cast: 'That exact player', desc: 'heroPlayerId on the entry casts him over the gradient — players show up when they’re being talked about, never as stand-ins.' },
            { type: 'bug-fix', cast: 'No player', desc: 'League-logo silhouette (light/dark asset pair). A bug fix doesn’t get a face.' },
            { type: 'league-event', cast: 'Relevant player', desc: 'The player who’s actually in the story. (Event-hero conversions in progress.)' },
          ],
        },
      ],
    },
    {
      num: '06', title: 'Eight Casting Functions',
      sub: 'Each surface has a purpose-built picker in <code>hero-casting.ts</code> — all deterministic, all reusable',
      blocks: [
        {
          kind: 'table',
          headers: ['Function', 'Surface', 'Who it picks'],
          rows: [
            ['castFeaturedModel', "What’s New (entry names a player)", 'Exactly the player the entry features — otherwise the hero shows the feature’s own screenshot.'],
            ['castRookieModel', 'Season reset (AFL new-season)', 'Newest draft class in the pool, rostered-first, daily rotation.'],
            ['castTopFreeAgentModel', 'Auction preview / live', 'Top-5 unrostered free agents by dynasty ADP, rotated daily.'],
            ['castClosingAuctionModel', 'Auction, live bids', 'The player whose bid clock runs out first (oldest anchor + MFL’s 36h rule).'],
            ['castRookiesOnBoard', 'UDFA window', 'Best current-class rookies still unrostered — the board is the board (no rotation).'],
            ['castBestScoredModel', 'Preseason / kickoff', 'Highest-projected starter in the earliest game — your player if you roster one.'],
            ['castRandomStarterModel', 'Preseason / kickoff / game day', 'Rotates among YOUR likely starters (top-8/team by projection) in the first game you play — your opener player if you have one. Guests get the opener, league-wide.'],
            ['castRosterModel', 'Roster actions (cuts, tags)', 'A candidate from YOUR franchise; guests get a league-wide daily pick.'],
          ],
        },
      ],
    },
    {
      num: '07', title: 'The Calendar Decides',
      sub: '14 core season phases resolve by date — plus a trade-deadline override and an offseason fallback; the two live phases subdivide into 6 daily slots',
      blocks: [
        {
          kind: 'prose',
          html: [
            'Which hero shows isn’t a toggle — it’s resolved from the calendar. The <code>hero-resolver</code> ' +
              'maps the current Pacific-Time date to a season phase. <strong>Fourteen are real windows</strong> ' +
              'on the league year; the <code>SeasonPhase</code> union below adds two more — a 24-hour ' +
              '<code>trade-deadline</code> override and an <code>offseason-fallback</code> catch-all for any gap ' +
              '(16 states in all). During the two live phases the resolver drops into a second axis — six ' +
              '<strong>daily slots</strong> keyed on day-of-week and game windows — so a Monday standings hero ' +
              'gives way to a Tuesday recap gives way to a waiver-wire push. A priority ladder (P0++ → P5) ' +
              'breaks ties.',
          ],
        },
        {
          kind: 'phases',
          shipped: ['auction-live', 'cut-watch', 'preseason-countdown', 'udfa-window', 'offseason-fallback'],
          legend: 'Phases with a shipped composite hero today',
          phases: [
            ['championship', 'Week 17 Thu → Mon night final'],
            ['champion-crowned', 'Championship decided → +7 days'],
            ['tag-window', 'After champion crowned → Feb 14'],
            ['tagged-showcase', 'Feb 15 → auction hero start'],
            ['auction-preview', 'Mon before 3rd Thu Mar → Thu 7am PT'],
            ['auction-live', '3rd Thu Mar 7am PT → +10 days'],
            ['draft-countdown', 'Auction end → Draft hero (scouting lull)'],
            ['draft-announced', 'Mon after NFL Draft → rookie draft'],
            ['draft-live', 'Rookie draft start → draft completes'],
            ['udfa-window', 'Draft completes → +7 days'],
            ['cut-watch', 'Jun 1 → 3rd Sun of Aug'],
            ['preseason-countdown', 'FA close → NFL kickoff'],
            ['regular-season', 'NFL kickoff → end of Week 14'],
            ['trade-deadline', 'Nov 13 (24h override)'],
            ['playoffs', 'Week 15 → Week 16'],
            ['offseason-fallback', 'Any gap not covered above'],
          ],
        },
        {
          kind: 'slots',
          label: 'Daily slots · regular-season + playoffs',
          slots: [
            ['live-scoring', 'TNF, Sunday, MNF game windows'],
            ['standings', 'Monday pre-game'],
            ['recap', 'Tuesday AM'],
            ['waiver-wire', 'Tuesday PM → Wednesday 8pm'],
            ['article', 'Schefter articles (pickups, preview)'],
            ['game-day-preview', 'Saturday, Sunday pre-game'],
          ],
        },
      ],
    },
    {
      num: '08', title: "What's Shipped",
      sub: 'Five composite heroes live today; each owns its gradient, wordmark, glow, and casting',
      blocks: [
        {
          kind: 'shipped',
          items: [
            { name: 'FeatureCompositeHero', cast: 'screenshot / castFeatured', desc: 'The What’s New hero. The feature’s own screenshot in a browser frame; the entry’s featured player composites over the gradient when one is named. Can force the dark treatment when the dark card <em>is</em> the story.' },
            { name: 'AuctionCompositeHero', cast: 'castTopFreeAgent / castClosingAuction', desc: 'Amber money accent. Best-available-by-ADP in preview; once bids are live, it flips to the player whose clock runs out first and adds a high-bid line.' },
            { name: 'CutWatchCompositeHero', cast: 'castRosterModel', desc: 'The first personalized hero — your own bubble player, “You&nbsp;+N” chip. Blue planning tier flips red inside the final 30 days.' },
            { name: 'PreseasonCompositeHero', cast: 'castBestScored / castRandomStarter', desc: 'The best (or a rotating) likely starter in the week’s earliest game — your player if you roster one in the opener.' },
            { name: 'UdfaCompositeHero', cast: 'castRookiesOnBoard', desc: 'Four team-gradient panels of the best rookies still on the board. Casts eight, renders the four whose photos actually load — a 404 never costs a slot.' },
            { name: 'One shell, seven heroes', cast: 'CompositeHero · CompositePanelBoard', desc: 'All of the above now render through two shared components. Seven forks became one spotlight shell and one panel board — every dimension that differed is a custom property, every palette a named accent. 3,028 lines became 800, verified pixel-identical.' },
            { name: 'Honest scope', cast: 'not composites (yet)', desc: 'The playoff hero is a bracket-summary table, not a player composite. Feed-card composites were built and deliberately reverted.', muted: true },
          ],
        },
      ],
    },
  ],

  closing: {
    title: 'The Bottom Line',
    paragraphs: [
      'The interesting part isn’t the gradient — it’s that a licensing constraint turned into a rule ' +
        '(“every hero means something”), the rule turned into eight small deterministic pickers, and those ' +
        'plug into a calendar-driven state machine that already knew what day it was. Personalization fell ' +
        'out for free, because the casting functions already took a franchise id.',
      'It renders on the server, stays stable for a Pacific-Time day, degrades gracefully when a photo ' +
        '404s, and looks right in light and dark. No stock photos. No licensed action shots. Just the right ' +
        'player, rendered the right way, every day.',
    ],
    filesLabel: 'Key files',
    files: [
      'src/utils/hero-casting.ts',
      'src/utils/nfl-team-colors.ts',
      'src/utils/hero-resolver.ts · src/types/hero-state.ts',
      'src/components/shared/CompositeHero.astro',
      'docs/…/features/player-composites.md',
    ],
    ctas: [
      { label: 'The full case study', href: '/theleague/about', primary: true },
      { label: 'See heroes in the wild', href: '/theleague/whats-new' },
      { label: "The AFL's version", href: '/afl-fantasy/showcase' },
    ],
  },
};

export default content;
