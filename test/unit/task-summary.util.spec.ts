import { buildTaskSummary } from 'src/modules/tasks/task-summary.util';

const NOW = new Date('2026-01-10T00:00:00.000Z');
const CREATED = new Date('2026-01-01T00:00:00.000Z');

function baseInput(overrides: Partial<Parameters<typeof buildTaskSummary>[0]> = {}) {
  return {
    title: 'Ship the feature',
    status: 'In Progress',
    priority: 'P2',
    createdAt: CREATED,
    completedAt: null,
    assigneeName: null,
    commentCount: 0,
    linkedIssueCount: 0,
    watcherCount: 0,
    voterCount: 0,
    activity: [],
    now: NOW,
    ...overrides,
  };
}

describe('buildTaskSummary', () => {
  it('reports days open from creation to now for an open issue', () => {
    const result = buildTaskSummary(baseInput());
    expect(result.headline).toContain('9 days');
    expect(result.headline).not.toContain('completed');
  });

  it('reports days open from creation to completion, and flags it as completed', () => {
    const result = buildTaskSummary(
      baseInput({ completedAt: new Date('2026-01-04T00:00:00.000Z') }),
    );
    expect(result.headline).toContain('3 days');
    expect(result.headline).toContain('completed');
    expect(result.bullets[0]).toBe('Completed. Priority: P2.');
  });

  it('reports "Unassigned" when there is no assignee', () => {
    const result = buildTaskSummary(baseInput({ assigneeName: null }));
    expect(result.bullets).toContain('Unassigned.');
  });

  it('reports the assignee name when present', () => {
    const result = buildTaskSummary(baseInput({ assigneeName: 'Dana Developer' }));
    expect(result.bullets).toContain('Assigned to Dana Developer.');
  });

  it('counts status changes and reassignments from the activity log, ignoring other actions', () => {
    const result = buildTaskSummary(
      baseInput({
        activity: [
          { action: 'status_changed', createdAt: new Date('2026-01-02T00:00:00.000Z') },
          { action: 'status_changed', createdAt: new Date('2026-01-03T00:00:00.000Z') },
          { action: 'reassigned', createdAt: new Date('2026-01-04T00:00:00.000Z') },
          { action: 'commented', createdAt: new Date('2026-01-05T00:00:00.000Z') },
        ],
      }),
    );
    expect(result.bullets).toContain('2 status changes, 1 reassignment so far.');
  });

  it('uses singular nouns for a count of exactly 1', () => {
    const result = buildTaskSummary(
      baseInput({
        activity: [{ action: 'status_changed', createdAt: new Date('2026-01-02T00:00:00.000Z') }],
        commentCount: 1,
        linkedIssueCount: 1,
      }),
    );
    expect(result.bullets).toContain('1 status change, 0 reassignments so far.');
    expect(result.bullets).toContain('1 comment, 1 linked issue.');
  });

  it('computes days-in-current-status from the most recent status_changed entry, not creation', () => {
    const result = buildTaskSummary(
      baseInput({
        activity: [
          { action: 'status_changed', createdAt: new Date('2026-01-02T00:00:00.000Z') },
          { action: 'status_changed', createdAt: new Date('2026-01-08T00:00:00.000Z') },
        ],
      }),
    );
    // now (01-10) - last status change (01-08) = 2 days, not now - createdAt (01-01) = 9 days.
    expect(result.bullets[0]).toContain('2 days in this status');
  });

  it('falls back to time-since-creation for days-in-current-status when there is no status change yet', () => {
    const result = buildTaskSummary(baseInput({ activity: [] }));
    expect(result.bullets[0]).toContain('9 days in this status');
  });

  it('reports watcher and voter counts', () => {
    const result = buildTaskSummary(baseInput({ watcherCount: 3, voterCount: 0 }));
    expect(result.bullets).toContain('Watched by 3 users, voted by 0 users.');
  });

  it('stamps generatedAt with the injected "now", never a live clock', () => {
    const result = buildTaskSummary(baseInput());
    expect(result.generatedAt).toBe(NOW.toISOString());
  });
});
