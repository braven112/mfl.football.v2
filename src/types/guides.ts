/**
 * Guides — the how-to pages behind the weekly changelog.
 *
 * WHY THESE EXIST. What's New used to carry both jobs: telling you a feature
 * shipped AND explaining how to use it. That made every announcement long
 * enough that nobody read it, and made the explanation unfindable a month
 * later when somebody actually wanted it — buried in a dated article about a
 * week that no longer mattered.
 *
 * The split: the Monday changelog says WHAT changed, in one line. A guide says
 * HOW to use it, is undated in spirit (`updated` is a freshness marker, not a
 * headline), and is written once and edited forever. A guide is the thing a
 * changelog line links to when a reader cares enough to click.
 *
 * Bodies reuse What's New's `DescriptionBlock` union deliberately: the same
 * prose / screenshot / bullet-list vocabulary, and — more importantly — the
 * same link guards. Every anchor in a guide is league-neutral and rewritten
 * per reader by `rewriteDescriptionLinks`, exactly as in an article.
 */

import type { DescriptionBlock } from './whats-new';
import type { LeagueSlug } from './nav';

/** One how-to page, served at /guides/{slug}. */
export interface GuideEntry {
  /** URL segment (kebab-case). Unique across the file. */
  slug: string;
  /** Page title and index-card headline. */
  title: string;
  /** One line on the index card and under the title. */
  summary: string;
  /**
   * Body blocks — prose, screenshots, bullet lists. Same union What's New
   * articles use, with ONE difference that matters: image `src` resolves
   * against `/assets/guides/`, not `/assets/whats-new/`. A guide's screenshots
   * are the point of the page and outlive the week's announcement, so they get
   * their own directory rather than accumulating in the changelog's.
   */
  body: DescriptionBlock[];
  /**
   * The page this guide is about — a league-neutral path (`/sunday-ticket`),
   * rendered as the "Open it" CTA. Written neutral for the same reason inline
   * hrefs are: one guide body serves every league it is tagged for.
   */
  featurePath?: string;
  /** Label for the CTA. Defaults to "Open it". */
  featureLabel?: string;
  /** Icon ID from sprite.svg, without the "icon-" prefix. */
  icon?: string;
  /** Last meaningful edit (YYYY-MM-DD). Shown as a freshness marker. */
  updated: string;
  /**
   * League scope — REQUIRED, and fails closed exactly like a What's New entry:
   * a missing, empty or misspelled value shows the guide in NO league rather
   * than leaking it into one it does not apply to.
   */
  leagues: LeagueSlug[];
  /** Audience restriction. Defaults to "all". */
  visibility?: 'all' | 'admin';
}

/** Is this guide visible in the given league? Fails closed on a bad tag. */
export function guideAppliesToLeague(guide: GuideEntry, league: LeagueSlug): boolean {
  if (!guide.leagues || guide.leagues.length === 0) return false;
  return guide.leagues.includes(league);
}
