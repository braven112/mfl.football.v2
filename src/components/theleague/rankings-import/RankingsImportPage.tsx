import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAllImports, migrateFromLegacyKeys, initFromServer } from '../../../utils/rankings-storage';
import type {
  BookmarkletSiteConfig,
  MFLPlayerForMatching,
  StoredRankingImport,
} from '../../../types/rankings-import';
import BookmarkletSection from './BookmarkletSection';
import ImportSection from './ImportSection';
import ManageImportsSection from './ManageImportsSection';
import SleeperDirectImport from './SleeperDirectImport';
import FantasyCalcDirectImport from './FantasyCalcDirectImport';
import EspnDirectImport from './EspnDirectImport';

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
  /** League year to pull season-scoped source data for (see EspnDirectImport). */
  seasonYear: number;
}

export default function RankingsImportPage({
  mflPlayersJson,
  siteConfigsJson,
  isAdmin = false,
  customRankingsHref = null,
  seasonYear,
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
    setSavedImports(getAllImports());
    // Sync with server (Redis) for cross-device access
    initFromServer().then((updated) => {
      if (updated) setSavedImports(getAllImports());
    });
  }, []);

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
      <div className="ri-direct-import-grid">
        <FantasyCalcDirectImport mflPlayers={mflPlayers} onImportComplete={handleImportComplete} />
        <EspnDirectImport mflPlayers={mflPlayers} onImportComplete={handleImportComplete} seasonYear={seasonYear} />
        <SleeperDirectImport mflPlayers={mflPlayers} onImportComplete={handleImportComplete} />
      </div>
      <BookmarkletSection siteConfigs={siteConfigs} />
      <ImportSection mflPlayers={mflPlayers} onImportComplete={handleImportComplete} />
    </div>
  );
}
