import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  getAllImports,
  migrateFromLegacyKeys,
  initFromServer,
  syncBuiltinImports,
} from '../../../utils/rankings-storage';
import type {
  BookmarkletSiteConfig,
  MFLPlayerForMatching,
  StoredRankingImport,
} from '../../../types/rankings-import';
import BookmarkletSection from './BookmarkletSection';
import ImportSection from './ImportSection';
import ManageImportsSection from './ManageImportsSection';

interface Props {
  mflPlayersJson: string;
  siteConfigsJson: string;
  isAdmin?: boolean;
  /**
   * Prefixed internal route to this league's Custom Rankings board, or null
   * when the league has none (best-ball leagues only consume the imports).
   * Resolved by the Astro page — this island can't know which league it's on,
   * and a hardcoded `/theleague/cr` here sent AFL admins to the wrong board.
   */
  customRankingsHref?: string | null;
  /**
   * The build-time snapshot of built-in ranking sources, as JSON. Reconciled
   * into the owner's store on mount so ESPN, FantasyCalc, Sleeper, MFL ADP and
   * FantasySharks are present without anyone importing anything — which is
   * what replaced the old one-click import cards.
   */
  builtinSnapshotJson?: string | null;
  /**
   * Built-in source ids this league ticks on by default (registry-driven).
   * Every source is still available and selectable — see syncBuiltinImports.
   */
  defaultSourceIds?: string[];
}

export default function RankingsImportPage({
  mflPlayersJson,
  siteConfigsJson,
  isAdmin = false,
  customRankingsHref = null,
  builtinSnapshotJson = null,
  defaultSourceIds = [],
}: Props) {
  const mflPlayers: MFLPlayerForMatching[] = useMemo(() => {
    try { return JSON.parse(mflPlayersJson); } catch { return []; }
  }, [mflPlayersJson]);

  const siteConfigs: BookmarkletSiteConfig[] = useMemo(() => {
    try { return JSON.parse(siteConfigsJson); } catch { return []; }
  }, [siteConfigsJson]);

  const [savedImports, setSavedImports] = useState<StoredRankingImport[]>(() => {
    migrateFromLegacyKeys();
    return getAllImports();
  });

  useEffect(() => {
    // Reconcile the built-in sources FIRST so a first-time owner sees a full
    // board immediately, then let the server sync layer bring in their own
    // imports. Both are no-ops when nothing changed.
    let snapshot = null;
    try {
      snapshot = builtinSnapshotJson ? JSON.parse(builtinSnapshotJson) : null;
    } catch {
      snapshot = null;
    }
    // The snapshot is id+rank only; the island already holds the league's
    // player list, so hand it over to fill in name/position/team.
    const meta = new Map(
      mflPlayers.map((p) => [p.id, { name: p.name, position: p.position, team: p.team }]),
    );
    syncBuiltinImports(snapshot, defaultSourceIds, meta);
    setSavedImports(getAllImports());

    // Sync with server (Redis) for cross-device access
    initFromServer().then((updated) => {
      if (updated) setSavedImports(getAllImports());
    });
  }, [builtinSnapshotJson, defaultSourceIds, mflPlayers]);

  const handleImportComplete = useCallback((newImport: StoredRankingImport) => {
    setSavedImports(getAllImports());
  }, []);

  const handleDelete = useCallback((id: string) => {
    setSavedImports(getAllImports());
  }, []);

  const handleReorder = useCallback(() => {
    setSavedImports(getAllImports());
  }, []);

  return (
    <div className="ri-page">
      <div className="ri-page__header">
        <h1 className="ri-page__title">Import Rankings</h1>
        {isAdmin && customRankingsHref && (
          <p className="ri-page__subtitle">
            <a href={customRankingsHref} className="ri-page__link">Custom Rankings</a>
          </p>
        )}
      </div>

      {savedImports.length > 0 && (
        <ManageImportsSection imports={savedImports} onDelete={handleDelete} onReorder={handleReorder} />
      )}
      <BookmarkletSection siteConfigs={siteConfigs} />
      <ImportSection mflPlayers={mflPlayers} onImportComplete={handleImportComplete} />
    </div>
  );
}
