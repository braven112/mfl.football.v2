/**
 * Nothing that renders a body-only element may sit inside a layout's <head>.
 *
 * The HTML parser only allows metadata in <head>. The first unknown element it
 * meets there (a custom element such as <vercel-speed-insights>) ends <head>
 * on the spot and opens <body>, so everything after it — including the
 * stylesheets Astro injects just before </head> — is parsed into <body>. Those
 * are no longer render-blocking, and every page paints unstyled for a moment
 * (a full-size logo, then the CSS lands). That shipped in Oct 2026 when
 * <SpeedInsights /> went into four layouts' <head>.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(__dirname, '..');

function astroFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...astroFiles(p));
    else if (name.endsWith('.astro')) out.push(p);
  }
  return out;
}

/** Components known to render a body-only element. */
const BODY_ONLY_COMPONENTS = ['SpeedInsights'];

function headOffenders(src: string): string[] {
  const open = src.search(/<head[\s>]/);
  if (open === -1) return [];
  const close = src.indexOf('</head>', open);
  if (close === -1) return [];
  const head = src.slice(open, close);
  const found: string[] = [];
  for (const m of head.matchAll(/<([a-z][a-z0-9]*-[a-z0-9-]*)[\s>/]/g)) found.push(`<${m[1]}>`);
  for (const name of BODY_ONLY_COMPONENTS) {
    if (new RegExp(`<${name}[\\s/>]`).test(head)) found.push(`<${name} />`);
  }
  return found;
}

describe('<head> holds no body-only elements', () => {
  it('detects a custom element and SpeedInsights inside <head>', () => {
    expect(headOffenders('<head><title>x</title><SpeedInsights /></head>')).toEqual(['<SpeedInsights />']);
    expect(headOffenders('<head><my-widget></my-widget></head>')).toEqual(['<my-widget>']);
    expect(headOffenders('<head><title>x</title></head><body><SpeedInsights /></body>')).toEqual([]);
  });

  it('no .astro file under src/ renders one in <head>', () => {
    const offenders = astroFiles(join(ROOT, 'src'))
      .map((f) => ({ file: relative(ROOT, f), tags: headOffenders(readFileSync(f, 'utf8')) }))
      .filter((o) => o.tags.length > 0)
      .map((o) => `${o.file}: ${o.tags.join(', ')}`);
    expect(offenders).toEqual([]);
  });
});
