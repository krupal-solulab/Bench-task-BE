import { SprintStatus } from '../../common/enums/sprint-status.enum';

// Completed is terminal - unlike Project (which allows reopening), Jira never lets you reopen a
// completed sprint since its completion is a permanent historical record.
const TRANSITIONS: Record<SprintStatus, SprintStatus[]> = {
  [SprintStatus.PLANNED]: [SprintStatus.ACTIVE],
  [SprintStatus.ACTIVE]: [SprintStatus.COMPLETED],
  [SprintStatus.COMPLETED]: [],
};

export function legalSprintTransitions(current: SprintStatus): SprintStatus[] {
  return TRANSITIONS[current];
}

export function isLegalSprintTransition(from: SprintStatus, to: SprintStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
