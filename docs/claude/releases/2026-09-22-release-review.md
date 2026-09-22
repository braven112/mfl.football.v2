# Release review — 2026-09-22

**Verdict: NO-GO** — `staging` does not contain `main`, so the promotion
cannot fast-forward. Clearing it means resolving the staging merge-down, which
has failed on every run since 2026-09-20. The shorter path is to **fix it**:
five conflicts, two of them real Live-board merges. Pulling features off the
train would not help, because the conflicts sit in the Live feature itself.
Once the merge-down is green and the *fix before promotion* items below are
applied, this becomes a GO, provided the Owners' Poll adopt step is run at
promotion (see *Stored-shape compatibility*).

**Range:** `origin/main...origin/staging` (`6b7a784618...d3c2eaf63b`,
merge base `a87d63e23c`). 11 commits, 243 files, +20,325/−2,056.
**Blackout:** `release-blackout.mjs` reports Tuesday 2026-09-22 clear to promote.

## Features on the train

| PR | What |
|---|---|
| #1174 | Full-league boards on MFL Live (`/live/league/[id]`) |
| #1177 | Live rows: position on the meta line, beside the NFL team |
| #1180 | NFL Brand Book: a page per club, derived reversed cuts, dark pipeline carries vector |
| #1181 | Brand Book: a team branding page for every AFL and TheLeague club |
| #1183 | Blend in-progress projections instead of echoing the live score |
| #1164 | Owners' Poll: always-open standing votes, no quorum, homepage card |
| #1187 | Live bench disclosure reads as a control |
| #1188 | Broadcast board no longer dies overnight |
| #1186 | Preferred team: "no preference" stops resolving to franchise 0001 |
| #1189 | Four-colour palette for all 40 franchises; Brand Book documents the slots |
| #1190 | Pecking Order: crest inline with the team name |

## Blocks promotion

1. **Fast-forward impossible: the merge-down is failing.**
   `git merge-base --is-ancestor origin/main origin/staging` fails. `main`
   carries about 210 commits `staging` lacks. Most are cron data, but they
   include hotfix #1178 (hold the last confirmed live scores), #1182
   (flat-shape leagues on MFL Live, uploaded marks) and the 10105 widget work.
   `staging-merge-down.yml` has failed on every run through at least #518. A
   trial merge conflicts in:
   - `src/components/shared/live/LiveBoard.tsx`: #1174's standings/leaders
     tabs versus #1178's panel-hold memory. Both are needed; they touch
     disjoint concerns in the same regions.
   - `src/components/shared/live/LvMatchupCard.tsx`: `LvCrest` (#1174) versus
     `LvMark` (#1182). Take `LvMark`; see *Fix before promotion* 1.
   - `.claude/hooks/path-guard.json`: union both sides' globs and tests.
   - `src/data/weekly-changelog-staging.json`: union both sides' entries.
   - `tests/fixtures/typecheck-baseline.json`: neither side is right;
     re-measure with `pnpm test:types` after the merge.

## Stored-shape compatibility

Only the Owners' Poll (#1164) touches storage, and it **changes the ballot
model**:

| Key | Status | Can current production read what staging writes? |
|---|---|---|
| `poll:<slug>:standing:<seasonYear>` (hash) | NEW, season-scoped standing ballots | Nothing on `main` reads it, so fine in that direction |
| `poll:<slug>:paused` | NEW, commissioner pause flag, fails open | Nothing on `main` reads it, so fine |
| `poll:<slug>:<year>-w<week>` (hash) | LEGACY, no longer written by the live path | n/a |
| `poll:<slug>:current` (window pointer) | LEGACY, no longer read | n/a |

The hazard runs in the **other** direction. Until promotion, production keeps
opening a weekly window (Tuesday pass) and collecting ballots into the week
hash. Once promoted, the tally reads only the standing hash. Without a
migration, every ballot cast in production this week is invisible to the new
code, and Thursday's close would tally nothing. A zero-ballot week now posts
nothing at all.

`scripts/owners-poll-adopt-standing.mjs` is the designed one-shot for this. It
is deliberately not wired into any cron. **Required at promotion, per league,
before Thursday's `owners-poll-close` (Thu 23:30 / Fri 00:30 UTC):**

```bash
node scripts/owners-poll-adopt-standing.mjs --league theleague   --week <open week> --dry-run
node scripts/owners-poll-adopt-standing.mjs --league theleague   --week <open week>
node scripts/owners-poll-adopt-standing.mjs --league afl-fantasy --week <open week> --dry-run
node scripts/owners-poll-adopt-standing.mjs --league afl-fantasy --week <open week>
```

It needs Upstash credentials (`vercel env pull`). Staging-cast ballots are
already in the standing hash and need nothing. If the promotion slips past
Thursday, ballots owners cast on staging hosts this week are not in
production's tally. That is a reason not to slip, not a blocker.

Expand/contract was not used. This is a cut-over plus a one-shot migration,
which is acceptable only because the migration is explicit and listed here.

## Build rehearsal

`PREBUILD_FULL=1 pnpm prebuild` on `staging`: **all 27 steps passed in 34 s**,
exit 0. Warnings (ESPN news 403, MFL 2027 ADP 404, ESPN roster fallback,
2028 draft date) all predate the range.

Derived-file diffs versus the committed copies are almost all staging's stale
data (no merge-down since 09-20). There is one exception, caused by code in
range: #1189 changed Vitside Mafia's `color` (`#f06abc` → `#7c221f`) in
`theleague.config.json` without recomputing
`data/theleague/derived/franchise-history.json`. The production build
regenerates it, so production is correct. The committed copy (read by slim
previews and `pnpm dev`) stays stale until the next derived-chain run. Benign,
and self-heals.

## Fix before promotion

1. **Two crest renderers written in parallel on two branches.** `LvCrest`
   (`src/components/shared/live/LvCrest.tsx`, #1174, used by
   `LvMatchupCard`, `LvStandings`, `LvLeaders`) and `LvMark`
   (`src/components/shared/live/LvMark.tsx`, #1182 on `main`). `LvMark` is a
   strict superset: it has the `onError` fall-through to initials and the
   crop for uploaded banners, both added after the 2026-09-21 "Rhinos logo"
   layout break. Shipped as-is, the new standings table and top-scorers strip
   reintroduce that bug. Each side was invisible to the other's PR. **Fix
   inside the merge-down:** switch all three callers to `LvMark`, delete
   `LvCrest`, and drop its line from both path lists in
   `.github/workflows/chromatic.yml`.
2. **#1186's fix did not reach the AFL trade builder.**
   `src/pages/afl-fantasy/front-office/trade-builder.astro:114` falls back to
   `authUser?.franchiseId ?? '0001'`. That branch is only reached when the
   viewer is NOT an AFL owner, so the session id is always another league's
   franchise number, which is exactly the cross-league bug #1186 removed from
   TheLeague's twin. Replace it with the explicit `'0001'` default. The rules
   doc allows a named default on a one-club surface.
3. **The franchise pages load the NFL brand kit for two pure functions.**
   `src/utils/franchise-marks.ts:38` imports `luminance`/`inkOn` from
   `nfl-marks.ts`. That module loads `nfl-brand-kit.json` (3.2k lines) plus
   both assignment files, and builds `TEAMS` when it loads (`:14-16`, `:78`).
   `luminance` is only a re-export of `relativeLuminance`
   (`team-color-contrast.ts`). This sits on the SSR path of both leagues'
   `franchises/[id].astro`. Import from `team-color-contrast` directly; move
   `inkOn` and the shared threshold there too (see 4).
4. **The 0.42 "light ground" threshold is written three times across two
   PRs** (`nfl-marks.ts:93,107`, `franchise-marks.ts:413`), and the comment
   says they must agree. Export one constant beside `inkOn` in
   `team-color-contrast.ts` and use it in all three places. This is the same
   edit as 3.

## Follow-up filed

- **The Brand Book's band preview is not the band the site renders.**
  `franchise-marks.ts:626,648` anchors on raw `colorPrimary` and picks the
  crest by luminance. `franchise-band-brand.ts` uses `resolveBandPair` (the
  swap for hueless `#181818` primaries), always `iconDark || icon`, and
  `BAND_ART_DIRECTION` overrides. So the page misdocuments exactly the
  franchises the band logic exists for, while its header claims parity. Read
  `buildFranchiseBandBrands` instead; this touches the grounds model and its
  tests.
- **Guard gap: `preferred-team-resolution-guard` only inspects resolver
  arguments.** It missed finding 2 because the AFL trade builder resolves
  inline. Widen it to flag `authUser?.franchiseId ??` fallbacks in
  `src/pages/**` (`/guard-test`).
- **Brand pages are SSR** (`prerender = false` on all three `[team]` routes,
  justified by `Astro.locals.hideLeaguePrefix`). The content is static per
  team. Worth checking whether the prefix really needs a request.
- **`inkOn` accepts roughly 3:1 contrast** for grounds with luminance
  0.18–0.42, which is below AA for body text on the Brand Book pages.
- **`franchise-marks.ts#slugify`** is a new, weaker slugger beside
  `owner-tenures.mjs#kebab`: no diacritic folding, and apostrophes dropped
  instead of hyphenated. Decide before `/brand/<slug>` URLs get linked from
  outside.

## Ratchets

| Baseline | Before | After | Why |
|---|---|---|---|
| typecheck | 1425 | 1423 | Owners' Poll JSDoc typing (#1164). Must be re-measured after the merge-down |
| page-fork | — | unchanged | Brand pages ship as thin wrappers over shared components |
| clientrouter-init | — | unchanged | |

## Observed on `main`, not from this range

`pnpm test:unit` on `main` HEAD `6b7a784618` (no staging code) has **5
failing data tests**:
- `division-strength-data`: the 2026 ledger disagrees with `schedule.json`
  for 16 TheLeague franchises (the ledger is two weeks behind).
- `offseason-hero-data` ×3: the committed 2026 feed now carries week 2, so
  the pinned "latest scored week = 1" no longer holds.
- `top-players-data`: Marvin Mims is owned by 0015 in `top-players.json` but
  not in `rosters.json`.

All three are derived data drifting behind the cron-synced inputs: the
derived-chain lane problem CLAUDE.md describes, plus a test pinned to a week
that has since passed. The merge-down will pull them into `staging`, so
recompute the chain (`scripts/recompute-derived-chain.mjs`, top-players) and
update the `offseason-hero` fixture before promoting, or CI on the
promotion commit will be red.

## Checked, nothing found

- **Sibling drift:** best-ball-1 twins are correctly absent (draft-only).
  Mock draft and roster twins resolve identity by league through their own
  AFL helpers. The trade builder is the exception, and is item 2 above.
- **Standings re-sort:** `src/utils/live/standings.ts` keeps MFL's feed order;
  the only `.sort` is cache eviction.
- **Absolute URLs:** Owners' Poll GroupMe text goes through `leagueUrl`; new
  components use relative hrefs.
- **Hydration:** one new `client:load` (a new page, `/live/league/[id]`) and
  one `client:idle` island on both homepages (Owners' Poll prompt; `idle` is
  correct because it renders null until its fetch resolves). The homepage
  card reads the ranking from a build-time glob, so there is no Redis on SSR.
- **N+1:** the league board reads scores and standings in one `Promise.all`,
  each cached, with no per-franchise loop.
- **Projection blending** reuses `blendedProjection`/`attachRowProjections`.
- **Bundle size:** `check-bundle-size.mjs --src` passes.
- **Chromatic:** expect diffs on the Live components (`LvMatchupCard`,
  `LvBench`, `LvPlayerRow`: #1174, #1177, #1187) and the Sunday Ticket board
  (#1183).

Not checked: `gemini-ask` is not installed in the cloud container, so the
duplication sweep ran through a subagent instead.
