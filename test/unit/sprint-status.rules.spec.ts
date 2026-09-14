import { SprintStatus } from 'src/common/enums/sprint-status.enum';
import {
  isLegalSprintTransition,
  legalSprintTransitions,
} from 'src/modules/sprints/sprint-status.rules';

describe('sprint-status.rules', () => {
  const ALL_STATUSES = Object.values(SprintStatus);

  describe('legalSprintTransitions', () => {
    it('Planned can only move to Active', () => {
      expect(legalSprintTransitions(SprintStatus.PLANNED)).toEqual([SprintStatus.ACTIVE]);
    });

    it('Active can only move to Completed', () => {
      expect(legalSprintTransitions(SprintStatus.ACTIVE)).toEqual([SprintStatus.COMPLETED]);
    });

    it('Completed is terminal', () => {
      expect(legalSprintTransitions(SprintStatus.COMPLETED)).toEqual([]);
    });
  });

  describe('isLegalSprintTransition — exhaustive matrix', () => {
    const expected: Record<SprintStatus, Record<SprintStatus, boolean>> = {
      [SprintStatus.PLANNED]: {
        [SprintStatus.PLANNED]: false,
        [SprintStatus.ACTIVE]: true,
        [SprintStatus.COMPLETED]: false,
      },
      [SprintStatus.ACTIVE]: {
        [SprintStatus.PLANNED]: false,
        [SprintStatus.ACTIVE]: false,
        [SprintStatus.COMPLETED]: true,
      },
      [SprintStatus.COMPLETED]: {
        [SprintStatus.PLANNED]: false,
        [SprintStatus.ACTIVE]: false,
        [SprintStatus.COMPLETED]: false,
      },
    };

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const legal = expected[from][to];
        it(`${from} -> ${to} is ${legal ? 'legal' : 'illegal'}`, () => {
          expect(isLegalSprintTransition(from, to)).toBe(legal);
        });
      }
    }
  });
});
