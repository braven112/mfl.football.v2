/**
 * Hero player cut-outs — shared across the AFL and TheLeague event heroes.
 *
 * Listed explicitly (not via import.meta.glob) so the set is greppable and the
 * URLs are stable across builds. Add new images to public/assets/hero-players/
 * and append their basenames here.
 */
export const HERO_PLAYERS = [
  'adams', 'allen', 'bijan', 'bishop', 'breece', 'burks', 'burrow', 'caleb',
  'chase', 'dak', 'drake', 'drakey-maye', 'elliss', 'goff', 'gonz', 'hawks',
  'hurts', 'jefferson', 'jefferson2', 'jeremiyah_love', 'josh', 'lamar', 'love',
  'mahomes', 'maye', 'mccaffrey', 'mills', 'njigba', 'njigba2', 'njigba3', 'pat',
  'pickens', 'puka', 'ramsey', 'sam', 'spears', 'stafford', 'tate', 'trevor',
  'watson',
] as const;

/**
 * Pick a hero player image, seeded by the reference date's day-of-year so the
 * choice is stable for SSR within a given day and re-rolls daily.
 */
export function randomHeroPlayer(seed: Date): string {
  const start = new Date(seed.getFullYear(), 0, 0);
  const day = Math.floor((seed.getTime() - start.getTime()) / 86_400_000);
  const name = HERO_PLAYERS[day % HERO_PLAYERS.length];
  return `/assets/hero-players/${name}.webp`;
}
