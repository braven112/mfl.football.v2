import navConfig from '../src/config/nav-config.json';
import { describeSpriteIconValidation, type SpriteIconRef } from './helpers/sprite-icons';

/**
 * Nav Config Sprite Icon Validation
 *
 * NavLinks.astro renders `<use href="${spriteUrl}#icon-${icon}">` for every
 * drawer link (using `iconAFL` over `icon` on AFL), and NavFooter.astro does
 * the same for footer links — so every icon value in nav-config.json must be
 * a bare glyph name that exists in sprite.svg. A prefixed or unknown value
 * silently renders a blank icon in the nav.
 */

interface NavLink {
  id: string;
  icon?: string;
  iconAFL?: string;
}
interface NavConfig {
  sections: { id: string; links: NavLink[] }[];
  footerLinks: NavLink[];
}

const nav = navConfig as unknown as NavConfig;

const refs: SpriteIconRef[] = [];
for (const section of nav.sections) {
  for (const link of section.links) {
    refs.push({ source: `${section.id}/${link.id} (icon)`, icon: link.icon });
    if (link.iconAFL !== undefined) {
      refs.push({ source: `${section.id}/${link.id} (iconAFL)`, icon: link.iconAFL });
    }
  }
}
for (const link of nav.footerLinks) {
  refs.push({ source: `footerLinks/${link.id}`, icon: link.icon });
}

describeSpriteIconValidation('nav-config.json', refs);
