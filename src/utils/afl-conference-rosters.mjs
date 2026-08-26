/**
 * Shared per-conference roster math for the AFL free agents surface.
 *
 * The AFL is a duplicate-player conference league (league registry
 * `duplicatePlayers: true`): the same NFL player can be rostered once per
 * conference, so a drop only frees the player IN THAT CONFERENCE. "Rostered"
 * for free-agent purposes therefore means "held in EVERY conference", and a
 * player's `confs` lists the conferences currently holding him.
 *
 * This module is the single implementation of that math — imported by BOTH
 * the build-time snapshot script (scripts/compute-afl-free-agents.mjs) and
 * the request-time live overlay (src/utils/afl-free-agents-live.ts). Plain
 * .mjs on purpose, same pattern as src/config/leagues-data.mjs: node scripts
 * and TS/src code can both import it, so the two consumers cannot drift.
 *
 * (src/utils/afl-structure.ts also parses league.json divisions, but for a
 * different job — per-season HISTORICAL structure for standings, including
 * the 2003–2012 six-division eras. This module only needs the current
 * year's franchise → conference availability map; don't merge the two
 * without accounting for the historical shapes.)
 */

/**
 * Build the conference structure from an MFL league export
 * (franchise.division → division.conference). Returns
 * `{ ids, names, franchiseConferences }` or null when the league has no
 * usable multi-conference structure (missing pieces, a single conference,
 * or any franchise that can't be mapped) — null means "one shared pool".
 */
export function buildConferenceStructure(leagueJson) {
  const divisions = leagueJson?.league?.divisions?.division;
  const conferences = leagueJson?.league?.conferences?.conference;
  const franchises = leagueJson?.league?.franchises?.franchise;
  if (!divisions || !conferences || !franchises) return null;
  const divArr = Array.isArray(divisions) ? divisions : [divisions];
  const confArr = Array.isArray(conferences) ? conferences : [conferences];
  const frArr = Array.isArray(franchises) ? franchises : [franchises];
  if (confArr.length < 2) return null;
  const divToConf = {};
  for (const d of divArr) {
    if (d?.id != null && d?.conference != null) divToConf[d.id] = d.conference;
  }
  const franchiseConferences = {};
  for (const f of frArr) {
    const conf = f?.division != null ? divToConf[f.division] : undefined;
    if (!f?.id || conf == null) return null; // unmappable franchise → single pool
    franchiseConferences[f.id] = conf;
  }
  const names = {};
  for (const c of confArr) {
    if (c?.id == null) continue;
    const name = c.name || `Conference ${c.id}`;
    names[c.id] = {
      name,
      abbrev: name.split(/\s+/).map((w) => w[0]).join('').toUpperCase(),
    };
  }
  const ids = [...new Set(Object.values(franchiseConferences))].sort();
  // Guarantee a names entry for every id a division references — a division
  // pointing at a conference id absent from the conferences list would
  // otherwise surface raw ids in UI fallbacks ("FA in 01").
  for (const id of ids) {
    if (!names[id]) names[id] = { name: `Conference ${id}`, abbrev: id };
  }
  // Colliding initials ("National League" / "North League" → both "NL")
  // would render identical tags for OPPOSITE availability states; suffix the
  // conference id to keep every abbrev distinct.
  const abbrevCounts = {};
  for (const id of ids) abbrevCounts[names[id].abbrev] = (abbrevCounts[names[id].abbrev] || 0) + 1;
  for (const id of ids) {
    if (abbrevCounts[names[id].abbrev] > 1) {
      names[id] = { ...names[id], abbrev: `${names[id].abbrev}${id}` };
    }
  }
  return { ids, names, franchiseConferences };
}

/**
 * Build per-conference rostered sets from an MFL rosters payload. Returns
 * `{ confIds, rosteredByConf, ownersByConf }` (Map<conferenceId,
 * Set<playerId>> and Map<conferenceId, Map<playerId, franchiseId>>; single
 * shared pool uses one pseudo-conference '') or null when the payload can't
 * be trusted, so callers fall back rather than guess:
 *   - missing/empty `rosters.franchise`;
 *   - multi-conference structure and a franchise the map can't place;
 *   - fewer franchises than expected (partial payload — players held by
 *     the omitted franchises would all be wrongly freed). The expectation
 *     comes from the conference map in multi-conference mode, and from the
 *     optional `expectedFranchiseCount` (e.g. the snapshot's baked count)
 *     in single-pool mode;
 *   - zero rostered players in total (an all-empty export is far more
 *     likely an MFL hiccup than a league-wide roster purge).
 */
export function buildRosteredByConf(rostersJson, conferenceStructure, expectedFranchiseCount) {
  const franchisesRaw = rostersJson?.rosters?.franchise;
  if (!franchisesRaw) return null;
  const franchises = Array.isArray(franchisesRaw) ? franchisesRaw : [franchisesRaw];
  const confIds = conferenceStructure?.ids?.length ? conferenceStructure.ids : [''];
  const franchiseConfs = conferenceStructure?.franchiseConferences ?? {};
  const multiConference = confIds.length > 1;
  const expected = Math.max(
    multiConference ? Object.keys(franchiseConfs).length : 0,
    expectedFranchiseCount ?? 0,
  );
  if (expected > 0 && franchises.length < expected) return null;
  const rosteredByConf = new Map(confIds.map((id) => [id, new Set()]));
  // WHO holds him, not just that someone does — the free-agent surfaces name
  // the owning franchise. Kept per conference for the same reason the sets
  // are: in a duplicate-player league the AL's holder and the NL's holder are
  // two different franchises, and only the viewed conference's is the answer.
  const ownersByConf = new Map(confIds.map((id) => [id, new Map()]));
  let totalRostered = 0;
  for (const franchise of franchises) {
    const confId = multiConference ? franchiseConfs[franchise?.id ?? ''] : confIds[0];
    const confSet = confId != null ? rosteredByConf.get(confId) : undefined;
    if (!confSet) return null; // unmapped franchise → don't guess
    const rosterPlayers = franchise?.player
      ? Array.isArray(franchise.player)
        ? franchise.player
        : [franchise.player]
      : [];
    const confOwners = ownersByConf.get(confId);
    for (const p of rosterPlayers) {
      if (p?.id) {
        confSet.add(String(p.id));
        // MFL allows one copy per conference, so a second holder in the same
        // one is a league misconfiguration, not a case to model: first writer
        // wins and the set already counted him.
        if (!confOwners.has(String(p.id))) confOwners.set(String(p.id), String(franchise.id));
        totalRostered++;
      }
    }
  }
  if (totalRostered === 0) return null;
  return { confIds, rosteredByConf, ownersByConf };
}

/**
 * Conferences currently holding a player. `rostered` (= unavailable to
 * everyone) is `confsForPlayer(...).length === confIds.length`.
 */
export function confsForPlayer(playerId, { confIds, rosteredByConf }) {
  const id = String(playerId);
  return confIds.filter((cid) => rosteredByConf.get(cid).has(id));
}

/**
 * `{ [conferenceId]: franchiseId }` for the conferences holding a player —
 * absent conferences mean he is available there. `{}` for a free agent, and
 * `{}` from a caller that built its sets by hand without owners (the
 * empty-rosters fallback), which reads downstream as "no owner to name"
 * rather than as a wrong one.
 */
export function ownersForPlayer(playerId, { confIds, ownersByConf }) {
  const id = String(playerId);
  // Annotated because this module is type-checked as JS: a bare `{}` infers
  // the empty type, and every consumer's `Record<string, string>` then fails.
  /** @type {Record<string, string>} */
  const out = {};
  if (!ownersByConf) return out;
  for (const cid of confIds) {
    const owner = ownersByConf.get(cid)?.get(id);
    if (owner) out[cid] = owner;
  }
  return out;
}
