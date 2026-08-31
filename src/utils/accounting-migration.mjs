/**
 * Year-rollover migration for the league ledger.
 *
 * MFL creates a BRAND NEW league every year — Feb 14 for TheLeague, June 1 for
 * the AFL — and the new league's accounting ledger starts completely empty.
 * Nothing carries over on MFL's side. Whatever an owner was up or down at the
 * close of last year simply vanishes unless it is written into the new year's
 * books, which is what this plans.
 *
 * PURE. No fetch, no fs, no clock. Same contract as accounting-payouts.mjs and
 * for the same reason: the plan a commissioner approves must be reproducible
 * from its inputs alone.
 *
 * ── THE SIGN IS PRESERVED, NEVER FLIPPED ──────────────────────────────────
 * A franchise sitting at -100 at the close of 2025 (they owe $100) opens 2026
 * at -100. A franchise at +300 (the league owes them) opens at +300. The
 * carried amount IS the closing balance, unchanged.
 *
 * This is the single most destructive thing to get wrong in this file. Flipping
 * it converts every debt in the league into a credit and every credit into a
 * debt, in one pass, with no error from MFL and no way to tell from the new
 * ledger that anything is wrong — the numbers all look plausible. Pinned by
 * tests/accounting-migration.test.ts.
 *
 * ── BALANCES FOLLOW THE FRANCHISE, NOT THE OWNER ──────────────────────────
 * Both constitutions say a replacement owner takes the team over as-is,
 * including its financial obligations ("rosters, keepers, picks, finances. No
 * refunds for departing owners"). So a straight franchise-id carry is the rule,
 * not an approximation of one: if 0009 changed hands over the winter, 0009's
 * debt is still 0009's debt. No owner-history lookup belongs here.
 */

const asArray = (value) => (value == null ? [] : Array.isArray(value) ? value : [value]);

const padFranchise = (value) => {
  const text = String(value ?? '').trim();
  if (!text) return '';
  return /^\d+$/.test(text) ? text.padStart(4, '0') : text;
};

/** Round to cents so a summed balance carries no float dust. */
const toCents = (value) => Math.round(value * 100) / 100;

/**
 * The description written on every carried record, and the idempotency handle.
 *
 * Deterministic and year-stamped: re-running a migration finds this string
 * already in the target ledger and skips it rather than carrying the balance a
 * second time. MFL's import has no upsert and no delete, so this check is the
 * only thing standing between a double-click and every balance applied twice.
 */
export function carryDescription(fromYear) {
  return `Balance carried forward from ${fromYear}`;
}

/**
 * Plan a year-to-year carry-forward.
 *
 * @param {object} options
 * @param {number|string} options.fromYear Season/league year being closed out.
 * @param {number|string} options.toYear   League year receiving the balances.
 * @param {{balances?: Record<string, number>, records?: Array<{franchiseId?: string, amount?: number, description?: string, timestamp?: number, id?: string}>}} options.sourceLedger
 *   Year N's ledger. Only `balances` is read here, but every real caller hands
 *   over a whole `AccountingLedger` — the API route and the carry-over script
 *   both pass `result.ledger` straight through — so the declared shape has to
 *   admit `records` rather than making them pass a stripped-down object.
 * @param {Array} [options.targetRecords] Year N+1's existing records, for idempotency.
 * @param {Array<{id: string, name?: string}>} [options.franchises] Target-year roster of franchises.
 * @returns {{lines: Array, skipped: Array, warnings: Array, totals: {carryable: number, alreadyMigrated: number, conflicts: number, sourceNet: number, carriedNet: number, franchisesCarried: number}}}
 *   `totals` is spelled out rather than left as `object` because consumers
 *   genuinely read its fields — the carry-over script gates the whole write on
 *   `sourceNet === carriedNet`, and a bare `object` makes that comparison a
 *   type error at every call site.
 */
export function planYearMigration({
  fromYear,
  toYear,
  sourceLedger,
  targetRecords = [],
  franchises = [],
}) {
  const description = carryDescription(fromYear);
  const lines = [];
  const skipped = [];
  const warnings = [];

  // Index the target ledger by (franchise, description). Keyed on the pair
  // rather than description alone because every franchise's carry record
  // shares the same description by design — that is the point of it.
  const existing = new Map();
  for (const record of asArray(targetRecords)) {
    const key = `${padFranchise(record?.franchiseId)}|${String(record?.description ?? '').trim().toLowerCase()}`;
    const held = existing.get(key) ?? [];
    held.push(record);
    existing.set(key, held);
  }

  const knownFranchises = new Set(
    asArray(franchises).map((franchise) => padFranchise(franchise?.id)).filter(Boolean)
  );
  const nameFor = new Map(
    asArray(franchises).map((franchise) => [padFranchise(franchise?.id), franchise?.name])
  );

  const balances = sourceLedger?.balances ?? {};
  const entries = Object.entries(balances)
    .map(([franchiseId, balance]) => [padFranchise(franchiseId), toCents(Number(balance) || 0)])
    .filter(([franchiseId]) => franchiseId)
    .sort((a, b) => a[0].localeCompare(b[0]));

  for (const [franchiseId, balance] of entries) {
    if (balance === 0) {
      // Nothing to carry, and MFL rejects a zero amount anyway. Recorded so
      // the page can show that the franchise WAS considered — a franchise
      // missing from the plan entirely reads as an oversight.
      skipped.push({ franchiseId, reason: 'Closed the year square.', balance });
      continue;
    }

    // A franchise that existed last year and is gone this year cannot be
    // carried — there is no franchise to write against. Reported loudly: this
    // is a real balance that someone has to reassign by hand, and dropping it
    // silently loses money from the league's books.
    if (knownFranchises.size > 0 && !knownFranchises.has(franchiseId)) {
      warnings.push({
        franchiseId,
        balance,
        reason: `Franchise ${franchiseId} held ${balance < 0 ? 'a debt' : 'a credit'} of ${Math.abs(balance).toFixed(2)} in ${fromYear} but does not exist in ${toYear}. Reassign it by hand.`,
      });
      continue;
    }

    const matches = existing.get(`${franchiseId}|${description.toLowerCase()}`) ?? [];
    const exact = matches.find((record) => toCents(record.amount) === balance);

    let status = 'payable';
    if (exact) status = 'already-migrated';
    else if (matches.length) status = 'conflict';

    lines.push({
      franchiseId,
      name: nameFor.get(franchiseId) ?? null,
      // THE SIGN IS THE CLOSING BALANCE, UNCHANGED. See the header.
      amount: balance,
      description,
      status,
      ...(status === 'conflict'
        ? {
            conflictWith: matches.map((record) => ({
              amount: record.amount,
              description: record.description,
            })),
          }
        : {}),
    });
  }

  const sum = (predicate) =>
    toCents(lines.filter(predicate).reduce((total, line) => total + line.amount, 0));

  const carryable = sum((line) => line.status === 'payable');
  const alreadyMigrated = sum((line) => line.status === 'already-migrated');

  return {
    lines,
    skipped,
    warnings,
    totals: {
      carryable,
      alreadyMigrated,
      conflicts: lines.filter((line) => line.status === 'conflict').length,
      /**
       * The league's books must net to the same number after the carry as
       * before it. Shown so a commissioner can eyeball that nothing was
       * invented or lost — and it is the number that goes visibly wrong if
       * the sign is ever flipped.
       */
      sourceNet: toCents(
        Object.values(sourceLedger?.balances ?? {}).reduce(
          (total, balance) => total + (Number(balance) || 0),
          0
        )
      ),
      carriedNet: toCents(carryable + alreadyMigrated),
      franchisesCarried: lines.filter((line) => line.status === 'payable').length,
    },
  };
}

/**
 * Whether an UNATTENDED carry may proceed, and if not, why.
 *
 * Split out of scripts/accounting-carry-over.ts so the refusal conditions are
 * testable in isolation. They are the entire safety story for a job that
 * writes real money with nobody watching, and MFL's import has no delete: a
 * wrong record is corrected by hand, by a human who first has to notice. So
 * this treats "don't know" as "don't write", and every gate refuses the whole
 * league rather than carrying the part it is sure about — a partial carry that
 * silently drops one franchise is worse than one that did not run.
 *
 * A human driving the page is deliberately NOT held to these: they can see the
 * warnings and decide. This is the unattended path only.
 *
 * @param {object} options
 * @param {{records?: Array<{timestamp?: number}>}} options.sourceLedger
 * @param {{lines: Array<{status: string}>, warnings: Array, totals: {sourceNet: number, carriedNet: number, carryable: number}}} options.plan
 * @param {number} options.nowMs Injected so the settle window is testable without a clock.
 * @param {number} options.settleAfterDays Days of quiet before a year counts as closed.
 * @returns {{ready: boolean, reason?: string, nothingToDo?: boolean}}
 */
export function assessCarryReadiness({ sourceLedger, plan, nowMs, settleAfterDays }) {
  const records = asArray(sourceLedger?.records);

  // An empty source is indistinguishable from a failed read, and the failure
  // mode of guessing is carrying nothing while reporting success.
  if (records.length === 0) {
    return { ready: false, reason: 'the source year has no accounting records at all' };
  }

  // A carry moves a CLOSING balance. "The new league year exists" fires on
  // rollover day, months before a season settles, so quiescence stands in for
  // "these books are closed". Biased toward waiting on purpose: being a
  // fortnight late costs nothing, carrying early costs a hand-reconciliation
  // nobody will think to do.
  const newest = records.reduce((max, record) => Math.max(max, record?.timestamp ?? 0), 0);
  if (newest > 0) {
    const ageDays = (nowMs - newest * 1000) / 86_400_000;
    if (ageDays < settleAfterDays) {
      return {
        ready: false,
        reason: `the source year is still active — last transaction ${ageDays.toFixed(1)}d ago, needs ${settleAfterDays}d of quiet`,
      };
    }
  }

  // A carry line already present at a different amount means the source moved
  // after a partial run, or someone edited by hand. The correct balance is then
  // ambiguous and no machine should pick one.
  const conflicts = plan.lines.filter((line) => line.status === 'conflict').length;
  if (conflicts) {
    return { ready: false, reason: `${conflicts} franchise(s) already carried at a different amount` };
  }

  // A warning is a balance whose franchise no longer exists — real money with
  // nowhere to go. Carrying "the rest" would quietly drop it.
  if (plan.warnings.length) {
    return {
      ready: false,
      reason: `${plan.warnings.length} balance(s) belong to a franchise that no longer exists`,
    };
  }

  // If the two nets disagree the plan is losing money somewhere this gate did
  // not anticipate, which is precisely when to stop.
  if (plan.totals.sourceNet !== plan.totals.carriedNet) {
    return {
      ready: false,
      reason: `net mismatch — source nets ${plan.totals.sourceNet} but the plan carries ${plan.totals.carriedNet}`,
    };
  }

  if (!plan.lines.some((line) => line.status === 'payable')) {
    return { ready: false, nothingToDo: true, reason: 'every balance is already carried' };
  }

  return { ready: true };
}
