/**
 * The Owners' Poll — the words, in one place.
 *
 * Six surfaces have to explain the same schedule: the Tuesday chat post, the
 * Thursday reveal, two push builders, the column's poll section, the ballot
 * page, and the homepage card. The original complaint that started this work
 * was "I don't understand when a poll starts or ends" — and the reason nobody
 * could tell is that *none* of those surfaces said. Six independent rewrites
 * would have fixed that for a week and drifted by the end of the season.
 *
 * So the sentences live here and the TIME is passed in already formatted.
 * That split is deliberate: a GroupMe post has no viewer to have a clock
 * preference and formats in the league's own zone, while a web surface must
 * render in whatever clock the viewer chose with the league's appended
 * (`viewer-clock.ts`). Sharing the formatter would force one of them to be
 * wrong; sharing the WORDING is what actually needed to be shared.
 *
 * Plain .mjs because both sides consume it — the node chat/push builders under
 * scripts/ and the TypeScript components under src/.
 *
 * See docs/plans/owners-poll.md.
 */

/**
 * The one-line explanation of how voting works now.
 *
 * Every surface leads with "always open" rather than a deadline, because the
 * deadline is no longer the thing an owner has to act on — the result time is
 * just when the count is taken.
 */
export function standingVoteLine(formattedResultTime) {
  return `Voting is always open — your ballot stands until you change it. Next result ${formattedResultTime}.`;
}

/** Shorter form, for a push body or a chat post's tail. */
export function nextResultLine(formattedResultTime) {
  return `Next result ${formattedResultTime}.`;
}

/**
 * The deadline phrase, which changes when the kickoff clamp bites.
 *
 * On a normal week the count is taken at the league's scheduled hour. On a
 * week whose games start earlier — Thanksgiving opens around 10:00 PT — it is
 * pulled back to just before the first snap, and saying "Thursday 4pm" then
 * would be a lie an owner discovers by being locked out.
 */
/**
 * @param {string} formattedResultTime
 * @param {boolean} [clampedToKickoff]
 */
export function resultTimingPhrase(formattedResultTime, clampedToKickoff = false) {
  return clampedToKickoff
    ? `at kickoff, ${formattedResultTime}`
    : formattedResultTime;
}

/**
 * How an owner's own standing ballot is described back to them.
 *
 * `weeksOld` is null when they have never voted.
 */
/** @param {number|null} weeksOld */
export function ballotAgeLine(weeksOld) {
  if (weeksOld == null) return 'You have no ballot on file.';
  if (weeksOld < 1) return 'Your ballot is current.';
  if (weeksOld === 1) return 'Your ballot is a week old.';
  return `Your ballot is ${weeksOld} weeks old.`;
}

/** The "Still good" prompt, shown once a ballot passes the stale threshold. */
/** @param {number|null} weeksOld */
export function stillGoodPrompt(weeksOld) {
  return `${ballotAgeLine(weeksOld)} Still how you see it?`;
}

/**
 * Coverage, stated as coverage rather than turnout.
 *
 * Under standing votes this number only ever grows and trends to the whole
 * league, so the old scarcity framing ("7 left, closes at 6") is not merely
 * stale, it is false. What it honestly measures is how much of the league has
 * an opinion on file — and the weekly signal, when there is one, is how many
 * owners CHANGED their mind.
 */
/**
 * @param {number} onFile
 * @param {number} eligible
 * @param {number|null} [changedThisCycle]
 */
export function coverageLine(onFile, eligible, changedThisCycle = null) {
  const base = `${onFile} of ${eligible} owners have a ballot on file`;
  if (changedThisCycle == null || changedThisCycle <= 0) return `${base}.`;
  const verb = changedThisCycle === 1 ? 'owner has' : 'owners have';
  return `${base} · ${changedThisCycle} ${verb} changed theirs since the last result.`;
}

/** Whole weeks between an edit and now — the unit every age line uses. */
/**
 * @param {string|null|undefined} updatedAt
 * @param {Date|number} now
 * @returns {number|null}
 */
export function weeksSince(updatedAt, now) {
  const then = Date.parse(updatedAt ?? '');
  if (!Number.isFinite(then)) return null;
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(nowMs)) return null;
  return Math.max(0, Math.floor((nowMs - then) / (7 * 86400 * 1000)));
}
