import { computeBurndown } from 'src/modules/sprints/sprint-reports.util';

const DAY = 24 * 60 * 60 * 1000;
const START = new Date('2026-01-01T00:00:00.000Z');
const END = new Date('2026-01-05T00:00:00.000Z');

describe('computeBurndown', () => {
  it('produces one point per day from start to now, remaining = all tasks when none are done', () => {
    const now = new Date('2026-01-03T12:00:00.000Z');
    const tasks = [
      { storyPoints: 3, completedAt: null },
      { storyPoints: 5, completedAt: null },
    ];

    const result = computeBurndown(tasks, START, END, null, now);

    expect(result.hasStoryPoints).toBe(true);
    // Jan 1, 2, 3 - inclusive of "today" even though it's only noon.
    expect(result.points).toHaveLength(3);
    expect(result.points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
    expect(result.points[0]).toMatchObject({ remainingPoints: 8, remainingCount: 2 });
  });

  it('each point is end-of-day remaining - a task completed during a day is already "done" by that day\'s point, and the day before it completed still counts it as remaining', () => {
    const now = new Date('2026-01-04T00:00:00.000Z');
    const tasks = [
      { storyPoints: 3, completedAt: new Date('2026-01-02T15:00:00.000Z') },
      { storyPoints: 5, completedAt: null },
    ];

    const result = computeBurndown(tasks, START, END, null, now);
    const byDate = new Map(result.points.map((p) => [p.date, p]));

    expect(byDate.get('2026-01-01')).toMatchObject({ remainingPoints: 8, remainingCount: 2 });
    expect(byDate.get('2026-01-02')).toMatchObject({ remainingPoints: 5, remainingCount: 1 });
    expect(byDate.get('2026-01-03')).toMatchObject({ remainingPoints: 5, remainingCount: 1 });
  });

  it('stops the curve at sprint.completedAt when the sprint has already been completed, not at now', () => {
    const completedAt = new Date('2026-01-03T00:00:00.000Z');
    const now = new Date('2026-01-10T00:00:00.000Z');
    const tasks = [{ storyPoints: 2, completedAt: null }];

    const result = computeBurndown(tasks, START, END, completedAt, now);

    expect(result.points.map((p) => p.date)).toEqual(['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  it('the ideal line reaches zero exactly at the planned endDate', () => {
    const now = END;
    const tasks = [
      { storyPoints: 4, completedAt: null },
      { storyPoints: 4, completedAt: null },
    ];

    const result = computeBurndown(tasks, START, END, null, now);
    const last = result.points[result.points.length - 1]!;

    expect(last.date).toBe('2026-01-05');
    expect(last.idealRemainingPoints).toBe(0);
    expect(result.points[0]!.idealRemainingPoints).toBe(8);
  });

  it('hasStoryPoints is false when every task has null storyPoints, and remainingPoints stays 0', () => {
    const now = START;
    const tasks = [
      { storyPoints: null, completedAt: null },
      { storyPoints: null, completedAt: null },
    ];

    const result = computeBurndown(tasks, START, END, null, now);

    expect(result.hasStoryPoints).toBe(false);
    expect(result.points[0]).toMatchObject({ remainingPoints: 0, remainingCount: 2 });
  });

  it('returns a single point when startedAt and now are the same day', () => {
    const tasks = [{ storyPoints: 1, completedAt: null }];
    const result = computeBurndown(tasks, START, END, null, new Date(START.getTime() + DAY / 2));
    expect(result.points).toHaveLength(1);
  });

  it('handles an empty task list without dividing by zero or crashing', () => {
    const result = computeBurndown([], START, END, null, END);
    expect(result.hasStoryPoints).toBe(false);
    expect(result.points.every((p) => p.remainingPoints === 0 && p.remainingCount === 0)).toBe(
      true,
    );
  });
});
