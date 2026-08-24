/**
 * Commissioner accounting console.
 *
 * Three jobs on one page, because they are one job in practice: see the books,
 * put money in or out, and pay the season.
 *
 * Every write is a REAL write to MFL's ledger, and MFL's import has no delete
 * and no undo. That single fact drives the whole design here:
 *
 *  - Nothing writes without an explicit click on a button that says what it
 *    will do, with the amount and the franchise already visible.
 *  - The CSV preview is served by the same endpoint that performs the write
 *    (`dryRun`), so the rows reviewed are the rows applied — never a
 *    client-side parse standing in for the server's.
 *  - Per-row results are shown after a bulk run, because a partial batch is a
 *    normal outcome of a one-record-per-call API, not an error state.
 *  - The payout run leads with what is ALREADY paid, so a second visit reads
 *    as "done" rather than as "click to pay again".
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

interface Franchise {
  id: string;
  name: string;
}

interface Props {
  leagueSlug: string;
  leagueName: string;
  franchises: Franchise[];
  /** MFL league year whose ledger is being edited. */
  year: number;
  /** Season whose results the payout run pays. */
  season: number;
  /** Seasons offered in the payout selector, newest first. */
  seasons: number[];
  hasPayouts: boolean;
}

interface LedgerRecord {
  franchiseId: string;
  amount: number;
  description: string;
  timestamp?: number;
}

interface PlanLine {
  key: string;
  label: string;
  franchiseId: string;
  amount: number;
  description: string;
  status: 'payable' | 'already-paid' | 'conflict';
  detail?: string;
}

interface Plan {
  lines: PlanLine[];
  unresolved: Array<{ key: string; label: string; reason: string }>;
  totals: {
    payable: number;
    alreadyPaid: number;
    conflicts: number;
    planned: number;
    prizePool: number | null;
    drift: number | null;
  };
}

const money = (amount: number) =>
  `${amount < 0 ? '-' : ''}$${Math.abs(amount).toFixed(2)}`;

type Tab = 'ledger' | 'add' | 'import' | 'payouts' | 'rollover';

export default function AccountingPanel({
  leagueSlug,
  leagueName,
  franchises,
  year,
  season: initialSeason,
  seasons,
  hasPayouts,
}: Props) {
  const [tab, setTab] = useState<Tab>('ledger');
  const [ledger, setLedger] = useState<LedgerRecord[] | null>(null);
  const [balances, setBalances] = useState<Record<string, number>>({});
  const [ledgerError, setLedgerError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const nameFor = useMemo(() => {
    const map = new Map(franchises.map((f) => [f.id, f.name]));
    // An id with no current franchise is a departed team whose ledger lines
    // still exist. Show the id rather than an empty cell — a blank row reads
    // as a rendering bug and hides real money.
    return (id: string) => map.get(id) ?? `Franchise ${id}`;
  }, [franchises]);

  const base = `/api/accounting`;
  const query = `league=${encodeURIComponent(leagueSlug)}&year=${year}`;

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setLedgerError(null);
    try {
      const response = await fetch(`${base}/records?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setLedger(data.records ?? []);
      setBalances(data.balances ?? {});
    } catch (error) {
      setLedgerError((error as Error).message);
      setLedger(null);
    } finally {
      setLoading(false);
    }
  }, [base, query]);

  useEffect(() => {
    void loadLedger();
  }, [loadLedger]);

  return (
    <div className="acct">
      <nav className="acct__tabs" role="tablist" aria-label="Accounting sections">
        {([
          ['ledger', 'Ledger'],
          ['add', 'Add transaction'],
          ['import', 'Import CSV'],
          ...(hasPayouts ? ([['payouts', 'Season payouts']] as Array<[Tab, string]>) : []),
          ['rollover', 'Year rollover'],
        ] as Array<[Tab, string]>).map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={`acct__tab${tab === id ? ' is-active' : ''}`}
            onClick={() => setTab(id)}
            type="button"
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === 'ledger' && (
        <LedgerView
          records={ledger}
          balances={balances}
          error={ledgerError}
          loading={loading}
          nameFor={nameFor}
          franchises={franchises}
          csvHref={`${base}/records?${query}&format=csv`}
          onReload={loadLedger}
        />
      )}

      {tab === 'add' && (
        <AddTransaction
          franchises={franchises}
          endpoint={`${base}/records?${query}`}
          onWritten={loadLedger}
        />
      )}

      {tab === 'import' && (
        <ImportCsv endpoint={`${base}/import?${query}`} nameFor={nameFor} onWritten={loadLedger} />
      )}

      {tab === 'payouts' && hasPayouts && (
        <Payouts
          base={base}
          leagueSlug={leagueSlug}
          leagueName={leagueName}
          year={year}
          initialSeason={initialSeason}
          seasons={seasons}
          nameFor={nameFor}
          onWritten={loadLedger}
        />
      )}

      {tab === 'rollover' && (
        <Rollover
          base={base}
          leagueSlug={leagueSlug}
          year={year}
          seasons={seasons}
          nameFor={nameFor}
          onWritten={loadLedger}
        />
      )}
    </div>
  );
}

/* ── Ledger ─────────────────────────────────────────────────────────────── */

function LedgerView({
  records,
  balances,
  error,
  loading,
  nameFor,
  franchises,
  csvHref,
  onReload,
}: {
  records: LedgerRecord[] | null;
  balances: Record<string, number>;
  error: string | null;
  loading: boolean;
  nameFor: (id: string) => string;
  franchises: Franchise[];
  csvHref: string;
  onReload: () => void;
}) {
  if (loading) return <p className="acct__note">Reading the ledger from MFL…</p>;

  if (error) {
    return (
      <div className="acct__error" role="alert">
        <p>{error}</p>
        <button type="button" className="acct__btn" onClick={onReload}>
          Try again
        </button>
      </div>
    );
  }

  // Every franchise gets a row, including the ones at zero: "who still owes"
  // is the question this table exists to answer, and a franchise missing from
  // the ledger entirely is the most important zero on the page.
  const rows = franchises
    .map((franchise) => ({ ...franchise, balance: balances[franchise.id] ?? 0 }))
    .sort((a, b) => a.balance - b.balance);

  return (
    <div className="acct__section">
      <div className="acct__toolbar">
        <h2>Balances</h2>
        <div className="acct__actions">
          <button type="button" className="acct__btn" onClick={onReload}>
            Refresh
          </button>
          {/* A plain link, not a scripted download: the server already builds
              the CSV, and an anchor keeps it working with the response's
              Content-Disposition. */}
          <a className="acct__btn" href={csvHref}>
            Export CSV
          </a>
        </div>
      </div>

      <p className="acct__note">
        Positive credits the franchise (a prize, or money they&rsquo;ve paid in). Negative charges them
        (dues, fees). That&rsquo;s MFL&rsquo;s convention, not ours.
      </p>

      <div className="acct__tablewrap">
        <table className="acct__table">
          <thead>
            <tr>
              <th scope="col">Franchise</th>
              <th scope="col" className="acct__num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.name}</td>
                <td className={`acct__num${row.balance < 0 ? ' is-negative' : ''}`}>
                  {money(row.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2>Transactions</h2>
      {records && records.length > 0 ? (
        <div className="acct__tablewrap">
          <table className="acct__table">
            <thead>
              <tr>
                <th scope="col">Franchise</th>
                <th scope="col" className="acct__num">Amount</th>
                <th scope="col">Description</th>
              </tr>
            </thead>
            <tbody>
              {records.map((record, index) => (
                <tr key={`${record.franchiseId}-${index}`}>
                  <td>{nameFor(record.franchiseId)}</td>
                  <td className={`acct__num${record.amount < 0 ? ' is-negative' : ''}`}>
                    {money(record.amount)}
                  </td>
                  <td>{record.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="acct__note">
          MFL returned balances but no individual transactions for this year.
        </p>
      )}
    </div>
  );
}

/* ── Single transaction ─────────────────────────────────────────────────── */

function AddTransaction({
  franchises,
  endpoint,
  onWritten,
}: {
  franchises: Franchise[];
  endpoint: string;
  onWritten: () => void;
}) {
  const [franchiseId, setFranchiseId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const parsedAmount = Number(String(amount).replace(/[$,\s]/g, ''));
  const amountValid = Number.isFinite(parsedAmount) && parsedAmount !== 0;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ franchiseId, amount, description }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setResult({ ok: true, message: 'Written to MFL.' });
      setAmount('');
      setDescription('');
      onWritten();
    } catch (error) {
      setResult({ ok: false, message: (error as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="acct__section" onSubmit={submit}>
      <h2>Add one transaction</h2>

      <label className="acct__field">
        <span>Franchise</span>
        <select value={franchiseId} onChange={(e) => setFranchiseId(e.target.value)} required>
          <option value="">Choose a franchise…</option>
          {franchises.map((franchise) => (
            <option key={franchise.id} value={franchise.id}>
              {franchise.name}
            </option>
          ))}
        </select>
      </label>

      <label className="acct__field">
        <span>Amount</span>
        <input
          type="text"
          inputMode="decimal"
          value={amount}
          placeholder="-100.00"
          onChange={(e) => setAmount(e.target.value)}
          required
        />
      </label>
      {/* Restate the direction next to the field, in the words of what will
          happen, because this is the one input on the page whose sign silently
          reverses the meaning of the write. */}
      {amountValid && (
        <p className="acct__hint">
          {parsedAmount > 0
            ? `Credits the franchise ${money(parsedAmount)} — use this for a prize or a payment received.`
            : `Charges the franchise ${money(Math.abs(parsedAmount))} — use this for dues or a fee.`}
        </p>
      )}

      <label className="acct__field">
        <span>Description</span>
        <input
          type="text"
          value={description}
          maxLength={200}
          placeholder="2026 league dues"
          onChange={(e) => setDescription(e.target.value)}
          required
        />
      </label>

      <button className="acct__btn acct__btn--primary" type="submit" disabled={busy || !amountValid}>
        {busy ? 'Writing…' : 'Write to MFL'}
      </button>

      {result && (
        <p className={result.ok ? 'acct__ok' : 'acct__error'} role="status">
          {result.message}
        </p>
      )}
    </form>
  );
}

/* ── CSV import ─────────────────────────────────────────────────────────── */

interface PreviewRow {
  line: number;
  record: { franchiseId?: string; amount?: number; description?: string };
  error: string | null;
  raw: string[];
}

function ImportCsv({
  endpoint,
  nameFor,
  onWritten,
}: {
  endpoint: string;
  nameFor: (id: string) => string;
  onWritten: () => void;
}) {
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<{ rows: PreviewRow[]; validCount: number; invalidCount: number; total: number } | null>(null);
  const [results, setResults] = useState<Array<{ row: { ref?: string; description: string }; ok: boolean; error?: string }> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const post = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ csv, dryRun }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPreview(data?.rows ? { rows: data.rows, validCount: 0, invalidCount: data.rows.length, total: 0 } : null);
        throw new Error(data?.error ?? `HTTP ${response.status}`);
      }
      if (dryRun) {
        setPreview(data);
        setResults(null);
      } else {
        setResults(data.results ?? []);
        setPreview(null);
        onWritten();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setCsv(await file.text());
    setPreview(null);
    setResults(null);
  };

  return (
    <div className="acct__section">
      <h2>Import CSV</h2>
      <p className="acct__note">
        Columns: <code>franchise, amount, description</code>. A header row is optional. Positive credits,
        negative charges. Preview first &mdash; nothing is written until you confirm.
      </p>

      <input type="file" accept=".csv,text/csv" onChange={onFile} className="acct__file" />

      <label className="acct__field">
        <span>…or paste rows</span>
        <textarea
          value={csv}
          rows={8}
          onChange={(e) => {
            setCsv(e.target.value);
            setPreview(null);
            setResults(null);
          }}
          placeholder={'franchise,amount,description\n0001,-100,2026 league dues\n0002,-100,2026 league dues'}
        />
      </label>

      <div className="acct__actions">
        <button type="button" className="acct__btn" disabled={busy || !csv.trim()} onClick={() => post(true)}>
          {busy ? 'Checking…' : 'Preview'}
        </button>
        {preview && preview.invalidCount === 0 && preview.validCount > 0 && (
          <button
            type="button"
            className="acct__btn acct__btn--primary"
            disabled={busy}
            onClick={() => post(false)}
          >
            Write {preview.validCount} record{preview.validCount === 1 ? '' : 's'} to MFL
          </button>
        )}
      </div>

      {error && <p className="acct__error" role="alert">{error}</p>}

      {preview && (
        <>
          <p className="acct__note">
            {preview.validCount} valid, {preview.invalidCount} with problems. Net {money(preview.total)}.
            {preview.invalidCount > 0 && ' Fix the flagged rows — nothing writes until every row is clean.'}
          </p>
          <div className="acct__tablewrap">
            <table className="acct__table">
              <thead>
                <tr>
                  <th scope="col">Line</th>
                  <th scope="col">Franchise</th>
                  <th scope="col" className="acct__num">Amount</th>
                  <th scope="col">Description</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.line} className={row.error ? 'is-bad' : undefined}>
                    <td>{row.line}</td>
                    <td>{row.record.franchiseId ? nameFor(row.record.franchiseId) : '—'}</td>
                    <td className="acct__num">
                      {typeof row.record.amount === 'number' ? money(row.record.amount) : '—'}
                    </td>
                    <td>{row.error ? <span className="acct__bad">{row.error}</span> : row.record.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {results && (
        <>
          <p className="acct__note">
            {results.filter((r) => r.ok).length} written, {results.filter((r) => !r.ok).length} failed.
          </p>
          <ul className="acct__results">
            {results.map((result, index) => (
              <li key={index} className={result.ok ? 'is-ok' : 'is-bad'}>
                {result.ok ? '✓' : '✗'} {result.row.description}
                {result.error ? ` — ${result.error}` : ''}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/* ── Season payouts ─────────────────────────────────────────────────────── */

function Payouts({
  base,
  leagueSlug,
  leagueName,
  year,
  initialSeason,
  seasons,
  nameFor,
  onWritten,
}: {
  base: string;
  leagueSlug: string;
  leagueName: string;
  year: number;
  initialSeason: number;
  seasons: number[];
  nameFor: (id: string) => string;
  onWritten: () => void;
}) {
  const [season, setSeason] = useState(initialSeason);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const query = `league=${encodeURIComponent(leagueSlug)}&year=${year}&season=${season}`;

  const loadPlan = useCallback(async () => {
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const response = await fetch(`${base}/payouts?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setPlan(data);
    } catch (err) {
      setError((err as Error).message);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }, [base, query]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${base}/payouts?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setApplied(
        data.failedCount
          ? `${data.written} paid, ${data.failedCount} failed. Re-run to retry only the failures.`
          : `${data.written} payout${data.written === 1 ? '' : 's'} written to MFL.`
      );
      onWritten();
      await loadPlan();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const payable = plan?.lines.filter((line) => line.status === 'payable') ?? [];
  const alreadyPaid = plan?.lines.filter((line) => line.status === 'already-paid') ?? [];
  const conflicts = plan?.lines.filter((line) => line.status === 'conflict') ?? [];

  return (
    <div className="acct__section">
      <div className="acct__toolbar">
        <h2>Season payouts</h2>
        <label className="acct__inline">
          <span>Season</span>
          <select value={season} onChange={(e) => setSeason(Number(e.target.value))}>
            {seasons.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="acct__note">
        Winners come from {leagueName}&rsquo;s own results &mdash; playoff brackets, award history, all-play
        tables and weekly scores. Prizes already in the {year} ledger are shown as paid and are never written
        twice.
      </p>

      {error && <p className="acct__error" role="alert">{error}</p>}
      {applied && <p className="acct__ok" role="status">{applied}</p>}
      {busy && !plan && <p className="acct__note">Working out who won what…</p>}

      {plan && (
        <>
          <dl className="acct__totals">
            <div>
              <dt>To pay</dt>
              <dd>{money(plan.totals.payable)}</dd>
            </div>
            <div>
              <dt>Already paid</dt>
              <dd>{money(plan.totals.alreadyPaid)}</dd>
            </div>
            <div>
              <dt>Plan total</dt>
              <dd>{money(plan.totals.planned)}</dd>
            </div>
            {plan.totals.prizePool != null && (
              <div>
                <dt>Prize pool</dt>
                <dd>
                  {money(plan.totals.prizePool)}
                  {/* Drift is surfaced, never corrected. The rules doc explains
                      why the AFL's plan is $5 over its stated pool. */}
                  {plan.totals.drift ? (
                    <span className="acct__drift"> ({plan.totals.drift > 0 ? '+' : ''}{money(plan.totals.drift)})</span>
                  ) : null}
                </dd>
              </div>
            )}
          </dl>

          {conflicts.length > 0 && (
            <div className="acct__error" role="alert">
              <p>
                {conflicts.length} prize{conflicts.length === 1 ? ' has a' : 's have'} ledger record
                {conflicts.length === 1 ? '' : 's'} at a different amount. Nothing will be paid until you
                review {conflicts.length === 1 ? 'it' : 'them'} in MFL.
              </p>
              <ul className="acct__results">
                {conflicts.map((line) => (
                  <li key={line.key + line.franchiseId} className="is-bad">
                    {line.label} — {nameFor(line.franchiseId)} — plan says {money(line.amount)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.unresolved.length > 0 && (
            <div className="acct__warn">
              <p>{plan.unresolved.length} prize{plan.unresolved.length === 1 ? '' : 's'} couldn&rsquo;t be resolved:</p>
              <ul className="acct__results">
                {plan.unresolved.map((item) => (
                  <li key={item.key} className="is-bad">
                    {item.label} — {item.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <PayoutTable title={`To pay (${payable.length})`} lines={payable} nameFor={nameFor} />
          <PayoutTable title={`Already paid (${alreadyPaid.length})`} lines={alreadyPaid} nameFor={nameFor} muted />

          <div className="acct__actions">
            <button type="button" className="acct__btn" onClick={loadPlan} disabled={busy}>
              Recheck
            </button>
            <button
              type="button"
              className="acct__btn acct__btn--primary"
              onClick={apply}
              disabled={busy || payable.length === 0 || conflicts.length > 0}
            >
              {busy
                ? 'Paying…'
                : payable.length === 0
                  ? 'Nothing to pay'
                  : `Pay ${payable.length} prize${payable.length === 1 ? '' : 's'} — ${money(plan.totals.payable)}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PayoutTable({
  title,
  lines,
  nameFor,
  muted,
}: {
  title: string;
  lines: PlanLine[];
  nameFor: (id: string) => string;
  muted?: boolean;
}) {
  if (!lines.length) return null;
  return (
    <>
      <h3 className={muted ? 'acct__h3 is-muted' : 'acct__h3'}>{title}</h3>
      <div className="acct__tablewrap">
        <table className={`acct__table${muted ? ' is-muted' : ''}`}>
          <thead>
            <tr>
              <th scope="col">Prize</th>
              <th scope="col">Franchise</th>
              <th scope="col" className="acct__num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={`${line.key}-${line.franchiseId}-${line.description}`}>
                <td>
                  {line.label}
                  {line.detail ? <span className="acct__detail"> {line.detail}</span> : null}
                </td>
                <td>{nameFor(line.franchiseId)}</td>
                <td className="acct__num">{money(line.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Year rollover ──────────────────────────────────────────────────────── */

interface MigrationLine {
  franchiseId: string;
  name: string | null;
  amount: number;
  description: string;
  status: 'payable' | 'already-migrated' | 'conflict';
}

interface MigrationPlan {
  from: number;
  to: number;
  lines: MigrationLine[];
  skipped: Array<{ franchiseId: string; reason: string; balance: number }>;
  warnings: Array<{ franchiseId: string; balance: number; reason: string }>;
  totals: {
    carryable: number;
    alreadyMigrated: number;
    conflicts: number;
    sourceNet: number;
    carriedNet: number;
    franchisesCarried: number;
  };
}

/**
 * Carry last year's closing balances into the new league year.
 *
 * MFL starts each new league year with an empty ledger, so this is the step
 * that stops the league's books resetting to zero every February. The panel
 * leads with the net check — source net vs carried net — because those two
 * numbers agreeing is the fastest way for a commissioner to see that nothing
 * was invented, lost, or flipped.
 */
function Rollover({
  base,
  leagueSlug,
  year,
  seasons,
  nameFor,
  onWritten,
}: {
  base: string;
  leagueSlug: string;
  year: number;
  seasons: number[];
  nameFor: (id: string) => string;
  onWritten: () => void;
}) {
  // Default to carrying the year before the live ledger year — the rollover
  // that is actually due when a commissioner opens this.
  const [from, setFrom] = useState(year - 1);
  const [plan, setPlan] = useState<MigrationPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applied, setApplied] = useState<string | null>(null);

  const query = `league=${encodeURIComponent(leagueSlug)}&from=${from}&to=${year}`;

  const loadPlan = useCallback(async () => {
    setBusy(true);
    setError(null);
    setApplied(null);
    try {
      const response = await fetch(`${base}/migrate?${query}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setPlan(data);
    } catch (err) {
      setError((err as Error).message);
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }, [base, query]);

  useEffect(() => {
    void loadPlan();
  }, [loadPlan]);

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${base}/migrate?${query}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error ?? `HTTP ${response.status}`);
      setApplied(
        data.failedCount
          ? `${data.written} carried, ${data.failedCount} failed. Re-run to retry only the failures.`
          : `${data.written} balance${data.written === 1 ? '' : 's'} carried into ${year}.`
      );
      onWritten();
      await loadPlan();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const carryable = plan?.lines.filter((line) => line.status === 'payable') ?? [];
  const carried = plan?.lines.filter((line) => line.status === 'already-migrated') ?? [];
  const conflicts = plan?.lines.filter((line) => line.status === 'conflict') ?? [];
  const netMatches = plan ? plan.totals.sourceNet === plan.totals.carriedNet : true;

  return (
    <div className="acct__section">
      <div className="acct__toolbar">
        <h2>Year rollover</h2>
        <label className="acct__inline">
          <span>Carry from</span>
          <select value={from} onChange={(e) => setFrom(Number(e.target.value))}>
            {seasons
              .filter((option) => option < year)
              .map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
          </select>
          <span>into {year}</span>
        </label>
      </div>

      <p className="acct__note">
        MFL creates a brand-new league every year and its ledger starts empty &mdash; nothing carries over on
        MFL&rsquo;s side. This writes each franchise&rsquo;s {from} closing balance into the {year} books, keeping
        the sign: a franchise that owed money still owes it. Balances already carried are never written twice.
      </p>

      {error && <p className="acct__error" role="alert">{error}</p>}
      {applied && <p className="acct__ok" role="status">{applied}</p>}
      {busy && !plan && <p className="acct__note">Reading both years&rsquo; ledgers…</p>}

      {plan && (
        <>
          <dl className="acct__totals">
            <div>
              <dt>{from} net</dt>
              <dd>{money(plan.totals.sourceNet)}</dd>
            </div>
            <div>
              <dt>Carried net</dt>
              <dd>{money(plan.totals.carriedNet)}</dd>
            </div>
            <div>
              <dt>To carry</dt>
              <dd>{money(plan.totals.carryable)}</dd>
            </div>
            <div>
              <dt>Franchises</dt>
              <dd>{plan.totals.franchisesCarried}</dd>
            </div>
          </dl>

          {/* The two nets disagreeing means a balance is being dropped — most
              often a franchise that no longer exists. Say so plainly rather
              than leaving the commissioner to spot it in the numbers. */}
          {!netMatches && (
            <div className="acct__warn">
              <p>
                {from} nets {money(plan.totals.sourceNet)} but only {money(plan.totals.carriedNet)} is
                accounted for. The difference is money that will not reach the {year} books &mdash; check the
                warnings below before carrying.
              </p>
            </div>
          )}

          {conflicts.length > 0 && (
            <div className="acct__error" role="alert">
              <p>
                {conflicts.length} franchise{conflicts.length === 1 ? '' : 's'} already carr
                {conflicts.length === 1 ? 'ies' : 'y'} a {from} balance at a different amount. Nothing will be
                written until {conflicts.length === 1 ? 'it is' : 'they are'} reconciled in MFL.
              </p>
              <ul className="acct__results">
                {conflicts.map((line) => (
                  <li key={line.franchiseId} className="is-bad">
                    {nameFor(line.franchiseId)} — plan says {money(line.amount)}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {plan.warnings.length > 0 && (
            <div className="acct__warn">
              <p>
                {plan.warnings.length} balance{plan.warnings.length === 1 ? '' : 's'} cannot be carried
                automatically:
              </p>
              <ul className="acct__results">
                {plan.warnings.map((warning) => (
                  <li key={warning.franchiseId} className="is-bad">
                    {warning.reason}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <MigrationTable title={`To carry (${carryable.length})`} lines={carryable} nameFor={nameFor} />
          <MigrationTable
            title={`Already carried (${carried.length})`}
            lines={carried}
            nameFor={nameFor}
            muted
          />

          {plan.skipped.length > 0 && (
            <p className="acct__note">
              {plan.skipped.length} franchise{plan.skipped.length === 1 ? '' : 's'} closed {from} square and
              need nothing carried.
            </p>
          )}

          <div className="acct__actions">
            <button type="button" className="acct__btn" onClick={loadPlan} disabled={busy}>
              Recheck
            </button>
            <button
              type="button"
              className="acct__btn acct__btn--primary"
              onClick={apply}
              disabled={busy || carryable.length === 0 || conflicts.length > 0}
            >
              {busy
                ? 'Carrying…'
                : carryable.length === 0
                  ? 'Nothing to carry'
                  : `Carry ${carryable.length} balance${carryable.length === 1 ? '' : 's'} into ${year}`}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function MigrationTable({
  title,
  lines,
  nameFor,
  muted,
}: {
  title: string;
  lines: MigrationLine[];
  nameFor: (id: string) => string;
  muted?: boolean;
}) {
  if (!lines.length) return null;
  return (
    <>
      <h3 className={muted ? 'acct__h3 is-muted' : 'acct__h3'}>{title}</h3>
      <div className="acct__tablewrap">
        <table className={`acct__table${muted ? ' is-muted' : ''}`}>
          <thead>
            <tr>
              <th scope="col">Franchise</th>
              <th scope="col" className="acct__num">Carried</th>
              <th scope="col">Direction</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.franchiseId}>
                <td>{line.name ?? nameFor(line.franchiseId)}</td>
                <td className={`acct__num${line.amount < 0 ? ' is-negative' : ''}`}>
                  {money(line.amount)}
                </td>
                {/* Spelled out, because the sign alone is the whole meaning
                    here and a misread costs an owner real money. */}
                <td>{line.amount < 0 ? 'Owes the league' : 'League owes them'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
