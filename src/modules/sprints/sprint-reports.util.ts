export interface SprintBurndownPoint {
  date: string;
  remainingPoints: number;
  remainingCount: number;
  idealRemainingPoints: number;
  idealRemainingCount: number;
}

export interface SprintBurndownResult {
  points: SprintBurndownPoint[];
  hasStoryPoints: boolean;
}

export interface BurndownTaskSnapshot {
  storyPoints: number | null;
  completedAt: Date | null;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// UTC throughout (not local time) - every date this codebase exchanges with clients is an ISO
// UTC string, and day boundaries must not shift depending on the server process's local timezone.
function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addDays(date: Date, days: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + days));
}

function toDateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Remaining work (story points and issue count) per day of a sprint, plus an ideal straight-line-
 * to-zero-by-`endDate` reference series - the BRD's Burndown chart. Pure and side-effect-free
 * (no DB, no DI) so it's exhaustively unit-testable, mirroring evaluateAutomationRules/
 * validateCustomFieldValues's style.
 *
 * Deliberately a simplified, current-scope model: `tasks` is whatever currently references the
 * sprint (a task removed from the sprint before completion drops out of the whole curve
 * retroactively; one added mid-sprint appears in it from day one) - not a full historical replay
 * of scope changes via task activity. `completedAt` (set once, when a task first reaches the Done
 * category) is enough to know whether a task was still remaining as of any given day.
 */
export function computeBurndown(
  tasks: BurndownTaskSnapshot[],
  startedAt: Date,
  plannedEndDate: Date,
  sprintCompletedAt: Date | null,
  now: Date,
): SprintBurndownResult {
  const hasStoryPoints = tasks.some((t) => t.storyPoints != null);
  const totalPoints = tasks.reduce((sum, t) => sum + (t.storyPoints ?? 0), 0);
  const totalCount = tasks.length;

  const startDay = startOfDay(startedAt);
  const endDay = startOfDay(sprintCompletedAt ?? now);
  const idealEndDay = startOfDay(plannedEndDate);
  const idealSpanDays = Math.max(
    1,
    Math.round((idealEndDay.getTime() - startDay.getTime()) / MS_PER_DAY),
  );

  const points: SprintBurndownPoint[] = [];
  for (let dayStart = startDay; dayStart <= endDay; dayStart = addDays(dayStart, 1)) {
    const dayEnd = addDays(dayStart, 1);
    let remainingPoints = 0;
    let remainingCount = 0;
    for (const task of tasks) {
      const doneByDay = !!task.completedAt && task.completedAt < dayEnd;
      if (!doneByDay) {
        remainingPoints += task.storyPoints ?? 0;
        remainingCount += 1;
      }
    }

    const dayIndex = Math.round((dayStart.getTime() - startDay.getTime()) / MS_PER_DAY);
    const idealFraction = Math.max(0, 1 - dayIndex / idealSpanDays);

    points.push({
      date: toDateKey(dayStart),
      remainingPoints,
      remainingCount,
      idealRemainingPoints: Math.round(totalPoints * idealFraction),
      idealRemainingCount: Math.round(totalCount * idealFraction),
    });
  }

  return { points, hasStoryPoints };
}
