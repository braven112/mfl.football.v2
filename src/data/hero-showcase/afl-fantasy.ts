/**
 * The AFL's composite-hero showcase content.
 *
 * Deliberately NOT a translation of TheLeague's module. The two leagues' hero
 * systems answer different questions, and the interesting parts here are the
 * ones TheLeague does not have: two conferences that draft on different days
 * off different pages, keepers instead of contracts, and a league that rosters
 * the same NFL player twice — which is what makes "whose colours is this hero
 * in?" a real question rather than a lookup.
 */
import type { ShowcaseContent } from '../../types/hero-showcase';

const content: ShowcaseContent = {
  pageTitle: 'Composite Hero System | AFL Fantasy',
  palette: {
    // AFL navy as the chrome, its lighter step so section numbers and inline
    // code read as navy rather than as near-black body text.
    accent: '#16324a',
    // The trophy gold in dark mode — --afl-gold-text's counterpart, and the
    // same value the navy composite hero uses for its accent word.
    accentDark: '#e6c976',
    cardSurface: 'linear-gradient(115deg, #f5f7fa 0%, #e6ecf3 52%, #d6e0ea 100%)',
    cardSolid: '#e6ecf3',
    cardSurfaceDark: 'linear-gradient(115deg, #0b1520 0%, #0f1e2e 52%, #16324a 100%)',
    cardSolidDark: '#0f1e2e',
    cardGlowDark: 'rgba(201, 164, 76, 0.32)',
  },
  logo: { light: '/assets/logos/afl-logo.svg', dark: '/assets/logos/afl-logo-dark.svg' },

  hero: {
    tag: 'Feature Deep-Dive',
    kicker: 'AFL Homepage Hero System',
    title: ['Twenty-four teams. Two conferences.', 'One hero that knows which is yours.'],
    deckHtml:
      'The AFL homepage hero is not a banner on a rotation. A calendar decides which phase the ' +
      'league is in, a casting rule decides <em>which player’s</em> face belongs on it, and — because ' +
      'this league rosters the same NFL player in <em>both</em> conferences — a third rule decides ' +
      '<em>whose colours</em> the card is painted in. That last one is the hard part, and it is the ' +
      'reason this page exists.',
    stack: ['Astro SSR', 'Conference-aware casting', 'Franchise-colour accents', 'Shared composite shell', 'Light + dark'],
  },

  gallery: [
    {
      key: 'keepers', accent: 'gold', component: 'AflCompositeHero · keeper window', wordmark: 'KEEPERS',
      pill: '2026 Keeper Deadline', title: 'Lock in your core.',
      summary:
        'Trophy gold is the keeper window’s own colour, and the face is your keeper cornerstone. ' +
        'On July 15 itself the whole card flips to urgency red.',
      model: { name: 'Bijan Robinson', descriptor: 'Keeper Cornerstone', pos: 'RB', code: 'ATL', espnId: '4430807' },
      primary: '#c9a44c',
    },
    {
      key: 'al-draft', accent: 'blue', component: 'AflCompositeHero · AL draft', wordmark: 'AL DRAFT',
      pill: 'AL · Live Draft', title: 'Build your empire.',
      summary:
        'The conferences draft on different days off different pages, so each names itself in the ' +
        'wordmark. Navy is the AFL’s ground; a draft actually running takes the red.',
      model: { name: "Ja'Marr Chase", descriptor: 'Best Available', pos: 'WR', code: 'CIN', espnId: '4362628' },
      primary: '#fb4f14',
    },
    {
      key: 'franchise-you', accent: 'gold', component: 'hero-franchise-accent · your club', wordmark: 'KEEPERS',
      pill: 'Your keeper class', title: 'Your team, in your colours',
      summary:
        'You roster him, so the glow is <strong>Midwestside</strong> gold, not Detroit blue — the ' +
        'caption still names his NFL club.',
      model: { name: 'Jahmyr Gibbs', descriptor: 'Your keeper', pos: 'RB', code: 'DET', espnId: '4429795' },
      primary: '#ffcd00', franchise: 'Midwestside Connection',
    },
    {
      key: 'franchise-rival', accent: 'red', component: 'hero-franchise-accent · a rival', wordmark: 'CUT DOWN',
      pill: 'Roster deadline', title: 'The same player, someone else’s story',
      summary:
        'Why the rule is conference-scoped: <strong>The Boondock Saints</strong> roster him too, in ' +
        'the other conference. Neither owner sees a stranger’s colours.',
      model: { name: 'Jahmyr Gibbs', descriptor: 'Their keeper', pos: 'RB', code: 'DET', espnId: '4429795' },
      primary: '#db2424', franchise: 'The Boondock Saints',
    },
    {
      key: 'franchise-navy', accent: 'blue', component: 'hero-franchise-backdrop', wordmark: 'GAME DAY',
      pill: 'Sunday · pre-game', title: 'Signed in, the card is yours',
      summary:
        'Beyond the glow, the card can take your whole gradient and crest — ' +
        '<strong>A Bruin Pegs Me</strong> here, floored for white-text contrast.',
      model: { name: 'Lamar Jackson', descriptor: 'Your starter', pos: 'QB', code: 'BAL', espnId: '3916387' },
      primary: '#002244', franchise: 'A Bruin Pegs Me',
    },
  ],
  galleryNote:
    'Reproductions of the shipped AFL hero treatment — real players, and real AFL franchise colours on ' +
    'the cards that are about a fantasy team rather than an NFL one. Toggle your theme: the gradient, ' +
    'glow and tokens re-resolve for dark mode.',

  sections: [
    {
      num: '01', title: 'The Premise',
      sub: 'Why a real player is on the hero at all — and the rule that governs which one',
      blocks: [
        {
          kind: 'prose-quote',
          html: [
            'Identifiable NFL action photography is rights-managed — Getty, AP, Imagn. A fantasy site ' +
              'can’t ship it, and the usual fallback is a gradient with a headline on top.',
            'Every NFL player, though, has a <strong>free, transparent headshot on ESPN’s CDN</strong>. ' +
              'Layer that cutout over a team-colour gradient with some typography and a glow and you get a ' +
              'branded, on-topic hero for any player, automatically, with zero licensing. The constraint ' +
              'became the design language — and the same one TheLeague uses, on the same components.',
            'What it unlocks is the rule the whole system exists to serve:',
          ],
          quote: {
            label: 'Casting Rule — binding',
            html:
              '“Every hero casts a <strong>semantically relevant</strong> player — your keeper ' +
              'cornerstone in the keeper window, the best available on draft day, <em>your</em> starter ' +
              'in the first game you play. Never a random star for decoration.”',
          },
        },
      ],
    },
    {
      num: '02', title: 'The Duplicate-Player Problem',
      sub: 'The AFL rosters the same NFL player twice, which makes “whose colours?” a real question',
      blocks: [
        {
          kind: 'prose-code',
          codeSide: 'left',
          code: {
            caption: 'src/utils/hero-franchise-accent.ts',
            body: `// Ownership is a LIST here, never one franchise.
const owners = ownersByPlayer.get(playerId);

// Scope to the viewer's own conference BEFORE picking.
// Inside one conference a player has at most one owner,
// so the ambiguity disappears instead of being broken
// by a tiebreak nobody can predict.
const mine = owners.filter(
  (id) => conferenceOf(id) === viewerConferenceId);

// Anything but exactly one → his NFL team's colour,
// which is what every hero did before this existed.
if (mine.length !== 1) return fallback;`,
          },
          html: [
            'The AFL runs 24 franchises as <strong>duplicate-player conferences</strong>: the same NFL ' +
              'player can be rostered by a team in the American League <em>and</em> a team in the National ' +
              'League at the same time. Sixty of the AL’s eighty-four keepers are kept in the NL too. So ' +
              '“the franchise that rosters this player” is a <strong>list</strong>, and a hero that picks ' +
              'one of them paints a stranger’s colours on your homepage.',
            'The rule that resolves it is to <strong>scope ownership to the viewer’s own ' +
              'conference</strong>. Inside a single conference a player has at most one owner, so the ' +
              'ambiguity is removed rather than guessed at. An AL owner sees the AL club’s colours; the NL ' +
              'owner of the same player is not their story.',
            'Everything that is not that falls back to the player’s NFL team colour — a signed-out ' +
              'visitor, a free agent, a franchise with no usable brand colour. That fallback is the ' +
              'behaviour every hero had before the accent existed, so the feature can only ever add.',
          ],
        },
        {
          kind: 'chips',
          chips: [
            'ownership is a list, never a franchiseId ===',
            'scoped to the signed-in franchise, not ?myteam=',
            'ambiguous → NFL colour',
            'near-white brand → floored for contrast',
          ],
        },
      ],
    },
    {
      num: '03', title: 'The Image Pipeline',
      sub: 'How a name becomes a composite — and the gate that keeps it from breaking',
      blocks: [
        {
          kind: 'layers',
          layers: [
            { z: 'z-0', name: 'Navy or gold gradient + ghost wordmark', html: 'A diagonal gradient on the AFL’s navy, or trophy gold in the keeper window, with an oversized barely-there wordmark — <code>KEEPERS</code>, <code>AL&nbsp;DRAFT</code>, <code>NL&nbsp;DRAFT</code> — bled off the top edge.' },
            { z: 'z-1', name: 'Radial glow, tinted by whoever owns the story', html: 'The cast player’s NFL team primary, or <strong>your franchise’s</strong> colour when your conference rosters him. <code>hexToRgba(tint, 0.42)</code> in dark, <code>0.22</code> in light.' },
            { z: 'z-2', name: 'Transparent ESPN headshot cutout', html: 'Anchored bottom-right with a soft drop-shadow, <code>loading="eager"</code> above the fold, decorative <code>alt=""</code>. A 404 hides it and reveals the AFL crest silhouette instead of an empty flank.' },
            { z: 'z-3', name: 'Frosted caption + editorial copy', html: 'His name on a blurred pill bottom-right — reading his <strong>NFL</strong> club, even when the glow is your fantasy one — and the phase’s copy bottom-left with explicit colours so global heading rules can’t restyle it.' },
          ],
        },
        {
          kind: 'prose',
          html: [
            'Two failure modes are gated before anything renders. <strong>Transparency is ' +
              'load-bearing</strong>: the ESPN headshot has an alpha channel, MFL’s fallback JPG has a baked-in ' +
              'background that ruins the composite, so the gate requires an ESPN CDN URL — matched on the ' +
              'parsed <strong>host</strong>, never a substring, so a lookalike domain can’t slip a foreign ' +
              'image into an <code>&lt;img src&gt;</code>. And a <strong>team defense isn’t a person</strong>: ' +
              '<code>position === ‘DEF’</code> is excluded, because a "DEF player" is a logo, not a face.',
          ],
        },
      ],
    },
    {
      num: '04', title: 'Two Conferences, Two Drafts',
      sub: 'The split TheLeague’s single draft hero cannot express',
      blocks: [
        {
          kind: 'cards',
          cards: [
            {
              head: 'American League · live draft',
              html: 'The AL meets and picks in <strong>MFL’s live-draft applet</strong>, Saturday at 12:30pm PT. On draft day the CTA becomes the room itself and the draft order is demoted to a secondary link — before that, the order is the useful destination, because the board is empty slots until picks land.',
              tag: "wordmark AL DRAFT · buildMflLiveDraftUrl",
            },
            {
              head: 'National League · email draft',
              html: 'The NL runs a <strong>slow email draft</strong> off MFL’s email-draft page, Sunday at 9am PT — a page that never opens the live applet. Sending either conference to the other’s URL is the bug this split exists to prevent.',
              tag: 'wordmark NL DRAFT · MFL_EMAIL_DRAFT_OPTION',
            },
          ],
        },
        {
          kind: 'prose',
          html: [
            'Because the hero leads with the <strong>viewer’s own</strong> conference, an NL owner would ' +
              'otherwise have no route to the AL board while the AL is actually drafting. So a live sibling ' +
              'conference attaches its board as a secondary link — resolved after the lead event is picked, ' +
              'because a view builder only sees its own event and cannot know the sibling’s live state.',
          ],
        },
        {
          kind: 'persona',
          columns: [
            {
              who: 'AL owner, AL draft day', tone: 'owner',
              lines: [
                'Wordmark reads <strong>AL&nbsp;DRAFT</strong>, card flips to urgency red',
                'CTA is the live draft room, not our board',
                'Draft order demoted to a secondary link',
              ],
            },
            {
              who: 'NL owner, same day', tone: 'guest',
              lines: [
                'Same event, but it is not their draft',
                'CTA watches the AL board instead of entering a room',
                'Their own NL card leads again the next morning',
              ],
            },
          ],
        },
      ],
    },
    {
      num: '05', title: 'The Calendar Decides',
      sub: 'Phases resolve by date; the regular season subdivides into six daily slots',
      blocks: [
        {
          kind: 'prose',
          html: [
            'Which hero shows is not a toggle — it is resolved from the calendar by ' +
              '<code>resolveAflHeroState</code>, on a priority ladder from P0 (an active event: draft day, ' +
              'the trade deadline, championship week) down to P5 (the default). Three phases have an ' +
              'identity of their own and render as composites; the rest render through the AFL’s branded ' +
              'promo card, which is also the fallback whenever no player can be cast. A missing feed ' +
              'degrades to the card that always worked, never to an empty flank.',
          ],
        },
        {
          kind: 'phases',
          shipped: ['keeper-deadline', 'al-draft', 'nl-draft'],
          legend: 'Phases with a shipped composite hero today',
          phases: [
            ['new-season-starts', 'New AFL league year created on MFL'],
            ['keeper-deadline', 'Jun 15 → Jul 15 @ 8:45pm PT'],
            ['al-draft', 'Saturday before Labor Day weekend, 12:30pm PT'],
            ['nl-draft', 'Sunday before Labor Day weekend, 9am PT'],
            ['season-start', 'NFL kickoff'],
            ['regular-season', 'Kickoff → end of the regular season'],
            ['trade-deadline', 'Deadline day (24h override)'],
            ['playoffs', 'Conference brackets'],
            ['championship', 'Championship week matchup card'],
            ['champion-crowned', 'Championship decided → +7 days'],
            ['default', 'Any gap not covered above'],
          ],
        },
        {
          kind: 'slots',
          label: 'Daily slots · regular season',
          slots: [
            ['live-scoring', 'TNF, Sunday, MNF game windows'],
            ['standings', 'Monday pre-game'],
            ['recap', 'Tuesday AM'],
            ['waiver-wire', 'Tuesday PM → Wednesday 8pm'],
            ['article', 'Schefter articles'],
            ['game-day-preview', 'Saturday, Sunday pre-game'],
          ],
        },
      ],
    },
    {
      num: '06', title: 'Casting, by Phase',
      sub: 'Each phase has a purpose-built picker — all deterministic, all shared with TheLeague',
      blocks: [
        {
          kind: 'table',
          headers: ['Function', 'Phase', 'Who it picks'],
          rows: [
            ['castRosterModel', 'Keeper window', 'A headliner from YOUR franchise — your keeper cornerstone. Guests get a league-wide daily pick.'],
            ['castTopFreeAgentModel', 'AL / NL draft', 'The best available by dynasty ADP, from the players nobody in the league rosters yet.'],
            ['castRandomStarterModel', 'Season start', 'Rotates among your likely starters in the first game <em>you</em> play — not merely the week’s earliest.'],
            ['castBestScoredModel', 'Recap slot', 'The week’s highest actual score, with the rostering franchise named in the copy.'],
            ['castRookieModel', 'New season', 'The newest draft class — rookies represent “new”.'],
            ['castFeaturedModel', 'Fresh What’s New entry', 'Exactly the player the entry names, and nobody when it names none.'],
          ],
        },
        {
          kind: 'prose',
          html: [
            'Every picker is <strong>deterministic per Pacific-Time calendar day</strong>: the page is ' +
              'server-rendered, so <code>Math.random()</code> at request time would make two loads disagree ' +
              'and the cache useless. A hash of the PT day-key plus a per-hero seed indexes into the sorted ' +
              'candidate pool — stable all day, rotating at midnight PT so one face doesn’t own the window. ' +
              '<code>?testDate=YYYY-MM-DD</code> drives both the phase and the rotation, so any day’s hero ' +
              'can be previewed on demand.',
          ],
        },
      ],
    },
    {
      num: '07', title: 'One Shell, Two Leagues',
      sub: 'The AFL’s composites are the same components TheLeague ships',
      blocks: [
        {
          kind: 'prose',
          html: [
            'The treatment is not reimplemented here. Seven forked hero components — five spotlights and ' +
              'two panel boards, about three thousand lines under seven CSS prefixes — were unified into ' +
              '<strong>one spotlight shell and one panel board</strong>. Every dimension that genuinely ' +
              'differed between them became a custom property; every palette became a named accent. The AFL’s ' +
              'keeper and draft heroes are configurations of that shell, which is why they arrived with ' +
              'light mode, dark mode, mobile behaviour and a 404 fallback already correct.',
            'The accents are named per <em>hero</em> rather than per colour, and that is deliberate: three ' +
              'of TheLeague’s five were shades of blue that differ in accent, pill and dark surface, and ' +
              'folding them together on the way in restyled live heroes. The AFL adds two more — ' +
              '<code>navy</code> and <code>gold</code> — plus the shared <code>red</code> urgency tone that ' +
              'the cut watch, the keeper deadline and a live draft all reach for.',
          ],
        },
        {
          kind: 'shipped',
          items: [
            { name: 'AflCompositeHero · keepers', cast: 'castRosterModel', desc: 'Trophy gold, <code>KEEPERS</code> wordmark, your keeper cornerstone. Flips to urgency red on the deadline itself.' },
            { name: 'AflCompositeHero · AL draft', cast: 'castTopFreeAgentModel', desc: 'Navy, <code>AL&nbsp;DRAFT</code> wordmark, best available on the board. Red while the room is live; the CTA becomes the room itself for an AL owner.' },
            { name: 'AflCompositeHero · NL draft', cast: 'castTopFreeAgentModel', desc: 'The same card, one page different — the NL drafts by email, so its CTA opens MFL’s email-draft page rather than the live applet.' },
            { name: 'AflEventHero', cast: 'every other phase', desc: 'The branded promo card still renders the calendar events, the daily slot rotation and fresh What’s New entries — and is the fallback whenever a composite can’t cast anyone.' },
            { name: 'Honest scope', cast: 'not composites', desc: 'The playoff and championship heroes are a bracket and a matchup card; the trade-deadline hero is a live countdown. Those do jobs a player composite cannot, so they keep their bespoke components.', muted: true },
          ],
        },
      ],
    },
  ],

  closing: {
    title: 'The Bottom Line',
    paragraphs: [
      'A licensing constraint turned into a rule — every hero means something — and the rule turned into ' +
        'a handful of small deterministic pickers plugged into a calendar that already knew what day it was. ' +
        'The AFL’s twist is that identity here is genuinely ambiguous: two conferences, twenty-four teams, ' +
        'and the same player on two rosters at once. Answering “whose colours?” honestly is one filter and ' +
        'one fallback, and it is the difference between a hero that is about your team and one that is ' +
        'about somebody else’s.',
      'It renders on the server, stays stable for a Pacific-Time day, degrades to a card that always ' +
        'worked when a feed is missing, and looks right in light and dark. No stock photos. No licensed ' +
        'action shots.',
    ],
    filesLabel: 'Key files',
    files: [
      'src/utils/afl-hero-resolver.ts',
      'src/utils/afl-hero-casting.ts',
      'src/utils/hero-franchise-accent.ts',
      'src/components/afl/AflCompositeHero.astro',
      'src/components/shared/CompositeHero.astro',
    ],
    ctas: [
      { label: 'About the AFL', href: '/afl-fantasy/about', primary: true },
      { label: "What's new", href: '/afl-fantasy/news' },
      { label: "TheLeague's version", href: '/theleague/showcase' },
    ],
  },
};

export default content;
