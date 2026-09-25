import { computeCycleTime } from 'src/modules/projects/cycle-time.util';

describe('computeCycleTime', () => {
  it('computes lead time as createdAt to completedAt', () => {
    const result = computeCycleTime({
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-04T00:00:00.000Z'),
      firstStatusChangeAt: null,
    });
    expect(result.leadTimeHours).toBe(72);
  });

  it('cycle time equals lead time when there was no recorded status change', () => {
    const result = computeCycleTime({
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-04T00:00:00.000Z'),
      firstStatusChangeAt: null,
    });
    expect(result.cycleTimeHours).toBe(result.leadTimeHours);
  });

  it('cycle time is measured from the first status change, not creation', () => {
    const result = computeCycleTime({
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-04T00:00:00.000Z'),
      firstStatusChangeAt: new Date('2026-01-02T00:00:00.000Z'),
    });
    expect(result.leadTimeHours).toBe(72);
    expect(result.cycleTimeHours).toBe(48);
  });
});
