/**
 * Hang a league's own titles in labelled rows (the AFL: Championships,
 * Conference titles, Other titles), each row newest first, rows in their
 * declared order. A row with nothing in it is left out.
 */
export function groupRows<H extends { year: number; row: { order: number; label: string } }, B>(
  honors: H[],
  toBanner: (honor: H) => B,
): Array<{ label: string; banners: B[] }> {
  const rows = new Map<number, { label: string; items: H[] }>();
  for (const honor of honors) {
    const row = rows.get(honor.row.order) ?? { label: honor.row.label, items: [] };
    row.items.push(honor);
    rows.set(honor.row.order, row);
  }
  return [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, row]) => ({
      label: row.label,
      // A stable sort keeps a season's titles in taxonomy order.
      banners: [...row.items].sort((a, b) => b.year - a.year).map(toBanner),
    }));
}
