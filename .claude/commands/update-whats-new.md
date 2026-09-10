Evaluate whether the current changes need a changelog entry, then write it.

## The model, in one paragraph

**Everything user-facing stages; the Monday rollup publishes.** One article a
week per league, compiled by `scripts/weekly-changelog-rollup.mjs` from
`src/data/weekly-changelog-staging.json`: a screenshot, a lede, then one line
per change under **New this week** and **Fixes & polish**. Depth lives behind
links — a `/guides` page for a feature, the marquee article for a big launch.

This replaced 40 individually-written articles in 12 days that nobody read.
**The default path is staging.** A standalone `whats-new.json` entry is the
exception and needs the user's yes.

## Step 1: Understand what changed

```bash
git diff main...HEAD --name-only
git log main...HEAD --oneline
```

No commits ahead of main → say "Nothing to document." and stop.

## Step 2: Classify

| Type | What it looks like |
|------|-------------------|
| `new-page` | New file under `src/pages/` |
| `new-feature` | New interactive element, tool, or mode on an existing page |
| `enhancement` | Meaningful change to how an existing feature works |
| `bug-fix` | Fix to broken behavior |
| `style-tweak` | Visual-only polish, no behavior change |
| `skip` | Refactor, data sync, internal tooling, test-only, docs-only |

`skip` → say "No changelog entry needed — change is internal." and stop.
Everything else stages. All five types go in the same `changes` array.

## Step 3: League scope (MANDATORY)

- Pages/features under `/theleague/...` or `src/data/theleague/` → `theleague`
- Pages/features under `/afl-fantasy/...` or `data/afl-fantasy/` → `afl`
- Shared infrastructure visible on both sites → `both`

Display code fails closed (an untagged entry shows nowhere) and the rollup
exits 1 on an untagged change. Valid slugs are `theleague` and `afl` — never
`afl-fantasy`.

**`both` means the two full-management leagues, NOT every league.** Best Ball
is draft-only and is excluded automatically (via the registry's `bestBall`
flag). Before checking `both`, ask whether the change is real for a league with
no lineups, no in-season roster management, no Schefter feed and no
`/notifications` route — if it is best-ball-only, tag that league by name
instead.

## Step 4: Write the staged change

Append to the `changes` array of `src/data/weekly-changelog-staging.json`:

```json
{
  "date": "<today YYYY-MM-DD>",
  "type": "new-page | new-feature | enhancement | bug-fix | style-tweak",
  "summary": "One line. What changed and why it matters, naming its page.",
  "impact": "user | admin",
  "area": "<a slug from AREA_LABELS in scripts/weekly-changelog-rollup.mjs>",
  "league": "theleague | afl | both"
}
```

**`summary` is ONE LINE — 200 visible characters, hard-enforced by
`tests/whats-new-data.test.ts`.** It becomes a bullet in the one article
everybody reads. Write it user-facing, not as a code description. If the
change needs more than a line to explain, that is the signal it needs a guide
(Step 6), not a longer bullet. Inline links are welcome and must be
league-neutral (`/standings`, never `/theleague/standings`).

`changes` is the ONLY array the rollup reads — anything parked under another
key is silently dropped when staging resets.

## Step 5: The featured change (for the week's face)

Exactly ONE staged change per league carries `featured: true` and supplies the
article's headline, lede and top screenshot:

```json
{
  "featured": true,
  "headline": "The article title — written in the league's voice",
  "lede": "One or two sentences. This is the homepage card and hero summary.",
  "image": "week-2026-09-14.webp",
  "imageAlt": "Descriptive alt text for the screenshot"
}
```

- **Required whenever the week ships a `new-page`, `new-feature` or
  `enhancement`.** A fixes-only week needs none — it gets a templated title.
- Screenshots are a light/dark THEME PAIR. Capture both with
  `node scripts/capture-whats-new-screenshots.mjs <id>`; the file goes in
  `public/assets/whats-new/`.
- A change tagged `both` featured for both leagues is correct only when the
  screenshot depicts a shared surface. If it shows one league's UI, tag the
  featured change to that league.
- If a later change in the same week is clearly the bigger story, move the flag
  rather than adding a second — the rollup exits 1 on two.

For an AFL-tagged featured change you expect in the hero, also write
`heroHeadline` / `heroAccentWord` — the AFL homepage hero renders a two-part
display line (a plain phrase plus a colour-accented closing word) and otherwise
derives it from the title, which runs long for that condensed type. Both fields
or neither: half a pair is ignored.

**Hero eligibility — ASK, don't decide.** Use `AskUserQuestion` on any
`new-page` / `new-feature`: is this worth the homepage hero? Yes → add
`"heroWorthy": true` to that change, which makes the whole week's article
hero-eligible. No → leave it off. Enhancements and fixes are never hero-worthy.
League events still outrank the article in the hero resolver, which is the
intent: in season, the auction beats the changelog.

## Step 6: Does it need a guide?

A `/guides` page is the evergreen how-to the changelog line links to. Propose
one — with `AskUserQuestion` — when a feature is non-obvious enough that a
bullet cannot carry it: multiple steps, a non-obvious entry point, options
worth explaining, or a rule people will get wrong. Do not write one for an
enhancement that explains itself.

If the user says yes:

1. Add an entry to `src/data/guides.json` (shape in `src/types/guides.ts`).
2. Body blocks are the same union What's New uses — prose strings, `list`
   blocks with a heading and items, `image` blocks. **Guide screenshots live in
   `public/assets/guides/`, not the changelog's directory.**
3. Links are league-neutral and must resolve in EVERY tagged league —
   `tests/guides-data.test.ts` fails the build otherwise. `/contracts` and
   `/salary` are TheLeague-only; `/keepers` and `/records` AFL-only.
4. Point the staged change at it: `"guide": "/guides/<slug>"`.

The guide must exist before the change references it — the test checks the
route resolves.

## Step 7: The marquee exception

A launch big enough to announce the day it ships — **a new page or a new
top-level feature you'd tell someone about unprompted, roughly one a month.**
An enhancement is never one. `AskUserQuestion` with a default answer of NO.

If the user says yes:

1. Write a full entry at the top of `src/data/whats-new.json` — the old rules
   apply in full: editorial voice, 2-3 paragraph `description`, mandatory
   `image`/`imageAlt`, mandatory league-neutral inline links
   (`tests/whats-new-links.test.ts`), `leagues` tag, `excludeFromHero` per the
   user's hero call.
2. **Also stage a one-line change** carrying `"entryId": "<that entry's id>"`,
   so Monday's article still names it and links to the full story. A change
   never carries both `entryId` and `guide`.

## Step 8: Confirm

Tell the user:
- Which file was updated, and the line or entry that was written
- Whether a screenshot is still needed
- Whether you proposed a guide, and the answer
