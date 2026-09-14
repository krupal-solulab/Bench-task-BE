/**
 * Fractional-rank helpers for backlog ordering. A task's `rank` is just a float used purely for
 * sort order within a scope (the backlog, or a single sprint) - inserting between two neighbors
 * only ever touches the one moved row, never the whole list.
 */

export const RANK_STEP = 1024;

/** Smallest gap between two neighbor ranks before a scope is considered to need renumbering. */
export const RANK_EPSILON = 1e-6;

/** Rank for a brand-new item appended to the end of a scope (task creation, sprint assignment). */
export function nextAppendRank(maxRank: number | null): number {
  return (maxRank ?? 0) + RANK_STEP;
}

/**
 * Rank for a task moved between `before` (closer to the top) and `after` (closer to the bottom).
 * Passing `null` for `before` means "move to the top"; `null` for `after` means "move to the
 * bottom"; both `null` means the scope is empty.
 */
export function midpointRank(before: number | null, after: number | null): number {
  if (before === null && after === null) return RANK_STEP;
  if (before === null) return (after as number) - RANK_STEP;
  if (after === null) return before + RANK_STEP;
  return (before + after) / 2;
}

/** True when the gap between two adjacent ranks is too small to safely bisect again. */
export function needsRenumber(before: number | null, after: number | null): boolean {
  if (before === null || after === null) return false;
  return after - before < RANK_EPSILON;
}

/** Renumbered ranks for a list already ordered top-to-bottom, spaced evenly by RANK_STEP. */
export function renumberedRanks(count: number): number[] {
  return Array.from({ length: count }, (_, index) => (index + 1) * RANK_STEP);
}
