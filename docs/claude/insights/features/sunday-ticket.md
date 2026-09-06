# Sunday Ticket — the multi-league multiview board

Plan and decisions: `docs/plans/sunday-ticket.md` (built 2026-09-04/05, branch
`claude/sunday-ticket-matchup-preview-3025b7`). This file holds the learnings
that are not in the plan.

## 2026-09-05 - What the build taught, in one place

- **The old spec was 80% already built by other features.** Of thirteen
  requirements in `.kiro/specs/dynamic-matchup-previews`, only the 4-box
  multiview was genuinely absent; live scoring, lineup optimization, IR
  moves, injury news, brackets and the player model all existed under other
  names. Read a stale spec as a map of what NOT to rebuild.
- **One cross-league board needs no second login.** `user.id` in the session
  IS the MFL cookie and `export?TYPE=myleagues` lists every league the account
  is in — so an owner on `theleague.us` sees their AFL team too. The login
  flow already made that call and discarded all but one league. Empty answer
  = dead cookie (`docs/claude/auth.md`).
- **Default set is the leagues this site runs, outside leagues opt in.** An
  owner in six other people's leagues (or with test leagues) should not have
  them counted or fetched unasked; off means no MFL read at all. Best Ball is
  registered but draft-only, so it folds in with the outside leagues
  (`isHomeLeague`). The chips are links + a cookie, and the cookie is written
  by the ROUTE — a component's `Astro.cookies.set()` blanks the page
  (CLAUDE.md).
- **A country is a data entry, not a code change — almost.** Adding the UK and
  Mexico (2026-09-06, for the league's owner in Great Britain) was one block
  each in `broadcast-mappings.json` plus the code list in
  `broadcast-channels.ts` — `COUNTRY_CODES`, the flag, and nothing else: the
  chips, the boxes, the window headers and the clocks all read the registry.
  Three things were NOT data: `parseCountry` now takes aliases, because `UK` is
  what a British owner types and it silently returned the US board; the
  free-to-air line (below); and the marks, which have to exist on disk and be
  re-measured (`pnpm measure:tv-logo-contrast`) or dark mode ships a black
  wordmark on a black card.
- **A free-to-air channel cannot be reached through the network map.** Sky gets
  every UK game, so `CBS → Sky Sports` is total — but Channel 5 also shows two
  of them, and WHICH two is Channel 5's call, not a property of CBS. A channel
  entry with no mapping key pointing at it is dead config: `7mate` sat in the
  AU block from the day the board shipped and could never render. The
  `freeToAir` block + `freeToAirOption` say it in one line under the chips
  instead, and 7mate finally appears.
- **The DAZN mark was never Canadian.** It shipped as `dazn-ca.png` because
  Canada was the only country that had it; the UK and Mexico both draw the same
  square for NFL Game Pass. Renamed to `dazn.png` / `dazn-black.png` — a mark's
  filename should say what it IS, not who first used it.
- **The mark treatment had to run in BOTH directions, and the crests' one
  threshold did not transfer.** The dark-card ring
  (`scripts/measure-tv-logo-contrast.mjs` → `tv-logo-theme-css.ts`) was built
  from the crest pipeline, which only ever asks "does this dissolve into
  #262626". Broadcaster brands broke that assumption: Channel 5 is a yellow 5
  and Kayo is light green, and on a WHITE card they are exactly what a black
  crest is on a dark one — with no light-mode artwork to swap to. Same ring,
  `TV_LOGO_LIGHT_STROKE_COLOR`, guarded on `html:not(.dark)` (unguarded, it
  would ink a dark outline around the white artwork a `logoDark` swaps in).
  The threshold is the part that does NOT carry over: at the dark pass's 0.5
  the light pass rings CBS, NBC, RedZone and Prime, whose INTERIORS are pale
  but whose silhouettes read fine. A mark with pale detail is not a pale mark
  — 0.25 splits them, and the measured gap is wide (Kayo 18%, then nothing
  until Prime at 36%).
- **Where the marks came from is now written down.** The originals (PR #972)
  were committed with no provenance — not in the plan, not in the commit
  body, nowhere — so nobody can re-cut one at a different size or check a
  brand refresh against its source. The 2026-09-06 additions record it below,
  and anything added later should too.

  | Mark | Source |
  |---|---|
  | `sky-sports-uk.png` | Wikipedia `File:Sky Sports logo 2020.svg` |
  | `channel-5-uk.png` | Wikipedia `File:Channel 5 2025.svg` |
  | `tudn-mx.png` | Wikipedia `File:TUDN Logo.svg` |
  | `fox-mx.png` | Wikipedia `File:FOX wordmark.svg` |
  | `nfl-network.png` | Wikipedia `File:NFL Network logo.svg` |

  All pulled through `https://en.wikipedia.org/wiki/Special:FilePath/<File>?width=640`,
  which renders an SVG to a transparent PNG server-side — no local conversion,
  and the only Wikimedia URL shape that works: `upload.wikimedia.org/.../<N>px-`
  thumbs 400 on any width not in their allow-list, and the API rate-limits to
  roughly one request every 20 seconds (429 with `retry-after`).
- **Country picks channels AND clocks.** `broadcast-mappings.json` maps each
  US network to DAZN/TSN/CTV, Kayo, Sky or FOX/ESPN/TUDN México and carries
  each country's `timeZones` — one clock for the UK, two everywhere else;
  Australia reads Monday 3am AEST for a Sunday 1pm ET kickoff,
  and the day is shown whenever it differs from the game's own. Marks get the
  team-crest dark treatment from their own manifest
  (`docs/claude/rules/theming-and-assets.md`), never a white pill.
  **SUPERSEDED 2026-09-06:** the country still picks the channels, the carrier
  and which clocks are on OFFER, but which one you read is a viewer preference
  now — one chosen zone plus the league's PT beside it
  (`docs/claude/rules/viewer-preferences.md`,
  `docs/claude/insights/features/viewer-preferences.md`).
- **The Sunday hero is a gate, not a slot.** `game-day-preview` spans
  Saturday and Sunday morning; Saturday is the lineup reminder, Sunday is the
  board, and from Saturday 5pm an owner whose lineup is CONFIRMED in gets the
  board early (`sunday-ticket-window.ts`, `lineup-submitted.ts`). Unknown
  keeps the reminder — a hero that stops nagging an owner with no lineup is
  the worse failure. One cached live `weeklyResults` read, only in that
  window, only for a signed-in owner.
- **What the follow-ups are.** ESPN's dark Raiders cut ships on an opaque
  white background (site-wide dark swap, separate session); the rest of the
  spec's orphan web (`mock-matchup-data`, `types/matchup-previews`, …) is a
  separate cleanup.
