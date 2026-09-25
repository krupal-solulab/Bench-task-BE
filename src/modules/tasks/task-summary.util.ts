export interface TaskSummaryActivityEvent {
  action: string;
  createdAt: Date;
}

export interface TaskSummaryInput {
  title: string;
  status: string;
  priority: string;
  createdAt: Date;
  completedAt: Date | null;
  assigneeName: string | null;
  commentCount: number;
  linkedIssueCount: number;
  watcherCount: number;
  voterCount: number;
  activity: TaskSummaryActivityEvent[];
  now: Date;
}

export interface TaskSummaryResult {
  headline: string;
  bullets: string[];
  generatedAt: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / MS_PER_DAY));
}

function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/**
 * Module 10's deterministic issue summary - NOT an LLM-generated summary (this codebase has no
 * real LLM provider anywhere; see `release-notes.util.ts` for the established "deterministic
 * composer, clearly labeled as suggested" pattern this mirrors). A templated readout of real field
 * values and real `TaskActivity` history - a headline plus a handful of bullet facts - rather than
 * free-form generated prose. Pure and side-effect-free so it's exhaustively unit-testable.
 */
export function buildTaskSummary(input: TaskSummaryInput): TaskSummaryResult {
  const isDone = input.completedAt != null;
  const ageDays = daysBetween(input.createdAt, isDone ? input.completedAt! : input.now);
  const statusChangeCount = input.activity.filter((a) => a.action === 'status_changed').length;
  const reassignmentCount = input.activity.filter((a) => a.action === 'reassigned').length;

  const lastStatusChange = [...input.activity]
    .filter((a) => a.action === 'status_changed')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const currentStatusSince = lastStatusChange?.createdAt ?? input.createdAt;
  const daysInCurrentStatus = daysBetween(currentStatusSince, input.now);

  const headline = isDone
    ? `"${input.title}" was open for ${pluralize(ageDays, 'day')} before it was completed.`
    : `"${input.title}" has been open for ${pluralize(ageDays, 'day')}.`;

  const bullets: string[] = [
    isDone
      ? `Completed. Priority: ${input.priority}.`
      : `Currently "${input.status}" (${pluralize(daysInCurrentStatus, 'day')} in this status). Priority: ${input.priority}.`,
    input.assigneeName ? `Assigned to ${input.assigneeName}.` : 'Unassigned.',
    `${pluralize(statusChangeCount, 'status change')}, ${pluralize(reassignmentCount, 'reassignment')} so far.`,
    `${pluralize(input.commentCount, 'comment')}, ${pluralize(input.linkedIssueCount, 'linked issue')}.`,
    `Watched by ${pluralize(input.watcherCount, 'user')}, voted by ${pluralize(input.voterCount, 'user')}.`,
  ];

  return { headline, bullets, generatedAt: input.now.toISOString() };
}
