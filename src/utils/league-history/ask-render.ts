/**
 * Ask the History — one answer, built client-side for the ask screen
 * (HistoryAskPage.astro). HistoryAnswer.astro renders the same markup on the
 * server for a shared answer, and history-ask.css styles both: the big stat,
 * the answer in words, the Record Book chart and boards, then the rows that
 * prove it behind "Show the rows".
 */
import { answerCharts, cellHref, formatCell, isNumericColumn, recordHref } from './ask-format.mjs';
import type { AskHeadline, AskRecordLink, AskTable } from './ask';

export interface ClientAnswer {
  id: string | null;
  question: string;
  answer: string;
  headline?: AskHeadline | null;
  followUps?: string[];
  table: AskTable | null;
  asOf?: string;
  records?: AskRecordLink[];
  error?: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) => {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = text;
  return node;
};

/** The team the answer is about, for the card's color band: the first row's franchise. */
export function answerTeam(table: AskTable | null | undefined): string | null {
  const id = table?.rows?.[0]?.franchiseId;
  return id && /^[A-Za-z0-9_-]{1,16}$/.test(id) ? id : null;
}

export function renderAnswer(data: ClientAnswer, base: string): HTMLElement {
  const article = el('article', 'ha-answer');
  const team = answerTeam(data.table);
  if (team) article.style.setProperty('--ha-team', `var(--team-accent-${team}, var(--history-gold))`);

  if (data.headline) {
    const head = el('div', 'ha-head');
    head.append(el('span', 'ha-head__value', data.headline.value), el('span', 'ha-head__label', data.headline.label));
    article.append(head);
  }
  article.append(el('p', 'ha-answer__a', data.answer));

  // The chart SVG is built by record-charts.mjs, which escapes every name.
  for (const c of answerCharts(data.table?.chart, base)) {
    const fig = el('figure', 'ha-chart');
    const phone = el('div', 'rb-viz__plot rb-viz__plot--phone');
    phone.innerHTML = c.phone;
    const wide = el('div', 'rb-viz__plot rb-viz__plot--wide');
    wide.innerHTML = c.wide;
    fig.append(el('p', 'ha-chart__title', c.title), phone, wide, el('figcaption', 'rb-viz__take', c.take));
    article.append(fig);
  }

  if (data.records?.length) {
    const list = el('ul', 'ha-records');
    list.setAttribute('aria-label', 'In the Record Book');
    for (const rec of data.records) {
      const a = el('a', 'ha-record');
      a.href = recordHref(base, rec.query);
      a.append(el('span', 'ha-record__kicker', 'Record Book'), el('span', 'ha-record__title', rec.title));
      if (rec.leader) a.append(el('span', 'ha-record__leader', rec.leader));
      const li = el('li');
      li.append(a);
      list.append(li);
    }
    article.append(list);
  }

  const table = data.table;
  if (table && table.rows.length) {
    const numeric = table.columns.map((_, i) => isNumericColumn(table, i));
    const rows = el('details', 'ha-rows');
    // Under a chart or a big stat the rows are the fine print; otherwise they ARE the answer.
    rows.open = !table.chart && !data.headline;
    rows.append(el('summary', 'ha-rows__toggle', rowsLabel(table)));
    const t = el('table', 'ui-table ha-table');
    const head = el('tr');
    table.columns.forEach((c, i) => {
      const th = el('th', numeric[i] ? 'ha-num' : '', c.label);
      th.scope = 'col';
      head.append(th);
    });
    t.append(el('thead'));
    t.tHead!.append(head);
    const body = el('tbody');
    for (const row of table.rows) {
      const tr = el('tr');
      table.columns.forEach((c, i) => {
        const td = el('td', numeric[i] ? 'ha-num' : '');
        td.dataset.label = c.label;
        const text = formatCell(c.key, row.cells[i]);
        const href = cellHref(c.key, row, base);
        if (href) {
          const a = el('a', '', text);
          a.href = href;
          td.append(a);
        } else td.textContent = text;
        tr.append(td);
      });
      body.append(tr);
    }
    t.append(body);
    rows.append(t);
    article.append(rows);
  }
  if (table) article.append(el('p', 'ha-receipt', receipt(table)));
  if (data.asOf) article.append(el('p', 'ha-receipt', `${data.asOf}.`));
  return article;
}

/** "Show the 23 rows" / "Show the top 10 of 23". */
export function rowsLabel(table: Pick<AskTable, 'total' | 'rows'>): string {
  return table.total > table.rows.length ? `Show the top ${table.rows.length} of ${table.total.toLocaleString('en-US')}` : `Show the ${table.rows.length === 1 ? 'row' : `${table.rows.length} rows`}`;
}

export function receipt(table: Pick<AskTable, 'total' | 'rows' | 'description'>): string {
  const matches = table.total === 1 ? '1 match' : `${table.total.toLocaleString('en-US')} matches`;
  return `${matches} · ${table.description}`;
}
