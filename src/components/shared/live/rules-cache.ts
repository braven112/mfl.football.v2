/**
 * Each league's MFL scoring rules, loaded once per (league, year) per page
 * life. Shared by the stat sheet (itemized breakdown) and the board's ESPN
 * overlay (newest score), so both read the same request.
 */
import { useEffect, useState } from 'react';
import type { LiveScoringRulesResponse, PositionRuleSet } from '../../../utils/live/scoring-rules';

/** A FAILED read is dropped from the cache so the next ask retries — never pin a failure. */
const rulesCache = new Map<string, Promise<LiveScoringRulesResponse>>();

export function loadRules(leagueId: string, year: number): Promise<LiveScoringRulesResponse> {
  const key = `${leagueId}:${year}`;
  let hit = rulesCache.get(key);
  if (!hit) {
    const failed: LiveScoringRulesResponse = { ok: false, leagueId, year: String(year), rules: null };
    hit = fetch(
      `/api/live-scoring-rules?L=${encodeURIComponent(leagueId)}&year=${encodeURIComponent(String(year))}`,
      { headers: { Accept: 'application/json' } },
    )
      .then((res) => res.json())
      // `res.ok` is not "the data is good" — gate on the flag.
      .then((data: LiveScoringRulesResponse) => (data && data.ok === true ? data : failed))
      .catch(() => failed)
      .then((data) => {
        if (!data.ok) rulesCache.delete(key);
        return data;
      });
    rulesCache.set(key, hit);
  }
  return hit;
}

/**
 * Rules for every league in `leagueIds`, keyed by league id. A league whose
 * rules have not loaded (or failed) is simply absent. `enabled: false` loads
 * nothing.
 */
export function useLeagueRules(
  leagueIds: readonly string[],
  year: number,
  enabled: boolean,
): ReadonlyMap<string, PositionRuleSet[]> {
  const [byLeague, setByLeague] = useState<ReadonlyMap<string, PositionRuleSet[]>>(() => new Map());
  const key = enabled ? [...new Set(leagueIds)].sort().join(',') : '';

  useEffect(() => {
    if (!key) return;
    let cancelled = false;
    for (const leagueId of key.split(',')) {
      loadRules(leagueId, year).then((data) => {
        if (cancelled || !data.ok || !data.rules) return;
        const rules = data.rules;
        setByLeague((prev) => {
          if (prev.get(leagueId) === rules) return prev;
          const next = new Map(prev);
          next.set(leagueId, rules);
          return next;
        });
      });
    }
    return () => {
      cancelled = true;
    };
  }, [key, year]);

  return byLeague;
}
