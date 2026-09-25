import { suggestSprintScope } from 'src/modules/sprints/sprint-planning.util';

describe('suggestSprintScope', () => {
  it('returns an empty, basis "none" suggestion for an empty backlog', () => {
    const result = suggestSprintScope([], null, null, null);
    expect(result).toEqual({
      suggestedTaskIds: [],
      suggestedPoints: 0,
      suggestedCount: 0,
      targetPoints: null,
      targetCount: null,
      basis: 'none',
    });
  });

  it('walks the ranked backlog by points until capacity is reached', () => {
    const backlog = [
      { id: 't-1', storyPoints: 3 },
      { id: 't-2', storyPoints: 5 },
      { id: 't-3', storyPoints: 2 },
    ];
    const result = suggestSprintScope(backlog, 8, null, null);
    expect(result.suggestedTaskIds).toEqual(['t-1', 't-2']);
    expect(result.suggestedPoints).toBe(8);
    expect(result.basis).toBe('capacity');
  });

  it('always includes at least the first task even if it alone exceeds capacity', () => {
    const backlog = [{ id: 't-1', storyPoints: 20 }];
    const result = suggestSprintScope(backlog, 5, null, null);
    expect(result.suggestedTaskIds).toEqual(['t-1']);
    expect(result.suggestedPoints).toBe(20);
  });

  it('treats an unpointed task as 0 points when accumulating against capacity', () => {
    const backlog = [
      { id: 't-1', storyPoints: null },
      { id: 't-2', storyPoints: 3 },
    ];
    const result = suggestSprintScope(backlog, 3, null, null);
    expect(result.suggestedTaskIds).toEqual(['t-1', 't-2']);
    expect(result.suggestedPoints).toBe(3);
  });

  it('falls back to average velocity points when no capacity is set and the backlog has points', () => {
    const backlog = [
      { id: 't-1', storyPoints: 4 },
      { id: 't-2', storyPoints: 4 },
    ];
    const result = suggestSprintScope(backlog, null, 5, 3);
    expect(result.suggestedTaskIds).toEqual(['t-1']);
    expect(result.basis).toBe('velocity');
    expect(result.targetPoints).toBe(5);
  });

  it('falls back to average velocity COUNT when nothing in the backlog is pointed at all', () => {
    const backlog = [
      { id: 't-1', storyPoints: null },
      { id: 't-2', storyPoints: null },
      { id: 't-3', storyPoints: null },
    ];
    const result = suggestSprintScope(backlog, null, 5, 2);
    expect(result.suggestedTaskIds).toEqual(['t-1', 't-2']);
    expect(result.suggestedCount).toBe(2);
    expect(result.basis).toBe('velocity');
    expect(result.targetPoints).toBeNull();
  });

  it('rounds a fractional average velocity count to the nearest whole issue, minimum 1', () => {
    const backlog = [
      { id: 't-1', storyPoints: null },
      { id: 't-2', storyPoints: null },
    ];
    const result = suggestSprintScope(backlog, null, null, 0.4);
    expect(result.suggestedCount).toBe(1);
  });

  it('produces no suggestion when there is neither a set capacity nor any velocity history', () => {
    const backlog = [{ id: 't-1', storyPoints: 3 }];
    const result = suggestSprintScope(backlog, null, null, null);
    expect(result.basis).toBe('none');
    expect(result.suggestedTaskIds).toEqual([]);
  });

  it('a set capacity always wins even when velocity data is also available', () => {
    const backlog = [
      { id: 't-1', storyPoints: 2 },
      { id: 't-2', storyPoints: 2 },
    ];
    const result = suggestSprintScope(backlog, 2, 100, 100);
    expect(result.basis).toBe('capacity');
    expect(result.suggestedTaskIds).toEqual(['t-1']);
  });
});
