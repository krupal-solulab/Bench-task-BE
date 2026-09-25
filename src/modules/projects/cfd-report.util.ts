import { StatusCategory } from '../../common/enums/status-category.enum';

export interface CfdTaskEvent {
  at: Date;
  category: StatusCategory;
}

/** `events` must be sorted ascending by `at`, with the first entry representing the task's
 * category at the moment of `createdAt` (its workflow's initial status). */
export interface CfdTaskHistory {
  createdAt: Date;
  events: CfdTaskEvent[];
}

export interface CfdPoint {
  date: string;
  toDo: number;
  inProgress: number;
  done: number;
}

// UTC throughout, matching sprint-reports.util.ts's own convention - every date this codebase
// exchanges with clients is an ISO UTC string, and day boundaries must not shift depending on the
// server process's local timezone.
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
 * A Cumulative Flow Diagram: for each of the last `days` days, how many of a project's (non-
 * deleted) tasks were in each status category as of that day's end. Pure and side-effect-free (no
 * DB, no DI) so it's exhaustively unit-testable, mirroring computeBurndown's style.
 *
 * Reconstructed from each task's `TaskActivity` STATUS_CHANGED history (mapped through the
 * project's workflow to a category) rather than any new tracking field - see the service layer for
 * how `events` is built. A task not yet created by a given day is excluded entirely from that
 * day's counts (matches how a real CFD only ever gains, never loses, a lane's total once an issue
 * exists) - deliberately simplified to non-deleted current tasks only, the same "current scope,
 * not a full historical replay of deletions" trade-off `computeBurndown` already documents.
 */
export function computeCfd(tasks: CfdTaskHistory[], days: number, now: Date): CfdPoint[] {
  const endDay = startOfDay(now);
  const startDay = addDays(endDay, -(Math.max(1, days) - 1));

  const points: CfdPoint[] = [];
  for (let day = startDay; day <= endDay; day = addDays(day, 1)) {
    const dayEnd = addDays(day, 1);
    let toDo = 0;
    let inProgress = 0;
    let done = 0;

    for (const task of tasks) {
      if (task.createdAt >= dayEnd) continue;

      let category = task.events[0]?.category ?? StatusCategory.TODO;
      for (const event of task.events) {
        if (event.at >= dayEnd) break;
        category = event.category;
      }

      if (category === StatusCategory.TODO) toDo += 1;
      else if (category === StatusCategory.IN_PROGRESS) inProgress += 1;
      else done += 1;
    }

    points.push({ date: toDateKey(day), toDo, inProgress, done });
  }

  return points;
}
