/**
 * Who can read the product pages (`/products`, on the shared host).
 *
 * The pages describe the commercial lineup planned for the 2027 season
 * (Owner Suite, League History, League Hub, League Package, Contest Package).
 * Nothing on them is for sale yet — the product name, the data licensing and
 * the business setup all have to land first — so until launch they are shown
 * to ONE seat: the same one `/live/analytics` admits (`canViewSiteInsights`).
 * Everyone else gets the site's 404; the pages do not admit to existing.
 *
 * Launch is this one constant. Flip it to `true` and every product page opens
 * to the public — then give each one a page-directory entry, which is left out
 * until then for the same reason `/live/analytics` has none: search would list
 * a page the reader cannot open.
 *
 * ONLY THE CUSTOMER-FACING HALF LIVES IN THIS REPOSITORY. The repo is public,
 * so costs, margins, build status and client names belong in the business
 * plan doc, never in `src/data/products.ts` (the same reason
 * `src/utils/private-doc.ts` keeps the proposal in Redis).
 * `tests/product-pages.test.ts` scans the product data for the obvious leaks.
 */
import type { AuthUser } from './auth';
import { canViewSiteInsights } from './site-insights';

/** Flip at launch. While false, only the site owner's seat sees the pages. */
export const PRODUCT_PAGES_PUBLIC = false;

export function canViewProductPages(user: AuthUser | null | undefined): boolean {
	return PRODUCT_PAGES_PUBLIC || canViewSiteInsights(user);
}
