export interface PlanningBacklogTask {
  id: string;
  storyPoints: number | null;
}

export interface SprintPlanningSuggestion {
  suggestedTaskIds: string[];
  suggestedPoints: number;
  suggestedCount: number;
  targetPoints: number | null;
  targetCount: number | null;
  basis: 'capacity' | 'velocity' | 'none';
}

function emptySuggestion(
  targetPoints: number | null = null,
  targetCount: number | null = null,
): SprintPlanningSuggestion {
  return {
    suggestedTaskIds: [],
    suggestedPoints: 0,
    suggestedCount: 0,
    targetPoints,
    targetCount,
    basis: 'none',
  };
}

// Unpointed tasks count as 0 points - the same simplification SprintCapacityIndicator.tsx already
// uses for its planned-vs-capacity display, kept consistent here rather than inventing a stricter
// rule this codebase doesn't otherwise apply. Always includes at least the first backlog task (if
// any) even if it alone exceeds the target, so one oversized top-of-backlog item never produces a
// silently-empty suggestion.
function walkByPoints(
  backlog: PlanningBacklogTask[],
  targetPoints: number,
  targetCount: number | null,
  basis: 'capacity' | 'velocity',
): SprintPlanningSuggestion {
  const suggested: PlanningBacklogTask[] = [];
  let points = 0;
  for (const task of backlog) {
    if (suggested.length > 0 && points + (task.storyPoints ?? 0) > targetPoints) break;
    suggested.push(task);
    points += task.storyPoints ?? 0;
  }
  return {
    suggestedTaskIds: suggested.map((t) => t.id),
    suggestedPoints: points,
    suggestedCount: suggested.length,
    targetPoints,
    targetCount,
    basis,
  };
}

function walkByCount(
  backlog: PlanningBacklogTask[],
  averageVelocityCount: number,
): SprintPlanningSuggestion {
  const targetCount = Math.max(1, Math.round(averageVelocityCount));
  const suggested = backlog.slice(0, targetCount);
  return {
    suggestedTaskIds: suggested.map((t) => t.id),
    suggestedPoints: suggested.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0),
    suggestedCount: suggested.length,
    targetPoints: null,
    targetCount: averageVelocityCount,
    basis: 'velocity',
  };
}

/**
 * Module 10's deterministic sprint-planning suggester - NOT an LLM call (this codebase has no real
 * LLM provider anywhere; see `release-notes.util.ts` for the established "deterministic composer,
 * clearly labeled as suggested" pattern this mirrors). Greedily walks the backlog in its existing
 * rank order, accumulating story points (or issue count, if nothing in the backlog is pointed)
 * until a target is reached:
 * 1. the sprint's own `capacityPoints`, if the PM has set one (always respected once set, even if
 *    the backlog happens to have no points at all - same as `capacityPoints` set with no signal);
 * 2. otherwise the average points completed per sprint over the last few completed sprints
 *    (velocity), if the backlog has at least one pointed task to size against;
 * 3. otherwise the average issue COUNT completed per sprint, if nothing is pointed at all;
 * 4. otherwise (a brand-new project with no velocity history and no capacity set) no suggestion.
 */
export function suggestSprintScope(
  backlog: PlanningBacklogTask[],
  capacityPoints: number | null,
  averageVelocityPoints: number | null,
  averageVelocityCount: number | null,
): SprintPlanningSuggestion {
  if (backlog.length === 0) return emptySuggestion();

  if (capacityPoints != null) {
    return walkByPoints(backlog, capacityPoints, averageVelocityCount, 'capacity');
  }

  const hasAnyPoints = backlog.some((t) => t.storyPoints != null);
  if (hasAnyPoints && averageVelocityPoints != null) {
    return walkByPoints(backlog, averageVelocityPoints, averageVelocityCount, 'velocity');
  }

  if (averageVelocityCount != null) {
    return walkByCount(backlog, averageVelocityCount);
  }

  return emptySuggestion();
}
