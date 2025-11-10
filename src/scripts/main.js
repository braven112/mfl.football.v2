import { fixFranchiseIcons } from './features/franchiseIcons.js';

const FRANCHISE_ICON_EXCLUSIONS = ['body_ajax_ls', 'body_add_drop'];
const FRANCHISE_ICON_SCOPES = {
  body_options_207: [
    { selector: '.recap_preview_players' },
    { selector: '.recap_preview_writeup', options: { imageStyles: { maxHeight: '25px', position: 'relative', top: '-5px' } } },
  ],
};

document.addEventListener('DOMContentLoaded', () => {
  const bodyId = document.body?.id;
  const skipFranchiseIcons = bodyId && FRANCHISE_ICON_EXCLUSIONS.includes(bodyId);
  const scopeConfigs = bodyId ? FRANCHISE_ICON_SCOPES[bodyId] : undefined;

  if (!skipFranchiseIcons) {
    if (Array.isArray(scopeConfigs) && scopeConfigs.length) {
      scopeConfigs.forEach(({ selector, options }) => {
        if (selector) {
          document.querySelectorAll(selector).forEach((scope) => {
            if (scope?.querySelector('img.franchiseicon')) {
              fixFranchiseIcons(scope, options);
            }
          });
        } else if (document.querySelector('img.franchiseicon')) {
          fixFranchiseIcons(document, options);
        }
      });
    } else if (document.querySelector('img.franchiseicon')) {
      fixFranchiseIcons();
    }
  }
  // Future features:
  // if (document.querySelector('#standings')) highlightStandings();
});
