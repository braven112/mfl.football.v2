import { useState, useEffect, useCallback, useMemo } from 'react';
import { getAllImports, migrateFromLegacyKeys } from '../../../utils/rankings-storage';
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

interface Props {
  mflPlayersJson: string;
  siteConfigsJson: string;
}

export default function RankingsImportPage({ mflPlayersJson, siteConfigsJson }: Props) {
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
        <p className="ri-page__subtitle">
          Import player rankings from your favorite fantasy football sites.
          All data is stored privately in your browser — never shared with other league members.
        </p>
      </div>

      {savedImports.length > 0 && (
        <ManageImportsSection imports={savedImports} onDelete={handleDelete} onReorder={handleReorder} />
      )}
      <div className="ri-direct-import-grid">
        <FantasyCalcDirectImport mflPlayers={mflPlayers} onImportComplete={handleImportComplete} />
        <SleeperDirectImport mflPlayers={mflPlayers} onImportComplete={handleImportComplete} />
      </div>
      <BookmarkletSection siteConfigs={siteConfigs} />
      <ImportSection mflPlayers={mflPlayers} onImportComplete={handleImportComplete} />
    </div>
  );
}
