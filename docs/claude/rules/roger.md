# Roger — dates, reminders, evals, and the improvement loop

> Deep reference extracted from `CLAUDE.md` (Aug 2026 slim-down). `CLAUDE.md`
> carries the one-line rule and points here; this file is the authority on the
> reasoning. Every rule below is load-bearing — each one is a bug that shipped.

## Roger date-handling gotchas

There are **two** independent code paths named "Roger". Both have hallucinated
event dates in the past. Fixing one does not fix the other.

1. **Ask Roger (rules Q&A chatbot)** — `src/pages/api/rules-qa.ts`. LLM-backed.
   The system prompt is split into two blocks: a static cached block with the
   constitution, and a per-request block that injects today's Pacific-Time
   date. **Never remove the date block**, and keep it in a separate system
   array entry so the constitution block stays cache-eligible.

2. **GroupMe reminder poster** — `scripts/schefter-scan.mjs`. Template-based,
   not LLM. Fires at 14d / 7d / 2d / day-of touches before major events. Two
   rules that MUST hold:

   - The reminder window is asymmetric: fire on the target day or one day
     late, **never early**. The shared helper is
     `scripts/lib/roger-reminder-window.mjs#shouldFireReminder`. Don't
     reinvent it inline — `tests/roger-reminder-window.test.ts` locks it in.

   - `event.daysUntil` must be a calendar-day diff (midnight-to-midnight),
     not `Math.ceil` of a timestamp delta. Use
     `scripts/lib/roger-reminder-window.mjs#calendarDaysUntil`. `Math.ceil`
     on a sub-day delta rounds "tomorrow evening" up to 1 and combines with
     a permissive window to post "TODAY" a day early.

   - Roger's reminders honor **quiet hours** (23:00–06:59 PT) like every
     other GroupMe lane. The gate wraps all of `scanEventReminders`, not
     just the send: the feed post id is the dedup key, so writing the post
     during quiet hours and skipping only the webhook would swallow the
     notification permanently. Skipping outright is safe because
     `shouldFireReminder` accepts the target day OR one day late.

   - **The reminder event list is not a place to write a date.** The AFL
     events in `compute-league-events.mjs` must resolve from the same rules
     as `src/data/afl-fantasy/league-events.json` (which drives
     `/afl-fantasy/calendar`), because Roger's post links to that calendar
     and any drift is visible to owners in one click. The AFL drafts are
     Labor-Day-anchored — `saturday-before-labor-day-weekend` (AL, Labor
     Day − 9) and `sunday-before-labor-day-weekend` (NL, Labor Day − 8) —
     never fixed calendar dates. The bad Aug 20 came from an "Annual draft
     window: August 20 – August 25" line that three rulebook surfaces
     carried (`src/data/afl-constitution.ts` ×2, `docs/claude/afl-rules.md`,
     `src/pages/afl-fantasy/docs/rules.html`) describing a window the league
     has never drafted in. All now state the Labor Day rule in words
     (commissioner, 2026-08-13). Not audited: stored answers under the
     `afl-rules-qa:all` Redis key, which needs Upstash creds.

Historical note: the first two bugs fired together in April 2026 — Roger
posted "TODAY: NFL Draft" on Wednesday when the draft was Thursday. The
post-mortem is the reason this section exists. The other two fired together
in August 2026: Roger woke the AFL at 1:00am PT to announce the draft was
one week away, when it was sixteen days out.
`tests/roger-afl-draft-reminder.test.ts` locks both in.


## Ask Roger eval — run before prompt/model/constitution changes

`pnpm eval:roger` grades the live TheLeague Q&A pipeline against
`tests/fixtures/roger-eval-cases.json` (49 cases: facts, multi-rule,
date-sensitivity, strategy/calc refusals, not-in-constitution honesty,
injection). Costs ~$1 of API calls (needs `ANTHROPIC_API_KEY`, so
`vercel env pull` first) — deliberately NOT part of `pnpm test:unit`.
Run it before merging any change to the Roger system prompt, the
constitution, or the answering model, and compare per-category pass rates.

- The production system prompt lives in
  `src/data/rules-qa-system-prompt.ts` (imported by the endpoint AND the
  eval) so the eval always tests the real prompt — don't re-inline it into
  the endpoint. The exported `RULEBOOK_ANCHORS` whitelist must match the
  prompt's section list; `tests/roger-eval-cases.test.ts` (normal CI, no
  API) enforces the sync and validates the fixture.
- The LLM call is `generateRulesAnswer` in `src/utils/rules-qa-handlers.ts`
  with an injectable `now` for date-sensitive cases.
- New Roger bug report → add a fixture case reproducing it, then fix.
  Details + methodology write-up: `docs/evals-explained.md`.

**Fixing the constitution does NOT fix answers already on the page.**
Roger generates each answer once and the POST handler persists it to Redis
(`rules-qa:all`); nothing ever regenerates a stored answer. So a wrong
ruling keeps getting served to every owner who scrolls past it long after
the rulebook is corrected, and the UI's only lever is deletion — which
discards the owner's question along with the bad answer. Repairing one
means rewriting the `answer` field of that entry in place, preserving
`id`/`askedBy`/`createdAt` so the card keeps its position and attribution.
The Upstash creds are repo secrets, so this runs from CI or from a checkout
with `vercel env pull`, not from a bare clone. (A scripted repair path is
in flight — check for `scripts/fix-rules-qa-answer.mjs` before hand-rolling
one.)
Owners can now say so themselves: every card carries a "This answer looks
wrong" button (`PATCH` on the rules-qa endpoint, storage in
`src/utils/rules-qa-flags.ts`). It is the non-destructive counterpart to
delete — the Q&A keeps its id, position and attribution. Load-bearing bits:
flags live in their OWN keys (`<prefix>:<qaId>` hash keyed by franchiseId,
plus a `<prefix>:index` set) so the Q&A array the improvement loop and repair
scripts read is untouched, one owner can't inflate a count, and two owners
flagging at once can't clobber each other. Flags work on **pre-seeded cards
too** — the 5th-year option bug was in a seed. Flagger names and reasons are
admin-only; everyone else sees the count.

Reports feed the SAME weekly delivery as the judge's findings
(`roger-improvement-notify.mjs` reads the flag store directly, so the notify
workflow step needs the Upstash secrets). A reported answer opens its own
GitHub issue and joins the league post. **Clearing the flags — the admin
"Mark reports handled" button — is what stops the nag; closing the issue does
not**, because the notifier reads Redis, not GitHub. Redis key prefixes and
seed filenames for both leagues live in `src/config/rules-qa-keys.mjs` so the
TS endpoints and the plain-node notifier can't drift apart; note `seedFile`
is a bare basename joined with `SEED_DIR`, because the full AFL path contains
`data/afl` and the league-literal guard forbids it.

Three surfaces can each hold the same wrong rule independently — the
constitution, the seeded cards in `rules-qa-seeds.json`, and stored Redis
answers — so check all three. The August 2026 taxi-squad ruling needed
edits in all three; a fourth (`.claude/agents/fantasy-expert.md`) carried
its own copy of the rule.

**A gap in the constitution reads as a wrong answer.** The prompt tells
Roger to answer ONLY from the constitution and to say "I don't see that in
the constitution" otherwise — but when the rulebook is merely *ambiguous*
rather than silent, he infers instead, confidently. Both August 2026
rules bugs were this: the 20-player minimum never said whether taxi/IR
players counted, so he reasoned from the adjacent 22-man roster limit and
got it backwards. When a bug report turns out to be an inference, fix the
ambiguity in the constitution — patching only the answer leaves the trap
armed for the next phrasing of the question.

**Improvement loop** (`pnpm improve:roger`, weekly via
`roger-improvement-loop.yml`): rubric-audits real owner questions from
Redis with an Opus judge, ledgers results in `data/roger-improvement/`,
and drafts failures as eval cases in `proposed-cases.json`. Ground truth
is human-gated on purpose: review a proposal, edit its `reference`, set
`"reviewed": true`, then `pnpm improve:roger --promote <id,...>` to grow
the golden dataset — promotion mechanically refuses unreviewed cases.
Never auto-promote or let the judge author ground truth. Prompt
suggestions land in `latest-report.md`; after applying one, run
`pnpm eval:roger`.

**Detection without delivery is not a loop.** The audit caught the August
2026 taxi-squad ruling correctly on 2026-07-27 and the proposal sat at
`"reviewed": false` for 17 days, because committing a report to the repo
notifies nobody. `scripts/roger-improvement-notify.mjs` (`pnpm notify:roger`,
last step of the workflow) closes that: it reads **state** — whatever is
unreviewed right now, not what this run found — and files one GitHub issue
per pending proposal (deduped on the exact title, weekly aging comment after
that) plus a **GroupMe post to the league** via `GROUPME_ROGER_BOT_ID`. The
two channels have different audiences and must not be collapsed:

- **The issue is for whoever closes it out** — ids, judge verdict, review
  steps, nagged weekly until `"reviewed": true`.
- **The post is for owners**, and says only what they can act on: a stored
  answer they may have read is suspect, don't rely on it yet. No proposal
  ids, no GitHub links. It fires **only for findings new that run** — the
  weekly nag stays on the issue rather than buzzing 12 phones — and never
  for operational errors (a wedged `ANTHROPIC_API_KEY` is not league news;
  it goes to the log and a `::warning::`). "New" is derived from whether the
  issue had to be *created* vs merely commented, so there's no extra state
  file; if `gh` is down nothing counts as new and the post is skipped rather
  than re-announced.
- **Silence when clean.** A weekly "all good" ping trains people to ignore
  the channel. Zero pending + zero judge errors = no issue, no DM, exit 0.
- **Closing an issue does not dismiss a proposal** — the notifier reads
  `proposed-cases.json`, so it re-files next week. `"reviewed": true` (or
  deleting the entry) is the only real off switch.
- Body-building is pure and tested in `tests/roger-improvement-notify.test.ts`;
  keep it that way rather than growing the inline `node -e` pattern some of
  the older workflows use. Preview any change with `pnpm notify:roger --dry-run`.


## NFL Draft date source of truth

- **Authoritative:** `src/data/theleague/nfl-draft-dates-fetched.json` —
  populated by `scripts/fetch-nfl-draft-date.mjs` (ESPN core API) during
  prebuild. This file wins.
- **Fallback:** hand-maintained `HARDCODED_OVERRIDES` in
  `src/data/theleague/league-year-config.ts`. Used when the fetched JSON has
  no entry for a year (offline builds, new year not yet announced).
- **Consumers:** `league-year-config.ts` merges both. `compute-league-events.mjs`
  reads the dates to produce `resolved-events.json`, which the schefter-scan
  reads to decide which reminders to fire.

Never hardcode a draft date in a third place — update the fetched JSON or the
fallback config.


## Daily audit

`.github/workflows/roger-date-audit.yml` runs daily. It runs the reminder-
window tests and fetches the ESPN draft date; if ESPN disagrees with the
committed `nfl-draft-dates-fetched.json`, the workflow fails so the drift
surfaces in the Actions tab. To accept a new date, run
`pnpm fetch:nfl-draft-date` locally and commit the change.

The audit detects drift by re-running the fetch and checking whether
`nfl-draft-dates-fetched.json` came back dirty, so that file must be
byte-identical across runs that resolve the same dates. `_fetchedAt` is
therefore the time a date last **changed**, not the last run — do not make it
bump unconditionally. It did until Aug 2026, which left the audit failing
every single day regardless of drift; a permanently-red alarm is how the wrong
2027 draft date went unnoticed.

