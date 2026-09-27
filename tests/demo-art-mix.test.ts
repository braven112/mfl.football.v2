import { describe, expect, it } from 'vitest';
import { ART_ASSIGNMENTS, artDataUri } from '../scripts/demo/lib/art-mix.mjs';
import { DEMO_FRANCHISES } from '../scripts/demo/lib/franchises.mjs';
import { KEEPER_FRANCHISES } from '../scripts/demo/lib/keeper.mjs';
import { BIGLEAGUE_FRANCHISES } from '../scripts/demo/lib/bigleague.mjs';
import { BESTBALL_FRANCHISES } from '../scripts/demo/lib/bestball.mjs';

const LISTS: Record<string, ReadonlyArray<{ id: string | number; name: string | number; art?: string }>> = {
  dynasty: DEMO_FRANCHISES,
  keeper: KEEPER_FRANCHISES,
  bigleague: BIGLEAGUE_FRANCHISES,
  redraft: BESTBALL_FRANCHISES,
};

describe('demo art mix', () => {
  it('assigns art only to franchises that exist, and every piece of art resolves', () => {
    for (const [demo, assignments] of Object.entries(ART_ASSIGNMENTS)) {
      const ids = new Set(LISTS[demo].map((f) => f.id));
      for (const [id, [art]] of Object.entries(assignments)) {
        expect(ids.has(id), `${demo} ${id}`).toBe(true);
        expect(artDataUri(art)).toMatch(/^data:image\/(png|gif|jpeg|svg\+xml);base64,/);
      }
    }
  });

  it('uses each piece of art once per demo, and keeps names unique', () => {
    for (const [demo, list] of Object.entries(LISTS)) {
      const arts = list.flatMap((f) => (f.art ? [f.art] : []));
      expect(new Set(arts).size, demo).toBe(arts.length);
      expect(new Set(list.map((f) => f.name)).size, demo).toBe(list.length);
    }
  });
});
