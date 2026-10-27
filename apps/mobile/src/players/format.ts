import type { MflLiveAppPlayersSort, MflLiveAppPlayerSummary } from '@mfl/shared-types/mfl-live-app-k';

/** "18.5", or a dash when MFL has no number. */
export function stat(n: number | null, digits = 1): string {
  return n === null ? '–' : n.toFixed(digits);
}

export function pct(n: number | null): string {
  return n === null ? '–' : `${Math.round(n)}%`;
}

/** "RB · ATL · Bye 5" */
export function playerLine(p: MflLiveAppPlayerSummary): string {
  return [p.position, p.team, p.bye ? `Bye ${p.bye}` : null].filter(Boolean).join(' · ');
}

/** MFL's injury words, shortened to the badge owners know from MFL. */
export function injuryBadge(status: string | null): string | null {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.startsWith('ir')) return 'IR';
  if (s.startsWith('out')) return 'O';
  if (s.startsWith('doubt')) return 'D';
  if (s.startsWith('quest')) return 'Q';
  if (s.startsWith('susp')) return 'SUS';
  return status.slice(0, 3).toUpperCase();
}

/** Who has him in this league, or that he is free. */
export function ownerLine(p: MflLiveAppPlayerSummary): string {
  if (p.isFreeAgent) return 'Free agent';
  if (p.owners.length === 0) return 'Not available';
  return p.owners.map((o) => o.name).join(', ');
}

export const SORT_LABEL: Record<MflLiveAppPlayersSort, string> = {
  proj: 'Projected',
  pts: 'Points',
  owned: 'Owned',
};

/** The number the list's right column shows for the chosen sort. */
export function sortValue(p: MflLiveAppPlayerSummary, sort: MflLiveAppPlayersSort): string {
  if (sort === 'owned') return pct(p.ownedPct);
  if (sort === 'pts') return stat(p.points);
  return stat(p.projected);
}
