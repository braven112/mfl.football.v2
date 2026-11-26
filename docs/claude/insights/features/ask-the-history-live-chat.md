# Ask the History — the live chat

## 2026-11-26 — Buck answers live, in place, as one conversation

Brandon: typing on the History home "just opens up another page", follow-ups
"feel like a separate question", and sharing a follow-up "doesn't give any
context to the first one".

- **Vercel AI SDK UI (`useChat`) was weighed and skipped.** Its selling point
  is conversation state, which we already had (`after` + `ask-store`
  `turnsAfter`), and adopting it meant rebuilding `askHistory`'s tool loop,
  the per-league model choice, cost tracking and the rate limit. The live
  chat is our own Anthropic SDK stream plus ~150 lines of client
  (`src/utils/league-history/ask-live.ts`).
- **Wire:** `POST /api/league-history/ask` with `stream: true` answers NDJSON:
  `step` per lookup, `answer` with the WHOLE answer so far (never a delta, so a
  guest's line can be re-masked whole), then one `done` (the old JSON body) or
  `error`. Refusals before the work starts stay plain JSON with their status.
  `tests/league-history-ask-stream.test.ts`.
- **The answer lives inside a tool call** (`answer.input.answer`), so typing it
  out needs `eager_input_streaming: true` on that tool, or the API buffers the
  whole string. And the SDK's partial-JSON parser DROPS an unfinished string,
  so the snapshot shows nothing until the answer is done: `partialAnswer` reads
  the raw `input_json_delta` buffer by hand. With eager streaming the API no
  longer validates the input, so a `max_tokens` (or `refusal`) turn is never
  run or kept.
- **Memory:** `MAX_TURNS` 4 → 10. The prompt tells Buck to answer a follow-up
  as his next reply in the same conversation.
- **Whole conversation on a link:** `loadConversation` walks `parent` links
  (each earlier answer with its chart); turns too old to read back fall back to
  `saved.turns` text. A guest chain never mixes with an owner one. The ask
  screen and the shared answer page both draw it; only the newest answer
  carries a Share button, since its link is the whole chat.
- **Share card:** a follow-up's PNG leads with "It started with “…”", and a
  ranking chart is drawn as up to five bars (`cardBars`); stacked, career and
  what-if charts are not flattened.
- **In place:** the History home's box is the chat for owners who can ask; for
  everyone else it still opens the ask screen (sign-in, the demo's counter).

## 2026-11-26 — a hidden owner is just his team's name

Brandon, on a guest answer reading "Vitside Mafia Owner": "we don't say
Vitside Mafia owner, that sounds weird". The signed-out stand-in
(`ownerStandIns`, guest-names.mjs) is now the bare team name, the way the
league talks. Co-owners ("A & B") and a name shown beside its own team
("A (Team)") collapse to one team name. Archived What's New text still quotes
the old form; it is history, not a rule.

## 2026-11-26 — signed-out visitors chat in place too

Brandon, reviewing the preview signed out: asking from the History home "links
me to another page first … and then I have to hit X to go back". The in-place
chat was owners-only; it now also serves a guest of the public demo league
(`canGuestAsk`). The API already masks names and counts the guest's
questions; the box shows "N free questions left today", and only a refusal
for running out links to the ask screen, which holds the email box.

## 2026-11-26 — Buck calls everyone by team, signed in or not

Brandon: "I want to use franchise names even when signed in. It feels more
natural than referring to an owner's name." The system prompt now tells Buck
to name every owner by their team (that season's name, or for a career the
team they are best known for), never a personal name, even when the asker
used one. Owner names stay in the data so "how has Todd done" still finds
him. Pinned in `tests/league-history-ask.test.ts`. History pages keep owner
names unless Brandon widens it.

## 2026-11-26 — team names on every History page, signed in or not

Brandon picked "Buck and all History pages" on the card. The middleware now
runs the same owner → team masker (`teamNameMasker`, guest-mask.ts) over every
league's history, franchise and rivalry pages for EVERYONE
(`teamNamePathLeague`, guest-names.mjs). Owner pages keep real names for
signed-in owners, because they exist to show the person (guests still see
them masked on TheLeague). Team-names mode fails OPEN and leaves the cache
headers alone, since it is the same page for every viewer; guest mode still
fails closed and is `private, no-store`. The franchise hero no longer prints
"Owner: <name>" (it would read "Owner: Smokane FC"): it links "Owner page ›".

## 2026-11-26 — in-place answers: chart styles, and names swapped on the way out

Brandon's first in-place answer on the History home drew every chart as a
black box: `HistoryAsk.astro` never imported `record-charts.css` (the ask
screen and HistoryAnswer do), and the home only needed it once Buck answered
there. And a prompt rule alone let "Jomar Marinio's team" through for a
signed-in owner, because a live answer is JSON the page renders client-side,
which the middleware's HTML pass never sees. The owner path now runs the
team-name masker over every streamed event and the final answer (the data
keeps real names so a question about a person still finds them), and the
masker folds "<Team>'s team" into the team.
