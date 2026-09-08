import { TaskStatus } from 'src/common/enums/task-status.enum';
import { isLegalTaskTransition, legalTaskTransitions } from 'src/modules/tasks/task-status.rules';

describe('task-status.rules', () => {
  const ALL_STATUSES = Object.values(TaskStatus);

  describe('legalTaskTransitions', () => {
    it('Todo can only move to In Progress', () => {
      expect(legalTaskTransitions(TaskStatus.TODO)).toEqual([TaskStatus.IN_PROGRESS]);
    });

    it('In Progress can move to Review or back to Todo', () => {
      expect(legalTaskTransitions(TaskStatus.IN_PROGRESS)).toEqual([
        TaskStatus.REVIEW,
        TaskStatus.TODO,
      ]);
    });

    it('Review can move to Done or back to In Progress', () => {
      expect(legalTaskTransitions(TaskStatus.REVIEW)).toEqual([
        TaskStatus.DONE,
        TaskStatus.IN_PROGRESS,
      ]);
    });

    it('Done can reopen to In Progress', () => {
      expect(legalTaskTransitions(TaskStatus.DONE)).toEqual([TaskStatus.IN_PROGRESS]);
    });
  });

  describe('isLegalTaskTransition — exhaustive matrix', () => {
    const expected: Record<TaskStatus, Record<TaskStatus, boolean>> = {
      [TaskStatus.TODO]: {
        [TaskStatus.TODO]: false,
        [TaskStatus.IN_PROGRESS]: true,
        [TaskStatus.REVIEW]: false,
        [TaskStatus.DONE]: false,
      },
      [TaskStatus.IN_PROGRESS]: {
        [TaskStatus.TODO]: true,
        [TaskStatus.IN_PROGRESS]: false,
        [TaskStatus.REVIEW]: true,
        [TaskStatus.DONE]: false,
      },
      [TaskStatus.REVIEW]: {
        [TaskStatus.TODO]: false,
        [TaskStatus.IN_PROGRESS]: true,
        [TaskStatus.REVIEW]: false,
        [TaskStatus.DONE]: true,
      },
      [TaskStatus.DONE]: {
        [TaskStatus.TODO]: false,
        [TaskStatus.IN_PROGRESS]: true,
        [TaskStatus.REVIEW]: false,
        [TaskStatus.DONE]: false,
      },
    };

    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const legal = expected[from][to];
        it(`${from} -> ${to} is ${legal ? 'legal' : 'illegal'}`, () => {
          expect(isLegalTaskTransition(from, to)).toBe(legal);
        });
      }
    }
  });
});
