import { findCyclePath, wouldCreateCycle } from 'src/modules/planning/utils/dependency-graph.util';

describe('wouldCreateCycle', () => {
  it('is false for a proposed edge into an empty graph', () => {
    expect(wouldCreateCycle([], 'A', 'B')).toBe(false);
  });

  it('is true for a self-link (A blocks A)', () => {
    expect(wouldCreateCycle([], 'A', 'A')).toBe(true);
  });

  it('is false for a simple chain with no cycle (A->B, proposing B->C)', () => {
    expect(wouldCreateCycle([{ source: 'A', target: 'B' }], 'B', 'C')).toBe(false);
  });

  it('is true for a direct 2-cycle (A->B exists, proposing B->A)', () => {
    expect(wouldCreateCycle([{ source: 'A', target: 'B' }], 'B', 'A')).toBe(true);
  });

  it('is true for a longer indirect cycle (A->B->C exists, proposing C->A)', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];
    expect(wouldCreateCycle(edges, 'C', 'A')).toBe(true);
  });

  it('is false when the proposed edge would not close any existing path', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'C', target: 'D' },
    ];
    expect(wouldCreateCycle(edges, 'D', 'A')).toBe(false);
  });

  it('ignores edges unrelated to the proposed pair (branching graph, no cycle)', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'A', target: 'C' },
      { source: 'B', target: 'D' },
    ];
    expect(wouldCreateCycle(edges, 'D', 'C')).toBe(false);
  });
});

describe('findCyclePath', () => {
  it('returns null when no cycle would form', () => {
    expect(findCyclePath([{ source: 'A', target: 'B' }], 'B', 'C')).toBeNull();
  });

  it('returns the self-link path for A blocking A', () => {
    expect(findCyclePath([], 'A', 'A')).toEqual(['A', 'A']);
  });

  it('returns the full path for an indirect cycle (A->B->C, proposing C->A)', () => {
    const edges = [
      { source: 'A', target: 'B' },
      { source: 'B', target: 'C' },
    ];
    expect(findCyclePath(edges, 'C', 'A')).toEqual(['C', 'A', 'B', 'C']);
  });
});
