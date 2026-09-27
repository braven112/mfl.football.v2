/**
 * The custom-site demo's keeper league config (data/keeper/keeper.config.json),
 * which exists only in a demo build's checkout. Read through a glob, never a
 * static import — a missing file would fail every other build — and kept free
 * of other imports so low-level brand helpers can read it too.
 */
const configs = import.meta.glob<any>('../../data/keeper/keeper.config.json', { eager: true, import: 'default' });

/** The keeper league's config — an empty league anywhere but a demo build. */
export const keeperLeagueConfig: { teams: any[]; [key: string]: any } =
  Object.values(configs)[0] ?? { teams: [], conferences: [], divisions: [] };
