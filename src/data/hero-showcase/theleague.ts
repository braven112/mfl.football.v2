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
  league: 'theleague',
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

  // ── THE INVENTORY ───────────────────────────────────────────────────────
  // Every composite state TheLeague can actually render, not a highlight reel.
  // Each entry is fixture props for the LIVE shell, so what a reader sees here
  // is what the homepage draws — crest, wordmark, glow and all.
  //
  // `scope` is load-bearing, not a label: a team card hands its franchise to
  // the shell (skin + crest + glow), a league card hands it none. The badge
  // therefore cannot disagree with the pixels.
  gallery: [
    {
      key: 'feature', accent: 'feature', scope: 'league',
      component: 'FeatureCompositeHero', wordmark: "WHAT'S NEW",
      pill: 'New this week', title: 'Dynamic top-player spotlight', titleAccent: 'on Free Agents',
      summary:
        'A player appears only if the entry names one: an ESPN cutout over league blue, his NFL club’s ' +
        'crest behind him. An announcement belongs to nobody, so that glow is the only team colour here.',
      ctaLabel: 'Read the update',
      model: { name: 'Ashton Jeanty', descriptor: 'Featured', pos: 'RB', code: 'LV', espnId: '4890973' },
    },
    {
      key: 'enhancement', accent: 'feature', scope: 'league',
      component: 'FeatureCompositeHero · enhancement', wordmark: "WHAT'S NEW",
      pill: 'Improved this week', title: 'Trade Builder now shows', titleAccent: 'live cap impact',
      summary:
        '“Same guy, leveled up” — an enhancement casts a rostered player in his first five NFL seasons. ' +
        'Strictly someone an owner invested in; the caption reads his year.',
      ctaLabel: 'See what changed',
      model: { name: 'Jahmyr Gibbs', descriptor: '4th Year', pos: 'RB', code: 'DET', espnId: '4429795' },
    },
    {
      key: 'recap', accent: 'recap', scope: 'team',
      component: 'RecapCompositeHero', wordmark: 'WEEK 12',
      pill: 'Tuesday · Week 12 recap', title: 'The week’s highest score', titleAccent: 'has an owner.',
      summary:
        'Tuesday’s card is about a franchise, not a player — so the glow and the crest behind him are ' +
        'the rostering club’s, not Minnesota’s. The caption still names his NFL team.',
      ctaLabel: 'Read the recap',
      franchiseId: '0001',
      model: { name: 'Justin Jefferson', descriptor: 'Week 12 high score', pos: 'WR', code: 'MIN', espnId: '4262921' },
    },
    {
      key: 'auction-countdown', accent: 'auction', scope: 'league',
      component: 'AuctionCompositeHero · countdown', wordmark: 'AUCTION',
      pill: 'Auction opens Friday', title: 'The money window', titleAccent: 'is coming.',
      summary:
        'Before bidding opens the card counts down and keeps its wordmark. Best available by dynasty ADP ' +
        'models the window — the pick rotates daily so one face doesn’t own the whole auction.',
      ctaLabel: 'Prep your board',
      model: { name: "Ja'Marr Chase", descriptor: 'Best Available', pos: 'WR', code: 'CIN', espnId: '4362628' },
    },
    {
      key: 'auction-live', accent: 'auction', scope: 'league',
      component: 'AuctionCompositeHero · live', wordmark: '',
      pill: 'Bidding open', title: 'The auction', titleAccent: 'is live.',
      summary:
        'Once bidding opens the ghost wordmark drops entirely — the live board needs the width, and ' +
        'decoration behind live money reads as clutter. The crest stays; it was never the noisy layer.',
      ctaLabel: 'Go to the auction',
      model: { name: 'Saquon Barkley', descriptor: 'On the block', pos: 'RB', code: 'PHI', espnId: '3929630' },
    },
    {
      key: 'cut-planning', accent: 'roster', scope: 'team',
      component: 'CutWatchCompositeHero · planning', wordmark: 'CUT WATCH',
      pill: 'Cut watch · 44 days left', title: 'Roster planning', titleAccent: 'ahead.',
      summary:
        'Outside the final 30 days the hero is calm blue and the copy is planning, not panic. Your club’s ' +
        'crest sits behind your own bubble player.',
      ctaLabel: 'See who’s on the bubble',
      franchiseId: '0002',
      model: { name: 'Trey McBride', descriptor: 'Your bubble player', pos: 'TE', code: 'ARI', espnId: '4361307' },
    },
    {
      key: 'cut-urgent', accent: 'roster', tone: 'red', scope: 'team',
      component: 'CutWatchCompositeHero · urgent', wordmark: 'CUT WATCH',
      pill: 'Cut watch · 6 days left', title: 'Roster deadline', titleAccent: 'approaching.',
      summary:
        'Inside the final 30 days a tone — not a second accent — flips the surface and pill to red over ' +
        'the same roster palette. Signed in, the CTA becomes “Plan your cuts.”',
      ctaLabel: 'Plan your cuts',
      // Cowboy Up's brand runs navy → red, which is the urgent tone's own arc.
      // Deliberately not the club used by the recap card above: a showcase that
      // dresses two shots in the same crest wastes one of them.
      franchiseId: '0014',
      model: { name: 'Bijan Robinson', descriptor: 'Your bubble player', pos: 'RB', code: 'ATL', espnId: '4430807' },
    },
    {
      key: 'cut-clear', accent: 'roster', scope: 'team',
      component: 'CutWatchCompositeHero · all clear', wordmark: 'CUT WATCH',
      pill: 'Cut watch · 6 days left', title: 'Every roster is', titleAccent: 'legal.',
      summary:
        'The state most hero systems forget: nobody is over the limit. Rather than hide the hero, the ' +
        'metrics become days-to-deadline and the cap, and it still wears your club’s crest.',
      ctaLabel: 'Review your roster',
      // Navy → green. The club dressed here was one whose brand runs navy →
      // RED, which made the one state that means "nothing to do" the most
      // alarming shot in the gallery. The skin is faithful either way; which
      // club models which state is an editorial choice, so make it.
      franchiseId: '0004',
      model: { name: 'Puka Nacua', descriptor: 'Your headliner', pos: 'WR', code: 'LAR', espnId: '4426515' },
    },
    {
      key: 'kickoff', accent: 'kickoff', scope: 'league',
      component: 'PreseasonCompositeHero', wordmark: 'KICKOFF',
      pill: 'Season opener', title: 'Football is back', titleAccent: 'Thursday night.',
      summary:
        'The best projected starter in the week’s earliest game — and if you roster a player in that ' +
        'opener, you see your own. Kickoff belongs to the league, so the card stays league-coloured.',
      ctaLabel: 'See the opener',
      model: { name: 'Lamar Jackson', descriptor: 'Your Kickoff Starter', pos: 'QB', code: 'BAL', espnId: '3916387' },
    },
    {
      key: 'udfa-board', accent: 'kickoff', scope: 'league', shape: 'board',
      component: 'UdfaCompositeHero · CompositePanelBoard', wordmark: 'UDFA',
      pill: 'UDFA window · Best on the board', title: 'The draft is over. The bargains aren’t.',
      summary:
        'The second shape the system ships: four rookies on their own NFL-team gradients, each panel ' +
        'watermarked with that club’s logo, instead of one spotlight.',
      ctaLabel: 'Browse free agents',
      panels: [
        { name: 'Omarion Hampton', position: 'RB', nflTeam: 'LAC', espnId: '4685382', badge: 'No. 1' },
        { name: 'Tetairoa McMillan', position: 'WR', nflTeam: 'CAR', espnId: '4685472', badge: 'No. 2' },
        { name: 'Colston Loveland', position: 'TE', nflTeam: 'CHI', espnId: '4723086', badge: 'No. 3' },
        { name: 'Matthew Golden', position: 'WR', nflTeam: 'GB', espnId: '4701936', badge: 'No. 4' },
      ],
    },
    {
      key: 'tag-board', accent: 'recap', scope: 'team', shape: 'board',
      component: 'TaggedShowcaseCompositeHero · CompositePanelBoard', wordmark: 'TAGS',
      pill: 'Franchise tags · 2026', title: 'Four players just got the franchise tag',
      summary:
        'The same board, watermarked with each TAGGING FRANCHISE’S crest rather than an NFL logo — a tag ' +
        'is a fantasy-team story, so the club that spent the tag is the mark behind the player.',
      ctaLabel: 'See every tag',
      franchiseId: '0013',
      panels: [
        { name: 'Brock Bowers', position: 'TE', nflTeam: 'LV', espnId: '4432665', badge: 'Pigskins · TE', flag: 'Tagged', watermarkFranchiseId: '0001' },
        { name: 'Travis Hunter', position: 'WR', nflTeam: 'JAC', espnId: '4685415', badge: 'Geeks · WR', flag: 'Tagged', watermarkFranchiseId: '0013' },
        { name: 'Jayden Daniels', position: 'QB', nflTeam: 'WAS', espnId: '4426348', badge: 'Dangsters · QB', flag: 'Tagged', watermarkFranchiseId: '0002' },
        { name: 'Xavier Worthy', position: 'WR', nflTeam: 'KC', espnId: '4683062', badge: 'Midwestside · WR', flag: 'Tagged', watermarkFranchiseId: '0011' },
      ],
    },
  ],
  galleryNote:
    'Every composite state TheLeague ships, at true homepage scale — real players, real NFL team ' +
    'colours on the league-scoped cards and real franchise colours on the team-scoped ones, and ' +
    'the exact gradient / radial glow / ghost-wordmark / frosted-caption CSS from the live ' +
    'components. The badge on each card says which half of the colour rule it is on. Toggle your ' +
    'theme: the gradient, glow and tokens re-resolve for dark mode.',
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
