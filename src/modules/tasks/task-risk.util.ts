import { StatusCategory } from '../../common/enums/status-category.enum';
import { TaskPriority } from '../../common/enums/task-priority.enum';

const DAY_MS = 24 * 60 * 60 * 1000;
/** "Due soon" window for work that hasn't even started yet. */
export const DUE_SOON_DAYS = 3;
/** In Progress this long without any status change counts as stalled. */
export const STALLED_DAYS = 7;

export interface TaskRiskInput {
  priority: TaskPriority;
  assignee: unknown | null;
  dueDate: Date | null;
  statusCategory: StatusCategory;
  /** When the task last changed status (or was created, if it never has). */
  lastStatusChangeAt: Date;
  /** Issue keys (or titles) of OPEN issues that block this one. */
  openBlockers: string[];
}

export type RiskLevel = 'high' | 'medium' | 'low';

export interface TaskRisk {
  score: number;
  level: RiskLevel;
  reasons: string[];
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * Module 10 gap-closure: deterministic risk flagging (no LLM). Each rule adds points and a
 * plain-language reason, so the flag always explains itself. Done issues are never at risk.
 *   overdue                                    +3
 *   due within 3 days and not started          +2
 *   In Progress with no status change in 7d    +2
 *   blocked by an open issue                   +2
 *   P1 with nobody assigned                    +2
 * Level: score >= 4 high, >= 2 medium, otherwise low (score 0 = not at risk).
 */
export function assessTaskRisk(task: TaskRiskInput, now: Date): TaskRisk {
  if (task.statusCategory === StatusCategory.DONE) return { score: 0, level: 'low', reasons: [] };

  let score = 0;
  const reasons: string[] = [];

  if (task.dueDate) {
    const daysUntilDue = Math.floor((task.dueDate.getTime() - now.getTime()) / DAY_MS);
    if (task.dueDate.getTime() < now.getTime()) {
      score += 3;
      const overdueDays = Math.max(
        1,
        Math.floor((now.getTime() - task.dueDate.getTime()) / DAY_MS),
      );
      reasons.push(`Overdue by ${plural(overdueDays, 'day')}`);
    } else if (daysUntilDue < DUE_SOON_DAYS && task.statusCategory === StatusCategory.TODO) {
      score += 2;
      reasons.push(
        daysUntilDue <= 0
          ? 'Due today and not started'
          : `Due in ${plural(daysUntilDue, 'day')} and not started`,
      );
    }
  }

  if (task.statusCategory === StatusCategory.IN_PROGRESS) {
    const idleDays = Math.floor((now.getTime() - task.lastStatusChangeAt.getTime()) / DAY_MS);
    if (idleDays >= STALLED_DAYS) {
      score += 2;
      reasons.push(`No status change for ${plural(idleDays, 'day')}`);
    }
  }

  if (task.openBlockers.length > 0) {
    score += 2;
    const shown = task.openBlockers.slice(0, 3).join(', ');
    const more = task.openBlockers.length > 3 ? ` +${task.openBlockers.length - 3} more` : '';
    reasons.push(`Blocked by ${shown}${more}`);
  }

  if (task.priority === TaskPriority.P1 && !task.assignee) {
    score += 2;
    reasons.push('High priority with nobody assigned');
  }

  return { score, level: score >= 4 ? 'high' : score >= 2 ? 'medium' : 'low', reasons };
}
