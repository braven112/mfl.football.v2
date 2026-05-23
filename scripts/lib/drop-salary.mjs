/**
 * Resolve the contract salary of dropped players from MFL salary adjustments.
 *
 * A FREE_AGENT drop transaction ("|playerId,") carries no salary, but MFL logs
 * a matching salary adjustment whose description embeds the dropped player's
 * contract salary, e.g.:
 *   "Dropped Thornton, Tyquan KCC WR (Salary: $1,100,000, Years: 4)"
 *
 * We index those by `${timestamp}_${franchiseId}` (a bulk drop shares one
 * timestamp, so each bucket is an array) and match each dropped playerId to its
 * adjustment by player name — the description embeds "Last, First" exactly as
 * it appears in players.json.
 */

/**
 * Index "Dropped …" adjustments by `${timestamp}_${franchiseId}`.
 * @returns {Map<string, Array<{ name: string|null, salary: number }>>}
 */
export function buildDropAdjustmentMap(adjustments) {
  const map = new Map();
  for (const a of adjustments ?? []) {
    const desc = a?.description ?? '';
    if (!/dropped/i.test(desc)) continue;
    const salMatch = desc.match(/Salary:\s*\$([\d,]+)/i);
    if (!salMatch) continue;
    const salary = parseInt(salMatch[1].replace(/,/g, ''), 10);
    if (!Number.isFinite(salary)) continue;
    const nameMatch = desc.match(/^Dropped\s+(.+?)\s+[A-Z]{2,3}\s+[A-Za-z/]+\s+\(Salary:/i);
    const name = nameMatch ? nameMatch[1].trim() : null;
    const key = `${a.timestamp}_${a.franchise_id}`;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push({ name, salary });
  }
  return map;
}

/**
 * Resolve the priciest dropped player's salary for a transaction.
 * @param {{ timestamp: string, franchise: string }} raw
 * @param {string[]} droppedIds
 * @param {Map<string, { name?: string }>} players  playerId → info
 * @param {Map} dropAdjustmentMap  from buildDropAdjustmentMap
 * @returns {{ playerId: string, salary: number } | null}
 */
export function resolveDropSalary(raw, droppedIds, players, dropAdjustmentMap) {
  const bucket = dropAdjustmentMap.get(`${raw.timestamp}_${raw.franchise}`) ?? [];
  if (bucket.length === 0) return null;

  let best = null;
  for (const id of droppedIds) {
    const name = players.get(id)?.name;
    const match = name
      ? bucket.find(b => b.name === name) ?? bucket.find(b => b.name && name.includes(b.name))
      : undefined;
    const salary = match ? match.salary : undefined;
    if (salary != null && (!best || salary > best.salary)) {
      best = { playerId: id, salary };
    }
  }

  // Single-drop fallback: name matching failed but the bucket has exactly one
  // entry — attribute it to the lone dropped player.
  if (!best && droppedIds.length === 1 && bucket.length === 1) {
    best = { playerId: droppedIds[0], salary: bucket[0].salary };
  }
  return best;
}
