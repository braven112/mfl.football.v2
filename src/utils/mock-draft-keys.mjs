/**
 * Redis keys for mock and best-ball drafts (src/utils/mock-draft-store.ts).
 *
 * Plain .mjs so `scripts/export-best-ball-draft.mjs` reads the official draft
 * from the same key the site writes it to, without a second copy of the name.
 */

/** The board and its clock. */
export function mockDraftSessionKey(id) {
  return `mock-draft:session:${id}`;
}

/** The ranked lists auto-pick reads. */
export function mockDraftPoolKey(id) {
  return `mock-draft:pool:${id}`;
}

/** Held for one read-modify-write of a session. */
export function mockDraftLockKey(id) {
  return `mock-draft:lock:${id}`;
}

/** A lobby's session list; `room` is `mockRegistryRoom(...)`. */
export function mockDraftRegistryKey(room) {
  return `mock-draft:registry:${room}`;
}
