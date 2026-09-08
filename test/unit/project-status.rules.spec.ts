import { ProjectStatus } from 'src/common/enums/project-status.enum';
import {
  isLegalProjectTransition,
  legalProjectTransitions,
} from 'src/modules/projects/project-status.rules';

describe('project-status.rules', () => {
  const ALL_STATUSES = Object.values(ProjectStatus);

  describe('legalProjectTransitions', () => {
    it('Planning can only move to In Progress', () => {
      expect(legalProjectTransitions(ProjectStatus.PLANNING)).toEqual([ProjectStatus.IN_PROGRESS]);
    });

    it('In Progress can move to Completed or back to Planning', () => {
      expect(legalProjectTransitions(ProjectStatus.IN_PROGRESS)).toEqual([
        ProjectStatus.COMPLETED,
        ProjectStatus.PLANNING,
      ]);
    });

    it('Completed can reopen to In Progress', () => {
      expect(legalProjectTransitions(ProjectStatus.COMPLETED)).toEqual([ProjectStatus.IN_PROGRESS]);
    });
  });

  describe('isLegalProjectTransition — exhaustive matrix', () => {
    const expected: Record<ProjectStatus, Record<ProjectStatus, boolean>> = {
      [ProjectStatus.PLANNING]: {
        [ProjectStatus.PLANNING]: false,
        [ProjectStatus.IN_PROGRESS]: true,
        [ProjectStatus.COMPLETED]: false,
      },
      [ProjectStatus.IN_PROGRESS]: {
        [ProjectStatus.PLANNING]: true,
        [ProjectStatus.IN_PROGRESS]: false,
        [ProjectStatus.COMPLETED]: true,
      },
      [ProjectStatus.COMPLETED]: {
        [ProjectStatus.PLANNING]: false,
        [ProjectStatus.IN_PROGRESS]: true,
        [ProjectStatus.COMPLETED]: false,
      },
    };

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const legal = expected[from][to];
        it(`${from} -> ${to} is ${legal ? 'legal' : 'illegal'}`, () => {
          expect(isLegalProjectTransition(from, to)).toBe(legal);
        });
      }
    }
  });
});
