# DEF Spotlight (Free Agents hero — team-defense faces)

TheLeague uses team defenses (D/ST) only, so a DEF free agent has no headshot.
When the Free Agents hero spotlight (`src/pages/theleague/players.astro`) lands on
a team defense, it shows a rotating pool of that team's marquee defenders' ESPN
headshots over the team-logo watermark instead of a bare crest.

## Architecture (data-driven, self-refreshing)

- **`src/data/theleague/def-spotlight-players.json`** — `{ teams: { CODE: [{name, espnId, position}] } }`, top ~6 defenders per team. Consumed by `def-spotlight-players.ts` (`getDefSpotlightPlayers` → pool, `getDefSpotlightPlayer` → primary). Regenerated **weekly** by `scripts/fetch-def-spotlight-players.mjs` (`def-spotlight-sync.yml`).
- **`src/data/theleague/def-marquee-defenders.json`** — flat `names[]` of Pro Bowl + All-Pro defenders, pinned to the front of each pool. Regenerated **yearly** by `scripts/fetch-marquee-defenders.mjs` (`marquee-defenders-sync.yml`, Feb 20 after both classes finalize).
- Client rotation lives in the `players.astro` `<script>`: `startDefRotation`/`applyDefFace` cycle the pool every 4.5s, random start, paused under `prefers-reduced-motion`.

## ESPN API gotchas (ranking defenders)

- **ESPN exposes NO Pro Bowl / All-Pro rosters.** The season awards collection (`.../seasons/{y}/awards`) has only **9 major individual awards** (MVP, DPOY, OPOY, etc.); `athletes/{id}/awards` surfaces just those. There is no Pro Bowl endpoint — that data must come from Wikipedia.
- **Per-team leaders (`.../teams/{id}/leaders`) expose only 3 defensive categories** (`totalTackles`, `sacks`, `interceptions`). That systematically buries coverage corners (few tackles because QBs avoid them) under tackle-happy linebackers. To value corners/edges you need `passesDefended`, `tacklesForLoss`, `QBHits`, forced fumbles — which only appear in the **per-athlete statistics endpoint** (`.../seasons/{y}/types/2/athletes/{id}/statistics`, categories `defensive` + `defensiveInterceptions`). Ranking the current roster means ~40 athletes/team × 32 stat calls (~1.3k, ~60s at concurrency 20) — acceptable in a weekly cron.
- Ranking follows the **live roster** (roster endpoint = source of truth for "who's on the team now"); a star traded in the offseason is scored from his prior-season stats and ranks on his new team.
- Even richer stats can't rescue an **injured/absent star** (e.g. a defender who missed the season) — no counting-stat source will. Pro Bowl/All-Pro pinning is the reputation backstop, but it too only covers players actually selected.

## Wikipedia scraping (marquee list)

- Page titles derive from the season year and are stable: All-Pro = `"{season} All-Pro Team"`, Pro Bowl = `"{season+1} Pro Bowl Games"`. Fetch wikitext via `action=parse&prop=wikitext&formatversion=2`.
- On both pages every defender is a wiki-link immediately followed by their team-season link: `[[Player]], [[YYYY <Team> season|City]]`. Anchor the parse on exactly that pattern inside the **"Defense"** table (bounded by the next "Special teams") so offensive players are never captured. Display name = text after the `|`.
- **The Pro Bowl page has TWO defense tables (AFC + NFC).** Parsing only the first drops ~half the names. Loop over every "Defense" caption whose next ~60 chars contain "Position".
- Name matching against ESPN rosters must be diacritic/suffix-insensitive: normalize by NFD-stripping combining marks, dropping suffix tokens (jr/sr/ii/iii/iv/v), lowercasing, and removing non-alphanumerics — so `T.J. Watt` === `T. J. Watt` and `Kevin Byard III` === `Kevin Byard`.
- The fetch **fails loud** (non-zero exit) if it parses < 30 defenders, so a Wikipedia format change never silently overwrites a good list with garbage.

## Two free-agent hero pages — keep them in sync

There are **two independent Free Agents pages** with **separately-copied** hero-spotlight code — they do NOT share a component:
- `src/pages/theleague/players.astro` (full-featured: cap/contract/auction/surplus)
- `src/pages/afl-fantasy/players.astro` (leaner sibling — AFL has no cap/contracts/auction)

Any hero-spotlight change (DEF rotation, headshot logic, caption behavior) must be applied to **both files**. They drifted once already: the AFL page shipped deliberately *without* the DEF-spotlight machinery ("drops all … DEF-spotlight machinery"), then had it re-added for parity in a later change. If you touch one, grep the other.

- **AFL is team-DEF only (no IDP)**, same as TheLeague, so it imports the *theleague-sourced* `../../data/theleague/def-spotlight-players` directly — the data is keyed by **NFL team code**, so it works cross-league with zero AFL-specific data. No separate `data/afl-fantasy/def-spotlight-players.json` exists or is needed.
- **Hero shows ESPN images only.** Both pages hide the foreground headshot (`visibility:hidden`) when there's no ESPN image rather than falling back to the low-res MFL `player_photos` mugshot or the `no_photo_available` placeholder. A dedicated hero-only `buildHeroOnerror(espnId)` (distinct from the table rows' `buildOnerror`) tries the ESPN *college* headshot, then hides — it never falls back to MFL. Server render seeds this with a `topFaHasHeadshot` flag + inline `style={... 'visibility:hidden'}`.

## Related
- Weekly + yearly sync are separate workflows on purpose — marquee data changes once a year, so scraping Wikipedia weekly would be wasteful and a Wikipedia break shouldn't take down the weekly roster refresh.
