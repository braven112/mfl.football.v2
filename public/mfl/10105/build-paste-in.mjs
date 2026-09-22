/**
 * Wraps standings.js into a single self-contained block the commissioner can
 * paste straight into the MFL message module — no hosting, no <script src>.
 *
 * Generated, never hand-edited:  node public/mfl/10105/build-paste-in.mjs
 *
 * The hosted install (one <script src> line) is the better long-term shape
 * because a fix then reaches the league without anyone re-pasting. This exists
 * so the widget can be tried before mfl.football serves the file, and as a
 * fallback if hosting is ever unavailable.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = readFileSync(path.join(here, 'standings.js'), 'utf8');

/* A literal </script> inside the source would close the tag early. Nothing in
 * the widget writes one today; this guards against a future edit that does. */
const safe = source.replace(/<\/script>/gi, '<\\/script>');

const out = `<!-- ============================================================
     MAD POWER 99 — automatic playoff standings
     Archie's Fantasy Football League (MFL 10105)

     GENERATED FILE — do not edit this block by hand.
     Source: public/mfl/10105/standings.js in the mfl.football repo.

     TO INSTALL
     1. Delete the module's existing script block. It does its own
        ranking and sectioning; both running at once will fight over
        the same table.
     2. Leave the table markup (id="wwwc") exactly as it is — the
        caption, the colgroup and the header row are all kept and
        reused. The 99 static rows are replaced at load.
     3. Paste this block below the table. Save.

     The widget reads the league from the page's own URL, so it carries
     no league id and needs no key. It refreshes itself on every page
     load; there is nothing to update weekly.
     ============================================================ -->
<script>
${safe}
</script>
`;

writeFileSync(path.join(here, 'paste-in.html'), out);
console.log('paste-in.html written —', out.length, 'bytes');
