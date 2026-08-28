// Render the modal with NO preview props via the Astro Container API and
// compare against the same render from the pre-refactor source.
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import Current from './src/components/theleague/PlayerDetailsModal.astro';

const c = await AstroContainer.create();
const html = await c.renderToString(Current, { props: {} });
const htmlHide = await c.renderToString(Current, { props: { hideContract: true } });
console.log('--- default render, no preview ---');
console.log('length:', html.length);
console.log('has active class:', /player-details-modal[^"]*active/.test(html));
console.log('em dashes:', (html.match(/—|&#8212;|&mdash;/g)||[]).length);
console.log('pdm-owner hidden:', /id="pdm-owner"[^>]*display: ?none/.test(html));
console.log('ids present:', (html.match(/id="/g)||[]).length);
console.log('--- hideContract render ---');
console.log('contract card absent:', !htmlHide.includes('metric-card-contract'));
