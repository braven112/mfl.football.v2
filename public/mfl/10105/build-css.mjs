/**
 * Builds standings.css — the league's own stylesheet plus the widget's rules.
 *
 *   node public/mfl/10105/build-css.mjs
 *
 * Served rather than pasted into the module, so a style fix ships the same way
 * a code fix does: push, deploy, done. The league's half is read from the
 * capture taken before the change, never retyped.
 *
 * Every rule is scoped to #madmen — the module must keep that wrapper or none
 * of this applies.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const league = readFileSync(path.join(here, 'reference/existing-page.css'), 'utf8').trim();
const added = readFileSync(path.join(here, 'widget.css'), 'utf8').trim();

const out = `/*
 * MAD POWER 99 — stylesheet for the automatic standings widget.
 * Archie's Fantasy Football League (MFL 10105)
 *
 * GENERATED — rebuild with: node public/mfl/10105/build-css.mjs
 *
 * The league's own stylesheet, captured from the module before the change,
 * plus the rules the widget adds (widget.css). Every rule is scoped to
 * #madmen; the module must keep that wrapper.
 */

${league}

${added}
`;
writeFileSync(path.join(here, 'standings.css'), out);
console.log('standings.css written —', out.length, 'bytes');
