/**
 * Which MFL draft the broadcast board is watching.
 *
 * By default: this league's own draft, from the registry — never a literal
 * (see `tests/league-literal-guard.test.ts`).
 *
 * WHY AN OVERRIDE EXISTS. The board's live half — poll, diff, queue, reveal —
 * only runs when picks are actually landing in MFL, and that happens once a
 * year for about two hours. `?rehearse=` replays a FINISHED season through the
 * real ingest path, which proves the reveal pipeline but not the network one:
 * it never calls `/api/draft/status`, so it cannot catch a wrong league id, a
 * wrong draft unit, a host that 404s, or a franchise id that doesn't resolve to
 * a crest. The only honest test of "does this board follow a live draft" is to
 * point it at a live draft.
 *
 * So: copy the league in MFL, turn on the draft in the copy, and load the real
 * board with `?mflLeague=<copy id>`. The page renders as its own league —
 * franchise names, colours, crests, board ranks, keepers — and takes its PICKS
 * from the copy. Everything downstream of the poll is the code that runs on
 * draft night, unmodified.
 *
 * Three rules keep that from being a liability:
 *
 *  - **The host is allowlisted to MFL.** `resolveMflHost` accepts only
 *    `*.myfantasyleague.com`. `/api/draft/status` fetches whatever host it is
 *    handed, so a free-text host parameter on a public page would be a
 *    server-side request forgery with a URL bar for an interface.
 *  - **The league id must look like one.** Digits only, so the override can
 *    only ever name an MFL league.
 *  - **An override is always ON SCREEN.** `sourceLabel` renders as a flag over
 *    the board, the same way a rehearsal does. A test feed that looks exactly
 *    like the real board is how a room ends up watching the wrong draft.
 */

/** MFL's league-agnostic export host — right for a league we have no registry
 *  entry for, since a copy can live on any `www##` and the API host serves
 *  every league's exports. */
export const MFL_EXPORT_HOST = 'api.myfantasyleague.com';

/** Hosts `/api/draft/status` may be pointed at. */
const MFL_HOST_PATTERN = /^[a-z0-9][a-z0-9.-]*\.myfantasyleague\.com$/i;

/** An MFL league id is digits. Bounded so a pathological string can't ride
 *  into a URL. */
const MFL_LEAGUE_ID_PATTERN = /^\d{1,10}$/;

export interface BroadcastSourceFallback {
  leagueId: string;
  mflHost: string;
  /** The draft unit this page would watch on its own — `CONFERENCE00`,
   *  `LEAGUE`, and so on. */
  unit: string;
}

export interface BroadcastSource {
  leagueId: string;
  mflHost: string;
  /**
   * Draft unit to request, or `null` for "whichever unit the board has".
   *
   * `null` is not a shrug: `selectDraftUnit` answers a missing unit with the
   * first one on the board, and `/api/draft/status` answers a NAMED unit that
   * isn't there with a 404. A copy league made "draft only" may well carry a
   * single unnamed unit where the real league drafts by conference, so asking
   * for `CONFERENCE00` by name would fail against exactly the league this
   * override exists to test.
   */
  unit: string | null;
  /** True when the board is watching something other than its own league. */
  isOverride: boolean;
  /** On-screen flag text. Empty when there is nothing to warn about. */
  label: string;
}

/** Normalize a host parameter, or fall back. Never returns a non-MFL host. */
export function resolveMflHost(raw: string | null | undefined, fallback: string): string {
  const value = (raw || '').trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  return MFL_HOST_PATTERN.test(value) ? value.toLowerCase() : fallback;
}

/**
 * Is this a complete https URL on an MFL host?
 *
 * For URLs taken from RESPONSE BODIES rather than from our own parameters —
 * specifically `static_url`, which `/api/draft/status` follows to read MFL's
 * static draft file. That value arrives inside a third-party JSON document, so
 * "it starts with https://" is not a check: it would let anything in that
 * response body name a host this server then fetches. Same allowlist as
 * `resolveMflHost`, applied to the parsed hostname so a path, credential or
 * query segment carrying `myfantasyleague.com` cannot pass for one.
 */
export function isMflUrl(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return false;
  }
  return parsed.protocol === 'https:' && MFL_HOST_PATTERN.test(parsed.hostname);
}

/** Normalize a league-id parameter. Returns null when it isn't one. */
export function resolveMflLeagueId(raw: string | null | undefined): string | null {
  const value = (raw || '').trim();
  return MFL_LEAGUE_ID_PATTERN.test(value) ? value : null;
}

/**
 * Resolve the feed the board should watch from the page's query string.
 *
 * Recognised parameters:
 *   `mflLeague` — MFL league id to follow instead of this league's own.
 *   `mflHost`   — MFL host serving it. Defaults to the export host, which
 *                 serves every league, so nobody has to know the copy's `www##`.
 *   `unit`      — draft unit to request. `auto` (or empty) means "the first
 *                 unit on the board".
 *
 * With no `mflLeague`, every one of them is ignored and the league's own feed
 * is returned unchanged — the override cannot half-apply.
 */
export function resolveBroadcastSource(
  params: URLSearchParams,
  fallback: BroadcastSourceFallback
): BroadcastSource {
  const leagueId = resolveMflLeagueId(params.get('mflLeague'));
  if (!leagueId) {
    return {
      leagueId: fallback.leagueId,
      mflHost: fallback.mflHost,
      unit: fallback.unit,
      isOverride: false,
      label: '',
    };
  }

  const mflHost = resolveMflHost(params.get('mflHost'), MFL_EXPORT_HOST);
  const unit = resolveBroadcastUnit(params, fallback.unit);

  return {
    leagueId,
    mflHost,
    unit,
    isOverride: true,
    label: `Test feed · MFL league ${leagueId}${unit ? ` · ${unit}` : ''}`,
  };
}

/**
 * Which unit an OVERRIDE asks for.
 *
 * An explicit `?unit=` wins. Otherwise: if the URL named a conference, the
 * caller has said which board they mean and we ask for it by name; if it did
 * not, we ask for whatever the copy has. That default is what makes a
 * single-draft copy of a conference league work without a second parameter,
 * while `?conference=01` still reaches the National board of a full copy.
 */
function resolveBroadcastUnit(params: URLSearchParams, fallbackUnit: string): string | null {
  const raw = (params.get('unit') || '').trim();
  if (raw) {
    const value = raw.toLowerCase();
    return value === 'auto' || value === 'any' ? null : raw.toUpperCase();
  }
  return params.get('conference') ? fallbackUnit : null;
}
