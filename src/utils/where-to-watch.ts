/**
 * Where to watch — for each NFL game the viewer's starters are in, the channel
 * it is on in their country and the app on THIS TV that opens it.
 *
 * PURE. The rows come from the overlay's Watch list (`overlayWatchList`, the
 * owner's own starters only — his call, Oct 2026), the channel from
 * `resolveChannel`, and the apps from the TV app's bridge (`MflTvHost.apps()`),
 * which lists the apps installed on the TV. Nothing here knows what anyone
 * PAYS for: an app can't see another app's subscription, so an installed app
 * is the best answer there is, and the owner said a "pick your TV service"
 * setting was not worth asking for (Oct 2026).
 *
 * What a row's OK does, also the owner's call:
 *  - a game on YouTube TV (every US TV network, Sunday Ticket included) asks
 *    the TV's own search for the game. YouTube TV publishes no link to a game,
 *    and Google TV's result for "Seattle Seahawks vs San Francisco 49ers"
 *    offers the game in YouTube TV or Sunday Ticket, one step from playing;
 *  - a streamer (Prime Video, Netflix, DAZN, ...) opens its app directly;
 *  - nothing installed fits: the TV's search, which knows every app.
 *
 * US and Canada get apps; the other countries the channel map knows still get
 * the channel's name, with the search to open it.
 */
import { normalizeUsNetwork, parseCountry, resolveChannel, type ChannelInfo, type CountryCode } from './broadcast-channels';
import type { WatchGame } from './broadcast-overlay';

/** One app the TV might have. Matched by package first, then by its launcher label. */
export interface WatchService {
  id: string;
  name: string;
  /** Known Android TV / Fire TV package names. */
  packages: readonly string[];
  /** Matches the app's launcher label when its package is one we don't know. */
  label: RegExp;
}

export const WATCH_SERVICES = {
  youtubeTv: { id: 'youtubeTv', name: 'YouTube TV', packages: ['com.google.android.youtube.tvunplugged'], label: /^YouTube TV$/i },
  primeVideo: { id: 'primeVideo', name: 'Prime Video', packages: ['com.amazon.amazonvideo.livingroom', 'com.amazon.firebat'], label: /prime video/i },
  netflix: { id: 'netflix', name: 'Netflix', packages: ['com.netflix.ninja'], label: /^netflix$/i },
  youtube: { id: 'youtube', name: 'YouTube', packages: ['com.google.android.youtube.tv', 'com.amazon.firetv.youtube'], label: /^YouTube$/i },
  espn: { id: 'espn', name: 'ESPN', packages: ['com.espn.score_center', 'com.espn.gtv'], label: /^ESPN\b/i },
  peacock: { id: 'peacock', name: 'Peacock', packages: ['com.peacocktv.peacockandroid'], label: /^peacock/i },
  paramount: { id: 'paramount', name: 'Paramount+', packages: ['com.cbs.ott'], label: /^paramount/i },
  dazn: { id: 'dazn', name: 'DAZN', packages: ['com.dazn'], label: /^DAZN\b/i },
  tsn: { id: 'tsn', name: 'TSN', packages: [], label: /^TSN\b/i },
  ctv: { id: 'ctv', name: 'CTV', packages: [], label: /^CTV$/i },
} satisfies Record<string, WatchService>;

type ServiceId = keyof typeof WATCH_SERVICES;

/**
 * The apps that carry a channel, best first, per country. US TV networks lead
 * with YouTube TV (the owner's own service, and every network is on it), then
 * the network's own streamer. Canada leads with the channel's own app, then
 * DAZN, which carries every game there.
 */
const US_APPS: Record<string, ServiceId[]> = {
  CBS: ['youtubeTv', 'paramount'],
  FOX: ['youtubeTv'],
  NBC: ['youtubeTv', 'peacock'],
  ESPN: ['youtubeTv', 'espn'],
  ABC: ['youtubeTv', 'espn'],
  'NFL Network': ['youtubeTv'],
  'Prime Video': ['primeVideo'],
  Netflix: ['netflix'],
  YouTube: ['youtube'],
  Peacock: ['peacock'],
};

const CA_APPS: { match: RegExp; apps: ServiceId[] }[] = [
  { match: /DAZN/i, apps: ['dazn'] },
  { match: /TSN/i, apps: ['tsn', 'dazn'] },
  { match: /CTV/i, apps: ['ctv', 'dazn'] },
  { match: /Netflix/i, apps: ['netflix'] },
  { match: /Prime Video/i, apps: ['primeVideo'] },
  { match: /YouTube/i, apps: ['youtube'] },
];

/** An app the TV app reports as installed. */
export interface InstalledApp {
  pkg: string;
  label: string;
}

/** What OK does on a row. `fallback` is a package the TV opens if its search can't. */
export type WatchAction =
  | { kind: 'search'; query: string; fallback?: string }
  | { kind: 'app'; pkg: string };

export interface WatchRow extends WatchGame {
  /** The channel in the viewer's country; null before ESPN names a network. */
  channel: ChannelInfo | null;
  /** The app the row opens, or null when none on the TV fits (or we can't tell). */
  app: { name: string; pkg: string | null } | null;
  /** The small print: "YouTube TV · Sunday Ticket", "Only if it's your local game". */
  how: string;
  /** True when this is a regional Sunday game the viewer may not get. */
  maybe: boolean;
  action: WatchAction;
}

/** A row matched to the TV's apps. `null` installed means the app can't tell us (a browser, an older build). */
function findInstalled(id: ServiceId, installed: readonly InstalledApp[]): InstalledApp | null {
  const service: WatchService = WATCH_SERVICES[id];
  return (
    installed.find((app) => service.packages.includes(app.pkg)) ??
    installed.find((app) => service.label.test(app.label.trim())) ??
    null
  );
}

/**
 * A network we don't know (or none yet) gets no app: naming YouTube TV for a
 * streaming exclusive would send the owner to the wrong place. A regional
 * game watched through Sunday Ticket only plays in YouTube TV, so the
 * network's own streamer (Paramount+ for CBS) is not offered for it.
 */
function candidatesFor(game: WatchGame, channel: ChannelInfo | null, ctx: WatchContext): ServiceId[] {
  if (ctx.country === 'US') {
    if (game.regional && ctx.sundayTicket) return ['youtubeTv'];
    return US_APPS[normalizeUsNetwork(game.network)] ?? [];
  }
  if (ctx.country === 'CA' && channel) return CA_APPS.find((c) => c.match.test(channel.name))?.apps ?? ['dazn'];
  return [];
}

export interface WatchContext {
  country: CountryCode;
  sundayTicket: boolean;
  /** The TV's apps, or null when nothing reported them. */
  installed: readonly InstalledApp[] | null;
}

export function watchRow(game: WatchGame, ctx: WatchContext): WatchRow {
  const channel = resolveChannel(game.network, ctx.country);
  const candidates = candidatesFor(game, channel, ctx);

  let pick: { id: ServiceId; app: InstalledApp | null } | null = null;
  if (ctx.installed) {
    for (const id of candidates) {
      const app = findInstalled(id, ctx.installed);
      if (app) {
        pick = { id, app };
        break;
      }
    }
  } else if (candidates[0]) {
    // We can't see the TV's apps, so name the likeliest one without a launch.
    pick = { id: candidates[0], app: null };
  }

  const regional = ctx.country === 'US' && game.regional;
  const maybe = regional && !ctx.sundayTicket;
  const appName = pick ? WATCH_SERVICES[pick.id].name : null;

  let how: string;
  if (regional) {
    how = ctx.sundayTicket ? 'YouTube TV · Sunday Ticket' : 'Only if it’s your local game';
  } else if (appName) {
    how = appName;
  } else if (!game.network) {
    how = 'Channel not announced yet';
  } else {
    how = 'Search on your TV';
  }

  let action: WatchAction;
  if (pick?.app && pick.id !== 'youtubeTv') action = { kind: 'app', pkg: pick.app.pkg };
  else action = { kind: 'search', query: game.query, ...(pick?.app ? { fallback: pick.app.pkg } : {}) };

  return {
    ...game,
    channel,
    app: pick && appName ? { name: appName, pkg: pick.app?.pkg ?? null } : null,
    how,
    maybe,
    action,
  };
}

export function watchRows(games: readonly WatchGame[], ctx: WatchContext): WatchRow[] {
  return games.map((game) => watchRow(game, ctx));
}

/**
 * The country a viewer watches in: their own choice on /preferences when they
 * made one, else where their connection says they are (Vercel's
 * `x-vercel-ip-country`), else the US. A VPN fools the second, which is what
 * the first is for.
 */
export function watchCountry(chosen: CountryCode | null, ipCountry: string | null | undefined): CountryCode {
  if (chosen) return chosen;
  return parseCountry(ipCountry);
}

/** Parse the bridge's answer; anything malformed reads as "can't tell". */
export function parseInstalledApps(raw: unknown): InstalledApp[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const list = JSON.parse(raw);
    if (!Array.isArray(list)) return null;
    return list
      .filter((a) => a && typeof a.pkg === 'string')
      .map((a) => ({ pkg: a.pkg as string, label: typeof a.label === 'string' ? a.label : '' }));
  } catch {
    return null;
  }
}
