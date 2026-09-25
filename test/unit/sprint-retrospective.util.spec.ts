import { StatusCategory } from 'src/common/enums/status-category.enum';
import { computeRetrospective } from 'src/modules/sprints/sprint-retrospective.util';

describe('computeRetrospective', () => {
  it('sums planned scope from the initial tasks alone, regardless of activeScope', () => {
    const initial = [
      { storyPoints: 3, statusCategory: StatusCategory.DONE },
      { storyPoints: 5, statusCategory: StatusCategory.TODO },
    ];
    const result = computeRetrospective(initial, [], initial, []);
    expect(result.plannedCount).toBe(2);
    expect(result.plannedPoints).toBe(8);
  });

  it('treats a null storyPoints as 0 rather than throwing or producing NaN', () => {
    const initial = [{ storyPoints: null, statusCategory: StatusCategory.DONE }];
    const result = computeRetrospective(initial, [], initial, []);
    expect(result.plannedPoints).toBe(0);
    expect(result.completedPoints).toBe(0);
  });

  it('counts completed and carryover from activeScope, not from planned/added directly', () => {
    const initial = [
      { storyPoints: 3, statusCategory: StatusCategory.DONE },
      { storyPoints: 2, statusCategory: StatusCategory.IN_PROGRESS },
    ];
    const added = [{ storyPoints: 1, statusCategory: StatusCategory.DONE }];
    const result = computeRetrospective(initial, added, [...initial, ...added], []);
    expect(result.completedCount).toBe(2);
    expect(result.completedPoints).toBe(4);
    expect(result.carryoverCount).toBe(1);
    expect(result.carryoverPoints).toBe(2);
  });

  it('reports added scope (raw, as-added) separately from planned scope', () => {
    const added = [
      { storyPoints: 2, statusCategory: StatusCategory.DONE },
      { storyPoints: 4, statusCategory: StatusCategory.TODO },
    ];
    const result = computeRetrospective([], added, added, []);
    expect(result.addedCount).toBe(2);
    expect(result.addedPoints).toBe(6);
  });

  it('a task added then explicitly removed still counts toward addedCount, but not toward completed/carryover', () => {
    const added = [{ storyPoints: 4, statusCategory: StatusCategory.TODO }];
    // activeScope excludes it (the service filters removed ids out before calling this).
    const result = computeRetrospective([], added, [], [{ storyPoints: 4 }]);
    expect(result.addedCount).toBe(1);
    expect(result.addedPoints).toBe(4);
    expect(result.completedCount).toBe(0);
    expect(result.carryoverCount).toBe(0);
    expect(result.removedCount).toBe(1);
    expect(result.removedPoints).toBe(4);
  });

  it('reports removed scope from the removed-tasks list, independent of completed/carryover', () => {
    const result = computeRetrospective([], [], [], [{ storyPoints: 5 }, { storyPoints: 2 }]);
    expect(result.removedCount).toBe(2);
    expect(result.removedPoints).toBe(7);
  });

  it('computes a completion rate percent across activeScope', () => {
    const activeScope = [
      { storyPoints: 1, statusCategory: StatusCategory.DONE },
      { storyPoints: 1, statusCategory: StatusCategory.DONE },
      { storyPoints: 1, statusCategory: StatusCategory.DONE },
      { storyPoints: 1, statusCategory: StatusCategory.TODO },
    ];
    const result = computeRetrospective([], [], activeScope, []);
    expect(result.completionRatePercent).toBe(75);
  });

  it('completion rate is null when there is no active scope at all (regression: 0/0 must not be NaN or 0)', () => {
    const result = computeRetrospective([], [], [], []);
    expect(result.completionRatePercent).toBeNull();
  });
});
