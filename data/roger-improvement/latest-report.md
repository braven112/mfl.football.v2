# Ask Roger improvement report

Generated: 2026-08-17T16:50:45.811Z · Judge: claude-opus-5 · Audited this run: 1

**1 pass / 0 fail.** 1 proposal(s) awaiting human review in data/roger-improvement/proposed-cases.json.

## Next steps

1. Review each unreviewed proposal: verify/edit `case.reference` against the constitution, set `"reviewed": true`.
2. `pnpm improve:roger --promote <id,...>` to grow the golden dataset.
3. Apply any prompt suggestions, then `pnpm eval:roger` — promoted cases prove the fix, the rest prove no regression.
