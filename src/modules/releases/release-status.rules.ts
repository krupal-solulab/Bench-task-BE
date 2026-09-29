import { ReleaseStatus } from '../../common/enums/release-status.enum';

// Unlike Sprint (Completed is terminal), a release can be reverted from Released back to
// Unreleased (Jira supports "unrelease" - a PM correcting a mistaken release). Archived is
// restorable too (the BRD's "restore-from-archive" action) - back to whichever of the two it
// effectively was before archiving, decided by ReleasesService.unarchive() from releasedAt, not
// a single fixed target here.
const TRANSITIONS: Record<ReleaseStatus, ReleaseStatus[]> = {
  [ReleaseStatus.UNRELEASED]: [ReleaseStatus.RELEASED, ReleaseStatus.ARCHIVED],
  [ReleaseStatus.RELEASED]: [ReleaseStatus.UNRELEASED, ReleaseStatus.ARCHIVED],
  [ReleaseStatus.ARCHIVED]: [ReleaseStatus.UNRELEASED, ReleaseStatus.RELEASED],
};

export function legalReleaseTransitions(current: ReleaseStatus): ReleaseStatus[] {
  return TRANSITIONS[current];
}

export function isLegalReleaseTransition(from: ReleaseStatus, to: ReleaseStatus): boolean {
  return TRANSITIONS[from].includes(to);
}
