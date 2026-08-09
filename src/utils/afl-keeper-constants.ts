/**
 * AFL keeper constants shared by the storage layer (Redis-backed planner)
 * and the pure analysis module. Lives in its own dependency-free file so
 * importing a constant never drags Redis/fs code into a pure module's
 * graph (or vice versa).
 */

/** Players each AFL franchise keeps into the new season. */
export const KEEPER_LIMIT = 7;
