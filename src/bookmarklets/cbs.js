(function () {
  'use strict';
  try {
    function transferToImportPage(payload, source, count) {
      var importBaseUrl = '__MFL_IMPORT_URL__';

      function toBase64Utf8(str) {
        return btoa(unescape(encodeURIComponent(str)));
      }

      var envelope = {
        version: 3,
        source: source,
        playerCount: count,
        payload: payload,
        pageUrl: location.href,
        transferredAt: new Date().toISOString()
      };

      var encoded = encodeURIComponent(toBase64Utf8(JSON.stringify(envelope)));
      var separator = importBaseUrl.indexOf('#') > -1 ? '&' : '#';
      var targetUrl = importBaseUrl + separator + 'bm=' + encoded;

      var tab = window.open(targetUrl, '_blank');
      if (tab) return true;

      try {
        window.location.href = targetUrl;
        return true;
      } catch (err) {
        return false;
      }
    }

    var table = document.querySelector('#TableBase table tbody');
    if (!table) {
      alert('No CBS rankings table found.\nMake sure you are on a CBS Fantasy Football rankings page.');
      return;
    }
    var rows = table.querySelectorAll('tr');
    var players = [];
    for (var i = 0; i < rows.length; i++) {
      var cells = rows[i].querySelectorAll('td');
      if (cells.length < 2) continue;

      // Player name: try CellPlayerName--long first, then TeamName (DST)
      var nameEl = cells[0].querySelector('span.CellPlayerName--long a, span.TeamName a');
      if (!nameEl) continue;
      var name = nameEl.textContent.trim();

      // Position and team from the text after the name link
      var infoText = cells[0].textContent.trim();
      var match = infoText.match(/\b(QB|RB|WR|TE|K|DST|DEF)\b/i);
      var pos = match ? match[1].toUpperCase() : '';
      var teamMatch = infoText.match(/\b([A-Z]{2,3})\s*$/);
      var team = teamMatch ? teamMatch[1] : '';

      players.push({
        rank: players.length + 1,
        name: name,
        pos: pos,
        team: team
      });
    }

    if (players.length === 0) {
      alert('Could not extract any players from the table.');
      return;
    }

    var output = JSON.stringify({
      source: 'cbs',
      type: 'redraft',
      exportedAt: new Date().toISOString(),
      players: players,
      metadata: { pageUrl: location.href }
    });

    if (!transferToImportPage(output, 'cbs', players.length)) {
      alert(
        'CBS rankings extracted (' + players.length + ' players), but transfer failed.\n' +
        'Allow popups for this page and run the bookmarklet again.'
      );
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
