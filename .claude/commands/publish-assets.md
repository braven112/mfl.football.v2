Ship a branding-assets-only change straight to main — regenerate the derived files, prove the diff really is assets-only, run the guard tests, then commit, PR and merge with **no code review**.

**Why this command exists.** `/live` runs five reviewers and an adjudication
pass because most diffs contain logic. A batch of team logos contains none: the
PNGs are opaque to every reviewer in that lineup, and the config edits are a
handful of string paths. Asking Claude, Codex, CodeQL, Copilot and Gemini to
weigh in on `"iconDark": "/assets/afl/icons/badd_boys_dark.png"` produces
nothing but latency.

**What makes skipping review safe is step 2, not the file extensions.** The
justification is "this diff cannot contain logic," so the command has to *prove*
that rather than assume it from the user saying "it's just logos." Step 2 is a
mechanical gate over the whole diff. If anything falls outside the allowlist —
one `.ts` file, one unexpected config key — this command **stops and sends the
user to `/live`**. Never widen the allowlist to get a diff through; the moment
you do, an unreviewed code change ships behind an asset-shaped PR.

Use `/live` instead whenever the change touches component code, utils, scripts,
tests, or a config field that anything computes with.

## Steps

### 1. Regenerate the derived files

Asset changes have three generated downstreams, and every one of them has
shipped stale at least once. Run all three before looking at the diff — they are
idempotent, so running them when nothing changed costs a few seconds and proves
they're in sync.

```bash
node scripts/measure-crest-contrast.mjs   # crest-dark-stroke-manifest.json
node scripts/sync-theleague-assets.mjs    # src/data/theleague.assets.json
node scripts/sync-afl-assets.mjs          # data/afl-fantasy/afl.assets.json
```

Two traps here, both of which have bitten:

- **`sync-afl-assets.mjs` writes 72 untracked numbered alias PNGs**
  (`public/assets/afl/{icons,banners,group-me}/00NN.png`). They are build
  artifacts, they have never been committed, and they must not start being
  committed now. Delete them before staging:

  ```bash
  git ls-files --others --exclude-standard 'public/assets/afl/*' \
    | grep -E '/[0-9]{4}\.png$' | while IFS= read -r f; do rm -- "$f"; done
  ```

- **`pnpm sync:afl` is NOT the same thing.** That script also runs
  `sync-afl-asset-urls.mjs`, which pulls live icon/banner URLs from MFL and will
  happily overwrite a franchise's local art with its *old* name's file — it
  rewrote A Bruin Pegs Me back to `herd.png` and The Show to `gobblers.png` in
  Sep 2026, silently, in a PR about something else. Call
  `sync-afl-assets.mjs` directly, as above. If you ever do run the URL sync,
  diff the config and revert anything you did not intend.

**A regenerated file with no change is the expected outcome.** If the manifest
or a registry *does* move, read the diff and make sure you can explain it — a
crest dropping out of `crest-dark-stroke-manifest.json` should correspond to an
`iconDark` you just added, and nothing else.

**Revert a registry whose only diff is `generatedAt`.** Both sync scripts stamp
a fresh timestamp every run, so a league you did not touch still shows as
modified. Committing that is noise in a diff whose whole claim is "only these
assets changed":

```bash
git diff <registry> | grep '^[+-]' | grep -v '^[+-][+-]' | grep -v generatedAt
# nothing printed → git checkout -- <registry>
```

### 2. Prove the diff is assets-only (the gate)

Collect every path this branch touches — committed, staged and unstaged — and
require all of them to match the allowlist.

```bash
{ git diff --name-only origin/main...HEAD; git diff --name-only; git diff --cached --name-only; } | sort -u
```

**Allowed paths — nothing else:**

| Path | What it is |
|---|---|
| `public/assets/**` (image files) | the artwork itself |
| `src/data/theleague.config.json` | TheLeague branding fields (key-checked below) |
| `data/afl-fantasy/afl.config.json` | AFL branding fields (key-checked below) |
| `src/data/theleague.assets.json` | generated registry |
| `data/afl-fantasy/afl.assets.json` | generated registry |
| `src/data/crest-dark-stroke-manifest.json` | generated measurement |
| `src/data/weekly-changelog-staging.json` | the changelog entry from step 5 |

**The two config files are allowed only for branding keys.** These files also
hold division/tier/color/gradient/history data that real code computes with, so
a path-level allowlist is not enough — check the changed lines:

```bash
{ git diff origin/main...HEAD -- src/data/theleague.config.json data/afl-fantasy/afl.config.json; \
  git diff -- src/data/theleague.config.json data/afl-fantasy/afl.config.json; \
  git diff --cached -- src/data/theleague.config.json data/afl-fantasy/afl.config.json; } \
| grep -E '^[+-]' | grep -vE '^(\+\+\+|---)' \
| grep -vE '^[+-][[:space:]]*"(icon|iconDark|iconStrokeDark|groupMe|groupMeDark|banner)":' \
| grep -vE '^[+-][[:space:]]*[{}],?[[:space:]]*$'
```

That prints the changed config lines that are **not** branding keys and not pure
punctuation. **It must print nothing.** A line that only gained a trailing comma
still shows its key, so it passes on the key name — that's intended.

**If anything is outside the allowlist, stop.** Print what fell out and tell the
user to run `/live` instead. Do not offer to split the diff yourself unless they
ask — the honest report is "this isn't an assets-only change."

### 3. Sanity-check the assets themselves

Cheap checks that catch the mistakes actually made in this workflow:

- **Light/dark not swapped.** For every `*_dark.png` added or modified, confirm
  it is the dark variant and not the light one. A file named `foo-group.png`
  next to `foo-group-dark.png` in Downloads means the first is the **light**
  crest — that exact pair got installed backwards in Sep 2026. Read both images
  when a pair arrives together. Filenames are the WEAKEST evidence available:
  `cowboy-light-dark.png` turned out to be a byte-different re-export of
  `cowboy-light-group.png` (0.00 pixel difference). Measure, then ask.
- **A quick way to tell them apart when the thumbnails look identical:** mean
  luminance of the semi-transparent EDGE pixels. The dark cut carries the
  lighter outline — 179 vs 93 on the Cowboy Up pair.
- **Dimensions match the sibling.** A dark variant should be the same pixel size
  as its light original (`sips -g pixelWidth -g pixelHeight`).

**Deriving an icon from a crest — check the relationship FIRST.** Most icons in
both leagues are plain downscales of their 400x400 crest, so a dark icon can be
cut from the dark crest with `sharp(...).resize(W, H, {kernel:'lanczos3'})` and
no new artwork decision. Prove it before relying on it: downscale the LIGHT
crest and diff it against the shipped LIGHT icon, composited on a flat
background.

```js
// composite on white first — fully transparent pixels carry arbitrary RGB,
// and comparing raw RGBA reports ~57/255 on a pair that is actually identical.
const a = await sharp(crest).resize(w,h).flatten({background:'#fff'}).raw().toBuffer();
const b = await sharp(icon).flatten({background:'#fff'}).raw().toBuffer();
```

Under ~8/255 means downscale, and the derivation is safe. **Minty Fresh measured
28.78** — a separate small-size cut with heavier strokes. Deriving only its DARK
icon there would have made dark mode change the artwork's *weight* rather than
its theme, so both its icons were re-cut from its crests to keep the pair
consistent. Decide which way to go before you generate anything.

- **Basenames can differ between an icon and its crest.** Minty is
  `icons/minty.png` but `group-me/minty-fresh.png`. Each dark file follows its
  OWN light sibling (`minty_dark.png`, `minty-fresh_dark.png`) — the config
  audit in step 4 checks exactly this.
- **Every new file is referenced.** A `*_dark.png` that no config field points at
  does nothing. Conversely every `iconDark`/`groupMeDark` path must exist on
  disk — `git status` showing an unstaged new PNG next to a staged config that
  references it is how a 404 ships.
- **Shared franchises land in both leagues.** Several franchises appear in
  TheLeague *and* the AFL with byte-identical light art (Midwestside, Ninjas,
  Computer Jocks, Vitside, Da Dangsters). Compare hashes; if the light files
  match, the dark file belongs in both trees and both configs.

### 4. Run the tests

```bash
pnpm test:unit
```

Full suite, not just the theming files — config edits reach further than they
look. The ones that actually gate this change are
`tests/crest-dark-stroke.test.ts` (fails if an `iconStrokeDark` opt-in emits no
rule, or if the committed manifest drifts from what the assets measure) and
`tests/team-accent-css.test.ts`.

**`iconDark` and `iconStrokeDark` are mutually exclusive.** Adding real dark art
to a franchise that carried a generated outline makes its `iconStrokeDark` dead
config, and the guard test fails until you remove it. That is the test doing its
job — delete the stale key rather than working around it. This holds for
`false` as well as for a colour: `false` is not exempt just because the
"every opt-in emits a rule" check skips it.

Run this audit alongside the suite — it catches placement bugs the tests cannot,
because a misplaced key still parses as valid JSON:

```js
for (const t of teams) {
  // every declared path resolves
  for (const k of ['icon','iconDark','groupMe','groupMeDark','banner'])
    if (t[k] && !existsSync('public' + t[k])) FAIL;
  if (t.iconDark && t.iconStrokeDark !== undefined) FAIL;          // mutually exclusive
  if (t.iconDark && t.icon.replace('.png','_dark.png') !== t.iconDark) FAIL;
  if (t.groupMeDark && t.groupMe.replace('.png','_dark.png') !== t.groupMeDark) FAIL;
  for (const h of t.history ?? [])                                  // stray keys in an era
    for (const k of ['iconDark','groupMeDark','iconStrokeDark']) if (h[k] !== undefined) FAIL;
}
```

That last check exists because of a real bug: a `perl`/`replace` anchored on
`      "icon": "…"` at six-space indent also matches inside a TEN-space
`history` entry, since the six-space string is a SUBSTRING of the ten-space
line. An `iconDark` landed in another franchise's history block, the real
franchise got none, and the JSON still parsed. **Anchor every config edit to
line start** (`^` with `/m`, or match the full leading whitespace).

Type-checking is not in scope: `pnpm test:types` takes ~2.5 min and no asset
change can move the baseline.

### 4a. When the gate or a guard test says this is not assets-only

Both are working. Do not widen the allowlist and do not work around the test —
route the change instead, and note that **`/live` is the destination whenever
the two halves cannot be split**:

- **A test or story fixture broke because of the DATA you changed.** Giving a
  franchise dark art removes it from the stroke set by construction, which
  retires any fixture pinned to it. That happened five times in one session.
  A fixture change is code: it goes through `/live`, or lands as its own small
  PR first if it passes against unchanged `main` (a synthetic fixture does).
- **The change needs a Chromatic trigger entry.** See step 8 — that one CANNOT
  be split, so the whole batch goes through `/live`.
- **Ask whether the fixture should be repointed at all.** Repointing at the next
  real franchise defers the problem by about a day; prefer a synthetic fixture,
  or delete the case if the branch has genuinely run out of subjects. Say which
  you did and why.

### 5. Changelog entry (light)

Logo swaps are **exempt from What's New** — `src/data/whats-new.json` is for
user-facing features, and CLAUDE.md explicitly skips style tweaks. Do not run
`/update-whats-new` here.

Do add one line to the `changes` array of
`src/data/weekly-changelog-staging.json` when the change is visible to owners
(a team's logo looks different now):

```json
{ "date": "YYYY-MM-DD", "type": "style-tweak", "summary": "<team> now has a dark-mode logo", "impact": "user", "area": "Branding", "league": "theleague" }
```

`league` is mandatory (`theleague | afl | both`) — the Monday rollup exits 1 on
an untagged change. Skip the entry entirely for invisible work (a registry
regen, a dark variant for a team nobody sees in dark mode yet).

### 6. Commit

Conventional commit, imperative subject, Co-Authored-By trailer. Group the whole
batch into one commit — a logo per commit is noise.

```
chore(assets): add dark-mode logos for <teams>
```

Use `feat(assets):` only if the change gives a franchise dark-mode branding it
did not have at all.

Skip the data-sync noise files when staging, same as `/live`:
`data/theleague/live-*`, `data/theleague/mfl-feeds/`, `src/data/salary-history/`,
`src/data/theleague/mfl-player-salaries-*`.

### 7. Push and open the PR

```bash
git push -u origin HEAD
gh pr view --json number,url,state 2>/dev/null   # reuse an existing PR
```

If none exists:

```bash
gh pr create --title "<commit subject>" --body "$(cat <<'EOF'
## Summary
<one line per team, saying which asset and which league(s)>

Assets-only change — no code paths touched. Shipped via `/publish-assets`
(no code review; see the command for the allowlist that gate is based on).

## Coverage after this PR
<the icons/crests per-league counts>

## Test plan
- [x] `pnpm test:unit`
- [x] Derived files regenerated (crest manifest, both asset registries)
- [ ] CI passes

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

State plainly in the PR body that review was skipped and why. A reviewer landing
on this later should not have to guess whether it was an oversight.

### 8. Expect Chromatic to fail, and treat it as the review

**An assets-only PR trips `Visual tests` essentially every time.** Swapping a
crest changes the pixels of every Storybook story that renders it, so Chromatic
reports "N visual changes" and exits 1. The first run of this command produced
6 changes across 320 snapshots. Nothing is broken — Chromatic is asking a human
to accept the new baselines.

**Do not treat this as noise, and never `--admin` past it.** The entire safety
argument for this command is "the change is purely visual, so the code reviewers
have nothing to look at." That argument makes the *visual* check the primary
gate rather than an optional one. Skipping code review AND the visual check
means shipping with nothing having reviewed the change at all.

So when `Visual tests` fails:

```bash
gh run view --job <JOB_ID> --log-failed | grep -E 'visual changes|chromatic.com/build'
```

Give the user the build URL and stop. **You cannot make this call for them** —
deciding a new baseline is correct means looking at the rendered diff, and "the
logo changed because I changed the logo" is precisely the assumption that would
hide a swapped light/dark pair or a crest that vanishes on a dark card.

The one case where you may proceed without waiting: the user has already looked
at the build and told you to go ahead.

**Every re-run starts a NEW Chromatic build; it does not re-judge the old one.**
This matters because the obvious loop is wrong. Re-running against build 171's
19 unaccepted changes produced build 172 with 16 — the acceptances that had
landed carried over as inherited baselines, the rest did not, and the user was
now looking at a stale URL. The sequence that works:

1. Give them the URL from the build that just ran.
2. Wait for them to accept **on that build**.
3. Only then re-run — and check first, because accepting often turns the commit
   status green by itself and the re-run gets refused as unnecessary.

Always hand over the URL from the LATEST build. And note that a rebase or any
new commit also produces a fresh build, which inherits accepted baselines and
passes clean — that is why a rebased branch can go green with no new review.

**A batch that touches no story asset never triggers Chromatic at all.** The
trigger list is per-file by design, so refreshing a crest no story renders
(Bring The Pain, Sept 2026) ships with six checks and no visual build. That is
the design working, not a check being skipped.

### 9. Merge

No approval step and no adjudication — there are no findings to adjudicate.
Wait for checks, then merge:

```bash
gh pr merge <PR_NUMBER> --auto --squash
```

Self-authored PRs can sit in `mergeable_state: "blocked"` even with everything
green. Once every required check is SUCCESS, force it (standing authorization
covers self-authored PRs with green checks):

```bash
gh pr merge <PR_NUMBER> --squash --admin
```

Never `--admin` past a failing check. CI is the only gate this command has left
— if it goes, nothing is checking the change at all.

**If the merge is refused with a `git merge origin/main` hint, the branch is
behind.** Rebase — this repo never merges (`CLAUDE.md`) — then force-push with
lease and wait for the fresh checks:

```bash
git rebase origin/main && git push --force-with-lease
```

Expect a conflict in `src/data/weekly-changelog-staging.json` if another asset
PR landed the same day: both sides prepend to `changes`. It is **additive** —
keep every entry from both sides, never pick one. Then re-run the sync scripts
and re-check for timestamp-only churn (step 1), and confirm the other PR's
artwork survived byte-identical:

```bash
shasum <file>; git show origin/main:<file> | shasum
```

### 10. Monitor and report

Poll until merged or a check fails (same loop as `/live` step 10). Then print:

- The PR URL (clickable)
- The squash commit SHA
- `Deployed to main ✓`
- **The coverage table** — icons and crests per league, and which franchises are
  still missing dark art. That list is the reason the next batch happens, and it
  is the one thing the user always asks for next.

Derive that table from the FILES ON DISK against merged `main`, never from an
earlier message in the conversation. Three separate count errors shipped into
PR bodies and a user-facing changelog in one session by quoting a running tally
instead of re-measuring — including "16/16 complete" when it was 13/16.

The same rule applies to any number in a changelog entry: **quote what a reader
can see, not an internal artifact.** `crest-dark-stroke-manifest.json` is the
raw measurement, and `withStrokeColors` then drops `false` opt-outs and adds
unmeasured opt-ins, so the manifest row count is NOT the number of outlines
anyone sees. Count the emitted rules:

```js
withStrokeColors(league, teams).filter(e => e.strokeColor !== false && e.icon).length
```

If CI fails, print the failing check names and stop. Do not `--admin` around a
red check to finish the ship.
