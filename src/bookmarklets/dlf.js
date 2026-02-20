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

    // DLF uses TablePress + DataTables. Try the DataTables API first for all rows.
    var players = [];

    if (window.jQuery && jQuery.fn.DataTable && jQuery('#avgTable').length) {
      // DataTables API: gets all rows regardless of pagination
      var dt = jQuery('#avgTable').DataTable();
      dt.rows().every(function () {
        var data = this.data();
        // Columns: [0]=rank, [1]=unknown, [2]=position, [3]=name (may contain HTML), [4]=team, [5]=age
        if (!data || data.length < 5) return;

        var rank = parseInt(String(data[0]).replace(/<[^>]*>/g, '').trim(), 10);
        var pos = String(data[2]).replace(/<[^>]*>/g, '').trim();
        var nameHtml = String(data[3]);
        // Extract name from anchor tag or plain text
        var nameMatch = nameHtml.match(/>([^<]+)</);
        var name = nameMatch ? nameMatch[1].trim() : nameHtml.replace(/<[^>]*>/g, '').trim();
        var team = String(data[4]).replace(/<[^>]*>/g, '').trim();

        if (name && !isNaN(rank)) {
          players.push({ rank: rank, name: name, pos: pos, team: team });
        }
      });
    }

    // Fallback: DOM scraping
    if (players.length === 0) {
      var table = document.getElementById('avgTable');
      if (!table) {
        alert('No DLF rankings table found.\nMake sure you are on a DLF dynasty rankings page.');
        return;
      }
      var rows = table.querySelectorAll('tbody tr');
      for (var i = 0; i < rows.length; i++) {
        var cells = rows[i].querySelectorAll('td');
        if (cells.length < 5) continue;

        var rank = parseInt(cells[0].textContent.trim(), 10);
        var pos = cells[2].textContent.trim();
        var nameLink = cells[3].querySelector('a');
        var name = nameLink ? nameLink.textContent.trim() : cells[3].textContent.trim();
        var team = cells[4].textContent.trim();

        if (name && !isNaN(rank)) {
          players.push({ rank: rank, name: name, pos: pos, team: team });
        }
      }
    }

    if (players.length === 0) {
      alert('Could not extract any players.\nAre you logged in to DLF Premium?');
      return;
    }

    var output = JSON.stringify({
      source: 'dlf',
      type: 'dynasty',
      exportedAt: new Date().toISOString(),
      players: players,
      metadata: { pageUrl: location.href }
    });

    if (!transferToImportPage(output, 'dlf', players.length)) {
      alert(
        'DLF rankings extracted (' + players.length + ' players), but transfer failed.\n' +
        'Allow popups for this page and run the bookmarklet again.'
      );
    }
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();
