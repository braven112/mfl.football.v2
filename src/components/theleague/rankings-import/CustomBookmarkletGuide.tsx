import { useState } from 'react';

const SCHEMA_EXAMPLE = `{
  "source": "custom",
  "type": "dynasty",
  "exportedAt": "2026-02-17T12:00:00Z",
  "players": [
    { "rank": 1, "name": "Ja'Marr Chase", "pos": "WR", "team": "CIN" },
    { "rank": 2, "name": "Bijan Robinson", "pos": "RB", "team": "ATL" },
    { "rank": 3, "name": "Sam LaPorta", "pos": "TE", "team": "DET" }
  ]
}`;

const TEMPLATE = `javascript:(function(){
  var players = [];
  // TODO: Add your scraping logic here
  // Example: document.querySelectorAll('.player-row').forEach(function(row, i) {
  //   players.push({ rank: i+1, name: row.querySelector('.name').textContent, pos: 'WR', team: '' });
  // });
  var output = JSON.stringify({
    source: 'custom',
    type: 'dynasty',
    exportedAt: new Date().toISOString(),
    players: players
  });
  navigator.clipboard.writeText(output).then(function(){
    alert('Copied ' + players.length + ' players!');
  });
})();`;

export default function CustomBookmarkletGuide() {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="ri-section">
      <button
        type="button"
        className="ri-guide__toggle"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <h2 className="ri-section__title" style={{ marginBottom: 0 }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
          Build Your Own Bookmarklet
        </h2>
        <span className="ri-guide__arrow" style={{ transform: expanded ? 'rotate(180deg)' : 'none' }}>
          &#9660;
        </span>
      </button>

      {expanded && (
        <div className="ri-guide__content">
          <p>
            You can build a bookmarklet for any rankings site. Your bookmarklet just needs to
            output JSON in this format and copy it to the clipboard:
          </p>

          <h3>JSON Schema</h3>
          <pre className="ri-guide__code">{SCHEMA_EXAMPLE}</pre>

          <h3>Required Fields</h3>
          <table className="ri-guide__fields-table">
            <thead>
              <tr><th>Field</th><th>Type</th><th>Description</th></tr>
            </thead>
            <tbody>
              <tr><td><code>source</code></td><td>string</td><td>Use <code>"custom"</code> for your own bookmarklets</td></tr>
              <tr><td><code>type</code></td><td>string</td><td><code>"dynasty"</code>, <code>"redraft"</code>, <code>"adp"</code>, or <code>"overall"</code></td></tr>
              <tr><td><code>exportedAt</code></td><td>string</td><td>ISO 8601 date string</td></tr>
              <tr><td><code>players</code></td><td>array</td><td>Array of player objects (see below)</td></tr>
            </tbody>
          </table>

          <h3>Player Object</h3>
          <table className="ri-guide__fields-table">
            <thead>
              <tr><th>Field</th><th>Required</th><th>Description</th></tr>
            </thead>
            <tbody>
              <tr><td><code>rank</code></td><td>Yes</td><td>Player's ranking position (1, 2, 3...)</td></tr>
              <tr><td><code>name</code></td><td>Yes</td><td>Full player name (e.g. "Patrick Mahomes")</td></tr>
              <tr><td><code>pos</code></td><td>Yes</td><td>QB, RB, WR, TE, K/PK, DEF/DST</td></tr>
              <tr><td><code>team</code></td><td>No</td><td>NFL team abbreviation (e.g. "KC")</td></tr>
              <tr><td><code>tier</code></td><td>No</td><td>Tier number if available</td></tr>
            </tbody>
          </table>

          <h3>Bookmarklet Template</h3>
          <p>
            Copy this template and modify the scraping logic for your target site.
            Test in the browser console first, then save as a bookmark.
          </p>
          <pre className="ri-guide__code ri-guide__code--sm">{TEMPLATE}</pre>

          <h3>Tips</h3>
          <ul className="ri-guide__tips">
            <li>Test your scraping logic in the browser console (F12) before creating the bookmarklet</li>
            <li>Position codes are normalized automatically — "K" and "PK" both work, as do "DST" and "DEF"</li>
            <li>Player names are fuzzy-matched — minor spelling differences are handled</li>
            <li>If <code>navigator.clipboard.writeText</code> fails, create a hidden textarea and use <code>document.execCommand('copy')</code></li>
          </ul>
        </div>
      )}
    </section>
  );
}
