import { TaskStatus } from 'src/common/enums/task-status.enum';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import { DEFAULT_WORKFLOW, Workflow } from 'src/modules/projects/schemas/workflow.schema';
import { isLegalTaskTransition, legalTaskTransitions } from 'src/modules/tasks/task-status.rules';

describe('task-status.rules', () => {
  const ALL_STATUSES = Object.values(TaskStatus);

  describe('legalTaskTransitions - system default workflow (regression: must match today exactly)', () => {
    it('Todo can only move to In Progress', () => {
      expect(legalTaskTransitions(DEFAULT_WORKFLOW, TaskStatus.TODO)).toEqual([
        TaskStatus.IN_PROGRESS,
      ]);
    });

    it('In Progress can move to Review or back to Todo', () => {
      expect(legalTaskTransitions(DEFAULT_WORKFLOW, TaskStatus.IN_PROGRESS)).toEqual([
        TaskStatus.REVIEW,
        TaskStatus.TODO,
      ]);
    });

    it('Review can move to Done or back to In Progress', () => {
      expect(legalTaskTransitions(DEFAULT_WORKFLOW, TaskStatus.REVIEW)).toEqual([
        TaskStatus.DONE,
        TaskStatus.IN_PROGRESS,
      ]);
    });

    it('Done can reopen to In Progress', () => {
      expect(legalTaskTransitions(DEFAULT_WORKFLOW, TaskStatus.DONE)).toEqual([
        TaskStatus.IN_PROGRESS,
      ]);
    });
  });

  describe('isLegalTaskTransition — exhaustive matrix on the default workflow', () => {
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
          expect(isLegalTaskTransition(DEFAULT_WORKFLOW, from, to)).toBe(legal);
        });
      }
    }
  });

  describe('a custom workflow', () => {
    const CUSTOM_WORKFLOW: Workflow = {
      statuses: [
        { name: 'Backlog', category: StatusCategory.TODO },
        { name: 'Blocked', category: StatusCategory.TODO },
        { name: 'Building', category: StatusCategory.IN_PROGRESS },
        { name: 'Shipped', category: StatusCategory.DONE },
      ],
      transitions: [
        { from: 'Backlog', to: 'Building' },
        { from: 'Building', to: 'Blocked' },
        { from: 'Blocked', to: 'Building' },
        { from: 'Building', to: 'Shipped' },
      ],
      initialStatus: 'Backlog',
    };

    it('reports the configured legal moves for a custom status name', () => {
      expect(legalTaskTransitions(CUSTOM_WORKFLOW, 'Building')).toEqual(['Blocked', 'Shipped']);
    });

    it('a status with no outgoing transitions has none', () => {
      expect(legalTaskTransitions(CUSTOM_WORKFLOW, 'Shipped')).toEqual([]);
    });

    it('accepts a configured move', () => {
      expect(isLegalTaskTransition(CUSTOM_WORKFLOW, 'Backlog', 'Building')).toBe(true);
    });

    it('rejects a move the custom workflow never configured', () => {
      expect(isLegalTaskTransition(CUSTOM_WORKFLOW, 'Backlog', 'Shipped')).toBe(false);
    });

    it("rejects a move using the default workflow's status names (they do not exist in this workflow)", () => {
      expect(isLegalTaskTransition(CUSTOM_WORKFLOW, 'Todo', 'In Progress')).toBe(false);
    });
  });
});
