import { fixFranchiseIcons } from './features/franchiseIcons.js';

const FRANCHISE_ICON_EXCLUSIONS = ['body_ajax_ls'];

document.addEventListener('DOMContentLoaded', () => {
  const bodyId = document.body?.id;
  const skipFranchiseIcons = bodyId && FRANCHISE_ICON_EXCLUSIONS.includes(bodyId);

  if (!skipFranchiseIcons && document.querySelector('img.franchiseicon')) {
    fixFranchiseIcons();
  }
  // Future features:
  // if (document.querySelector('#standings')) highlightStandings();
});
