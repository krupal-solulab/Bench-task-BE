import { StatusCategory } from 'src/common/enums/status-category.enum';
import { CfdTaskHistory, computeCfd } from 'src/modules/projects/cfd-report.util';

const NOW = new Date('2026-01-10T12:00:00.000Z');

function daysAgo(n: number): Date {
  return new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);
}

describe('computeCfd', () => {
  it('returns exactly `days` points ending today', () => {
    const points = computeCfd([], 5, NOW);
    expect(points).toHaveLength(5);
    expect(points[0].date).toBe('2026-01-06');
    expect(points[4].date).toBe('2026-01-10');
  });

  it('counts a task in its initial category for every day since creation', () => {
    const tasks: CfdTaskHistory[] = [
      { createdAt: daysAgo(4), events: [{ at: daysAgo(4), category: StatusCategory.TODO }] },
    ];
    const points = computeCfd(tasks, 5, NOW);
    expect(points.map((p) => p.toDo)).toEqual([1, 1, 1, 1, 1]);
    expect(points.every((p) => p.inProgress === 0 && p.done === 0)).toBe(true);
  });

  it('excludes a task from days before it was created', () => {
    const tasks: CfdTaskHistory[] = [
      { createdAt: daysAgo(2), events: [{ at: daysAgo(2), category: StatusCategory.TODO }] },
    ];
    const points = computeCfd(tasks, 5, NOW);
    // Days -4, -3 (before creation): 0. Days -2, -1, 0 (after creation): 1.
    expect(points.map((p) => p.toDo)).toEqual([0, 0, 1, 1, 1]);
  });

  it('moves a task between categories on the day its status-change event lands', () => {
    const tasks: CfdTaskHistory[] = [
      {
        createdAt: daysAgo(4),
        events: [
          { at: daysAgo(4), category: StatusCategory.TODO },
          { at: daysAgo(2), category: StatusCategory.IN_PROGRESS },
          { at: daysAgo(0), category: StatusCategory.DONE },
        ],
      },
    ];
    const points = computeCfd(tasks, 5, NOW);
    expect(points.map((p) => [p.toDo, p.inProgress, p.done])).toEqual([
      [1, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 1, 0],
      [0, 0, 1],
    ]);
  });

  it('stacks multiple tasks into the same day correctly', () => {
    const tasks: CfdTaskHistory[] = [
      { createdAt: daysAgo(4), events: [{ at: daysAgo(4), category: StatusCategory.TODO }] },
      {
        createdAt: daysAgo(4),
        events: [
          { at: daysAgo(4), category: StatusCategory.TODO },
          { at: daysAgo(1), category: StatusCategory.DONE },
        ],
      },
    ];
    const points = computeCfd(tasks, 5, NOW);
    expect(points.at(-1)).toMatchObject({ toDo: 1, inProgress: 0, done: 1 });
  });

  it('an event timestamped exactly at a day boundary counts from that day, not the day before', () => {
    const boundary = new Date('2026-01-08T00:00:00.000Z');
    const tasks: CfdTaskHistory[] = [
      {
        createdAt: daysAgo(4),
        events: [
          { at: daysAgo(4), category: StatusCategory.TODO },
          { at: boundary, category: StatusCategory.DONE },
        ],
      },
    ];
    const points = computeCfd(tasks, 5, NOW);
    const boundaryIndex = points.findIndex((p) => p.date === '2026-01-08');
    expect(points[boundaryIndex - 1]).toMatchObject({ toDo: 1, done: 0 });
    expect(points[boundaryIndex]).toMatchObject({ toDo: 0, done: 1 });
  });
});
