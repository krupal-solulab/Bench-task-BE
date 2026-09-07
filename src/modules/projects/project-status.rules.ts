import { ProjectStatus } from '../../common/enums/project-status.enum';

const TRANSITIONS: Record<ProjectStatus, ProjectStatus[]> = {
  [ProjectStatus.PLANNING]: [ProjectStatus.IN_PROGRESS],
  [ProjectStatus.IN_PROGRESS]: [ProjectStatus.COMPLETED, ProjectStatus.PLANNING],
  [ProjectStatus.COMPLETED]: [ProjectStatus.IN_PROGRESS],
};

export function legalProjectTransitions(current: ProjectStatus): ProjectStatus[] {
  return TRANSITIONS[current];
}

export function isLegalProjectTransition(from: ProjectStatus, to: ProjectStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
