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
import CustomBookmarkletGuide from './CustomBookmarkletGuide';

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

  // Read from localStorage synchronously on first render so the layout
  // is correct immediately — no flash of wrong section order.
  const [savedImports, setSavedImports] = useState<StoredRankingImport[]>(() => {
    migrateFromLegacyKeys();
    return getAllImports();
  });

  // Re-read on mount in case migration changed anything
  useEffect(() => {
    setSavedImports(getAllImports());
  }, []);

  const handleImportComplete = useCallback((newImport: StoredRankingImport) => {
    setSavedImports(getAllImports());
  }, []);

  const handleDelete = useCallback((id: string) => {
    setSavedImports(getAllImports());
  }, []);

  const hasImports = savedImports.length > 0;

  return (
    <div className="ri-page">
      <div className="ri-page__header">
        <h1 className="ri-page__title">Import Rankings</h1>
        <p className="ri-page__subtitle">
          Import player rankings from your favorite fantasy football sites.
          All data is stored privately in your browser — never shared with other league members.
        </p>
      </div>

      {/* When imports exist: manage first, bookmarklets last.
          CSS flex order ensures layout swaps without unmounting components. */}
      <div className="ri-page__sections" style={{ display: 'flex', flexDirection: 'column' }}>
        {hasImports && (
          <div style={{ order: 0 }}>
            <ManageImportsSection imports={savedImports} onDelete={handleDelete} />
          </div>
        )}
        <div style={{ order: 1 }}>
          <ImportSection mflPlayers={mflPlayers} onImportComplete={handleImportComplete} />
        </div>
        <div style={{ order: hasImports ? 2 : 0 }}>
          <BookmarkletSection siteConfigs={siteConfigs} />
        </div>
      </div>
      <CustomBookmarkletGuide />
    </div>
  );
}
