import { activeSeasonalTheme, SURFACE_SEASONAL_THEMES } from '../config/seasonal-themes.mjs';
import { getTestDateFromSearchParams } from './league-year';

/**
 * The seasonal theme MFL Live wears for this request, or null. One resolution
 * for the layout's <html data-season> and the pages that add seasonal content
 * of their own (the /live header's Halloween cards), so the cards appear
 * exactly when the scene behind them does. ?testDate= / ?seasonPreview=
 * preview it, as on the league sites.
 */
export function mflLiveSeason(url: URL, seasonPreview: string | undefined) {
  return activeSeasonalTheme(
    SURFACE_SEASONAL_THEMES.mfl,
    getTestDateFromSearchParams(url.searchParams) ?? new Date(),
    seasonPreview,
  );
}
