import { TaskPriority } from 'src/common/enums/task-priority.enum';
import {
  DEFAULT_SLA_POLICY,
  isBreached,
  resolutionHoursOf,
  resolveSlaPolicy,
  slaTargetHours,
} from 'src/modules/projects/schemas/sla-policy.schema';

describe('resolveSlaPolicy', () => {
  it('falls back to the default policy when the project has none configured (regression)', () => {
    expect(resolveSlaPolicy({ slaPolicy: [] })).toBe(DEFAULT_SLA_POLICY);
    expect(resolveSlaPolicy({})).toBe(DEFAULT_SLA_POLICY);
  });

  it("returns the project's own policy when configured", () => {
    const custom = [{ priority: TaskPriority.P1, resolutionHours: 4 }];
    expect(resolveSlaPolicy({ slaPolicy: custom })).toBe(custom);
  });
});

describe('slaTargetHours', () => {
  it('returns the configured hours for a priority present in the policy', () => {
    expect(slaTargetHours(DEFAULT_SLA_POLICY, TaskPriority.P1)).toBe(8);
    expect(slaTargetHours(DEFAULT_SLA_POLICY, TaskPriority.P2)).toBe(24);
    expect(slaTargetHours(DEFAULT_SLA_POLICY, TaskPriority.P3)).toBe(72);
  });

  it('returns null for a priority missing from a custom policy', () => {
    const custom = [{ priority: TaskPriority.P1, resolutionHours: 4 }];
    expect(slaTargetHours(custom, TaskPriority.P2)).toBeNull();
  });
});

describe('isBreached', () => {
  const now = new Date('2026-01-10T00:00:00.000Z');

  it('a Done task completed within the target is compliant', () => {
    const task = {
      priority: TaskPriority.P2,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-01T12:00:00.000Z'), // 12h, target 24h
    };
    expect(isBreached(task, DEFAULT_SLA_POLICY, now)).toBe(false);
  });

  it('a Done task completed after the target is breached', () => {
    const task = {
      priority: TaskPriority.P2,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-03T00:00:00.000Z'), // 48h, target 24h
    };
    expect(isBreached(task, DEFAULT_SLA_POLICY, now)).toBe(true);
  });

  it('an open task still within the target is not yet breached', () => {
    const task = {
      priority: TaskPriority.P3,
      createdAt: new Date('2026-01-09T00:00:00.000Z'), // 24h elapsed, target 72h
      completedAt: null,
    };
    expect(isBreached(task, DEFAULT_SLA_POLICY, now)).toBe(false);
  });

  it('an open task past the target is already breached', () => {
    const task = {
      priority: TaskPriority.P1,
      createdAt: new Date('2026-01-01T00:00:00.000Z'), // days elapsed, target 8h
      completedAt: null,
    };
    expect(isBreached(task, DEFAULT_SLA_POLICY, now)).toBe(true);
  });

  it('a priority with no applicable target never counts as breached', () => {
    const custom = [{ priority: TaskPriority.P1, resolutionHours: 1 }];
    const task = {
      priority: TaskPriority.P2,
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
      completedAt: null,
    };
    expect(isBreached(task, custom, now)).toBe(false);
  });
});

describe('resolutionHoursOf', () => {
  it('returns null for a task that is not Done yet', () => {
    expect(
      resolutionHoursOf({
        priority: TaskPriority.P2,
        createdAt: new Date(),
        completedAt: null,
      }),
    ).toBeNull();
  });

  it('computes hours between createdAt and completedAt', () => {
    const hours = resolutionHoursOf({
      priority: TaskPriority.P2,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      completedAt: new Date('2026-01-02T06:00:00.000Z'),
    });
    expect(hours).toBe(30);
  });
});
