/**
 * Spots a real NFL player or team in a team logo name, so the prompt can hint
 * at it (team-logo-prompt.ts).
 *
 * Fantasy names are puns on real people and clubs: "Mahomes Alone", "Bijan
 * Mustard", "Lambeau Packers". Brandon's rule (2026-10-30): hint at the
 * reference as much as possible (the joke, the position, the moves, the
 * colors) but never draw the real person's face or copy a team's logo,
 * helmet, uniform or wordmark. No AI: a word match against the players every
 * ranking source rates highly (scripts/compute-logo-reference-players.mjs) and
 * the 32 club nicknames.
 */

import referencePlayers from '../data/team-logo-reference-players.json';
import { getNFLTeamName, NFL_TEAM_NAMES } from './nfl-logo';

export type LogoReference =
  | { kind: 'player'; name: string; position: string; team: string }
  | { kind: 'team'; nickname: string; team: string };

/**
 * Words too common to name a player on their own: "Brown" in a team name is
 * not a nod to A.J. Brown. A FULL name still matches ("AJ Brown Bears").
 */
const COMMON_WORDS = new Set(
  (
    'adams allen anderson bailey baker barnes bell bennett black brooks brown campbell carter chase cole coleman ' +
    'collins cook cooper cox davis evans fisher ford foster gibson golden graham gray green hall hamilton harris ' +
    'hayes henderson hill howard hughes hunt jackson james jenkins johnson jones jordan king lee lewis long love ' +
    'martin mason miller mitchell moore morris murphy nelson perry pope powell price reed reynolds rice richardson ' +
    'robinson ross russell sanders scott simmons smith stewart stone sullivan swift taylor thomas thompson walker ' +
    'wallace ward watson west white williams wilson wood wright young'
  ).split(' '),
);

/**
 * First names that are everyday names (or places) too: "Dallas Destroyers" is
 * not about a player called Dallas. Only a distinctive first name ("Bijan",
 * "Saquon", "Dak") names a player on its own.
 */
const COMMON_FIRST_NAMES = new Set(
  (
    'adam alec alvin antonio ashton baker blake bryce cade carson chase cooper dallas daniel darius darnell darren ' +
    'david derrick devin devon dylan emanuel emmett garrett greg harold hunter isaac isaiah jake james jared jerry ' +
    'joe jonah jonathan jonathon keaton keenan kendrick kirk mark marvin mason nicholas nico omar parker patrick ' +
    'quentin ricky rico roman rome romeo ryan seth skyler tanner ted tee terrance terry tony trevor trey tucker ' +
    'tyrone xavier zach zachariah'
  ).split(' '),
);

const SUFFIXES = new Set(['jr', 'sr', 'ii', 'iii', 'iv', 'v']);

/** Lowercase letters-and-digits words: "A.J. Brown" → ["aj", "brown"], "D'Andre" → ["dandre"]. */
function words(text: string): string[] {
  return `${text ?? ''}`
    .toLowerCase()
    .replace(/[.'’]/g, '')
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

interface Candidate {
  first: string;
  last: string;
  full: string[];
  ref: Extract<LogoReference, { kind: 'player' }>;
}

let candidates: Candidate[] | null = null;
let uniqueFirst: Set<string>;
let uniqueLast: Set<string>;

function playerCandidates(): Candidate[] {
  if (candidates) return candidates;
  candidates = (referencePlayers.players as Array<{ name: string; position: string; team: string }>).map((p) => {
    const full = words(p.name).filter((w) => !SUFFIXES.has(w));
    return {
      first: full[0] ?? '',
      last: full[full.length - 1] ?? '',
      full,
      ref: { kind: 'player', name: p.name, position: p.position, team: getNFLTeamName(p.team) },
    };
  });
  const count = (key: 'first' | 'last') => {
    const seen = new Map<string, number>();
    for (const c of candidates!) seen.set(c[key], (seen.get(c[key]) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n === 1).map(([w]) => w));
  };
  uniqueFirst = count('first');
  uniqueLast = count('last');
  return candidates;
}

/** "ab cd" appears as consecutive words in `hay`. */
function hasRun(hay: string[], run: string[]): boolean {
  if (!run.length) return false;
  for (let i = 0; i + run.length <= hay.length; i += 1) {
    if (run.every((w, j) => hay[i + j] === w)) return true;
  }
  return false;
}

/** A word on its own names a player only when it is theirs alone and not an everyday word. */
const distinctive = (w: string, unique: Set<string>) => w.length >= 3 && unique.has(w) && !COMMON_WORDS.has(w);

/**
 * The real player or club the owner's name or idea nods to, or undefined.
 * Strongest match first: a full player name, then a surname, then a first
 * name, then a club nickname.
 */
export function findLogoReference(...texts: string[]): LogoReference | undefined {
  const hay = words(texts.join(' '));
  if (!hay.length) return undefined;
  const players = playerCandidates();
  const set = new Set(hay);
  const player =
    players.find((c) => c.full.length > 1 && hasRun(hay, c.full)) ??
    players.find((c) => set.has(c.last) && distinctive(c.last, uniqueLast)) ??
    players.find((c) => set.has(c.first) && distinctive(c.first, uniqueFirst) && !COMMON_FIRST_NAMES.has(c.first));
  if (player) return player.ref;

  for (const team of Object.values(NFL_TEAM_NAMES)) {
    const nickname = team.split(' ').pop() as string;
    if (set.has(nickname.toLowerCase())) return { kind: 'team', nickname, team };
  }
  return undefined;
}

const POSITION_NAMES: Record<string, string> = {
  QB: 'quarterback',
  RB: 'running back',
  WR: 'wide receiver',
  TE: 'tight end',
  PK: 'kicker',
};

/** The sentence the prompt adds for a reference, asking the AI to hint at it as hard as it can. */
export function referencePromptLine(ref: LogoReference): string {
  if (ref.kind === 'player') {
    const role = POSITION_NAMES[ref.position] ?? 'player';
    return (
      `The name is a nod to NFL ${role} ${ref.name} of the ${ref.team}: hint at that as strongly as you can ` +
      '(the joke in the name, the position, signature moves and celebrations, nicknames, and the team colors where they fit the colors above), ' +
      "but with an original cartoon character, never the real person's face or likeness."
    );
  }
  return (
    `The name is a nod to the ${ref.team}: echo that team's spirit, mascot idea and colors as strongly as you can ` +
    '(where they fit the colors above), with all-new art.'
  );
}

/** The friendly note shown under the prompt when a reference is spotted. */
export function referenceNote(ref: LogoReference): string {
  if (ref.kind === 'player') {
    return `Sounds like a nod to ${ref.name}. Nice. The prompt asks the AI to hint at them as much as it can, without drawing their real face or copying a team logo.`;
  }
  return `“${ref.nickname}” is an NFL team’s name. Nice. The prompt asks for the ${ref.team}’ spirit and colors, with new art instead of their logo.`;
}
