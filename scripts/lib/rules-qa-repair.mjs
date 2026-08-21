/**
 * Pure helpers for repairing stored Ask Roger answers.
 *
 * Fixing the constitution does NOT fix answers already on the page: Roger
 * generates each answer once and the POST handler persists it to Redis, and
 * nothing ever regenerates a stored answer (docs/claude/rules/roger.md). So a
 * ruling that was correct-for-the-old-wording keeps getting served to every
 * owner who scrolls past it long after the rulebook is clarified.
 *
 * The repair is a targeted rewrite of the `answer` field IN PLACE —
 * `id`/`askedBy`/`createdAt` are preserved so the card keeps its position,
 * its attribution, and the owner's original question. Deleting and re-asking
 * would discard all three.
 *
 * Everything here is pure so the risky part (a whole-array overwrite of
 * `rules-qa:all`) is covered by tests/rules-qa-repair.test.ts rather than by
 * hoping the one-shot script was right.
 */

/** Fields a repair is allowed to touch. Everything else must survive byte-identical. */
const MUTABLE_FIELDS = ['answer'];

/** Case-insensitive substring match across an entry's question + answer. */
export function matchesSearch(entry, term) {
  if (!term) return true;
  const needle = term.toLowerCase();
  return (
    String(entry.question ?? '').toLowerCase().includes(needle) ||
    String(entry.answer ?? '').toLowerCase().includes(needle)
  );
}

/** One-line, log-safe digest of a stored Q&A. */
export function summarizeEntry(entry, { answerChars = 160 } = {}) {
  const answer = String(entry.answer ?? '').replace(/\s+/g, ' ');
  const truncated =
    answer.length > answerChars ? `${answer.slice(0, answerChars)}…` : answer;
  return [
    `id:        ${entry.id}`,
    `asked:     ${entry.createdAt ?? '(no date)'} by ${entry.askedBy ?? '(seed/unknown)'}`,
    `question:  ${entry.question}`,
    `answer:    ${truncated}`,
  ].join('\n');
}

/**
 * Apply `repairs` ([{ id, answer }]) to `entries`, returning a NEW array plus
 * a per-repair result. Never reorders, never adds, never drops: the array
 * written back to Redis differs from the one read only in the `answer` field
 * of the entries named by a repair.
 *
 * Results are one of:
 *   - 'updated'   — answer replaced
 *   - 'unchanged' — stored answer already byte-identical (re-running is a no-op)
 *   - 'not-found' — no entry with that id (a typo'd id, or an owner deleted
 *                   the card between the list run and the apply run)
 */
export function applyRepairs(entries, repairs) {
  if (!Array.isArray(entries)) {
    throw new Error('Stored answers are not an array — refusing to write.');
  }
  const byId = new Map(entries.map((e, i) => [e.id, i]));
  const updatedIndexes = new Map();
  const results = [];

  for (const repair of repairs) {
    const index = byId.get(repair.id);
    if (index === undefined) {
      results.push({ id: repair.id, status: 'not-found' });
      continue;
    }
    const current = updatedIndexes.get(index) ?? entries[index];
    if (current.answer === repair.answer) {
      results.push({ id: repair.id, status: 'unchanged' });
      continue;
    }
    updatedIndexes.set(index, { ...current, answer: repair.answer });
    results.push({
      id: repair.id,
      status: 'updated',
      before: current.answer,
      after: repair.answer,
    });
  }

  const updated = entries.map((entry, i) => updatedIndexes.get(i) ?? entry);
  return { updated, results };
}

/**
 * Guard the write: confirm the outgoing array is the incoming one with only
 * `answer` fields changed. Cheap insurance against a future edit to
 * applyRepairs quietly dropping a field — the blast radius here is every
 * stored answer since launch, under a single key.
 */
export function assertOnlyAnswersChanged(before, after) {
  if (before.length !== after.length) {
    throw new Error(
      `Repair changed the number of stored answers (${before.length} -> ${after.length}) — refusing to write.`,
    );
  }
  for (let i = 0; i < before.length; i++) {
    const a = before[i];
    const b = after[i];
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const key of keys) {
      if (MUTABLE_FIELDS.includes(key)) continue;
      if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
        throw new Error(
          `Repair changed "${key}" on entry ${a.id ?? i} — only ${MUTABLE_FIELDS.join('/')} may change.`,
        );
      }
    }
  }
}
