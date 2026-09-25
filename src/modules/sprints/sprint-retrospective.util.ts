import { StatusCategory } from '../../common/enums/status-category.enum';

export interface RetroTaskSnapshot {
  storyPoints: number | null;
  statusCategory: StatusCategory;
}

export interface RetroRemovedTask {
  storyPoints: number | null;
}

export interface SprintRetrospectiveResult {
  plannedCount: number;
  plannedPoints: number;
  addedCount: number;
  addedPoints: number;
  completedCount: number;
  completedPoints: number;
  removedCount: number;
  removedPoints: number;
  carryoverCount: number;
  carryoverPoints: number;
  completionRatePercent: number | null;
}

function sumPoints(tasks: Array<{ storyPoints: number | null }>): number {
  return tasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
}

/**
 * Pure aggregation for a sprint retrospective, given the groups the service layer resolves
 * separately (see SprintsService.retrospective):
 * - `initialScopeTasks`: the sprint's locked-at-start scope (`Sprint.initialTaskIds`) - reported
 *   as-is for `plannedCount`/`plannedPoints`, regardless of what happened to those tasks since.
 * - `addedScopeTasks`: every task added to the sprint after start (from `TaskActivity`
 *   SPRINT_ASSIGNED events) - reported as-is for `addedCount`/`addedPoints`, a scope-churn figure
 *   that deliberately still includes a task added and later removed (it genuinely was added).
 * - `activeScopeTasks`: `initialScopeTasks` UNION `addedScopeTasks`, MINUS anything with an
 *   explicit removal - the set actually eligible for `completedCount`/`carryoverCount`, since a
 *   removed task is no longer part of what the sprint needs to finish.
 * - `removedTasks`: tasks explicitly removed from the sprint before completion (from
 *   `TaskActivity` SPRINT_REMOVED events) - deliberately excludes the automatic end-of-sprint
 *   carryover, which is a different concept (those tasks are still "in scope", just unfinished).
 *
 * `carryoverCount`/`carryoverPoints` means "not in the Done category as of now" - meaningful for
 * both an Active sprint (work still remaining) and a Completed one (work that was carried over by
 * `SprintsService.complete()`); the caller/frontend labels it based on the sprint's own status.
 */
export function computeRetrospective(
  initialScopeTasks: RetroTaskSnapshot[],
  addedScopeTasks: RetroTaskSnapshot[],
  activeScopeTasks: RetroTaskSnapshot[],
  removedTasks: RetroRemovedTask[],
): SprintRetrospectiveResult {
  const completed = activeScopeTasks.filter((t) => t.statusCategory === StatusCategory.DONE);
  const carryover = activeScopeTasks.filter((t) => t.statusCategory !== StatusCategory.DONE);

  return {
    plannedCount: initialScopeTasks.length,
    plannedPoints: sumPoints(initialScopeTasks),
    addedCount: addedScopeTasks.length,
    addedPoints: sumPoints(addedScopeTasks),
    completedCount: completed.length,
    completedPoints: sumPoints(completed),
    removedCount: removedTasks.length,
    removedPoints: sumPoints(removedTasks),
    carryoverCount: carryover.length,
    carryoverPoints: sumPoints(carryover),
    completionRatePercent:
      activeScopeTasks.length > 0
        ? Math.round((completed.length / activeScopeTasks.length) * 100)
        : null,
  };
}
