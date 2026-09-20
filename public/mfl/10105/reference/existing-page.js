(function () {
  function parsePoints(cell) {
    if (!cell) return -Infinity;
    var text = (cell.textContent || '').trim();
    if (text.toUpperCase() === 'TBD') return -Infinity;
    var num = parseFloat(text.replace(/[^0-9.\-]/g, ''));
    return isNaN(num) ? -Infinity : num;
  }
  function normalizeMoneyValue(text) {
    var raw = (text || '').trim();
    if (!raw) return null;
    var cleaned = raw.replace(/\s+/g, '');
    if (
      cleaned === '0' ||
      cleaned === '0.0' ||
      cleaned === '0.00' ||
      cleaned === '$0' ||
      cleaned === '$0.0' ||
      cleaned === '$0.00'
    ) {
      return null;
    }
    return raw;
  }
  function convertWinnings(cell) {
    if (!cell) return false;
    var original = (cell.textContent || '').trim();
    var value = normalizeMoneyValue(original);
    cell.textContent = '';
    if (!value) return false;
    var wrap = document.createElement('div');
    wrap.className = 'winnings-stack';
    var icon = document.createElement('i');
    icon.className = 'fa-sharp fa-regular fa-money-bill-1 winnings-icon';
    icon.setAttribute('aria-label', 'winnings');
    var amount = document.createElement('span');
    amount.className = 'winnings-amount';
    amount.textContent = value;
    wrap.appendChild(icon);
    wrap.appendChild(amount);
    cell.appendChild(wrap);
    return true;
  }
  function convertDivisionLeader(cell) {
    if (!cell) return false;
    var divisionName = (cell.textContent || '').trim();
    cell.textContent = '';
    if (!divisionName) return false;
    var wrap = document.createElement('div');
    wrap.className = 'division-leader-stack';
    var icon = document.createElement('i');
    icon.className = 'fa-sharp fa-solid fa-ranking-star division-leader-icon';
    icon.setAttribute('aria-label', 'division leader');
    var name = document.createElement('span');
    name.className = 'division-leader-name';
    name.textContent = divisionName;
    wrap.appendChild(icon);
    wrap.appendChild(name);
    cell.appendChild(wrap);
    return true;
  }
  function convertWildcardLeader(cell) {
    if (!cell) return false;
    var wildcardFlag = (cell.getAttribute('data-wildcard') || '').trim().toUpperCase();
    var wildcardNote = (cell.getAttribute('data-wildcard-note') || '').trim();
    cell.textContent = '';
    if (wildcardFlag !== 'Y') return false;
    var wrap = document.createElement('div');
    wrap.className = 'wildcard-leader-stack';
    var icon = document.createElement('i');
    icon.className = 'fa-sharp fa-solid fa-cards wildcard-leader-icon';
    icon.setAttribute('aria-label', 'wild card leader');
    wrap.appendChild(icon);
    if (wildcardNote) {
      var note = document.createElement('span');
      note.className = 'wildcard-leader-note';
      note.textContent = wildcardNote;
      wrap.appendChild(note);
    }
    cell.appendChild(wrap);
    return true;
  }
  function makeSectionCaption(text, extraClass) {
    var tr = document.createElement('tr');
    tr.className = 'section-caption-row ' + (extraClass || '');
    var td = document.createElement('td');
    td.colSpan = 6;
    td.className = 'section-caption-cell';
    td.textContent = text;
    tr.appendChild(td);
    return tr;
  }
  function makeSectionGap() {
    var tr = document.createElement('tr');
    tr.className = 'section-gap-row';
    var td = document.createElement('td');
    td.colSpan = 6;
    td.className = 'section-gap-cell';
    td.setAttribute('aria-hidden', 'true');
    tr.appendChild(td);
    return tr;
  }
  function makeSectionHeaderRow(lastHeaderText) {
    var tr = document.createElement('tr');
    tr.className = 'section-header-row';
    tr.innerHTML = [
      '<th scope="col">RANKING</th>',
      '<th scope="col">TEAM</th>',
      '<th scope="col">RECORD</th>',
      '<th scope="col">POINTS AVG</th>',
      '<th scope="col">WINNINGS</th>',
      '<th scope="col">' + lastHeaderText + '</th>'
    ].join('');
    return tr;
  }
  var table = document.querySelector('#madmen #wwwc');
  if (!table) return;
  var tbody = table.tBodies[0] || table;
  var originalHeaderRow = null;
  var tableRows = Array.prototype.slice.call(table.querySelectorAll('tr'));
  originalHeaderRow = tableRows.find(function (row) {
    return row.querySelectorAll('th').length === 6 && !row.classList.contains('section-header-row');
  });
  var dataRows = tableRows.filter(function (row) {
    return row.querySelector('.points');
  });
  if (!dataRows.length) return;
  dataRows.forEach(function (row) {
    row.classList.remove(
      'highlight-row',
      'division-row',
      'winnings-row',
      'overall-top-row',
      'wildcard-row'
    );
    var hasWinnings = convertWinnings(row.querySelector('.winnings-input'));
    var divisionCell = row.querySelector('.division-leader-display');
    var wildcardCell = row.querySelector('.wildcard-leader-display');
    var isDivisionLeader = false;
    if (divisionCell) {
      isDivisionLeader = convertDivisionLeader(divisionCell);
    }
    if (hasWinnings) row.classList.add('winnings-row');
    if (isDivisionLeader) row.classList.add('division-row');
    if (wildcardCell) {
      wildcardCell.textContent = '';
    }
  });
  var overallSorted = dataRows.slice().sort(function (a, b) {
    return parsePoints(b.querySelector('.points')) - parsePoints(a.querySelector('.points'));
  });
  // Do not declare a points leader while every score is zero or TBD.
  var overallTopRow = overallSorted.length &&
    parsePoints(overallSorted[0].querySelector('.points')) > 0
    ? overallSorted[0] : null;
  var divisionRows = dataRows.filter(function (row) {
    var cell = row.querySelector('.division-leader-display');
    if (!cell) return false;
    var txt = (cell.textContent || cell.innerText || '').trim();
    return !!txt;
  }).sort(function (a, b) {
    return parsePoints(b.querySelector('.points')) - parsePoints(a.querySelector('.points'));
  });
  if (divisionRows.length > 9) {
    divisionRows = divisionRows.slice(0, 9);
  }
  var divisionSet = new Set(divisionRows);
  var pointsRows = dataRows.filter(function (row) {
    return !divisionSet.has(row);
  }).sort(function (a, b) {
    return parsePoints(b.querySelector('.points')) - parsePoints(a.querySelector('.points'));
  });
  pointsRows.forEach(function (row) {
    var wildcardCell = row.querySelector('.wildcard-leader-display');
    var isWildcard = convertWildcardLeader(wildcardCell);
    if (isWildcard) {
      row.classList.add('wildcard-row');
    }
  });
  var oldSectionRows = table.querySelectorAll('.section-caption-row, .section-gap-row, .section-header-row');
  Array.prototype.forEach.call(oldSectionRows, function (row) {
    if (row.parentNode) row.parentNode.removeChild(row);
  });
  if (originalHeaderRow) {
    if (divisionRows.length) {
      originalHeaderRow.style.display = '';
    } else {
      originalHeaderRow.style.display = 'none';
    }
  }
  var frag = document.createDocumentFragment();
  if (divisionRows.length) {
    frag.appendChild(makeSectionCaption('ARCHIES DIVISION LEADERS', 'division-section-caption'));
    divisionRows.forEach(function (row, idx) {
      var rankCell = row.querySelector('.rank');
      if (rankCell) rankCell.textContent = String(idx + 1);
      frag.appendChild(row);
    });
    if (pointsRows.length) {
      frag.appendChild(makeSectionGap());
    }
  }
  if (pointsRows.length) {
    frag.appendChild(makeSectionHeaderRow('WILD CARD LEADERS'));
    frag.appendChild(makeSectionCaption('ARCHIES POINTS LEADERS', 'points-section-caption'));
    pointsRows.forEach(function (row, idx) {
      var rankCell = row.querySelector('.rank');
      if (rankCell) rankCell.textContent = String(idx + 1);
      frag.appendChild(row);
    });
  }
  tbody.appendChild(frag);
  if (overallTopRow) {
    overallTopRow.classList.remove('division-row', 'winnings-row', 'wildcard-row');
    overallTopRow.classList.add('highlight-row', 'overall-top-row');
  }
  var imgs = table.querySelectorAll('img.team-banner');
  Array.prototype.forEach.call(imgs, function (img, i) {
    if (!img.hasAttribute('loading')) img.loading = 'lazy';
    if (!img.hasAttribute('decoding')) img.decoding = 'async';
    if (!img.hasAttribute('fetchpriority')) {
      img.setAttribute('fetchpriority', i < 12 ? 'auto' : 'low');
    }
    if (!img.hasAttribute('width')) img.setAttribute('width', '300');
    if (!img.hasAttribute('height')) img.setAttribute('height', '50');
  });
})();

