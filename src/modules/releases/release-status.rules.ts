import { ReleaseStatus } from '../../common/enums/release-status.enum';

// Unlike Sprint (Completed is terminal), a release can be reverted from Released back to
// Unreleased (Jira supports "unrelease" - a PM correcting a mistaken release) - only Archived is
// terminal, mirroring Sprint's Completed-is-terminal precedent for "this is a closed record now".
const TRANSITIONS: Record<ReleaseStatus, ReleaseStatus[]> = {
  [ReleaseStatus.UNRELEASED]: [ReleaseStatus.RELEASED, ReleaseStatus.ARCHIVED],
  [ReleaseStatus.RELEASED]: [ReleaseStatus.UNRELEASED, ReleaseStatus.ARCHIVED],
  [ReleaseStatus.ARCHIVED]: [],
};

export function legalReleaseTransitions(current: ReleaseStatus): ReleaseStatus[] {
  return TRANSITIONS[current];
}

export function isLegalReleaseTransition(from: ReleaseStatus, to: ReleaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
