/**
 * TheLeague rulebook anchors Ask Roger may link to. Kept apart from
 * rules-qa-system-prompt.ts so node scripts (tsx) can import them: that module
 * reads Roger's prompt through a Vite glob (src/utils/roger-prompts.ts).
 */

/**
 * Every anchor Roger is allowed to link to. Must stay in sync with the
 * RULEBOOK SECTIONS list inside Roger's prompt (private pack, prompts/roger/theleague.md) —
 * tests/roger-eval-cases.test.ts enforces the sync.
 */
export const RULEBOOK_ANCHORS = [
  '#league-information',
  '#important-dates',
  '#division-setup',
  '#team-rosters',
  '#injured-reserve',
  '#starting-rosters',
  '#salary-caps-contracts',
  '#rookie-salaries',
  '#trades',
  '#player-tags',
  '#veteran-extensions',
  '#rookie-extensions',
  '#first-round-team-option',
  '#compensatory-picks',
  '#rookie-draft',
  '#free-agent-bidding',
  '#in-season-free-agent-blind-bidding-process',
  '#waiving-players',
  '#schedule',
  '#scoring-errors',
  '#game-tiebreakers',
  '#standings-tiebreakers',
  '#playoff-structure',
  '#payouts',
  '#replacement-owners',
  '#rule-changes',
] as const;
