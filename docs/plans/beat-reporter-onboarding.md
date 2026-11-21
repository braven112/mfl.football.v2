# Adding a paying league to the AI Beat Reporter

Onboarding is by hand for now (Brandon, 2026-11-19). A league that buys the
$49 two-for-one gets League History and its own AI beat reporter, which the
league names. Payment arrives through the sales page's contact form until the
PayPal link exists (`HISTORY_AND_REPORTER_CHECKOUT_URL`, `src/data/pricing.ts`).

## What to collect from the commissioner

- A link to the league on MyFantasyLeague (any page of it).
- The league's name, and a short name if it has one.
- The reporter's name, and its personality in a few sentences. This becomes
  the reporter's voice prompt, so plain description works best ("a gruff
  veteran newsman who loves a lopsided trade"). Up to 1,200 characters.
- A 500x500 picture of the reporter. Any size works; the script crops it.
- Whether they want a group chat (GroupMe, Slack or Discord), and which one.

## The command

```bash
node scripts/add-beat-reporter-league.mjs \
  --mfl https://www49.myfantasyleague.com/2026/home/12345 \
  --slug smith --name "Smith Family League" --short-name Smith \
  --reporter-name "Scoop McGee" --voice-file scoop.txt --avatar scoop.png
```

Add `--dry-run` first to see every file it will write. The slug is the
league's address (`mfl.football/smith`) and cannot be changed easily later.

It launches the league as the `history-and-reporter` archetype, registry
`tier: 'ai'`:

- **Pages:** History's pages, plus a News page and a page for every story.
  None of the site's tools (standings, rosters, lineups). The bare address
  redirects to the league's History page.
- **Reporter:** registry `persona` with the name, voice and picture
  (`public/assets/reporters/<slug>.webp`). The commissioner can change it
  later on the league's news admin page, which saves over the registry value.
- **Scanner:** a `schefter` block, so the scanner posts every move and runs
  the NFL lanes (injuries, odds). Every GroupMe lane is off.
- **Columns:** the Saturday matchup preview and Tuesday's history notebook.
  With the move posts, these carry the three-stories-a-week guarantee.

## After the command

1. **Past seasons**, for History and Ask the History:
   `node scripts/backfill-historical-feeds.mjs --league=<slug>`, then
   `node scripts/recompute-derived-chain.mjs`. Seasons MFL marks private
   cannot be read; the History page starts at the first public one.
2. **Ship it:** `pnpm test:unit`, open a PR to staging, promote to production.
   Some guard tests pin per-league lists (`tests/league-jobs.test.ts` and the
   bundled-data baseline among them); add the new league where they ask.
3. **The widget line:** once production has the league, open
   `https://mfl.football/api/beat/snippet?league=<slug>&format=text` signed in
   as a platform admin. It is signed with production's secret, so it only
   comes from there. The commissioner pastes it into MFL under
   Setup > Home Page Message. Until then, the widget shows the ad card.
4. **Group chat**, if they asked for one. One chat per league per season is
   included; a switch to another service mid-season is $49
   (`EXTRA_INTEGRATION_PRICE`). GroupMe and Slack follow
   `docs/plans/league-chat-and-persona.md` (the bot, its env names in the
   registry's `schefter.env` / `chat` block, and turning the lane on). Discord
   is not built yet.

## Cost

Every reporter league joins the scanner and two weekly columns, so each one
adds Claude and build spend. That is why only paying leagues are added.
