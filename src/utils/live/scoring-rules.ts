/**
 * A league's MFL scoring rules, and what they make of one player's stat line.
 *
 * Pure and client-safe: the live board's stat sheet calls `scorePlayerStats`
 * in the browser with the league's rules (`/api/live-scoring-rules`) and the
 * league-NEUTRAL stat counts that ride on each box-score row
 * (`PlayerBoxScore.stats`, from `boxScoreToMflStats`).
 *
 * ── MFL'S TOTAL IS THE AUTHORITY, NOT THIS ───────────────────────────────
 * This re-derives points from ESPN's box score, and ESPN is not MFL's stat
 * provider: the two can disagree for a poll or two, a stat correction lands on
 * one before the other, and plenty of what a league scores (first downs,
 * 20-yard plays, two-point conversions, the length of each touchdown) is not in
 * a box score at all. So the sheet never prints its own sum as the score. It
 * itemizes what it can and carries the rest on one reconciling line —
 * `unitemized = mflTotal - itemized` — so the sheet always adds up to the
 * number on the row it was opened from.
 *
 * ── A CODE WE CANNOT SEE IS SKIPPED, NEVER ZERO ──────────────────────────
 * A rule whose event we have no count for contributes nothing to `itemized`.
 * Evaluating it at 0 would be wrong in both directions: a flat "0 first downs:
 * −2" penalty would be charged to a player who had six, and a rule that pays
 * on zero would be paid for a stat ESPN never reported.
 */

/** One `<rule>` from MFL's `TYPE=rules` export. */
export interface ScoringRule {
  /** The event's codes; `UY+KY` scores the SUM of punt and kick return yards. */
  event: string[];
  lo: number;
  hi: number;
  /**
   * `per` multiplies the value (`*.04` per passing yard; `*1/10` is one point
   * per WHOLE ten); `flat` is paid once when the value is in range.
   */
  kind: 'per' | 'flat';
  points: number;
  /** For `*a/b`: points are paid per whole `b` units. 1 otherwise. */
  every: number;
}

/** One `<positionRules>` block — rules that apply to the listed positions. */
export interface PositionRuleSet {
  positions: string[];
  rules: ScoringRule[];
}

export interface LiveScoringRulesResponse {
  ok: boolean;
  leagueId: string;
  year: string;
  /**
   * The league's rules, or null when MFL publishes none for it (a league that
   * runs MFL's defaults answers "No League Scoring Rules"). Null is a READ
   * that succeeded — distinct from `ok: false`, which is a read that did not.
   */
  rules: PositionRuleSet[] | null;
}

/**
 * Events MFL evaluates once PER OCCURRENCE (its descriptions say "evaluated
 * for EACH …"). Only `FG` has occurrence data here (`fgLengths`); the rest
 * fall to the reconciling line.
 */
const PER_OCCURRENCE = new Set([
  'FG', 'MG', 'PS', 'RS', 'RC', 'KO', 'PR', 'IR', 'IT', 'DR', 'FT', 'FR', 'BF', 'MF', 'BP', 'DD', 'TT',
]);

/** Short labels for the stat codes this board can itemize. */
const LABELS: Record<string, string> = {
  PC: 'Completions',
  PA: 'Pass attempts',
  INC: 'Incompletions',
  PY: 'Passing yards',
  '#P': 'Passing TDs',
  IN: 'Interceptions thrown',
  TSK: 'Times sacked',
  TSY: 'Sack yards lost',
  RA: 'Rush attempts',
  RY: 'Rushing yards',
  '#R': 'Rushing TDs',
  CC: 'Receptions',
  TGT: 'Targets',
  CY: 'Receiving yards',
  '#C': 'Receiving TDs',
  RCY: 'Rush + rec yards',
  PRY: 'Pass + rush yards',
  TYS: 'Scrimmage yards',
  TY: 'Total yards',
  '#TD': 'Total TDs',
  FU: 'Fumbles',
  FL: 'Fumbles lost',
  '#F': 'Field goals made',
  '#A': 'Field goal attempts',
  '#M': 'Field goals missed',
  FG: 'Field goals',
  EP: 'Extra points',
  EA: 'Extra point attempts',
  EM: 'Extra points missed',
  P2: '2-pt passes',
  R2: '2-pt rushes',
  C2: '2-pt receptions',
  '#K': 'Kick returns',
  KY: 'Kick return yards',
  '#KT': 'Kick return TDs',
  '#U': 'Punt returns',
  UY: 'Punt return yards',
  '#UT': 'Punt return TDs',
  TK: 'Tackles',
  AS: 'Assists',
  SK: 'Sacks',
  TKL: 'Tackles for loss',
  PD: 'Passes defended',
  QH: 'QB hits',
  IC: 'Interceptions',
  ICY: 'Interception return yards',
  '#IR': 'Interception return TDs',
};

/**
 * Reading order for the sheet: passing → rushing → receiving → composites →
 * kicking → returns → turnovers → defense. A line is placed by its FIRST code.
 */
const ORDER = [
  'PC', 'PA', 'INC', 'PY', '#P', 'IN', 'TSK', 'TSY', 'P2',
  'RA', 'RY', '#R', 'R2',
  'TGT', 'CC', 'CY', '#C', 'C2',
  'RCY', 'PRY', 'TYS', 'TY', '#TD',
  'FG', '#F', '#A', '#M', 'EP', 'EA', 'EM',
  '#K', 'KY', '#KT', '#U', 'UY', '#UT',
  'FU', 'FL',
  'TK', 'AS', 'SK', 'TKL', 'PD', 'QH', 'IC', 'ICY', '#IR',
];

const orderOf = (code: string) => {
  const i = ORDER.indexOf(code);
  return i === -1 ? ORDER.length : i;
};

const text = (v: unknown): string => {
  if (v && typeof v === 'object' && '$t' in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>).$t ?? '');
  }
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
};

const asList = <T,>(v: T | T[] | undefined | null): T[] =>
  v == null ? [] : Array.isArray(v) ? v : [v];

/** "-50-999" → [-50, 999]; "0-10" → [0, 10]. Null when unparseable. */
export function parseRange(raw: string): [number, number] | null {
  const m = raw.trim().match(/^(-?\d*\.?\d+)\s*-\s*(-?\d*\.?\d+)$/);
  if (!m) return null;
  const lo = Number(m[1]);
  const hi = Number(m[2]);
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : null;
}

/** "*.04" → per .04; "*1/10" → per 1 every 10; "15" → flat 15. */
export function parsePoints(raw: string): Pick<ScoringRule, 'kind' | 'points' | 'every'> | null {
  const s = raw.trim();
  if (s.startsWith('*')) {
    const [num, den] = s.slice(1).split('/');
    const points = Number(num);
    const every = den === undefined ? 1 : Number(den);
    if (!Number.isFinite(points) || !Number.isFinite(every) || every <= 0) return null;
    return { kind: 'per', points, every };
  }
  const points = Number(s);
  return Number.isFinite(points) ? { kind: 'flat', points, every: 1 } : null;
}

/**
 * Parse MFL's `TYPE=rules` JSON. Returns null for a payload that carries no
 * rules (MFL's "No League Scoring Rules" error, or anything unreadable) — the
 * caller decides whether that was a failed read or a league without rules.
 */
export function parseScoringRules(payload: unknown): PositionRuleSet[] | null {
  const blocks = asList((payload as any)?.rules?.positionRules);
  if (blocks.length === 0) return null;
  const out: PositionRuleSet[] = [];
  for (const block of blocks) {
    const positions = text(block?.positions)
      .split('|')
      .map((p) => p.trim())
      .filter(Boolean);
    const rules: ScoringRule[] = [];
    for (const r of asList(block?.rule)) {
      const event = text(r?.event)
        .split('+')
        .map((e) => e.trim())
        .filter(Boolean);
      const range = parseRange(text(r?.range));
      const pts = parsePoints(text(r?.points));
      if (event.length === 0 || !range || !pts) continue;
      rules.push({ event, lo: range[0], hi: range[1], ...pts });
    }
    if (positions.length > 0 && rules.length > 0) out.push({ positions, rules });
  }
  return out.length > 0 ? out : null;
}

/**
 * One position spelling, for matching a player to a rule block. MFL's rules
 * say `PK` and `Def`; rows can carry `K`, `DEF`, `DST`.
 */
function canonPosition(raw: string): string {
  const p = raw.trim().toUpperCase();
  if (p === 'K') return 'PK';
  if (p === 'DST' || p === 'D/ST' || p === 'TMDEF') return 'DEF';
  return p;
}

export interface StatSheetLine {
  /** The rule event as MFL spells it, e.g. `PY` or `UY+KY`. */
  event: string;
  label: string;
  /** Display value: "312", "41, 53 yds". */
  value: string;
  /** Points this stat earned under the league's rules; null when unscored. */
  points: number | null;
}

export interface StatSheet {
  lines: StatSheetLine[];
  /** Sum of the itemized points. */
  itemized: number;
  /** MFL's official total for the player — the row's live score. */
  total: number;
  /**
   * `total - itemized`, rounded to hundredths; 0 when they agree. Points the
   * league scored that this board could not attribute to a stat.
   */
  unitemized: number;
  /** False when the league publishes no rules — lines then carry no points. */
  scored: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const fmtValue = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

export interface ScorePlayerInput {
  rules: PositionRuleSet[] | null;
  position: string;
  stats: Record<string, number>;
  fgLengths?: number[];
  /** MFL's own total for him — the authority the sheet reconciles to. */
  total: number;
}

/**
 * Itemize one player's line under one league's rules.
 *
 * Every matching rule is applied and rules for the same event ADD (TheLeague's
 * field goal is "3 flat for 0-30 yards" plus "×0.1 per yard for 31-99", and
 * MFL sums every rule whose range holds). A player can match several blocks —
 * a league may list `QB` rules apart from `QB|RB|WR|TE` ones — and all apply.
 */
export function scorePlayerStats({
  rules,
  position,
  stats,
  fgLengths,
  total,
}: ScorePlayerInput): StatSheet {
  const pos = canonPosition(position);
  const lines = new Map<string, StatSheetLine & { order: number }>();

  if (rules) {
    for (const block of rules) {
      if (!block.positions.some((p) => canonPosition(p) === pos)) continue;
      for (const rule of block.rules) {
        const key = rule.event.join('+');
        let value: number;
        let points = 0;
        let display: string;

        if (rule.event.length === 1 && PER_OCCURRENCE.has(rule.event[0])) {
          // Only FG has per-occurrence data; anything else is un-itemizable.
          if (rule.event[0] !== 'FG' || !fgLengths) continue;
          value = fgLengths.length;
          for (const len of fgLengths) {
            if (len < rule.lo || len > rule.hi) continue;
            points += rule.kind === 'per'
              ? Math.floor(len / rule.every) * rule.points
              : rule.points;
          }
          display = fgLengths.length ? `${fgLengths.join(', ')} yds` : '0';
        } else {
          // A combined event (`UY+KY`) is known when ANY part is: a player
          // with kick returns and no punt returns has 0 punt return yards,
          // and requiring both dropped every returner's yards.
          if (!rule.event.some((code) => code in stats)) continue;
          value = rule.event.reduce((t, code) => t + (stats[code] ?? 0), 0);
          if (value >= rule.lo && value <= rule.hi) {
            points = rule.kind === 'per'
              ? Math.floor(value / rule.every) * rule.points
              : rule.points;
          }
          display = fmtValue(value);
        }

        const prev = lines.get(key);
        if (prev) {
          prev.points = (prev.points ?? 0) + points;
        } else {
          lines.set(key, {
            event: key,
            label: rule.event.map((c) => LABELS[c] ?? c).join(' + '),
            value: display,
            points,
            order: orderOf(rule.event[0]),
          });
        }
      }
    }
  } else {
    // No rules published: show the raw line, unscored.
    for (const [code, value] of Object.entries(stats)) {
      if (!LABELS[code]) continue;
      lines.set(code, {
        event: code,
        label: LABELS[code],
        value: fmtValue(value),
        points: null,
        order: orderOf(code),
      });
    }
    if (fgLengths?.length) {
      lines.set('FG', {
        event: 'FG',
        label: LABELS.FG,
        value: `${fgLengths.join(', ')} yds`,
        points: null,
        order: orderOf('FG'),
      });
    }
  }

  // A stat that did nothing and paid nothing is noise ("0 punt return yards").
  const kept = [...lines.values()]
    .map((l) => ({ ...l, points: l.points === null ? null : round2(l.points) }))
    .filter((l) => l.value !== '0' || (l.points !== null && l.points !== 0))
    .sort((a, b) => a.order - b.order || a.event.localeCompare(b.event))
    .map(({ order: _order, ...l }) => l);

  const itemized = round2(kept.reduce((t, l) => t + (l.points ?? 0), 0));
  const scored = rules !== null;
  const diff = round2(total - itemized);
  return {
    lines: kept,
    itemized,
    total,
    // Within a rounding hair is agreement; MFL itself rounds to hundredths.
    unitemized: scored && Math.abs(diff) >= 0.05 ? diff : 0,
    scored,
  };
}
