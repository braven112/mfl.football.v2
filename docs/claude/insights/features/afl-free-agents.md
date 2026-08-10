# AFL Free Agents Page

Insights for `/afl-fantasy/players` (`src/pages/afl-fantasy/players.astro`),
its build-time snapshot (`scripts/compute-afl-free-agents.mjs` →
`data/afl-fantasy/derived/free-agents.json`), and the live roster overlay
(`src/utils/afl-free-agents-live.ts`). The SSR-vs-bundle-size story behind
the snapshot is in `domains/deployment.md`.

## 2026-08-08 - "Rostered" Is Per-Conference in a Duplicate-Player League

**Context:** Players dropped weeks earlier (Kyle Pitts, Parker Washington)
never appeared on the AFL free agent page even though the synced feeds were
fresh.

**Insight:** The AFL's registry flag `duplicatePlayers: true` is not just
about the cut-player preflight — it changes what "free agent" means. The
league is two conferences (AL/NL) sharing one player pool, each able to
roster the same NFL player independently. A single global rostered set
(union of all 24 franchises) marks a player unavailable when *either*
conference holds him, hiding every cross-conference drop (~50 players at the
time of the fix). The correct model: map franchises to conferences via the
league feed (`franchise.division` → `division.conference` in `league.json`),
track a rostered set per conference, and define `rostered` = held in EVERY
conference, with `confs` listing the holders so the UI can tag partial
availability ("FA in AL").

**Evidence:** Franchise 0002 (AL) dropped 15329/16192 in July (confirmed in
`transactions.json`), but franchises 0019/0017 (NL) still held them, so the
old global set kept `rostered: true`. Fix in `compute-afl-free-agents.mjs`
grew the FA pool 897 → 947.

**Recommendation:** The conference math has ONE implementation:
`src/utils/afl-conference-rosters.mjs` (plain .mjs so both node scripts and
TS/src import it — same pattern as `leagues-data.mjs`), consumed by the
build-time script and by `applyLiveRosters()` in
`src/utils/afl-free-agents-live.ts`, unit tested in
`tests/afl-free-agents-live.test.ts`. Any AFL surface that reasons about
availability (needs analysis, add-drop tooling, Schefter FA lanes) must
import that module, never re-implement a rostered set — and never a global
one.

## 2026-08-08 - Live Overlay on a Build-Time Snapshot (SSR Freshness Pattern)

**Context:** The snapshot regenerates only at deploy, so roster moves made
on MFL after the last deploy didn't surface until the next one; the user
wants moves visible as they happen.

**Insight:** Because the page is already SSR (apex-routing requirement), the
cheap fix is a request-time overlay: keep the heavy player pool (physicals,
ADP, projections — ~400KB, slow-changing) in the deploy-time snapshot, and
re-derive ONLY roster-membership flags per request from the live MFL rosters
export (~16KB, public, no auth — same `api.myfantasyleague.com` pattern the
lineup pages use). Guardrails that matter: module-level cache (60s success /
20s failure) so traffic can't hammer MFL and an outage can't add a 5s
timeout to every request; treat an all-empty or conference-unmappable
payload as an MFL hiccup and fall back to the snapshot's baked flags; and
never mutate the imported snapshot JSON — it's a module singleton shared
across warm-lambda requests, so the overlay must return copies.

**Evidence:** `src/utils/afl-free-agents-live.ts` (`fetchLiveAflRosters` +
pure `applyLiveRosters`), consumed at the top of
`src/pages/afl-fantasy/players.astro`; fallback paths covered in
`tests/afl-free-agents-live.test.ts` (including the no-mutation test).

**Recommendation:** Reuse this split for any SSR page fed by a derived
snapshot that needs one fast-moving slice to be fresh: snapshot for the bulk,
tiny live fetch for the volatile flags, short cache, loud-free fallback.
Note the derived faCounts/topFa must be recomputed after the overlay — the
baked ones bake in the stale flags.

## 2026-08-08 - The Page Renders ONE Conference at a Time (Hard Boundary)

**Context:** Even with per-conference `confs` data, a mixed league-wide list
confused owners — an AL owner saw NL-available players they can't add.

**Insight:** For duplicate-player conference leagues, availability UI should
be conference-SCOPED, not conference-ANNOTATED. The page defaults to the
signed-in owner's conference (session JWT → `franchiseConferences` map from
the snapshot; AL for signed-out), and a hero switcher flips the whole view.
Within a view, "rostered" is view-relative (`p.confs.includes(activeConf)`),
and counts/pills/spotlight re-scope via `conferenceScopedView` in
`afl-free-agents-live.ts`. Cross-conference intel ("FA in NL") only appears
on rows the "Include rostered" toggle reveals — never in the default list.

**Evidence:** `src/pages/afl-fantasy/players.astro` (conf-switcher +
`isRosteredForView`); the two views genuinely differ (Aug 2026: 923 players
each, Burrow tops AL, Lamar tops NL, Pitts AL-only).

**Recommendation:** Any future AFL availability surface should scope to one
conference with an explicit switcher, defaulting to the viewer's own — don't
annotate a merged list.

## 2026-08-10 - Filter Defaults Don't Copy Across Leagues (Rookies)

**Context:** Owners reported rookies (and their ADP) missing from the AFL FA
list. The data was fine — 145 rookies in the snapshot, 72 with dynasty ADP —
but the page copied TheLeague's "Include rookies" filter, which defaults to
OFF because TheLeague rookies enter only through the rookie draft. In the
AFL, rookies are ordinary addable free agents, so the inherited default hid
the entire draft class.

**Insight:** When cloning a sibling league's page, every filter DEFAULT is a
league-policy decision, not shared UI — re-derive it from the league's rules
rather than carrying it over. Two mechanics follow from a default flip:
(1) the SSR counts/spotlight call (`conferenceScopedView({ includeRookies })`)
must mirror the client's default state or the hero numbers pop on hydration;
(2) the filter badge counts deviation-from-default, so a default-ON toggle
increments the badge when UNchecked (`if (!showRookies) count++`) and
"Clear Filters" must reset it back to checked, not false.

**Evidence:** Fix in `src/pages/afl-fantasy/players.astro` (default
`showRookies = true`, checkbox `checked`, inverted badge logic, new
"Rookies only" checkbox that wins over the include toggle). TheLeague's page
keeps its hidden-by-default behavior on purpose.

**Recommendation:** Before shipping any new per-league wrapper of a shared
page pattern, walk the filter defaults against that league's registry flags
and rules (duplicate players, rookie entry path, keepers) — and keep SSR
initial counts wired to the same defaults the client script initializes.
