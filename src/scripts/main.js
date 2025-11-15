import { fixFranchiseIcons } from './features/franchiseIcons.js';
import { fixPlayoffTableLabels } from './features/projected-playoff.js';

const FRANCHISE_ICON_EXCLUSIONS = ['body_ajax_ls', 'body_add_drop', 'body_lineup'];

const MOBILE_FRANCHISE_ICON_EXCLUSIONS = ['body_standings'];

const isMobileContext = () => {
  if (typeof window === 'undefined') return false;
  if (navigator?.userAgentData?.mobile) return true;
  const ua = navigator?.userAgent || '';
  if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(ua)) {
    return true;
  }
  if (window.matchMedia) {
    return window.matchMedia('(max-width: 768px)').matches;
  }
  return typeof window.innerWidth === 'number' && window.innerWidth <= 768;
};

const revealFranchiseIcons = (scope = document) => {
  if (!scope) return;
  scope.querySelectorAll('img.franchiseicon').forEach(img => {
    img.style.opacity = '1';
  });
};

const FRANCHISE_ICON_SCOPES = {
  body_options_207: [
    {
      selector: '.recap_preview_players'
    },
    {
      selector: '.recap_preview_writeup',
      options: {
        imageStyles: {
          maxHeight: '25px',
          position: 'relative',
          top: '-5px'
        }
      }
    },
  ],
};

document.addEventListener('DOMContentLoaded', () => {
  const bodyId = document.body?.id;
  const skipForMobile =
    bodyId &&
    MOBILE_FRANCHISE_ICON_EXCLUSIONS.includes(bodyId) &&
    isMobileContext();
  const skipFranchiseIcons =
    (bodyId && FRANCHISE_ICON_EXCLUSIONS.includes(bodyId)) ||
    skipForMobile;

  const scopeConfigs = bodyId ? FRANCHISE_ICON_SCOPES[bodyId] : undefined;

  //
  // --------------------------
  // Franchise Icon Replacement
  // --------------------------
  //
  if (skipFranchiseIcons) {
    revealFranchiseIcons();
  } else {
    // If page has special scope rules
    if (Array.isArray(scopeConfigs) && scopeConfigs.length > 0) {
      scopeConfigs.forEach(({ selector, options }) => {
        // Safety: only process if selector exists
        if (selector) {
          document.querySelectorAll(selector).forEach(scope => {
            if (scope?.querySelector('img.franchiseicon')) {
              fixFranchiseIcons(scope, options);
            }
          });
        } else {
          // No selector = full page scan
          if (document.querySelector('img.franchiseicon')) {
            fixFranchiseIcons(document, options);
          }
        }
      });
    }

    // No special configs → run on full page
    else if (document.querySelector('img.franchiseicon')) {
      fixFranchiseIcons();
    }
  }

  //
  // --------------------------
  // Projected Playoff Table Fix
  // --------------------------
  //
  fixPlayoffTableLabels();

  //
  // Future features:
  // if (document.querySelector('#standings')) highlightStandings();
});
