export interface CycleTimeInput {
  createdAt: Date;
  completedAt: Date;
  /** The task's first STATUS_CHANGED activity timestamp - i.e. when it first left its workflow's
   * initial column - or null if it went straight from creation to Done in one step. */
  firstStatusChangeAt: Date | null;
}

export interface CycleTimeResult {
  /** Lead time: creation to completion - the customer-facing "how long did this take" metric. */
  leadTimeHours: number;
  /** Cycle time: first work to completion - the team-facing "how long once we started" metric.
   * Equals lead time when a task has no recorded status change before completion. */
  cycleTimeHours: number;
}

const MS_PER_HOUR = 60 * 60 * 1000;

/**
 * Pure per-issue lead-time/cycle-time computation for the Control Chart - mirrors the existing
 * (internal, never-exposed) lead-time math in `sla-policy.schema.ts`'s `resolutionHoursOf`, but
 * factored out as its own public, unit-tested function since Module 9 exposes it directly rather
 * than only feeding it into an average.
 */
export function computeCycleTime(input: CycleTimeInput): CycleTimeResult {
  const leadTimeHours = (input.completedAt.getTime() - input.createdAt.getTime()) / MS_PER_HOUR;
  const cycleStart = input.firstStatusChangeAt ?? input.createdAt;
  const cycleTimeHours = (input.completedAt.getTime() - cycleStart.getTime()) / MS_PER_HOUR;
  return { leadTimeHours, cycleTimeHours };
}
