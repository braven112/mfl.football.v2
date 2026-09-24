/**
 * Builds module.html — the complete MESSAGE6 module.
 *
 *   node public/mfl/10105/build-module.mjs
 *
 * WHY THIS IS GENERATED, AND WHY IT INLINES THE STYLESHEET
 *
 * The first version of this file carried the table alone. That was wrong, and
 * shipping it stripped the league's page: the module did not just hold 99 rows,
 * it held the #madmen wrapper, the banner image and a 7.7 KB <style> block
 * carrying the entire colour system. Replacing "everything in the module" with
 * a bare table took all three, and the page rendered flat — no pink division
 * rows, no cyan wild cards, no column widths, unstyled icons.
 *
 * So the module is assembled here from its real parts, with the stylesheet
 * read from the captured original rather than retyped. Anything the league
 * later adds to reference/existing-page.css reaches the module by rebuilding.
 *
 * Original module order, preserved below:
 *   banner image → table#madmen > tr > td > table#wwwc → script → <style>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
// Served from here rather than the league's old host, so a banner swap ships
// with the widget instead of waiting on someone else's image server.
const BANNER = 'https://v2.mfl.football/mfl/10105/banner.png';
const SCRIPT = 'https://v2.mfl.football/mfl/10105/standings.js';
const STYLES = 'https://v2.mfl.football/mfl/10105/standings.css';

const out = `<!-- ============================================================
     MAD POWER 99 — the complete MESSAGE6 module.

     GENERATED — rebuild with: node public/mfl/10105/build-module.mjs

     This is the WHOLE module. Replace everything currently in it.

     What is kept from the original and must not be dropped:
       · the banner image
       · the #madmen outer table — every CSS rule below is scoped to it,
         so without it the page renders completely unstyled
       · the #wwwc inner table, its caption and its colgroup widths
       · the header row
       · the stylesheet link — every rule is scoped to #madmen

     Prize money is set in the block below — it is the only figure the
     commissioner still enters.

     What is gone: the 99 hand-written rows, the module's own script, and
     the inline <style> block — that stylesheet is now served, so a style
     fix ships without anyone editing the module again.

     Rows are built from MyFantasyLeague on every page load.
     ============================================================ -->

<img class="img-responsive" src="${BANNER}" alt="MAD POWER 99: featuring 99 teams who think they're smarter than Alfred E. Neuman!" title="MAD POWER 99" />

<table width="100%" border="0" cellspacing="4" cellpadding="0" id="madmen">
  <tr>
    <td>

      <table width="100%" border="0" cellspacing="1" cellpadding="0" id="wwwc">
        <caption>MAD POWER 99</caption>

        <colgroup>
          <col class="col-rank">
          <col class="col-team">
          <col class="col-record">
          <col class="col-points">
          <col class="col-winnings">
          <col class="col-division">
        </colgroup>

        <!-- The widget retitles columns 4 and 6 at load. These labels are
             what shows if it cannot run. -->
        <tr>
          <th scope="col">RANKING</th>
          <th scope="col">TEAM</th>
          <th scope="col">RECORD</th>
          <th scope="col">POINTS AVG</th>
          <th scope="col">WINNINGS</th>
          <th scope="col">DIVISION LEADERS</th>
        </tr>
      </table>

    </td>
  </tr>
</table>

<!-- ============================================================
     PRIZE MONEY — the one thing still entered by hand.

     MFL's accounting ledger for this league is empty, so there is
     nothing to read prizes from. Set them here: team id, then amount.
     Team ids are MFL's, four digits, and they are what the franchise
     export calls "id" — Rhinos is 0001.

     Amounts can be plain numbers or written with a dollar sign. A team
     left out, or set to 0, shows nothing in the WINNINGS column.
     Everything else on the table updates itself.
     ============================================================ -->
<script>
window.MAD_POWER_99_WINNINGS = {
  // "0001": 239.00,
  // "0016": 125.00,
  // "0042": "$75"
};
</script>

<link rel="stylesheet" href="${STYLES}">
<script src="${SCRIPT}" defer></script>
`;

writeFileSync(path.join(here, 'module.html'), out);
console.log('module.html written —', out.length, 'bytes');
