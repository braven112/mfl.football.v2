import { fixFranchiseIcons } from './features/franchiseIcons.js';

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('img.franchiseicon')) {
    fixFranchiseIcons();
  }
  // Future features:
  // if (document.querySelector('#standings')) highlightStandings();
});
