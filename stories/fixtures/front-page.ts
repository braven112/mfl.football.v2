/**
 * A frozen front-page model for the Storybook stories: Archie's teams and art,
 * a doubleheader week, a Gauntlet lead and a podium. Hand-written, not read
 * from the feeds, so a snapshot never moves with the season.
 */
import type { FrontPageModel, FrontTeamArt } from '../../src/components/shared/front-page/types';

// Crest paths are written out whole: tests/chromatic-path-filter.test.ts reads
// them literally to know which assets re-trigger a snapshot.
const team = (id: string, name: string, icon: string, a: string, b: string, record: string): FrontTeamArt => ({
  franchiseId: id,
  name,
  icon,
  gradient: `linear-gradient(115deg, ${a} 0%, ${b} 100%)`,
  crest: icon,
  round: true,
  href: '#team',
  record,
});

export const frontTeams: Record<string, FrontTeamArt> = {
  '0001': team('0001', 'Rhinos', '/assets/archies/icons/0001.webp', '#2a3a58', '#d8672b', '1-7'),
  '0002': team('0002', 'Freeze', '/assets/archies/icons/0002.webp', '#397999', '#0d375b', '3-5'),
  '0003': team('0003', 'Goats', '/assets/archies/icons/0003.webp', '#674439', '#b77c12', '4-4'),
  '0004': team('0004', 'Waves', '/assets/archies/icons/0004.webp', '#07434a', '#39190a', '7-1'),
  '0005': team('0005', 'Lions', '/assets/archies/icons/0005.webp', '#0a4879', '#24a7e7', '8-0'),
  '0006': team('0006', 'Chickens', '/assets/archies/icons/0006.webp', '#461919', '#a5451a', '5-3'),
};

const headshot = (espnId: string) => `https://a.espncdn.com/i/headshots/nfl/players/full/${espnId}.png`;

export const signedInModel: FrontPageModel = {
  leagueName: "Archie's",
  strip: {
    week: 5,
    state: 'upcoming',
    scope: 'division',
    games: [
      { sides: [{ franchiseId: '0001', score: null }, { franchiseId: '0002', score: null }], mine: true },
      { sides: [{ franchiseId: '0001', score: null }, { franchiseId: '0003', score: null }], mine: true },
      { sides: [{ franchiseId: '0004', score: null }, { franchiseId: '0005', score: null }], mine: false },
      { sides: [{ franchiseId: '0006', score: null }, { franchiseId: '0002', score: null }], mine: false },
    ],
    hidden: 95,
  },
  stripHref: '#scores',
  band: {
    team: frontTeams['0001'],
    standing: '11th in the Payton Manning Division',
    week: 5,
    opponents: [frontTeams['0002'], frontTeams['0003']],
    links: [
      { label: 'Roster', href: '#roster' },
      { label: 'Lineup', href: '#lineup' },
      { label: 'Standings', href: '#standings' },
    ],
  },
  signInHref: null,
  lead: {
    id: 'post-1',
    kind: 'gauntlet',
    kicker: 'The Gauntlet',
    headline: 'The Gauntlet: Waves walk into a buzz saw at 54 difficulty',
    dek: 'Week 5 is the league-wide wall. Four teams face nightmare schedules, while schedule luck is finally catching up to a perfect record.',
    href: '#gauntlet',
    franchiseIds: ['0004'],
    at: '2026-10-07T21:07:00Z',
  },
  headlines: [
    {
      id: 'rivalry-5-0002',
      kind: 'rivalry',
      kicker: 'Your rivalry · Week 5',
      headline: 'Freeze have won the last 3 against Rhinos',
      href: '#rivalry',
      franchiseIds: ['0001', '0002'],
      pinned: true,
    },
    {
      id: 'rivalry-5-0003',
      kind: 'rivalry',
      kicker: 'Your rivalry · Week 5',
      headline: 'First meeting: Rhinos vs Goats',
      href: '#rivalry',
      franchiseIds: ['0001', '0003'],
      pinned: true,
    },
    {
      id: 'move-1',
      kind: 'transaction',
      kicker: 'Transaction',
      headline: 'Chickens add Braelon Allen and drop David Montgomery',
      franchiseIds: ['0006'],
      at: '2026-10-10T18:00:00Z',
      action: { label: 'Official move', href: '#transactions' },
    },
  ],
  cards: [
    {
      id: 'recap-4',
      kind: 'recap',
      kicker: 'Week 4 in the books',
      headline: "Lions post the week's best score, 234.73",
      dek: "Waves edged Goats by 1.38, the week's closest game.",
      href: '#recap',
      franchiseIds: ['0005'],
    },
    {
      id: 'rivalry-5-0002',
      kind: 'rivalry',
      kicker: 'Your rivalry · Week 5',
      headline: 'Freeze have won the last 3 against Rhinos',
      dek: '1–3 all-time in 4 meetings. Last time, 2025 week 9, Freeze won 131.20–98.45.',
      href: '#rivalry',
      franchiseIds: ['0001', '0002'],
      pinned: true,
    },
  ],
  race: [
    { place: 1, team: frontTeams['0005'], line: '8-0 · 729.3 pts', star: { name: 'CeeDee Lamb', headshot: headshot('4241389') } },
    { place: 2, team: frontTeams['0004'], line: '7-1 · 669.2 pts', star: { name: 'Jahmyr Gibbs', headshot: headshot('4429795') } },
    { place: 3, team: frontTeams['0006'], line: '5-3 · 645.3 pts', star: null },
  ],
  raceTitle: 'The race',
  raceHref: '#standings',
  wire: [
    { id: 'w1', headline: 'CeeDee Lamb limited in practice with an ankle', href: '#wire', at: '2026-10-10T20:00:00Z', source: 'ESPN', onMyRoster: true },
    { id: 'w2', headline: 'Jahmyr Gibbs set for a bigger workload', href: '#wire', at: '2026-10-10T16:00:00Z', source: 'NFL.com', onMyRoster: false },
  ],
  teams: frontTeams,
  leagueMark: { light: '/assets/logos/archies-head.webp', dark: '/assets/logos/archies-head.webp' },
  times: {
    'post-1': { line: 'Wed 2:07 PM PT', day: 'Wed' },
    'move-1': { line: 'Sat 11:00 AM PT', day: 'Sat' },
  },
};

/** A visitor: no band, a sign-in prompt, the league's top games, no rivalries. */
export const guestModel: FrontPageModel = {
  ...signedInModel,
  strip: { ...signedInModel.strip!, scope: 'league', games: signedInModel.strip!.games.map((g) => ({ ...g, mine: false })) },
  band: null,
  signInHref: '#sign-in',
  headlines: signedInModel.headlines.filter((s) => !s.pinned),
  cards: signedInModel.cards.filter((s) => !s.pinned),
};

export const rivalryOverlays = { 'rivalry-5-0002': { text: '1–3', label: 'All-time' } };
