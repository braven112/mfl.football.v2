import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ASSET_SPECS, STORED_SIZES } from '../src/utils/brand-asset-specs';

const PUBLIC = join(process.cwd(), 'public');

/** Width and height from a PNG's IHDR chunk. */
function pngSize(path: string): [number, number] {
  const buf = readFileSync(path);
  return [buf.readUInt32BE(16), buf.readUInt32BE(20)];
}

describe('brand asset specs (/brand/specs)', () => {
  it.each(STORED_SIZES)('%s is still stored at %ix%i, as the page says', (rel, w, h) => {
    expect(pngSize(join(PUBLIC, rel))).toEqual([w, h]);
  });

  it('every template the page offers exists, and the PNG is the master size', () => {
    for (const spec of ASSET_SPECS) {
      if (!spec.template) continue;
      expect(existsSync(join(PUBLIC, spec.template.svg)), spec.template.svg).toBe(true);
      const [w, h] = pngSize(join(PUBLIC, spec.template.png));
      expect(`${w} × ${h}`, spec.id).toBe(spec.size);
    }
  });

  it('spec ids are unique, since they are the page anchors', () => {
    const ids = ASSET_SPECS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
