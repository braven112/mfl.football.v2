# Scouting System

Year-round per-franchise GM dossiers + event reports + a prediction ledger.

## Layout

```
scouting-system/
  franchises/<id>-<slug>.json      ← Living per-franchise dossier
  reports/<year>-<event>/
    predictions.json               ← Full event report (briefs + mock + market notes)
    meta.json                      ← Generation metadata
  predictions-ledger.json          ← Append-only ledger of every prediction
```

## Event types

| Event             | When           | Predicts                                          |
|-------------------|----------------|---------------------------------------------------|
| `rookie-draft`    | Pre-draft      | Per-owner targets + 3-round mock                  |
| `season-start`    | Week 1         | Win totals, breakouts, busts                      |
| `trade-deadline`  | Week 8 ish     | Buyer/seller, likely deals                        |
| `playoffs`        | Week 14        | Bracket, upset risks                              |
| `year-end`        | Post-Super Bowl| Extensions, franchise tags, comp picks, releases  |

## Generation

Reports are generated locally and committed:

```bash
pnpm scout:rookie-draft 2026
```

The script makes one Anthropic API call per franchise, role-playing each
GM. Output is written to `reports/<year>-<event>/` and any new predictions
are appended to the ledger.

## Prediction tracking

Every prediction is appended to `predictions-ledger.json` with an empty
`outcome` slot. A separate scoring step (run after the actual event) backfills
`outcome.actual` and `outcome.correct`, building a track record we can use to
assess and improve the system over time.
