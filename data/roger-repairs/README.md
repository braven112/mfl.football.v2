# Ask Roger stored-answer repairs

Nothing regenerates a stored Ask Roger answer. Roger writes each one once and
the POST handler persists it to Redis (`rules-qa:all` / `afl-rules-qa:all`), so
correcting the constitution fixes future questions and leaves every card
already on the rules-chat page serving the old ruling — see
`docs/claude/rules/roger.md`.

This directory holds the replacement text for those repairs, one file per
stored answer:

    data/roger-repairs/<league-slug>/<qaId>.md

The filename IS the target id. `scripts/fix-rules-qa-answer.mjs --apply`
rewrites only that entry's `answer` field, preserving `id`, `askedBy` and
`createdAt` so the card keeps its position, its attribution and the owner's
original question. Deleting the card — the only lever the UI offers — would
throw all three away.

Run it from CI: **Actions → "Ask Roger — Repair Stored Answers"**
(`workflow_dispatch`), which has the Upstash credentials.

    mode: list   search: rotowire   # find the ids
    mode: apply  dry_run: true      # see the rewrite
    mode: apply  dry_run: false     # write it

Applying is idempotent — an answer that already matches its file reports
`unchanged` and nothing is written. The previous array is snapshotted to
`<key>:repair-backup` before every write.

Files stay here after they're applied: they're the record of what a stored
ruling was changed to, and they make a re-run a no-op rather than a surprise.
