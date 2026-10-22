/**
 * Read rows out of a MySQL/MariaDB dump (phpMyAdmin / mysqldump text) without
 * a database. The forum archive is built from TheLeague's old phpBB export,
 * which is a plain `.sql` file: `CREATE TABLE` blocks for the column order and
 * `INSERT INTO ... VALUES (...),(...);` statements for the rows.
 *
 * Isomorphic on purpose — the commissioner's import panel runs this in the
 * browser on the `.sql` they exported, and `scripts/forum-archive/` runs it in
 * node. No `fs`, no `Buffer`.
 */

/**
 * Parse the `(...),(...)` tuple list of one INSERT statement.
 * Handles MySQL string escapes (\' \\ \n \r \t \0), doubled quotes, NULL and
 * bare numbers.
 *
 * @param {string} s
 * @returns {Array<Array<string | number | null>>}
 */
export function parseInsertValues(s) {
  const rows = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    if (s[i] !== '(') { i++; continue; }
    i++;
    const row = [];
    let bare = '';
    let quoted = false;
    for (;;) {
      if (i >= n) throw new Error('Unterminated row in INSERT statement');
      const c = s[i];
      if (c === "'") {
        i++;
        let buf = '';
        for (;;) {
          if (i >= n) throw new Error('Unterminated string in INSERT statement');
          const d = s[i];
          if (d === '\\') {
            const nx = s[i + 1];
            buf += nx === 'n' ? '\n' : nx === 'r' ? '\r' : nx === 't' ? '\t' : nx === '0' ? '\0' : nx;
            i += 2;
            continue;
          }
          if (d === "'") {
            if (s[i + 1] === "'") { buf += "'"; i += 2; continue; }
            i++;
            break;
          }
          buf += d;
          i++;
        }
        row.push(buf);
        quoted = true;
      } else if (c === ',' || c === ')') {
        if (!quoted) {
          const v = bare.trim();
          row.push(v === 'NULL' ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v);
        }
        bare = '';
        quoted = false;
        i++;
        if (c === ')') { rows.push(row); break; }
      } else {
        bare += c;
        i++;
      }
    }
  }
  return rows;
}

/**
 * Column names of a table, in order, from its CREATE TABLE block.
 *
 * @param {string} sql
 * @param {string} table
 * @returns {string[] | null}
 */
export function tableColumns(sql, table) {
  const start = sql.indexOf(`CREATE TABLE \`${table}\``);
  if (start < 0) return null;
  const end = sql.indexOf('\n) ', start);
  const body = sql.slice(start, end < 0 ? undefined : end);
  return [...body.matchAll(/^\s+`(\w+)`/gm)].map((m) => m[1]);
}

/**
 * Every row of the named tables, as objects keyed by column name.
 * A table missing from the dump comes back as an empty array.
 *
 * @param {string} sql
 * @param {string[]} tables
 * @returns {Record<string, Array<Record<string, string | number | null>>>}
 */
export function readTables(sql, tables) {
  /** @type {Record<string, Array<Record<string, string | number | null>>>} */
  const out = {};
  for (const table of tables) {
    out[table] = [];
    const cols = tableColumns(sql, table);
    if (!cols) continue;
    const marker = `INSERT INTO \`${table}\``;
    let at = sql.indexOf(marker);
    while (at >= 0) {
      const valuesAt = sql.indexOf('VALUES', at) + 'VALUES'.length;
      const stop = findStatementEnd(sql, valuesAt);
      for (const row of parseInsertValues(sql.slice(valuesAt, stop))) {
        /** @type {Record<string, string | number | null>} */
        const obj = {};
        cols.forEach((c, idx) => { obj[c] = row[idx] ?? null; });
        out[table].push(obj);
      }
      at = sql.indexOf(marker, stop);
    }
  }
  return out;
}

/** Index of the `;` ending the statement that starts at `from`, skipping quoted text. */
function findStatementEnd(sql, from) {
  let inStr = false;
  for (let i = from; i < sql.length; i++) {
    const c = sql[i];
    if (inStr) {
      if (c === '\\') { i++; continue; }
      if (c === "'") {
        if (sql[i + 1] === "'") { i++; continue; }
        inStr = false;
      }
    } else if (c === "'") {
      inStr = true;
    } else if (c === ';') {
      return i;
    }
  }
  return sql.length;
}
