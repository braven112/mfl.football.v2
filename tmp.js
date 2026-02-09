---
import Layout from '../layouts/Layout.astro';
import salarySummary from '../data/mfl-salary-averages-2024.json';
import playerSalaries from '../data/mfl-player-salaries-2024.json';
import leagueAssets from '../data/theleague.assets.json';

const extensionPositions = [
  { key: 'QB', label: 'Quarterback' },
  { key: 'RB', label: 'Running Back' },
  { key: 'WR', label: 'Wide Receiver' },
  { key: 'TE', label: 'Tight End' },
  { key: 'PK', label: 'Kicker' },
];

const salaryTabs = [2, 3, 4];
const extensionSalaries = extensionPositions.reduce((acc, { key }) => {
  acc[key] = salarySummary.positions?.[key]?.top5Average ?? 0;
  return acc;
}, {});
const franchiseSalaries = extensionPositions.reduce((acc, { key }) => {
  acc[key] = salarySummary.positions?.[key]?.top3Average ?? 0;
  return acc;
}, {});

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

const franchiseMetaMap = new Map(
  (leagueAssets.teams ?? []).map((team) => {
    const aliases = team.aliases ?? [];
    const tokens = [
      team.name,
      team.slug,
      team.key,
      team.id,
      ...aliases,
    ]
      .filter(Boolean)
      .map((value) => value.toLowerCase());

    return [
      team.id,
      {
        name: team.name,
        icon: team.assets?.icons?.[0]?.relativePath,
        tokens,
      },
    ];
  })
);

const playerChoices = (playerSalaries.players ?? []).map((player) => {
  const contractYears =
    Number.parseInt(player.contractYear ?? player.contractYearRemaining ?? '0', 10) || 0;
  const franchiseMeta =
    franchiseMetaMap.get(player.franchiseId) ??
    franchiseMetaMap.get(player.franchise_id) ?? {};
  const teamName = franchiseMeta?.name || player.franchiseId || 'Free Agent';
  const nflTeam =
    (player.team ?? franchiseMeta?.nflTeam ?? franchiseMeta?.key ?? '').toUpperCase();
  const icon = franchiseMeta?.icon || null;
  const teamTokens = franchiseMeta?.tokens ?? [];
  const label = `${player.name} (${player.position}) – ${teamName}`;
  const searchBlob = [player.name, player.position, teamName, player.team, ...teamTokens]
    .filter(Boolean)
    .map((value) => value.toLowerCase())
    .join(' ');
  return {
    id: player.id,
    name: player.name,
    position: player.position,
    salary: player.salary,
    franchiseId: player.franchiseId,
    contractYears,
    teamName,
    nflTeam,
    icon,
    label,
    teamTokens,
    searchBlob,
    points: player.points ?? 0,
    draftYear: player.draftYear ?? null,
  };
});

const serializedConfig = JSON.stringify({
  positionKeys: extensionPositions.map(({ key }) => key),
  extensionSalaries,
  franchiseSalaries,
  salaryTabs,
  players: playerChoices,
});
---

<Layout title="Contract Tools">
  <section class="calculator">
    <div class="calculator__card" id="rookie-extension-calculator">
      <h1>Contract Tools</h1>

      <label class="field-label">Contract Type:</label>
      <div class="toggle-switch toggle-switch--grid">
        <input type="radio" id="franExt" name="extType" value="franchise" checked />
        <label for="franExt">Franchise Tag</label>
        <input type="radio" id="transExt" name="extType" value="transition" />
        <label for="transExt">Veteran Extension</label>
        <input type="radio" id="rookieExt" name="extType" value="rookie" />
        <label for="rookieExt">Rookie Extension</label>
      </div>

      <div class="player-actions">
        <label class="field-label" for="playerSearch">Find Player:</label>
        <button type="button" class="ghost-btn" id="clearPlayerBtn">Clear</button>
      </div>
      <div class="player-search-wrapper">
        <input
          type="text"
          id="playerSearch"
          class="player-search"
          placeholder="Start typing a name or team..."
          autocomplete="off"
        />
        <div class="player-suggestions hidden" id="playerSuggestions"></div>
      </div>
      <div class="player-details">
        <p class="field-hint">
          Selecting a player auto-fills the salary below. Manual overrides are available if needed.
        </p>
        <p class="selected-player hidden" id="selectedPlayerDisplay"></p>

        <details class="manual-salary" id="manualSalaryPanel">
          <summary>Need to override the salary?</summary>
          <div class="manual-salary__body">
            <label class="field-label" for="currentSalary">Enter Salary Manually:</label>
            <input
              type="text"
              id="currentSalary"
              class="currency-input"
              value="$1,500,000"
              placeholder="$0"
              inputmode="decimal"
            />
          </div>
        </details>
      </div>

      <label class="field-label">Position:</label>
      <div class="toggle-switch toggle-switch--compact" id="positionToggleGroup">
        {extensionPositions.map(({ key }) => (
          <>
            <input type="radio" id={`pos${key}`} name="position" value={key} checked={key === 'QB'} />
            <label for={`pos${key}`}>{key}</label>
          </>
        ))}
      </div>
      <p class="field-hint hidden" id="positionAutoMessage">
        Position locked to <strong id="positionAutoValue">QB</strong> from the selected player.
      </p>

      <div id="yearsContainer">
        <label class="field-label">Years Remaining:</label>
        <div class="toggle-switch toggle-switch--compact">
          {salaryTabs.map((years) => (
            <>
              <input type="radio" id={`yr${years}`} name="yearsRemaining" value={years} checked={years === 3} />
              <label for={`yr${years}`}>{years}</label>
            </>
          ))}
        </div>
      </div>
      <p class="field-hint hidden" id="yearsAutoMessage">
        Contract years remaining: <strong id="yearsAutoValue">0</strong>
      </p>

      <div id="extensionLengthContainer">
        <label class="field-label">Extension Length:</label>
        <div class="toggle-switch toggle-switch--compact">
          <input type="radio" id="ext1" name="extensionLength" value="1" />
          <label for="ext1">1 Yr</label>
          <input type="radio" id="ext2" name="extensionLength" value="2" checked />
          <label for="ext2">2 Yr</label>
        </div>
      </div>

      <button type="button" id="calculateBtn">Calculate</button>
      <div class="result" id="result">Use the calculator above, then generate your message here.</div>
    </div>

    <section class="salary-reference">
      <div class="salary-reference__panel">
        <h2>Extension Salaries<br />(Top 5)</h2>
        <p>Used for rookie and veteran extensions.</p>
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>Average Salary</th>
            </tr>
          </thead>
          <tbody>
            {extensionPositions.map(({ key, label }) => (
              <tr>
                <td>{label}</td>
                <td>{currencyFormatter.format(extensionSalaries[key] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div class="salary-reference__panel">
        <h2>Franchise Tag Salaries<br />(Top 3)</h2>
        <p>Franchise tags are locked to one-year deals.</p>
        <table>
          <thead>
            <tr>
              <th>Position</th>
              <th>Average Salary</th>
            </tr>
          </thead>
          <tbody>
            {extensionPositions.map(({ key, label }) => (
              <tr>
                <td>{label}</td>
                <td>{currencyFormatter.format(franchiseSalaries[key] ?? 0)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  </section>
</Layout>

<style>
  .calculator {
    padding: 4rem 1rem;
    display: grid;
    grid-template-columns: minmax(0, 2fr) minmax(240px, 1fr);
    gap: 1.5rem;
    background: #e7ebef;
  }

  .calculator__card {
    padding: 2rem;
    background: #fff;
    border-radius: 1rem;
    border: 1px solid #d7dce3;
    box-shadow: 0 18px 35px rgba(15, 23, 42, 0.12);
    display: grid;
    gap: 1rem;
    align-self: flex-start;
  }

  .calculator__card h1 {
    margin: 0;
    text-align: center;
    background: #0d3b78;
    color: #fff;
    padding: 0.85rem;
    border-radius: 0.75rem;
    font-size: 2.4rem;
    font-weight: 700;
    letter-spacing: 0.02em;
  }

  .field-label {
    font-weight: 600;
    margin-bottom: 0.15rem;
  }

  .currency-input {
    padding: 0.75rem;
    border: 1px solid #ccc;
    border-radius: 0.35rem;
    font-size: 1.15rem;
  }

  .player-search {
    padding: 0.65rem 0.85rem;
    border: 1px solid #ccd3df;
    border-radius: 0.5rem;
    font-size: 1rem;
    width: 100%;
    box-sizing: border-box;
  }

  .player-search::placeholder {
    color: #9ca3af;
  }

  .player-search-wrapper {
    position: relative;
  }

  .player-details {
    display: block;
  }

  .player-details.hidden {
    display: none;
  }

  .player-suggestions {
    position: absolute;
    top: calc(100% + 0.25rem);
    left: 0;
    right: 0;
    background: #fff;
    border: 1px solid #d1d5db;
    border-radius: 0.75rem;
    box-shadow: 0 12px 25px rgba(15, 23, 42, 0.12);
    max-height: 235px;
    overflow-y: auto;
    z-index: 5;
  }

  .player-suggestion {
    display: flex;
    align-items: center;
        gap: 0.75rem;
    padding: 0.5rem 0.85rem;
    cursor: pointer;
    border-bottom: 1px solid #f1f5f9;
    white-space: nowrap;
  }
  :global(.player-suggestion) {
    display: grid;
    grid-template-columns: 32px 1fr;
    width: 100%;
    align-items: center;
    justify-items: start;
    gap: 0.5rem;
    padding: 0.5rem 0.85rem;
    cursor: pointer;
    box-shadow: none;
    border: 1px solid #ddd;
    border-top: 0;
  }

  :global(.player-suggestion:last-child) {
    border-bottom: none;
  }

  :global(.player-suggestion:hover) {
    background: #f3f4f6;
  }

  :global(.player-suggestion__icon) {
    width: 32px;
    height: 32px;
    border-radius: 12px;
    object-fit: cover;
  }

  :global(.player-suggestion__details) {
    flex: 1;
    min-width: 0;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    font-size: 0.95rem;
    white-space: nowrap;
  }

  :global(.player-suggestion__name) {
    font-weight: 600;
    color: #0f172a;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  :global(.player-suggestion__meta) {
    color: #475569;
    font-weight: 500;
    white-space: nowrap;
    font-size: 0.9rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  :global(.player-suggestion__meta span) {
    white-space: nowrap;
  }

  :global(.player-suggestion__nfl-icon) {
    width: 1rem;
    height: 1rem;
    object-fit: contain;
  }

  :global(.player-suggestion.empty) {
    justify-content: flex-start;
    color: #6b7280;
    font-size: 0.9rem;
    white-space: normal;
    text-align: left;
    grid-template-columns: 1fr;
  }

  .field-hint {
    margin: 0.2rem 0 0.35rem;
    color: #6b7280;
    font-size: 0.85rem;
  }

  .player-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  .ghost-btn {
    background: transparent;
    color: #0d3b78;
    border: none;
    padding: 0.35rem 0.65rem;
    border-radius: 0.5rem;
    font-weight: 600;
    cursor: pointer;
  }

  .ghost-btn:hover {
    background: rgba(13, 59, 120, 0.08);
  }

  .selected-player {
    margin: 0;
    font-size: 0.9rem;
    font-weight: 600;
    color: #0f172a;
  }

  .manual-salary {
    border: 1px solid #d7dce3;
    border-radius: 0.65rem;
    padding: 0.5rem 0.85rem;
    background: #f8fafc;
  }

  .manual-salary summary {
    cursor: pointer;
    font-weight: 600;
    color: #0d3b78;
    outline: none;
  }

  .manual-salary__body {
    margin-top: 0.65rem;
    display: grid;
    gap: 0.4rem;
  }

  .toggle-switch {
    display: flex;
    border-radius: 1.6rem;
    background: #f7f8fb;
    border: 1px solid #d7dce3;
    padding: 0.25rem;
    gap: 0.25rem;
  }

  .toggle-switch input {
    display: none;
  }

  .toggle-switch label {
    flex: 1;
    text-align: center;
    padding: 0.5rem 0.25rem;
    border-radius: 1rem;
    cursor: pointer;
    font-weight: 600;
    color: #003366;
  }

  .toggle-switch input:checked + label {
    background: #238047;
    color: #fff;
    box-shadow: 0 10px 20px rgba(34, 197, 94, 0.25);
  }

  .toggle-switch--compact label {
    padding: 0.4rem 0.25rem;
  }

  button {
    background: #2f8a4d;
    color: #fff;
    border: none;
    padding: 0.95rem 1.5rem;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
    transition: all 0.2s ease;
    letter-spacing: 0.03em;
    font-size: 1rem;
  }

  button:hover {
    background: #1f6d39;
  }

  button:active {
    transform: translateY(1px);
  }

  #calculateBtn {
    width: 100%;
  }

  .hidden {
    display: none !important;
  }

  .result {
    padding: 0.75rem;
    border: 1px solid #d7dce3;
    border-radius: 0.35rem;
    box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.08);
    font-size: 0.95rem;
    background: #fff;
  }

  .bbcode {
    font-family: monospace;
    background: #1f2937;
    color: #d1d5db;
    padding: 0.75rem;
    border-radius: 0.35rem;
    margin-top: 0.5rem;
    white-space: pre-wrap;
  }

  .result-player {
    font-weight: 600;
    color: #0d3b78;
  }

  .salary-reference {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    align-self: flex-start;
  }

  .salary-reference__panel {
    background: #fff;
    border: 1px solid #d7dce3;
    border-radius: 0.9rem;
    padding: 1.25rem 1.5rem;
    box-shadow: 0 12px 24px rgba(15, 23, 42, 0.12);
  }

  .salary-reference__panel h2 {
    margin: 0 0 0.3rem;
  }

  .salary-reference__panel p {
    margin: 0 0 0.75rem;
    color: #555;
    font-size: 0.9rem;
  }

  .salary-reference table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.95rem;
  }

  .salary-reference th,
  .salary-reference td {
    padding: 0.35rem 0;
    border-bottom: 1px solid #eee;
  }

  .salary-reference td:last-child {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 600;
  }

  .toggle-switch--grid {
    flex-wrap: wrap;
  }

  @media (max-width: 1024px) {
    .calculator {
      grid-template-columns: 1fr;
    }

    .salary-reference {
      flex-direction: row;
      flex-wrap: wrap;
    }
  }

  @media (max-width: 640px) {
    .salary-reference {
      flex-direction: column;
    }
  }

  @media (max-width: 590px) {
    .toggle-switch--grid {
      padding: 0.4rem;
      gap: 0.35rem;
    }

    .toggle-switch--grid label {
      flex: 1 1 calc(50% - 0.35rem);
      border-radius: 0.6rem;
    }

    button {
      width: 100%;
    }
  }
</style>

<script
  type="application/json"
  id="calculator-config"
  set:html={serializedConfig}
></script>

<script type="module">
  const {
    positionKeys,
    extensionSalaries,
    franchiseSalaries,
    salaryTabs,
    players,
  } = JSON.parse(document.getElementById('calculator-config').textContent);

  const currencyFormatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  });

  const formatCurrency = (value) => {
    if (!Number.isFinite(value)) return '$0';
    return currencyFormatter.format(Math.round(value));
  };

  const parseCurrency = (value) => {
    if (!value) return 0;
    const numeric = parseFloat(value.replace(/[^\d.-]/g, ''));
    return Number.isNaN(numeric) ? 0 : numeric;
  };

  const formatInput = (input) => {
    input.value = formatCurrency(parseCurrency(input.value));
  };

  const playerLookupByLabel = new Map(
    players.map((player) => [player.label.toLowerCase(), player])
  );
  const playerLookupByName = new Map(
    players.map((player) => [player.name.toLowerCase(), player])
  );
  const playerById = new Map(players.map((player) => [player.id, player]));
  const playerSearchInput = document.getElementById('playerSearch');
  const currentSalaryInput = document.getElementById('currentSalary');
  const selectedPlayerDisplay = document.getElementById('selectedPlayerDisplay');
  const playerSuggestions = document.getElementById('playerSuggestions');
  const positionToggleGroup = document.getElementById('positionToggleGroup');
  const positionAutoMessage = document.getElementById('positionAutoMessage');
  const positionAutoValue = document.getElementById('positionAutoValue');
  const yearsContainer = document.getElementById('yearsContainer');
  const yearsAutoMessage = document.getElementById('yearsAutoMessage');
  const yearsAutoValue = document.getElementById('yearsAutoValue');
  const playerDetails = document.querySelector('.player-details');
  let selectedPlayer = null;
  let suppressManualSalaryUpdate = false;

  const sortPlayers = (list) =>
    [...list].sort(
      (a, b) =>
        (b.points ?? 0) - (a.points ?? 0) ||
        a.name.localeCompare(b.name)
    );

  const getEligiblePlayers = () => {
    const type = document.querySelector('input[name="extType"]:checked').value;
    let filtered = players;
    if (type === 'transition') {
      filtered = players.filter((player) =>
        [2, 3, 4].includes(player.contractYears ?? 0)
      );
    } else if (type === 'franchise') {
      filtered = players.filter((player) => (player.contractYears ?? 0) === 1);
    } else if (type === 'rookie') {
      filtered = players.filter((player) => (player.draftYear ?? 0) >= 2026);
    }
    return sortPlayers(filtered);
  };

  const updateSelectionUi = () => {
    const type = document.querySelector('input[name="extType"]:checked').value;
    if (selectedPlayer) {
      playerDetails?.classList.remove('hidden');
      positionToggleGroup?.classList.add('hidden');
      positionAutoMessage?.classList.remove('hidden');
      if (positionAutoValue) positionAutoValue.textContent = selectedPlayer.position;
      if (type === 'transition') {
        yearsAutoMessage?.classList.remove('hidden');
        if (yearsAutoValue)
          yearsAutoValue.textContent = selectedPlayer.contractYears ?? 0;
      } else {
        yearsAutoMessage?.classList.add('hidden');
      }
    } else {
      playerDetails?.classList.add('hidden');
      positionToggleGroup?.classList.remove('hidden');
      positionAutoMessage?.classList.add('hidden');
      yearsAutoMessage?.classList.add('hidden');
    }
  };

  const buildSuggestionMarkup = (playersToRender) =>
    playersToRender
      .map(
        (player) => `
        <button class="player-suggestion" type="button" data-player-id="${player.id}">
          ${
            player.icon
              ? `<img src="${player.icon}" alt="${player.teamName}" class="player-suggestion__icon" />`
              : '<div class="player-suggestion__icon"></div>'
          }
          <div class="player-suggestion__details">
            <span class="player-suggestion__name">${player.name} (${player.position})</span>
            <span class="player-suggestion__meta">
              <span>
                <img
                  src="https://www.mflscripts.com/ImageDirectory/script-images/nflTeamsvg_2/${player.nflTeam ||
                    'FA'}.svg"
                  alt="${player.nflTeam}"
                  class="player-suggestion__nfl-icon"
                />
              </span>
              <span>
                ${formatCurrency(player.salary)} • ${player.contractYears ?? 0} yr${
                  (player.contractYears ?? 0) === 1 ? '' : 's'
                }
              </span>
            </span>
          </div>
        </button>`
      )
      .join('');

  const updateSuggestions = () => {
    const eligiblePlayers = getEligiblePlayers();
    const query = playerSearchInput.value.trim().toLowerCase();
    const currentType = document.querySelector(
      'input[name="extType"]:checked'
    ).value;

    let matches = eligiblePlayers;
    let teamSpecific = false;

    if (query) {
      if (currentType !== 'rookie') {
        const teamMatches = eligiblePlayers.filter((player) =>
          (player.teamTokens ?? []).some((token) => token.includes(query))
        );
        if (teamMatches.length) {
          matches = teamMatches;
          teamSpecific = true;
        } else {
          matches = eligiblePlayers.filter((player) =>
            player.searchBlob.includes(query)
          );
        }
      } else {
        matches = eligiblePlayers.filter((player) =>
          player.searchBlob.includes(query)
        );
      }
    }

    const limit = query
      ? teamSpecific
        ? matches.length
        : 30
      : currentType === 'rookie'
        ? 30
        : 12;
    matches = matches.slice(0, limit);

    if (!matches.length) {
      const message =
        currentType === 'rookie'
          ? 'Only players drafted by their original team in 2026 and beyond are available.'
          : 'No eligible players';
      playerSuggestions.innerHTML = `<div class="player-suggestion empty" type="button">${message}</div>`;
      playerSuggestions.classList.remove('hidden');
      return eligiblePlayers;
    }

    playerSuggestions.innerHTML = buildSuggestionMarkup(matches);
    playerSuggestions.classList.remove('hidden');
    return eligiblePlayers;
  };

  const selectPositionRadio = (position) => {
    if (!position) return;
    const radio = document.getElementById(`pos${position}`);
    if (radio) {
      radio.checked = true;
    }
  };

  const setSelectedPlayer = (player) => {
    selectedPlayer = player;
    if (player) {
      suppressManualSalaryUpdate = true;
      currentSalaryInput.value = formatCurrency(player.salary);
      setTimeout(() => {
        suppressManualSalaryUpdate = false;
      }, 0);
      selectedPlayerDisplay.textContent = `Using salary for ${player.name} (${player.position})`;
      selectedPlayerDisplay.classList.remove('hidden');
      playerSearchInput.value = player.label;
      playerSuggestions.classList.add('hidden');
      selectPositionRadio(player.position);
    } else {
      selectedPlayerDisplay.classList.add('hidden');
      selectedPlayerDisplay.textContent = '';
    }
    updateSelectionUi();
  };

  const handlePlayerSelection = () => {
    const key = playerSearchInput.value.trim();
    if (!key) {
      setSelectedPlayer(null);
      return;
    }
    const normalized = key.toLowerCase();
    const player =
      playerLookupByLabel.get(normalized) ||
      playerLookupByName.get(normalized) ||
      null;
    setSelectedPlayer(player);
  };

  const toggleExtensionLength = () => {
    const container = document.getElementById('extensionLengthContainer');
    const type = document.querySelector('input[name="extType"]:checked').value;
    const showExtensionLength = type === 'transition';
    const showYears = type === 'rookie';
    container.classList.toggle('hidden', !showExtensionLength);
    yearsContainer.classList.toggle('hidden', !showYears);
    if (type === 'rookie') {
      document.getElementById('ext2').checked = true;
    }
    const eligiblePlayers = updateSuggestions();
    if (
      selectedPlayer &&
      !eligiblePlayers.some((player) => player.label === selectedPlayer.label)
    ) {
      setSelectedPlayer(null);
      playerSearchInput.value = '';
    }
    updateSelectionUi();
  };

  const getReferenceSalary = (position, type) => {
    if (type === 'franchise') return franchiseSalaries[position] ?? 0;
    return extensionSalaries[position] ?? 0;
  };

  const calculateExtension = () => {
    const salary = parseCurrency(currentSalaryInput.value);
    const selectedYearsInput = Number(
      document.querySelector('input[name="yearsRemaining"]:checked')?.value ?? 0
    );
    let yearsRemaining = selectedYearsInput;
    const position = document.querySelector('input[name="position"]:checked').value;
    const extensionType = document.querySelector('input[name="extType"]:checked').value;
    const extensionLength =
      extensionType === 'rookie'
        ? 2
        : extensionType === 'franchise'
          ? 1
          : Number(document.querySelector('input[name="extensionLength"]:checked').value);
    let avgSalary = getReferenceSalary(position, extensionType);
    let referenceLabel = 'Top Average';

    if (extensionType === 'transition') {
      yearsRemaining = selectedPlayer?.contractYears ?? yearsRemaining ?? 0;
      if (!yearsRemaining) {
        yearsRemaining = 2;
      }
    }

    if (extensionType === 'franchise') {
      const increaseSalary = salary * 1.2;
      const appliedSalary = Math.max(increaseSalary, avgSalary);
      avgSalary = appliedSalary;
      referenceLabel =
        appliedSalary === increaseSalary ? '20% Increase' : 'Top Average';
    }

    let newSalary = 0;
    let totalYears = extensionLength;
    if (extensionType === 'franchise') {
      totalYears = 1;
      newSalary = Math.round(avgSalary);
    } else {
      const totalExtensionValue = avgSalary * extensionLength;
      const baseYears = yearsRemaining;
      totalYears = baseYears + extensionLength;
      newSalary = Math.round(
        salary + totalExtensionValue / Math.max(totalYears, 1)
      );
    }
    const label =
      extensionType === 'franchise'
        ? 'Franchise Tag'
        : extensionType === 'rookie'
          ? 'Rookie Extension'
          : 'Transition Extension';
    const playerNameLabel = selectedPlayer?.name
      ? `${selectedPlayer.name} (${selectedPlayer.position})`
      : 'Player';

    const bbcode = `[b]${playerNameLabel}[/b]
[b]${label}[/b]
Position: ${position}
Term: ${extensionLength} year(s)
New Salary: ${formatCurrency(newSalary)}
Total Contract Length: ${totalYears} years
Reference: ${referenceLabel}`;

    const result = document.getElementById('result');
    result.innerHTML = `
      <strong>Results:</strong><br/>
      <span class="result-player">${playerNameLabel}</span><br/>
      New Salary: ${formatCurrency(newSalary)}<br/>
      Total Contract Length: ${totalYears} years<br/>
      Reference Salary Used: ${formatCurrency(avgSalary)} (${referenceLabel})
      <div class="bbcode" id="bbcodeOutput">${bbcode}</div>
      <button type="button" id="copyBtn">Copy Message Board Post</button>
    `;

    document.getElementById('copyBtn').addEventListener('click', () => {
      navigator.clipboard
        .writeText(bbcode)
        .then(() => alert('BBCode copied!'))
        .catch(() => alert('Unable to copy BBCode.'));
    });
  };

  document.addEventListener('DOMContentLoaded', () => {
    updateSuggestions();
    toggleExtensionLength();
    document.querySelectorAll('.currency-input').forEach((input) => {
      input.addEventListener('blur', () => formatInput(input));
    });

    playerSearchInput.addEventListener('change', handlePlayerSelection);
    playerSearchInput.addEventListener('blur', () => {
      handlePlayerSelection();
      setTimeout(() => playerSuggestions.classList.add('hidden'), 120);
    });
    playerSearchInput.addEventListener('focus', () => {
      playerSearchInput.select();
      updateSuggestions();
    });
    playerSearchInput.addEventListener('input', () => {
      updateSuggestions();
      const currentValue = playerSearchInput.value.trim();
      if (!currentValue) {
        setSelectedPlayer(null);
      } else if (selectedPlayer && currentValue !== selectedPlayer.label) {
        setSelectedPlayer(null);
      }
    });

    document.getElementById('clearPlayerBtn').addEventListener('click', () => {
      playerSearchInput.value = '';
      setSelectedPlayer(null);
      playerSearchInput.focus();
      updateSuggestions();
    });

    currentSalaryInput.addEventListener('input', () => {
      if (suppressManualSalaryUpdate) return;
      setSelectedPlayer(null);
      playerSearchInput.value = '';
    });

    document.querySelectorAll('input[name="extType"]').forEach((radio) => {
      radio.addEventListener('change', toggleExtensionLength);
    });

    document.getElementById('calculateBtn').addEventListener('click', calculateExtension);

    playerSuggestions.addEventListener('mousedown', (event) => event.preventDefault());
    playerSuggestions.addEventListener('click', (event) => {
      const target = event.target.closest('[data-player-id]');
      if (!target) return;
      const player = playerById.get(target.dataset.playerId);
      if (player) {
        setSelectedPlayer(player);
      }
    });
  });
</script>
  .player-details {
    display: none;
  }
