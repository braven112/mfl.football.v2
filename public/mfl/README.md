# `public/mfl/` — custom work for outside MFL leagues

Client work for MyFantasyLeague leagues that are **not** this site's own leagues.
One folder per MFL league id:

```
public/mfl/<leagueId>/
  README.md                 install guide for that league's commissioner
  DECISIONS.md              what was agreed, and what is still open
  <widget>.js               the file MFL's page loads
  <widget>.css              its styles, if not inlined
  reference/                snapshots of the client's existing page
```

## Why it is here and not in `src/`

These leagues are not in the league registry and must not be added to it.
`src/config/leagues-data.mjs` is the source of truth for leagues **this site
runs** — it carries apex domains, feature flags, official clocks and data paths,
none of which mean anything for a league we only publish a widget into.
`tests/league-literal-guard.test.ts` walks `src` and `scripts` only, so a league
id written here is correct rather than a violation.

Files under `public/` are served as-is at the site root, so
`public/mfl/10105/standings.js` is `https://mfl.football/mfl/10105/standings.js`.
That URL is what the client's MFL page puts in its `<script src>`. There is no
build step: an edit plus a deploy is the whole release path, which is what lets
a fix reach the client without them re-pasting anything.

## Everything here is world-readable

`public/` is public. Do not put credentials, cookies, MFL passwords, pricing,
or anything else client-confidential in these folders. Commercial terms belong
in the statement of work, not in the repo.

## Rules for a widget that runs on someone else's page

1. **Derive the league from the page, never hardcode it.** MFL serves the page
   at `https://www<NN>.myfantasyleague.com/<year>/home/<leagueId>?MODULE=…`, so
   host, year and league id all come from `location`. A widget written this way
   drops into the next client unchanged.
2. **Read MFL through the same host the page is on.** `…/<year>/export?TYPE=…`
   on the league's own host is same-origin, needs no key, and returns
   `Access-Control-Allow-Origin` for that origin. Never proxy it through us.
3. **Never assume a feed field exists.** MFL's `leagueStandings` export returns
   only the columns that league's standings display is configured to show —
   two leagues return different column sets. Check, and degrade honestly.
4. **An array of one comes back as an object.** MFL collapses single-element
   arrays. Normalize before iterating.
5. **Take artwork from the feed.** `franchise.icon` carries the real URL;
   icon paths embed the year each image was uploaded, so they cannot be built
   from the current year.
6. **Scope every selector.** The widget shares the DOM with MFL's own scripts
   and stylesheets. Namespace under the client's container id.
7. **Fail visibly, not silently.** If a feed can't be read, say so in the table.
   A widget that renders plausible wrong numbers is worse than one that stops.
