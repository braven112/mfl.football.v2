# Schefter Rumor Mill — Anonymous Tips, GroupMe Listening, Trade Rumors

**Status:** Planning
**Author:** Brandon + Claude
**Date:** 2026-04-16

## TL;DR

Give Schefter a rumor-mill mode. Owners submit anonymous tips from the site, Schefter loosely references them ("hearing from a division rival…", "multiple owners in the Northwest division…"). He also listens to @Schefter mentions in GroupMe, occasionally riffs on Ask Roger (~7% of days), and always fires a breaking-news rumor when a trade hits pending commish approval. Strict rate limits: **max 3 posts/day from the rumor mill**, min **1hr delay after first tip**, **4hr spacing** between rumor posts. Salt, not sugar.

---

## Goals & Non-Goals

**Goals**
- Anonymous tip channel → vague, columnist-voiced posts
- GroupMe two-way: read @Schefter mentions, fold into next report
- Ask Roger cameo at ~7% frequency
- Trade-pending → auto rumor post (also serves as commish approval reminder)
- Rate limiting that feels editorial, not robotic

**Non-Goals**
- No deanonymization ever (even admin-side, hash tipster IDs)
- Not replacing existing transaction scanner — this is additive
- No live chat / DMs with Schefter — async only

---

## Bot Role Convention (IMPORTANT)

Two GroupMe bots, different jobs — never cross them:

| Bot | Env Var | Role |
|-----|---------|------|
| **Ask Roger** | `GROUPME_ROGER_BOT_ID` | Deadline reminders only (lineups due, auction clock, contract deadlines) |
| **Claude Schefter** | `GROUPME_SCHEFTER_BOT_ID` | Voice of the league — all rumor mill, transaction posts, tip-driven posts, @-mention replies, Ask Roger riffs |

Every new GroupMe-posting code path in this feature MUST use the Schefter bot. If `GROUPME_SCHEFTER_BOT_ID` is unset, **skip the post and warn** — never fall back to Roger.

## Architecture Overview

Four inputs, one throttled writer:

```
┌─ Tip form (site)          ┐
├─ GroupMe @Schefter         ├──► tips queue ──► rumor-mill scanner ──► feed + GroupMe
├─ Ask Roger messages (7%)   ┤         (Redis)        (cron, 15min)
└─ Trade pending webhook     ┘                                │
                                                               └──► skip throttle (trade posts always fire)
```

**Storage:** Redis (already in use). Keys:
- `schefter:tips:queue` — list of unprocessed tips
- `schefter:tips:processed` — list of tips consumed in last 24h (for dedup + context)
- `schefter:rumor:last_post_ts` — last rumor-mill post timestamp
- `schefter:rumor:posts_today` — counter, resets daily
- `schefter:groupme:last_mention_id` — watermark for @Schefter mention scanner
- `schefter:ask_roger:last_riff_date` — last date a Roger riff posted

Trade-pending posts bypass `posts_today` limit (they're transactional, not rumor mill).

---

## Feature 1 — Anonymous Tip Submission

**UI:** New page `/theleague/schefter/tip` (also a button "Tip Schefter" in nav drawer under "Tools").

Form fields:
- Tip text (textarea, 500 char max)
- Optional: "About which team?" (dropdown — franchise list, or "league-wide")
- Optional: "Topic" (trade interest, roster gripe, bold prediction, commish beef, other)
- **No name field.** Auth'd users are identified server-side only for anti-abuse.

**API:** `POST /api/schefter/tip`
- Auth required (prevent guest spam)
- Stores: `{ id, hashedOwnerId, franchiseHint, topic, text, submittedAt, division }`
- `hashedOwnerId = sha256(userId + TIPSTER_SALT)` — stable per user for rate-limiting ("one owner tipped twice today"), but not reversible
- Rate limit: 3 tips per owner per 24h
- On submit → push to `schefter:tips:queue`

**Anonymization rules (server-side, before passing to LLM):**
- Never include owner's franchise name unless `franchiseHint` explicitly set (and even then, fuzz it)
- Attach `division` from config for "multiple owners in the Northwest division" phrasing
- When 2+ tips in same batch reference same franchise → unlock "multiple sources" phrasing

---

## Feature 2 — Rumor Mill Scanner (cron)

**Script:** `scripts/schefter-rumor-scan.mjs`
**Schedule:** Every 15 min (GitHub Actions or Vercel cron)

Flow per run:
1. Pull `schefter:tips:queue`. If empty, check Ask Roger + trade-pending fallbacks, then exit.
2. Gate checks:
   - `posts_today >= 3`? → exit (but keep tips queued for tomorrow — they expire after 24h)
   - `now - last_post_ts < 4h` AND there's already been a post today? → exit
   - First tip of the day: wait at least **1 hour** after first tip's `submittedAt` before posting, to let others chime in
3. Gather context: queued tips + any @Schefter GroupMe mentions since last watermark + (7% roll) latest Ask Roger excerpt
4. Generate post via Claude (Schefter voice skill) with anonymization rules in system prompt
5. Post to feed + GroupMe; move tips from queue → processed; bump counter + timestamp

**The 1-hour "marinate" window** is the key mechanic. When the first tip lands, set `schefter:tips:first_tip_ts`. Scanner refuses to post until `now - first_tip_ts >= 1h`. This lets other owners see the form exists (once one post fires) and pile on before the next cycle.

**Quiet hours:** No posts 11pm–7am PT (hold and fire at 7am if queue non-empty).

---

## Feature 3 — GroupMe @Mention Listening

GroupMe already has `sync.ts`. Extend it:

**`scripts/schefter-groupme-listen.mjs`** (or fold into existing sync)
- Scan messages since `schefter:groupme:last_mention_id`
- **Detection:** GroupMe bots don't get structured `@mention` attachments. Match by text, case-insensitive:
  - **Schefter tips:** `\bclaude\b` OR `\bschefter\b` OR `\bclaude\s+schefter\b`
  - **Roger riff source:** `\bask\s+roger\b` OR standalone `\broger\b`
  - False-positive guards: require the name near a `?`, or in the first ~5 words of the message, or followed by a comma/colon ("Claude, what about…"). "Roger that" / "roger dodger" acknowledgements should NOT trigger — reject when preceded by common ack phrases.
  - "Claude" alone is generic enough to false-positive rarely (no other Claudes in league) but still run through the guard above.
- **Filter out the bots themselves** by `sender_id` so Schefter doesn't ingest his own posts
- Extract message text + sender name (NOT anonymized — GroupMe is public context)
- Store as pseudo-tip: `{ source: 'groupme', author: senderName, text, ts }`
- Feeds into same rumor-mill scanner queue but flagged `attributable: true` so Schefter can say "Wabbit shouted in the group chat that…"

---

## Feature 4 — Ask Roger Cameo (7%)

Ask Roger is already posting in GroupMe. On each rumor-mill scanner run:
- Roll `Math.random() < 0.07` AND `schefter:ask_roger:last_riff_date !== today`
- If true AND there are recent Roger messages → pull latest Roger quote, include in LLM context with directive "riff on what Roger said, light ribbing, one line"
- Counts toward the 3/day limit

---

## Feature 5 — Trade Pending Rumor (separate lane)

**Trigger:** When a trade enters pending commish approval. Detection options:
1. **Poll** MFL `pendingTrades` endpoint from existing cron (simplest — piggyback on `schefter-scan.mjs`)
2. New watermark: `schefter:trades:last_pending_offerId`
3. Any new pending trade → generate rumor post immediately (no throttle)

**Post style:** "Hearing a deal is on the commish's desk between [Team A] and [Team B]… @Brandon, the league awaits." Tags Brandon in GroupMe as reminder.

**Bonus:** When commish approves/vetoes → follow-up post ("It's official" / "DOA"). Optional phase 2.

---

## Data Model

```ts
// src/types/schefter-tips.ts
export type Tip = {
  id: string;                    // nanoid
  hashedOwnerId: string;          // sha256(userId + salt)
  franchiseHint?: string;         // franchise id or 'league-wide'
  division?: string;              // resolved server-side
  topic: 'trade' | 'roster' | 'prediction' | 'commish' | 'other';
  text: string;                   // 500 char max
  submittedAt: number;            // epoch ms
  source: 'web' | 'groupme';
  attributable?: boolean;         // true for groupme (named source ok)
  author?: string;                // groupme sender name if attributable
};

export type RumorPost = {
  id: string;
  body: string;
  tipIds: string[];               // which tips fed into it
  hadRogerRiff: boolean;
  postedAt: number;
};
```

---

## LLM Prompt Design (Schefter Skill Extension)

New section in `.claude/agents/schefter.md` (or separate skill) — **Rumor Mill Mode**:

System prompt directives:
- Voice: breaking-news Schefter energy, but vaguer. Lean on "sources say", "a division rival tells me", "multiple owners suggest…"
- NEVER name the tipster or quote them verbatim
- Use division phrasing when 2+ tips about one division: "Northwest is buzzing…"
- Use "multiple sources" only when tipCount >= 2
- For GroupMe attributable items: direct attribution is fine
- For Ask Roger riffs: one-liner callback, no more
- 2–4 sentence post max
- End with a tease when appropriate ("…developing")

---

## Phased Rollout

### Phase 1 — Trade Pending Rumors (smallest, highest ROI)
*Owner: qa-principal-engineer → schefter*
- Poll pending trades in existing scan
- Generate post, push to feed + GroupMe
- No new UI, no new storage beyond one watermark
- **Ships first. Validates the "auto-post from Schefter" plumbing for everything else.**

### Phase 2 — Anonymous Tip Form + Scanner Core
*Owner: frontend-ux-architect (form) + qa-principal-engineer (API + scanner)*
- `/theleague/schefter/tip` page
- `POST /api/schefter/tip` with rate limits
- `scripts/schefter-rumor-scan.mjs` with queue, marinate window, 3/day cap
- Cron wiring (GitHub Actions)
- Editorial voice tuning via schefter skill update

### Phase 3 — GroupMe @Mention Listening
*Owner: qa-principal-engineer + mfl-api-expert (for GroupMe API quirks)*
- Extend groupme/sync.ts or new scanner script
- Mention parsing + queue injection
- Attribution rules in LLM prompt

### Phase 4 — Ask Roger Cameo
*Owner: schefter agent*
- 7% dice roll in scanner
- Roger quote retrieval
- Prompt directive for riff

### Phase 5 — Polish
*Owner: code-reviewer + frontend-ux-architect*
- What's New entry (2 screenshots: tip form + sample rumor post)
- Page directory registry entry for the tip page
- Moderation: admin-only "mute tipster" (by hashedOwnerId) if someone abuses it
- Metrics page: tips submitted, posts generated, GroupMe mentions consumed

---

## Agent Assignments Summary

| Agent | Phase(s) | Scope |
|-------|----------|-------|
| **qa-principal-engineer** | 1, 2, 3 | API routes, scanner scripts, Redis, cron, GroupMe integration |
| **frontend-ux-architect** | 2, 5 | Tip form UI, nav entry, What's New screenshot |
| **schefter** | 1–4 | Voice tuning, prompt authoring, sample posts |
| **mfl-api-expert** | 1, 3 | Pending trades endpoint, GroupMe mention parsing |
| **code-reviewer** | After each phase | Review before merge |
| **astro-performance-expert** | Phase 2 | Audit tip page perf |

Run phases sequentially. Within a phase, parallelize independent work (e.g. Phase 2: form + API + scanner can each be separate PRs).

---

## Risks & Open Questions

1. **Anonymity leaks** — if only one owner submits a tip about franchise X and Schefter posts about franchise X, the target can guess the tipster. **Mitigation:** require `tipCount >= 2` OR fuzz franchise to division before posting. When only one tip exists about a specific team, Schefter must generalize ("someone in the Pacific is antsy…").

2. **Noise abuse** — owner spams tips to dominate feed. **Mitigation:** 3 tips/owner/24h hard cap; moderation mute list.

3. **Ask Roger integration** — does the Roger bot tag its messages identifiably in GroupMe? Confirm before building Phase 4.

4. **Quiet hours timezone** — confirm league TZ (likely PT).

5. **Trade-pending de-dup** — if commish takes 3 days to approve, don't re-post the rumor. Watermark by offerId.

6. **GroupMe @Schefter bot identity** — does Schefter already have a GroupMe bot account? If not, Phase 3 needs that provisioned first.

---

## Success Criteria

- First week: ≥ 5 tips submitted, ≤ 3 posts/day, zero deanonymization complaints
- GroupMe @Schefter mentions consumed within next post cycle
- Trade-pending → rumor post within 15 min of pending state
- Brandon approves trades faster because rumor post is nagging him 😉

---

## Files to Create / Modify

**New:**
- `src/pages/theleague/schefter/tip.astro`
- `src/pages/api/schefter/tip.ts`
- `src/pages/api/schefter/trade-pending-hook.ts` (or fold into existing scan)
- `scripts/schefter-rumor-scan.mjs`
- `src/types/schefter-tips.ts`
- `.github/workflows/schefter-rumor-scan.yml`
- `docs/features/schefter-rumor-mill.md`

**Modify:**
- `.claude/agents/schefter.md` — add Rumor Mill Mode section
- `scripts/schefter-scan.mjs` — add trade-pending detection
- `src/pages/api/groupme/sync.ts` — emit @Schefter mentions to tip queue
- `src/data/page-directory.json` — register tip page
- `src/data/whats-new.json` — feature announcement (Phase 5)
- `src/data/nav-config.json` — Tools → "Tip Schefter"

---

**Next step:** Brandon confirms scope, then kick off **Phase 1 (Trade Pending Rumors)** with qa-principal-engineer to validate the posting pipeline before building the tip form.
