# Schefter — multi-league rules, redaction, tipster context

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Schefter multi-league (tips + rumor mill run for BOTH leagues)

The tips → rumor-mill system is multi-tenant since July 2026. Load-bearing
rules — breaking any of these cross-contaminates the leagues:

- **Redis keys** go through `scripts/lib/schefter-keys.mjs#schefterKey(
  navSlug, suffix)` — TheLeague keeps its legacy unprefixed keys
  byte-identical, every other league gets `schefter:<navSlug>:*`.
  `tests/schefter-keys.test.ts` freezes the legacy strings and forbids raw
  `'schefter:'` literals outside the helper. Id-keyed namespaces
  (reactions/replies/threads/impressions/tipster_hash_for_tip) are global
  by design via `globalSchefterKey`.
- **API routes**: authed routes resolve the league from the session JWT
  (`src/utils/schefter-league.ts#resolveSchefterLeague`); public routes take
  `?league=<slug|navSlug>` defaulting to TheLeague. Never import a league's
  config/feed directly in a schefter route — use the helpers.
- **Season years** for tipster counters use each league's own rollover
  clock (`schefterSeasonYear`) — AFL rolls June 1, TheLeague Feb 14.
- **Scanner**: `schefter-rumor-scan.mjs --league <slug>`, one league per
  invocation, sequential workflow steps (parallel would race the feed
  commit). Per-league enablement = registry `features.schefterTips`; the
  `SCHEFTER_RUMOR_MILL_ENABLED` env var is only the global kill switch.
  The trade-offer lane and GroupMe mention ingestion are TheLeague-only
  (`scripts/lib/schefter-leagues.mjs` toggles) — AFL needs its own design
  for duplicate players before that lane can open.
- **Trade-block lane runs in BOTH leagues** (`features.tradeBait`, since
  Sep 2026). `schefter-scan.mjs#scanTradeBait` enqueues into the tips queue
  the rumor-scan drains, so its keys MUST come from the scanned league
  (`schefterKey(league.slug, …)`) — a module-level TheLeague literal put AFL
  listings in TheLeague's GroupMe. And seeding is per LEAGUE, not per
  franchise: MFL's `tradeBait` export omits franchises with an empty block,
  so a franchise absent from an already-seeded state diffs against `[]` and
  its first listing posts. Per-franchise seeding silently swallowed the first
  listing of every franchise not on the block at launch (11 of TheLeague's
  16 had not listed yet). And the export is OWNER-GATED for a private league:
  the AFL answers a bare request with an empty 200, so the fetch carries
  `MFL_APIKEY` (league-scoped — it must be a key for 19621) and the scanner
  holds state when a league with committed listings suddenly reads as empty
  (and refuses to seed from a keyless empty answer). Its MFL year comes from
  `scripts/lib/schefter-league-year.mjs#leagueYearFor` — the AFL rolls June 1,
  so the calendar heuristic the other scan lanes still use would aim it at a
  league year MFL hasn't created from Feb to June.
  `tests/schefter-trade-bait-league-scope.test.ts` pins all of it.
- **Lore/persona** is per-league under `data/schefter/<navSlug>/`
  (personality, league-lore, running-bits, post-history, topic-recurrence).
  No legacy-path fallback on purpose — a missing file fails loudly rather
  than silently reading the other league's voice.
- **Pages** are thin per-league wrappers over shared components
  (`src/components/schefter/{TipPage,StyleBookPage,RumorThread,
  AdminDashboard}.astro`) — build tip-page improvements in the component
  once and both leagues inherit them.
- **Topics** come from `src/config/schefter-topics.mjs` — single source of
  truth for ids, labels, placeholders, per-league availability (AFL has no
  `motive`; hotseat is "Relegation watch" there), and scanner naming
  policies (tampering = explicit-pick-only + mandatory hedge; hotseat =
  never-name + scope floor + 14d per-team cooldown). Legacy `commish`
  normalizes to `frontoffice`. Adding a topic requires a scanner
  TOPIC_NOUNS entry — the scanner asserts coverage at startup.
- **Admin** is league-scoped end to end: `adminFranchiseIds` in
  nav-config.json is a per-league map, `isCommissionerOrAdmin` checks the
  session's own league, and both admin pages gate on
  `isAuthorizedForLeague`. AFL franchise 0001 must never pass TheLeague's
  admin gate (different teams, same id).

### Franchise-name redaction — a team answers to every name it ever had

`redactFranchiseNamesInText` in `schefter-rumor-scan.mjs` is the mechanical
backstop for every "Schefter may not name that team" rule — the prompt asks
the LLM not to, this makes it unable to. It scrubs franchise mentions out of
the tipster's raw `text` before the text reaches the prompt, so the token
harvest it runs on is load-bearing, not bookkeeping:

- **Harvest `history[]` (all four name fields per entry) AND `aliases[]`, not
  just the four current name fields.** A retired name identifies a franchise as
  well as the current one and *better* in the AFL, where the last-place
  punitive rebrands are recent and memorable. That gap shipped "Hearing Balls
  Deep and a former Cock Gobbler front office…" (Aug 2026) — a second team
  named in a post allowed to name exactly one, because "Cock Gobbler" is The
  Show's 2025 rebrand and lived only in `history[]`. Both configs are deep
  here: ~250 retired name forms and ~90 aliases across the two leagues.
  `loadTeams` has to carry both fields through or the harvest can't see them.
- **Redact the RESULT, never inside the scope classifier.** `resolveTipScope`
  returns from a dozen branches; a scrub at its tail only protects whichever
  paths fall through, and `league-wide` and `commish` returned raw text for
  months for exactly that reason. `redactSafePayload` runs on whatever the
  classifier hands back, so a new branch is safe by default. It also covers
  **every** free-text field, not just `text` —
  `threadFollowup.parentHeadlineSnippet` is lifted from a published post that
  may legitimately have named a franchise and pinned onto a tip that's fully
  anonymous, and it reaches the prompt through the same `JSON.stringify`.
- **Match with `(?<!\w) … (?!\w)`, never `\b … \b`.** A word boundary can't
  exist after a token ending in punctuation, so `\bBe Rough!\b` matches
  nothing — eight real AFL names (`The Blunt Bros.`, `Lucky Buck$`,
  `Be Rough!`, …) survived redaction verbatim. And run ONE alternation pass,
  not a `replace()` per token: sequential passes re-scan their own output, so
  normalizing "Smokane" → "Smokane FC" then matching "Smokane" again yields
  "Smokane FC FC". Guard tests must not rebuild the same regex to detect
  leaks — ours did, and was blind to precisely the bug it guarded.
- **`keepFranchise` is one display name but a franchise owns many.** Resolve
  it to the franchise and normalize that team's other forms (alias, retired
  name) to the canonical name; redact everything else. Comparing the one
  string fuzzes the kept team's own nicknames and lets Schefter print
  last-season's punishment name for a team he's allowed to name.
- Over-matching is the safe direction — a miss leaks an identity — but it is
  **not free, and the old "a stray hit just fuzzes a word" framing was wrong**.
  `[a team]` is a SEMANTIC INSERTION: it asserts a franchise reference where
  none existed, and HARD RULES 2/3 then order the LLM to make the tip's content
  survive the fuzz, so the model invents a team's involvement out of "put out
  feelers". A leak names the wrong team; this fabricates one on a tip nobody
  scoped to a franchise. Because the harvest floor is two characters and
  matching is case-insensitive, ~40 real name forms are ordinary words, and
  every one of these was live (Aug 2026): "Deal is dead." → "Deal is [a team]."
  (`DEAD`), "a heavy favorite" (`Heavy`), "put out feelers" (AFL `Feelers`),
  "headed to the Saints" (AFL `Saints` — an NFL club), "Swift is being shopped"
  (AFL `Swift` — an NFL player).
  The relaxation is **two gates, and both must pass**, because two different
  questions are involved and only one is answerable by hand:
  - `AMBIGUOUS_NAME_TOKENS` (curated) — "is this an ordinary English word?"
    Judgment; not derivable. Team-flavored forms that merely happen to be
    words ("Mafia", "Generals", "Pigs") stay out.
  - `computeRelaxableTokens` (derived from the configs) — "is this a name
    people currently CALL the team?" A token relaxes only if EVERY appearance
    across both leagues is an MFL `abbrev` or a RETIRED `history[]` form. The
    moment any franchise wears it as a live `name`/`nameMedium`/`nameShort`/
    alias it is blocked everywhere. Currently 21 relax, 12 are blocked
    (`saints`, `balls`, `feelers`, `herd`, `chat`, `swift`, `fire`, `pain`,
    `indians`, `cowboy`, `dream`, `baked`). This half **self-maintains**:
    rename a team to "Fire" and `fire` drops out on its own.

  Then `readsAsOrdinaryProse` relaxes on **case alone** — lowercase passes,
  any capital redacts. Two relaxations were tried and reverted, both because
  they leaked real franchises: relaxing sentence-initial capitals (destroys
  the only signal there is, and that position is where a tipster names a team
  as the subject — five AFL franchises leaked), and relaxing every ambiguous
  token regardless of whether it is a live nickname ("hearing saints is
  shopping a tight end" reached the prompt intact). Don't re-litigate either
  without re-running the sweep.

  Two more things hold it together: multi-word tokens match with
  `withFlexibleSeparators`, because "dead-cap" otherwise misses "Dead Cap"
  entirely and falls apart into `dead`, letting the FULL name through — every
  Set lookup therefore goes through `canonicalizeNameKey` or the kept team's
  own hyphenated name gets demoted to `[a team]`. The separator set is
  space/hyphen/underscore/slash **plus a period only when not followed by
  whitespace**: a period is also a full stop, so widening it naively welds
  "The deal is dead. Cap space is tight." into one phantom team. And the prose check runs
  **before** the keep-franchise branches, or an ordinary word that is one of
  the kept team's own forms gets rewritten to that team's display name ("the
  deal is Dead Cap Walking"), the same fabrication wearing a real name.
  `tests/schefter-franchise-name-redaction.test.ts` runs the real configs
  through the anonymizer and fails on any surviving alias or retired name —
  one tip per token, each placed mid-sentence in its config casing, because a
  bare `tokens.join(' / ')` cannot express position and position is now
  load-bearing.

### A named team must OWN the players named beside it

The trade-offer lane's graduated reveal names one franchise and, from signal 2,
one or more players. The playbook's wording asserts ownership — "Hearing the
[team] have [Player] on the table" — so the pairing is a factual claim about a
real owner's roster, not flavour.

`buildExposure` (`scripts/lib/redact-trade-offer.mjs`) used to pick the team by
hashing the offer id and the players from `allAssets`, BOTH sides of the offer
merged, with no relationship between the two choices. Roughly half of every
signal-2+ post therefore credited a team with a player it did not own. It
shipped as "the Mavericks have had Colston Loveland on the table" — Loveland is
a Pacific Pigskins player and Maverick was trying to ACQUIRE him (commissioner
report, 2026-09-07). To the owner being described it reads as pure invention.

Three rules hold it together:

- **Sides stay attached to the franchise giving them up.** `franchise1_gave_up`
  are fid1's players, `franchise2_gave_up` are fid2's; `playersByFid` keeps them
  apart. Never merge them into one pool that a team name is then attached to.
- **A team sending only picks cannot be described as shopping a player.** When
  the coin-flip team has no players of its own, the other side is named
  instead — still deterministic, so later signals about the same offer do not
  flip teams.
- **`escalatedPlayer` is scoped the same way once a team is named.** At tier
  `named` the playbook lets the LLM print that player's name, and
  `exposure.team` sits in the same payload — so an escalated player from the
  other side reproduces the identical bug through a different field. With no
  team named, nobody is being credited and the unscoped pick stands.

`tests/redact-trade-offer-attribution.test.ts` runs the real Loveland offer
through six offer ids so both sides of the coin flip are exercised. Note that
`tests/redact-trade-offer-exposure.test.ts` previously PINNED the bug — its
"caps at the number of players actually in the offer" case expected the
opponent's player listed beside the named team. A guard test can encode a
defect as an invariant; read the fixture before assuming a failing test means
the fix is wrong.

Retracting a post that already shipped is `scripts/schefter-retract-post.mjs`,
never a hand edit — the feeds are cron-written, so a hand edit is invisible in
review. It deliberately leaves the scanner's `posted`/exposure state alone, or
the same offer regenerates the same wrong post on the next scan.

### The drip — a beat may only assert what the feeds can see

**Read "The rumor mill is a beat, not an advertising feed" below first.** Since
2026-09-08 a proposal must clear a 7-day repost cooldown and win a fresh daily
roll to reach signal 2 at all, so the ladder below describes what a
re-surfacing offer may REVEAL, not a sequence the lane works through. Most
proposals now post once and never come back. The rules in this section still
hold for the rare offer that does.

`scripts/lib/schefter-offer-beats.mjs` is the second dimension of the
trade-proposal reveal. Before it, signal N named the hash-chosen team and `N-1`
of that team's players in ADP order and nothing else, so post seven was post two
with a longer list — a lane covering six live proposals read as if it reported
every rumor in the league. Beats add the deal's shape, MFL's own expiry clock,
and cross-references against the public trade block, and `leadKind` names the
ONE fact that is new this signal so the prompt opens on it.

- **A name now lands every OTHER signal** (`plannedPlayerCount`: 0,0,1,1,2,2,3…)
  and a beat carries the signals in between. That is what makes it a drip rather
  than a countdown, and it is why
  `tests/redact-trade-offer-exposure.test.ts` reads `exposureCount: 2` where it
  used to read `1`. Both ladders are monotone: a name or a beat that has shipped
  is never withdrawn — the reader is assembling a picture.
- **`blockByFid` is a `Map`, and a MISSING franchise must drop the beat.** "Not
  on anybody's block" is exact only because a player can be listed on one block
  — his own owner's. `feed.tradeBaitState` holds five of sixteen franchises
  today, so an object-of-arrays that can't tell "no block read" from "empty
  block" would report a player as unlisted on the strength of never having
  looked.
- **Every count over "all proposals" is a FLOOR, never a total.** The
  league-wide `pendingTrades` read has returned nothing on every scan since the
  lane went live (`commish sourced 0`); the six visible proposals are the ones
  owners self-reported by loading the trades page. `third_desk` and
  `position_run` therefore carry `atLeast: true` and the playbook forbids
  "exactly" / "only" / a league total.
- **`block_stale` says what is listed, never that nobody called.** Absence of a
  proposal we can see is not absence of interest, and the beat has no field that
  could express one — `tests/schefter-offer-beats.test.ts` pins its key set for
  exactly that reason.
- **Beats are not a second name surface.** `exposure.players` stays
  authoritative; `buildMarketBeats` takes `nameablePlayerIds` and drops to
  position-level phrasing for anyone outside it, so the other side's players are
  never printable however far the ladder runs. `buildExposure` returns
  `playerIds`/`chosenFid` for that purpose and `redactTradeOffer` rebuilds
  `exposure` without them — the block the playbook calls the authoritative name
  surface keeps exactly its three published fields.
- **The named team comes from `chosenFid`, not from matching the display name
  back through `teamMap`.** Two franchises can carry the same display string,
  and the name lookup then hands the beats the wrong side's roster — the same
  class of bug as the Loveland attribution above, one layer down.
- At the end of both ladders (offer 1076 was on signal 7 the day this shipped)
  `leadKind` rotates through the unlocked beats rather than parking on one.
- **A beat leads only on the signal that UNLOCKED it.** Deriving "new" from
  `unlockedBeatCount(signal)` alone is wrong the moment a proposal qualifies
  for fewer beats than its signal number: with one beat available, every even
  signal re-led on it and the rotation was unreachable — post seven reading
  like post two, the exact failure the layer exists to remove. Compare against
  what the PREVIOUS signal had unlocked, capped at the beats that exist.
- **The named escalation tier must not reach the beats.** `nameablePlayerIds`
  is `exposure.players` and nothing else. Admitting the named-tier
  `escalatedPlayer` — on the reasoning that the ladder already authorizes his
  name — let a beat print him at signal 4 while `exposure.players` still held
  one other name, two signals before the drip meant it.
- **Anti-leak Rule B has to cover `deal_shape` too.** It drops `pickTokens` at
  the named tier because a name plus a pick round identifies the deal; the
  shape beat reaches the prompt through a different field and was republishing
  the same labels verbatim, with the playbook inviting the model to use them.
- **The stored shape is the ask AS OF THE LAST REPORT, not the last scan.**
  Written every scan, a changed ask was detectable for exactly one cycle — at
  ~8 scans a day against a 5–35% roll, most changes were overwritten before
  they could post. Anchored to the report, the beat means "changed since we
  last told you", which survives until it is made.
- **Counting beats must count only LIVE proposals.** `positionRuns` is built
  before the expiry filter, so it has to apply the same check itself;
  `owner_reports` keeps resolved proposals indefinitely, and `atLeast` does not
  make a stale count true.
- **The seed store is keyed on navSlug in BOTH lanes.** The writer uses
  `NAV_SLUG`; the reader must resolve it through the registry rather than
  passing the league slug. They are the same string for TheLeague and differ
  everywhere else, so a slug works today and silently splits the store on the
  second league.

### The rumor mill is a beat, not an advertising feed — three rarity gates

Owner report, 2026-09-08: two rumors in one day about the SAME Fire Ready Aim
offer, 7.5 hours apart — once inside a five-tip multi-desk bucket, once as its
own dedicated story. Nothing had malfunctioned; every gate passed. The gates
were simply far looser than the constants read.

**The base probability was never a per-run probability in practice.**
`OFFER_POST_PROBABILITY` was 0.05 and the offer scan ran on the 15-minute cron,
so each live offer drew ~50 rolls a day and compounded to **~92% within 24
hours**. Nominally a 5% chance; actually a near-certainty. Every offer leaked,
almost immediately, which is what made the lane read as an advertisement for
the trade block rather than as a reporter breaking the occasional story.
Three gates now hold the line, and they are independent — removing any one
puts the lane back:

- **One roll per offer per Pacific day** (`trade_offers:last_roll_date`). This
  is what makes the constant mean what it reads like. The base moved 0.05 →
  **0.10 per DAY**, so an ordinary single-suitor offer is roughly a coin flip
  across a week-long life. **Never re-tune the base without checking the roll
  cadence first** — that is the exact mistake three prior bumps made
  (0.0075 → 0.025 → 0.05, each chasing "proposals age out" while the real
  cause was that the roll fired 50 times a day).
- **A reported offer goes quiet for 7 days** (`trade_offers:last_post`,
  `OFFER_REPOST_COOLDOWN_MS`). Checked BEFORE the daily roll, deliberately: a
  cooling-down offer must not spend its roll, or the `trade_offers:rolls`
  counter stops meaning "chances this offer had to leak". The window sits just
  past the 7-day tip expiry, so nearly every proposal dies inside it and is
  reported exactly once.
- **The cooldown is stamped on DELIVERY, never at enqueue** — off
  `consumedBatch`, beside the other daily budgets, under the
  BUDGET-ON-DELIVERY sentinel. `scanTradeOffers` only QUEUES a tip; the post
  ships later and may never ship at all (quality gate, daily cap, strike-out,
  expiry), and roughly half the offers that pass the roll never become their
  own post. Stamping at enqueue silences an offer for 7 days over a post
  nobody read — and because `TIP_EXPIRY_MS` is also 7 days, that usually means
  never. Note this is exactly where `exposure` is wrong and has always been
  wrong (it counts enqueues); do not copy it.
- **The volume boost SURVIVES all of this.** A player three desks are calling
  about is the genuine breaking story; the gradient from 10%/day up to the
  0.35 ceiling is what separates it from a routine offer. Note the ceiling now
  binds before `OFFER_VOLUME_BOOST_MAX` does (0.10 × 4 = 0.40 > 0.35), so any
  test asserting the raw product pins a number the clamp never returns.

**The exposure boost is GONE and must not come back.** Phase 6c multiplied the
base by `OFFER_EXPOSURE_BOOST_FACTOR ^ priorExposure` so an already-reported
offer raced through its reveal ladder. With a repost cooldown in place that
dial points backwards — the offers it accelerates are precisely the ones the
league has already heard about. `offerPostProbability` therefore takes ONE
argument. `priorExposure` is still read and still threaded through the scanner,
because it decides how much detail a re-surfacing offer may reveal — it just
never touches the odds again. `tests/trade-builder-tip-source.test.ts` pins the
signature and greps the scanner for a re-added second argument.

### The rumor mill's cap inverts with the calendar — and it is the mill's ALONE

`scripts/lib/schefter-rumor-cadence.mjs`. In the offseason the rumor mill IS
the league's conversation; in season the league generates its own drama and
three trade rumors a day on top of it reads as spam.

| When | Cap |
|---|---|
| League asleep | `MAX_POSTS_PER_DAY` (3) |
| League awake — draft weekend through championship Monday | 1/day |
| 10 days into each league's trade deadline, through deadline day | 3 again |

- **It counts on its OWN key** (`rumor:mill_posts_today`), never on the shared
  `rumor:posts_today`. That shared budget also carries the transaction
  scanner's big-name-drop pings and the speculation lane, so gating the
  in-season cap on it would let one real roster move silence the rumor mill for
  the rest of the day — muting league news to quiet trade gossip, which is
  backwards. The quiet-day post spends a mill slot too; it is a rumor-mill feed
  entry, and leaving it out lets a quiet-day post and a real rumor both ship
  against a cap of one.
- **The cap may only TIGHTEN the shared budget, never widen it** — the lane
  cannot outspend the budget it draws from. Pinned by test.
- **EVERY double-post path is off wherever the cap is 1**, not just the one you
  are looking at. The counter increments once per delivering CYCLE, so both the
  busy-morning trade split AND the gossip secondary must ask
  `allowsTwoPostCycle`. Gating only busy-morning was a real bug in the first
  draft of this feature, and the tighter cap made the ungated path fire MORE
  often — a 1/day mill drains the gossip queue slower, so it crosses
  `SECONDARY_GOSSIP_POST_PRESSURE` sooner. A third such path asks too.
- **The Friday mailbag is the ONE exemption from the cap**, and it is resolved
  BEFORE `checkGates` because that function returns early. Otherwise one
  earlier rumor spends the day's only in-season slot, the mailbag never runs,
  `mailbag:done_date` is never set, and the swept gossip tips age out unseen —
  the precise loss the mailbag exists to prevent. Losing a tip an owner
  actually wrote is worse than one extra post a week, and its own done-key
  still bounds the exemption to once per Friday. Nothing else gets added to
  this exemption without the same argument: the cap is the feature.
- **The deadline is PER LEAGUE and the two differ** — TheLeague's is a fixed
  Nov 13, the AFL's is the Wednesday between Weeks 10 and 11 (2026: Nov 18). A
  single shared window would be wrong in both leagues on both days. The data
  lives in the registry (`leagues-data.mjs#tradeDeadline`); `tradeDeadlineIsoDate`
  in `src/utils/trade-deadline.mjs` is the only resolver, and Best Ball
  declares `null` rather than being omitted, because a substituted date would
  open a deadline window in a league that never trades.
- **Everything is compared as PT calendar-date strings, not instants.** The
  deadlines sit in November (PT is UTC-8) while kickoff sits in September (PT
  is UTC-7); an instant built from one offset lands on the wrong day under the
  other. The questions are day-grained, so the answers are too.
- **The window opens at DRAFT WEEKEND, not at kickoff** — Labor Day − 8, the
  AFL's NL email draft Sunday. The league is awake the moment the drafts land:
  real rosters, real cuts, real trade talk, which is the entire argument the
  quiet cap rests on. It is anchored to the NL draft rather than the AL Live
  Draft Saturday (LD − 9) on purpose, so the loud cadence still gets AL draft
  morning; `-12` is the offset that would cover the whole weekend.
- **The window is LEAGUE-AGNOSTIC and the anchor is the AFL's calendar.**
  TheLeague's own roster crunch is a fortnight earlier — Declare Contracts /
  Cut to 22 and Offseason FA Closes are both `third-sunday-august` (2026-08-16)
  — so it stays loud through its own deadlines and goes quiet on the AFL's
  draft weekend. Known gap, deliberately not papered over: `leagueAwakeWindow`
  takes no slug, and a per-league window is the fix if it ever bites. Anchored at
  kickoff (Labor Day + 3) it left the LOUDEST cadence — 3/day plus the
  busy-morning double — running through the busiest roster week of the year,
  and on 2026-09-08 the mill shipped two beats about one trade offer a second
  apart, two days before kickoff. The helper is `isLeagueAwake`, deliberately
  NOT named `isLeagueSeasonOpen`: a reader who takes it to mean "games are
  being played" is wrong for eleven days a year, and those are the eleven that
  matter here.
- **Both ends of that window measure from KICKOFF.** `endIso` derived from
  `startIso` instead would drag championship Monday back every time the start
  moves, retiring the quiet cap mid-playoffs. Pinned by test.
- **It still ends at championship Monday**, kickoff + 16 weeks + 4 days, which
  lands in EARLY JANUARY. It checks the current AND previous calendar year for
  exactly that reason. Do not re-derive the season year from
  `getCurrentSeasonYear()` here — it runs on the Labor Day clock and resolves
  to LAST season from February through Labor Day, so a quiet date would test
  against a window that closed months ago and read as awake. Same trap as the
  Pecking Order's, one door down.

`tests/schefter-rumor-cadence.test.ts` pins all of it, including the per-league
deadline split and the gate ordering.

### One tip id, one row — the queue counts rows and the split counts stories

`scanTradeOffers` enqueues a row every time an offer passes its dice roll, and
a row that does not post is requeued for up to `TIP_EXPIRY_MS` (7 days). So one
offer that rolled on two different days sat in the queue TWICE under the same
`to_<offerId>` id, and nothing downstream noticed, because nothing downstream
counted ids.

The busy-morning split is where that became visible: it reads a trade bucket of
two rows as a backlog of two OFFERS and hands `slice(0,1)` and `slice(1,2)` to
two independent LLM passes. Owner report, 2026-09-08 — two GroupMe posts about
offer `to_1080`, one second apart, one CTA pointing at the Trade Builder and the
other at the tip page, so they read as two separate scoops. Duplicate ids had
been landing inside ordinary batches for days first: one post's `tipIds` were
`to_1076, to_1078, to_1081, to_1003, to_1081`, another's carried `to_1081`
three times.

- **`dedupeTipsById` runs on the queue READ**, before anything counts rows —
  `scripts/lib/schefter-tip-queue.mjs`, beside `isUsableTip`. Deduping on
  requeue alone would miss it: fresh offer tips are pushed at the START of the
  run, so the read is the only point that sees every row.
- **It keeps the NEWEST row's PAYLOAD under the EARLIEST row's `submittedAt`** —
  two questions, not one. The payload must be newest because
  `redactTradeOffer` stamps `to_<offerId>` on every tip it mints for an offer,
  **the closure callback included**: keeping the earliest row wholesale let a
  stale "still shopping" row swallow the "this one got done" tip behind it, and
  `OFFER_CLOSED_KEY` is written at ENQUEUE, before the tip ships, so a dropped
  closure is never retried. It also discarded the newer row's `framingHint`,
  `offerAgeMs` and `exposure`, so an ask-changed beat never shipped and the
  post understated the offer's age. The timestamp must be earliest because
  `submittedAt` is the anchor the framing, the age-boost and `TIP_EXPIRY_MS`
  all read; carrying the newest forward lets a re-rolled offer refresh its own
  clock forever — the "dead proposals never leave" failure of the 2026-09-07
  insight, wearing a plausible timestamp.
- **Election is by story CLASS first, timestamp second — a closure outranks a
  live row whatever the clock says.** On timestamp alone, a live row enqueued
  AFTER a closure destroyed it: accepted-closure detection reads the
  transactions feed and that read is warn-only, so when it fails `wasAccepted`
  is false, the offer takes the live path again, and the fresh row wins on
  recency. `OFFER_CLOSED_KEY` was written at enqueue, so the terminal tip never
  comes back.
- **Within a class the newest row wins, compared against the HELD ROW.** Comparing against the merged value —
  which is the oldest — meant that once two rows had folded together, any third
  row beat the accumulated payload on a timestamp it never had:
  `[closure@9000, live@1000, changed@5000]` elected `changed` and dropped the
  closure. Two rows behaved correctly and three did not, which is why the
  two-row tests passed.
- **A CLOSURE keeps its own clock and a clean strike ledger.** The
  oldest-timestamp rule is there to stop a re-rolled duplicate of the SAME
  story refreshing its clock; a closure is a different terminal story that
  merely shares the id. Dedupe runs at the queue read and the expiry/strike
  filter immediately after it, so a closure handed a 6d23h-old row's
  `submittedAt` is dropped as `expired` within the hour — and `OFFER_CLOSED_KEY`
  was written at enqueue, so it never returns.
- **That exemption is CROSS-STORY, not blanket — two closures still fold.** A
  second closure row under one id is reachable: the `sadd(OFFER_CLOSED_KEY)`
  that guards re-detection is warn-only and the tip is pushed regardless, so a
  failed write or a lapsed 30-day TTL re-enqueues one on the next scan.
  Exempting those from the fold as well let each duplicate relaunder both the
  clock and the ledger, so a closure the quality gate kept suppressing would
  never age out at all — strictly worse than the 7 days it had before the
  dedupe existed. Budget is inherited only from rows telling the SAME story.
- **It merges into a COPY, never onto the input row.** Folding the fields onto
  the kept row leaves two rows sharing one `submittedAt`, and the newest-wins
  compare then breaks that tie by arrival order — so a second pass over the
  same array answers differently. The scanner dedupes once per run; a function
  whose result depends on whether it has already been called is a trap
  regardless.
- **Strike state folds FORWARD from every duplicate**, never inherited from the
  kept row alone — otherwise a newly enqueued copy launders a tip out of
  hold-and-strike by resetting its counter to zero.
- **The busy-morning split counts DISTINCT ids and picks a secondary beat with
  a DIFFERENT id**, not the next row along. That is belt-and-braces over the
  dedupe on purpose: it is the one place in the scanner where "two tips" means
  "two stories", and the cost of being wrong there is not a bad log line, it is
  the same trade reported twice in the chat.
- **The per-offer repost cooldown cannot cover this.** `trade_offers:last_post`
  is stamped on DELIVERY, and duplicate rows deliver inside the SAME cycle. Any
  future "don't repeat yourself" rule has to hold WITHIN a cycle as well as
  across days.

- **A beat's CTA comes from that BEAT'S OWN TIPS, never from a parallel bucket
  array.** `pickPrimaryBucket` hard-codes `secondaryBucket` to `null` for a
  trade primary, so `[primaryBucket, secondaryBucket][1]` handed beat 2
  `undefined`: no trade-flavored tips, so it shipped the generic "Got a tip?"
  link while beat 1 shipped the Trade Builder one. That is why the 2026-09-08
  pair read as two separate scoops rather than one story told twice.
  `resolveCta` only reads `.tips`, so it takes the beat's batch. The parallel
  array survives for the recurrence fingerprint alone, which reads the bucket's
  key and kind.
- **The Friday MAILBAG is the exception — it stays on the tip-page CTA.** It
  never assigns `primaryBucket`, so it used to reach the generic link by
  accident of `null`; its batch is the whole gossip pool, and
  `classifyTipKind` puts everything that is not `source: 'trade_offer'` in
  there, `trade_bait` and `topic: 'trade'` web tips included. Handing that to
  `resolveCta` points a multi-topic roundup at one franchise's trade builder
  and drops the whisper-back link, which is the one CTA a mailbag most needs.

`tests/schefter-tip-queue-admission.test.ts` pins the dedupe behavior;
`tests/schefter-busy-morning.test.ts` pins the distinct-id split and both
beats' CTA.

### An expired proposal is a SEED, not a post

`scripts/lib/speculation-seeds.mjs` routes an expiry into the daily speculation
lane instead of the rumor feed. A proposal that ran out the clock is the
strongest private evidence the site has about who will move whom; announcing
that a specific real deal died spends that once, while seeding it lets the
speculation matcher build its own pairings off it for 30 days.

- **Only the PROPOSER's half is signal.** Their offered players are an
  availability fact about their own roster — the same KIND of fact as a public
  trade-block listing, arrived at privately — and the positions they asked for
  are their own stated need. The RECIPIENT said nothing: someone else asked
  about their player. Marking that player available would publish a willingness
  its owner never expressed, which is the redaction bug arriving through a
  different lane. `buildSeedFromProposal` reads the sides off the resolved
  proposer (never off `franchise` alone — MFL's owner-view rows omit it), and
  the asked-about player's ID never leaves the function; only his POSITION does.
- **The pair that actually talked is excluded from being paired.** Otherwise a
  "hypothetical" could reproduce the real proposal and publish it named, which
  is worse than the closure post this replaced. `seedSignals().excludedPairs`
  feeds a check inside `findTwoTeamCandidates`'s buyer loop.
- **Seeds are Redis-only, and must stay that way.** Everything else this lane
  writes (`speculation-history.json`) is committed; a seed holds an unpublished
  proposal, so committing one would permanently publish exactly what the
  trade-offer subsystem exists to meter out.
- **A seeded player becomes an eligible marquee**, not merely a re-ranked one —
  `buildHaves` takes `seededIds` as a third qualifier beside the block and
  positional surplus, because a seed that only reordered already-eligible
  players would do almost nothing. The pool stays mixed for that reason too: if
  seeded players were the ONLY unlisted ones ever speculated about, an
  appearance would itself signal that a real offer had been made.
- **`accepted` still posts, `expired` never does.** A completed trade is public
  the moment it processes, so the callback reveals nothing; an expiry is
  private, so it only ever moves the matcher's inputs.

### Closing a proposal — only the two endings MFL states

Movement beats (`ask_changed`, `re_offer`, `closure`) run off two new Redis
keys: `trade_offers:shape` (a sorted, order-independent fingerprint of the ask,
so the next scan can tell "changed" from "still sitting there") and
`trade_offers:closed` (idempotency — a proposal reads as expired on every scan
for the rest of its 30-day TTL).

- **There is no `withdrawn` closure, and adding one would be a fabrication.**
  A proposal leaving the scan is NOT evidence it was pulled: with `commish
  sourced 0` the lane is fed by owner self-reports, and the `owner_reports`
  hash has no per-row TTL, so a resolved proposal lingers in it while a live one
  drops out the moment its owner stops loading the trades page. The two endings
  we publish are the two MFL states outright — `accepted` (a TRADE in the
  committed transactions feed with the same signature) and `expired` (the row's
  own `expires` has passed). `CLOSURE_REASONS` is the allowlist and
  `buildClosureBeat` returns null for anything else.
- **`tradeSignatureOf` must keep hashing a proposal and the TRADE it became
  alike.** MFL calls a different side "franchise1" depending on the export, so
  the signature is the sorted franchise pair plus every asset from both sides
  sorted together — the same shape
  `schefter-scan.mjs#buildTradeSignature` builds for its supersede rule.
  `tests/schefter-offer-beats.test.ts` runs the real 2026 TRADE row and the
  owner-view proposal it would have come from through it and fails if they
  diverge.
- **A closure HOLDS the exposure signal instead of advancing it.** Ending a
  story is not a licence to reveal one more name on the way out, so a proposal
  closed after a single team-only post closes team-only.
- **A proposal with `priorExposure < 1` closes silently.** Never having passed a
  dice roll means the league was never told it existed; a closure post would be
  the lane's first word on it, which is exactly what the roll exists to prevent.
  It is marked closed and dropped.
- **The expiry check also fixes a quieter bug:** before it, a proposal MFL
  dropped weeks ago kept drawing dice rolls and shipping fresh rumors off a
  stale owner report. That is where this lane's 26-to-56-day-old "live"
  proposals came from.
- **A changed ask jumps the rotation** rather than waiting for an even signal —
  by the time its slot came up the ask may have changed again — and its shape
  row is written on every scan, whether or not the dice landed, because the
  change is a fact about the proposal rather than about whether we reported it.

### Former-name callbacks — the bit is the pairing, and it expires

Schefter nodding to a name a franchise just retired ("Dead Cap Walking, the
former Heavy Chevy…") is a wanted bit, not a bug — but only under three
constraints, all enforced in `scripts/lib/schefter-former-name.mjs` +
HARD RULE 30 (commissioner, 2026-08-15):

- **The current name always rides along.** A bare old name is the failure
  mode — a reader who joined this season doesn't know who that is, and the
  joke needs both halves. The redactor normalizes any old name in the tip
  text to the canonical one, so `formerName` on the scope is the ONLY channel
  the old name reaches the prompt through. No payload, no callback.
- **Last season's name, and only last season's.** `pickFormerName` requires
  an explicit `lastSeason` and matches `yearEnd === lastSeason` — never "the
  most recent rename", which is a different question with the same answer
  most of the time and a wrong answer the rest. A franchise that rebranded in
  2017 has no callback available at all, even though that name is genuinely
  its most recent former one. The bit is a nod to something the league just
  lived through; two seasons back it's trivia.
- **It decays and then stops.** Eligible only for the season AFTER the
  rename: occasional in the offseason, ~2× as often in preseason (Aug 1 →
  Labor Day) and regular-season weeks 1–3, then **nothing** from week 4 on,
  permanently. `resolveCallbackPhase` owns the window; the dice roll per post
  so the bit stays a callback rather than a tic.
- **Naming-allowed scopes only.** The payload attaches to
  `franchise-multi-source`, `franchise-explicit-pick`, and `trade-bait` — the
  same three the IRON RULES let Schefter name. An old name identifies a team
  as well as the current one, so a callback on a fuzzed scope would be the
  redaction bug wearing a costume.

Applies to EVERY rename, not just the AFL's last-place punishments —
`punitive` is a voice flag (lean into the sentence lore) not a gate.
**Name collisions need an OWNERSHIP map, not a set of taken names.** A
franchise keeps its own retired name in `aliases` so people can still search
by it (the documented convention), so a flat "these names are in use" set
can't tell "another team has this" from "this team kept its own nickname" —
and it silently zeroed out AFL 0014's callback, the league's current punitive
rename, while two quieter renames worked fine.
Two `history[]` rows look like renames and aren't: **re-skins** that repeat
the current name under a new icon (nearly every TheLeague franchise has one —
"the Pigskins, formerly the Pigskins") and **names that moved between
franchises** ("Midwestside Connection" is 0010's old name and 0011's current
one, so the callback would point at a live team that isn't the subject).
`pickFormerName` excludes both.


## Articles must link — and must plug the site

Schefter has two jobs: report the league, and get owners USING the site. Until
Aug 2026 he did neither half of the second one — a `grep '<a '` over the whole
published feed (396 posts, every article type, both leagues) returned **zero**.
The article that made it visible was the 2026 schedule release: eight
paragraphs about a schedule, and not one link to the schedule release page the
column existed to announce.

`scripts/article-utils/article-links.mjs` is the whole mechanism. Three layers,
because the model is one of them and the model is not reliable:

1. **Declare.** Every article type exports
   `relatedLinks(enrichment, { league })`. The pipeline calls it
   **unconditionally**, which is the load-bearing part:
   `tests/article-type-interface.test.ts` derives its required-export list by
   reading `schefter-weekly-articles.mjs`, so a new article type that omits
   `relatedLinks` fails the suite. Wrapping that call in a
   `typeof mod.relatedLinks === 'function'` guard silently re-opens the hole —
   `tests/article-links.test.ts` asserts the call stays unguarded for exactly
   that reason.
2. **Ask.** `withLinkDirective` appends copy-this-verbatim anchors to the fact
   sheet. Never "link to the standings": a model asked to build a URL builds a
   *plausible* one, and `/theleague/schedule` 404s as hard as gibberish.
3. **Enforce.** `applyArticleLinks` runs on the built post before the feed
   write. It repairs alias spellings (`/schedule-release` → the prefixed form,
   absolute URLs → paths), **unwraps** any href not on the declared list, and
   injects the primary link if it is still missing. Publishing a linkless
   article is not a reachable state.

Load-bearing details:

- **Three tiers, three different instructions.** `primaryLink` is the article's
  subject and gets injected if dropped. Plain `articleLink` is subject-adjacent
  and merely encouraged. `featureLink` is a **site-feature plug** and is
  offered, never injected — a plug the model had to wedge in reads as an ad,
  and readers stop clicking a columnist who sounds like an ad. Aim for one plug
  per column; do not enforce one.
- **hrefs are root-relative and league-prefixed** (`/theleague/standings`).
  Article `content` is raw HTML through `set:html`, so it never gets the
  `resolveLeaguePath()` treatment a component's `<a>` gets — the string in the
  JSON *is* the href. Prefixed root-relative is the one form that resolves
  everywhere: directly on the shared host and on localhost/preview, via the
  `vercel.json` 301 on each apex domain. `leagueUrl` absolutes are for text
  that LEAVES the site (the GroupMe promo) — an absolute in the body bounces a
  preview-deploy reader to production.
- **`DESTINATIONS.leagues` is checked BOTH ways.** A listed league that lacks
  the page is a dead link; an **unlisted league that has the page** is a
  feature Schefter is silently not allowed to mention there — the failure mode
  that hides, because nothing breaks. The test enumerates `src/pages/<slug>/`
  and fails on either. It already caught one: `/activity` exists in both
  leagues but is owner-visit tracking in TheLeague and the transaction log in
  the AFL, which is why that entry carries a per-league `labels` override
  rather than one label promising the wrong page.
- **`articleLink` returns null for a page the league lacks; `primaryLink`
  throws.** The AFL has no salary cap, so cap-flavoured plugs drop out through
  `linkList` instead of forcing every `relatedLinks` into per-league branches.
  A missing PRIMARY is different — that league has no business running the
  article type at all, so it fails loudly.
- **Grade-card types are covered too.** `draft-grades` / `team-grades` put
  prose in `intro[]` plus `grades[].body`, not `content[]`. Sanitising only
  `content` would leave the grade cards as the one place a hallucinated href
  still ships.
- **Link styling lives in `src/styles/schefter-feed.css`, not a page `<style>`
  block.** `set:html` content carries no Astro scoped-style attribute, so a
  scoped rule cannot reach these anchors — and both leagues' news pages import
  the shared sheet, so one definition serves both.

`tests/article-links.test.ts` also checks the **shipped feeds**: every
`type: 'article'` post must contain an anchor and every href in one must
resolve to a real route. That is what catches a hand-edited feed, which no
amount of pipeline enforcement would.

## The tip queue — a producer and its consumer must agree on shape

Three independent failures in Sep 2026 all had the same signature: the tip
line looked alive from every angle we normally check, and delivered nothing.
Read this before touching the queue, the scan workflow, or the tip page.

- **`text` is required only of sources that CARRY text.**
  `scripts/lib/schefter-tip-queue.mjs#isUsableTip` is the single admission
  rule; `TEXTLESS_TIP_SOURCES` is its allowlist and `trade_offer` is in it.
  A trade-offer tip is built by `redactTradeOffer` with `text: ''` on purpose
  — the signal is `volumeHint` / `positionTokens` / `pickTokens` /
  `playerNames`, and prose comes later. The scanner used to demand truthy
  `obj.text` from every queue item, so from the lane's launch (2026-04-30) to
  2026-09-03 it enqueued a trade-offer tip, re-read its own queue ~200ms
  later, parsed zero usable tips, and then hit the "no fresh tips" branch and
  **deleted the queue**. Forty consecutive workflow runs logged
  `Enqueued 1 trade-offer tip(s)` immediately above `Queue depth: 0`.
  Two things that let it hide for four months, both worth generalizing:
  - **The enqueue logged success.** A producer reporting "wrote 1" is not
    evidence the consumer can read it. Nothing logged the drop until this fix
    added the `unparseable` warn — a silent `else` branch on a filter is a
    data-loss path with no alarm on it.
  - **The downstream was fully built and tested.** `resolveTipScope` has a
    complete `trade_offer` branch, and `schefter-trade-cta`,
    `schefter-trade-corroboration` and friends all cover it. Every test used a
    hand-built fixture that carried the fields the consumer wanted. None
    round-tripped the REAL producer's output through the REAL admission check
    — which is exactly what `tests/schefter-tip-queue-admission.test.ts` now
    does, and the one thing that would have caught it on day one.
- **A `hidden` attribute loses to any author `display`.** `.tip-confirm` set
  `display: flex` and shipped with `hidden`, so every owner opening the tip
  page saw "Schefter's got it." over a dead "Undo 60s" button before typing a
  word — a tip line that looks like it already ate something you never sent.
  Restate `[hidden] { display: none }` on any element you give a `display` to.
- **Scoped CSS cannot reach markup the page builds at runtime.** Astro
  compiles `.foo` to `.foo[data-astro-cid-…]`, an attribute only the
  server-rendered template carries. Anything written in by `innerHTML` — the
  whole tipster record rail — needs `:global(...)`, wrapping the FULL
  selector (`:global(html.dark .foo)`, not `:global(html.dark) .foo`).
- **Do not re-state `--color-gray-*` under `html.dark`.** The ramp inverts
  itself: `gray-700` is `#374151` in light and `silver` in dark, `gray-50` is
  `#f9fafb` / `#181818`. "Fixing" dark mode by overriding to `gray-300`
  resolves to `#3a3a3a` there and ships near-black text on a near-black card.
  Only literal hexes need a dark variant.

### The GroupMe mention ingest is TheLeague's, and needs its own credentials

`ingestGroupMeMentions` hardcodes TheLeague's keys (queue, watermark, style
book) because TheLeague owns the only group chat we read. Two consequences:

- It **must** be gated on `SCHEFTER_LEAGUE.features?.groupmeListen` at the
  call site. Before Sep 2026 it was called unconditionally for both leagues
  and only the missing credentials stopped the AFL invocation from reading
  TheLeague's group and pushing into TheLeague's queue a second time per
  cycle. A missing env var is not an access-control mechanism.
- `GROUPME_SERVICE_TOKEN` + `GROUPME_GROUP_ID` must be in the scan workflow's
  env for TheLeague's step. Both secrets existed in the repo for months while
  the workflow passed neither, so every run logged `GROUPME_SERVICE_TOKEN or
  GROUPME_GROUP_ID not set — skipping mention ingest` and every mention tipped
  in the group chat was discarded. The job exited 0 throughout.

### Every terminal tip outcome leaves a receipt

`recordTipReceipt` writes `schefter:<league>:tipster:last_receipt:<hash>`
(14d TTL, web tips only, one per tipster) at all three points a tip can end:
consumed into a post (`published`), struck out by the quality gate
(`spiked` — 3 strikes or past `MAX_HELD_MS`), or aged out unposted
(`expired`). `/api/schefter/tipster-stats` returns it as `me.lastReceipt` and
only ever for the caller's own hash.

This exists because "a post appeared, or it didn't" was the tipster's entire
feedback channel, and the back half of the pipeline — suppression, holding,
expiry — all rendered identically as silence. An owner's tip on 2026-09-02
was generated, scored 2/10, held, and struck out over ~30h with no signal
reaching them; from their seat the tip line was simply broken, and they were
not wrong to say so. If you add a new way for a tip to die, give it a receipt.

## Schefter tipster context (Phase 8 — bot intelligence)

The rumor-mill scanner weights bucket priority and surfaces voice cues
based on per-tipster signals. The whole flow lives in three files:

- **`scripts/lib/schefter-tipster-context.mjs`** — `buildTipsterContext`
  reads two Redis keys per queued web tipster and returns a
  `Map<hashedOwnerId, { isFirstTime, isProlific, tipsInQueue, beat }>`:
  - `schefter:tipster:rumors_total:{hash}` (STRING, lifetime post count)
  - `schefter:tipster:topic_counts:{hash}` (HASH, topic → lifetime count)
- **`scripts/lib/schefter-bucket-logic.mjs`** — `bucketPriorityScore`
  accepts the context as an optional third arg and adds a tipster delta
  (first-time voice +5, burst regular −3, prolific −1). Without the
  context, falls back to the pre-Phase-8 size+age math — both the
  scanner and the admin preview pass the context now.
- **`scripts/schefter-rumor-scan.mjs`** — `anonymizeTips` surfaces the
  voice flags on every web-tip scope: `firstTimeTipster`,
  `prolificTipster`, `tipsterBeat: { topic }`. HARD RULES 22 / 23 / 24
  drive the phrasing. Post-commit increments live in
  `schefter-tipster-counters.mjs` (`incrementTipsterCounters` plus
  `incrementTipsterTopicCounters`).

**Privacy contract — DO NOT WEAKEN.** The codename↔topic binding stays
server-side. That's option B from the design discussion in
`#enhance-bot-intelligence-tAh6t` — public codenames (Style Book bit)
are fine, but pairing a codename with a beat (e.g. "Burner Phone keeps
feeding me trade chatter") correlates over time and starts narrowing
source identity. HARD RULE 24 enforces "never name the codename"; the
`tipsterBeat` payload deliberately carries only the topic name, never
the codename or hash. The admin route keeps a server-only
`pendingTipsWithHashes` array for the priority preview math but strips
`hashedOwnerId` from everything that crosses the response boundary.


## Schefter quiet-day post (Phase 8 — feature 7)

When the scanner's normal lane finds no qualifying bucket AND the queue
meets one of three honest-quiet conditions (`queue-empty`,
`single-prolific-tipster`, `all-stale`), Schefter ships ONE candid
"slow news day" post instead of going silent. Lives entirely inside
`scripts/schefter-rumor-scan.mjs` (no separate module — the logic is
specific to the scanner flow):

- **Cooldown:** `schefter:rumor:quiet_day_last_date` (PT-date string),
  guarded by `QUIET_DAY_COOLDOWN_DAYS` (default 3).
- **Distribution:** writes the feed entry and consumes one of
  `MAX_POSTS_PER_DAY`, but **deliberately skips the GroupMe webhook** —
  a slow-news-day post buzzing every owner's phone is the opposite of
  slow. This invariant is locked by a sentinel comment that the
  regression test (`tests/schefter-quiet-day.test.ts`) greps for; do not
  delete the comment without also adding GroupMe-skip coverage another way.
- **Voice:** `generateQuietDayBody` uses its own tiny system prompt (not
  the main HARD-RULES block) with a 4-template fallback when
  `ANTHROPIC_API_KEY` is unset, so dry-runs still produce recognizable
  output.


## Schefter recurrence ledger v2 (Phase 8 — feature 10)

`data/schefter/<navSlug>/topic-recurrence.json` (per-league since the AFL launch) bumped to v2. Each fingerprint
entry now carries `tipsterHashes` (sorted-unique, capped at 64) in
addition to the existing `weeksSeen`. The bump powers cross-week memory
recall (HARD RULE 25): when a bucket reappears with at least one voice
that wasn't on its prior roster, `getMemoryRecall` returns a
counts-only payload (`weeksSinceFirstSeen`, `totalWeeksSeen`,
`distinctVoicesAcrossTime`) that the anonymizer attaches to each tip
in the bucket.

`loadLedger` migrates v1 files in place by backfilling empty
`tipsterHashes` arrays. The migration is transparent — no manual
intervention needed when a deployed branch first hits the v2 code.
Unknown future versions (>2) are discarded and replaced with an empty
ledger (safer than trusting a schema we don't understand).

**Privacy contract:** the ledger stores raw hashes for set-membership
checks (so we can detect "fresh voice"), but `getMemoryRecall`'s return
value contains only counts. The hashes never reach the LLM prompt or
the response payload. Don't change that without re-litigating the
correlation argument from option B above.


## The trade lanes post to chat — on their own budget, not the calendar

The rumor mill (which carries **trade-bait** listings), and the daily trade
**speculation** lane, are in `OWN_BUDGET_KINDS`, not `PUSH_ONLY_KINDS`. They
exist to get owners trading, and that only works in the room where trades get
talked about — they are not reminders competing with the league's chatter, they
are the chatter, and every one of those posts already ends in a Trade Builder
CTA.

They skip the one-post-a-day weekday calendar because a rumor held until its
assigned weekday is not a rumor any more. What governs them instead is the
budget the rumor mill has always carried
(`scripts/lib/schefter-groupme-budget.mjs`), which is tighter in practice and
far better targeted:

- `MAX_POSTS_PER_DAY` (3) per Pacific day, **shared across both lanes**
- `MIN_SPACING_MS` (4 hours) between any two
- a one-hour marinate window before a fresh tip may post
- quiet hours (11pm–7am PT), plus an LLM quality gate

Three things that are load-bearing:

- **`transaction` stays push-only.** Every add, drop and waiver claim, scanned
  every 15 minutes, is the firehose that got the chat muted. Trades are
  separable (`raw.type === 'TRADE'` → `breaking` tier) if that ever changes.
- **Speculation is budgeted ONCE, by its script, and the sender must not look
  again.** `schefter-trade-speculation.mjs` checks the shared 3/day + 4h gate
  at its step 3 (`checkGlobalBudgetGate`) and increments `posts_today` +
  stamps `last_post_ts` at step 9 — both BEFORE it calls
  `postSpeculationToGroupMe` at step 10. A second budget check inside the
  sender therefore reads a millisecond-old timestamp and refuses on 4-hour
  spacing every single time. That is not hypothetical: it was written that way
  in this very PR, and it made the lane post nothing at all while every log
  line and test read as correctly gated. **A gate and the consume it guards
  must stay on the same side of the send.** The sender's only check is
  `isPlannedToday`, the day-plan question, which is a different question.
  `tests/reminder-push-first.test.ts` pins the split.

Speculation also had **no push route at all** until Sep 2026: held out of the
chat by the day cap and never sent to a phone either, so a daily job published
into the feed and reached nobody. It now rides the existing `rumor` category
rather than adding a toggle of its own.

**Every step that runs a scanner needs `CRON_SECRET`**, including BOTH league
steps of `schefter-rumor-scan.yml`. The 2026-09-06 08:49 PT run is the worked
example of what its absence costs, and why the two failures are worse together
than apart:

```
[quality-gate] 8/10 ALLOW — Named franchise (Fire Ready Aim), named
                player (Demond Claiborne), concrete trade assets (2027 3rd)
Appended to feed: 2 new post(s) (total: 379)
[push] CRON_SECRET not set — skipping rumor push.
[groupme] Held: rumor is push-only — it never posts to chat.
```

Two posts the gate scored 8/10, written to the feed, held from chat AND
skipped on push — delivered to nobody, with the run still green.
`tests/reminder-push-first.test.ts` now pins the secret onto every scanner
step by name.

`tests/groupme-day-plan.test.ts` enforces that every GroupMe sender shows a
real cap. Note its escape hatch matches a CALL with import lines stripped — a
bare identifier regex is satisfied by the import statement alone, which let a
lane delete its gate and stay green.
