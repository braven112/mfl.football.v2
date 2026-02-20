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

    // FootballGuys loads rankings asynchronously. Wait for content, then scrape.
    function scrape() {
      var tables = document.querySelectorAll('table');
      var playerTable = null;

      // Find the rankings table by looking for headers with relevant keywords
      for (var t = 0; t < tables.length; t++) {
        var headerText = (tables[t].querySelector('thead') || { textContent: '' }).textContent || '';
        if (headerText.match(/rank|player|pts|age/i) && tables[t].querySelectorAll('tbody tr').length > 5) {
          playerTable = tables[t];
          break;
        }
      }

      if (!playerTable) {
        // Also try div-based rankings
        var cards = document.querySelectorAll('[class*="rank"], [class*="player"]');
        if (cards.length < 5) {
          alert('No FootballGuys rankings table found.\nMake sure you are on a FootballGuys rankings page and are logged in.');
          return;
        }
      }

      var players = [];

      if (playerTable) {
        var rows = playerTable.querySelectorAll('tbody tr');
        for (var i = 0; i < rows.length; i++) {
          var cells = rows[i].querySelectorAll('td');
          if (cells.length < 4) continue;

          // Player name from link (href contains /player/)
          var nameLink = rows[i].querySelector('a[href*="/player/"]');
          if (!nameLink) continue;
          var name = nameLink.textContent.trim();
          if (!name) continue;

          // Team from span.team-abbr
          var teamSpan = rows[i].querySelector('span[class*="team-abbr"]');
          var team = teamSpan ? teamSpan.textContent.trim() : '';

          // Position from span.pos-XX (e.g., pos-WR, pos-QB)
          var posSpan = rows[i].querySelector('span[class*="pos-"]');
          var pos = '';
          if (posSpan) {
            var posClass = posSpan.className.match(/pos-(\w+)/);
            pos = posClass ? posClass[1].toUpperCase() : posSpan.textContent.replace(/[0-9]/g, '').trim().toUpperCase();
          }

          // Rank from first cell
          var rankText = cells[0].textContent.trim();
          var rank = parseInt(rankText, 10);
          if (isNaN(rank)) rank = players.length + 1;

          players.push({ rank: rank, name: name, pos: pos, team: team });
        }
      }

      if (players.length === 0) {
        alert('Could not extract any players.\nAre you logged in with a PRO subscription?');
        return;
      }

      // Detect type from URL
      var type = 'redraft';
      if (location.href.indexOf('dynasty') > -1) type = 'dynasty';

      var output = JSON.stringify({
        source: 'footballguys',
        type: type,
        exportedAt: new Date().toISOString(),
        players: players,
        metadata: { pageUrl: location.href }
      });

      if (!transferToImportPage(output, 'footballguys', players.length)) {
        alert(
          'FootballGuys rankings extracted (' + players.length + ' players), but transfer failed.\n' +
          'Allow popups for this page and run the bookmarklet again.'
        );
      }
    }

    // Wait for async content to load
    if (document.querySelector('table tbody tr') || document.readyState === 'complete') {
      scrape();
    } else {
      setTimeout(scrape, 2000);
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
