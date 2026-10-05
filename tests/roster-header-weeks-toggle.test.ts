/**
 * The phone "Last & next game" toggle must bind its click listener ONCE.
 *
 * The build inlines GamedayBar's small script once per rendered header, and
 * the rosters page renders a header per team — 16 copies in TheLeague. With no
 * guard, 16 listeners flipped the toggle 16 times per tap, back to collapsed,
 * so the button did nothing on staging while dev (one deduped module) worked
 * (user, 2026-09-27).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync('src/components/shared/roster-header/GamedayBar.astro', 'utf8');
// The component's one client script, between its opening and closing tags.
const scriptStart = source.indexOf('<script>') + '<script>'.length;
const script = source.slice(scriptStart, source.indexOf('</script>', scriptStart));

describe('GamedayBar week toggle', () => {
  it('binds its document listener behind a once-per-window flag', () => {
    expect(script).toContain("document.addEventListener('click'");
    const guard = script.indexOf('if (!w.__rhdrWeeksBound) {');
    expect(guard).toBeGreaterThan(-1);
    expect(script.indexOf('w.__rhdrWeeksBound = true;')).toBeGreaterThan(guard);
    expect(script.indexOf("document.addEventListener('click'")).toBeGreaterThan(guard);
  });

  it('toggles once per tap however many copies of the script run', () => {
    const listeners: Array<(e: { target: unknown }) => void> = [];
    const bar = { dataset: { weeks: 'collapsed' } as Record<string, string> };
    class FakeButton {
      attrs: Record<string, string> = {};
      closest(sel: string) {
        return sel === '[data-rhdr-weeks-toggle]' ? this : bar;
      }
      setAttribute(k: string, v: string) { this.attrs[k] = v; }
    }
    const toggle = new FakeButton();
    const win: Record<string, unknown> = {};
    const doc = { addEventListener: (_: string, fn: (e: { target: unknown }) => void) => listeners.push(fn) };
    // Strip the TypeScript so the script runs as plain JS.
    const js = script
      .replace(/ as Window & \{[^}]*\}/, '')
      .replace(/ as Element \| null/, '')
      .replace(/closest<HTMLElement>/, 'closest');
    const run = new Function('window', 'document', 'HTMLButtonElement', js);
    for (let i = 0; i < 16; i++) run(win, doc, FakeButton);
    expect(listeners).toHaveLength(1);
    for (const fn of listeners) fn({ target: toggle });
    expect(bar.dataset.weeks).toBe('expanded');
    expect(toggle.attrs['aria-expanded']).toBe('true');
  });
});
