import {
  bucketTimesheetEntries,
  TimesheetBucketEntry,
} from 'src/modules/worklogs/utils/timesheet-bucket.util';

function makeEntry(overrides: Partial<TimesheetBucketEntry> = {}): TimesheetBucketEntry {
  return {
    id: 'log-1',
    taskId: 'task-1',
    issueKey: 'PRJ-1',
    taskTitle: 'A task',
    projectId: 'project-1',
    projectName: 'A project',
    hours: 1,
    workDate: '2026-03-02T00:00:00.000Z',
    billable: true,
    description: '',
    ...overrides,
  };
}

describe('bucketTimesheetEntries', () => {
  it('groups entries into Monday-start week buckets', () => {
    const buckets = bucketTimesheetEntries(
      [
        makeEntry({ id: 'a', workDate: '2026-03-02T00:00:00.000Z' }), // Monday
        makeEntry({ id: 'b', workDate: '2026-03-08T00:00:00.000Z' }), // Sunday, same week
        makeEntry({ id: 'c', workDate: '2026-03-09T00:00:00.000Z' }), // Monday, next week
      ],
      'week',
    );

    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.bucketStart).toBe('2026-03-09');
    expect(buckets[0]!.entries.map((e) => e.id)).toEqual(['c']);
    expect(buckets[1]!.bucketStart).toBe('2026-03-02');
    expect(buckets[1]!.entries.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('groups entries into calendar-month buckets', () => {
    const buckets = bucketTimesheetEntries(
      [
        makeEntry({ id: 'a', workDate: '2026-03-01T00:00:00.000Z' }),
        makeEntry({ id: 'b', workDate: '2026-03-31T00:00:00.000Z' }),
        makeEntry({ id: 'c', workDate: '2026-04-01T00:00:00.000Z' }),
      ],
      'month',
    );

    expect(buckets).toHaveLength(2);
    expect(buckets[0]!.bucketStart).toBe('2026-04-01');
    expect(buckets[1]!.bucketStart).toBe('2026-03-01');
    expect(buckets[1]!.entries.map((e) => e.id).sort()).toEqual(['a', 'b']);
  });

  it('sums totalHours and billableHours per bucket, excluding non-billable hours from the latter', () => {
    const buckets = bucketTimesheetEntries(
      [
        makeEntry({ id: 'a', hours: 3, billable: true, workDate: '2026-03-02T00:00:00.000Z' }),
        makeEntry({ id: 'b', hours: 2, billable: false, workDate: '2026-03-03T00:00:00.000Z' }),
      ],
      'week',
    );

    expect(buckets).toHaveLength(1);
    expect(buckets[0]!.totalHours).toBe(5);
    expect(buckets[0]!.billableHours).toBe(3);
  });

  it('returns an empty array for no entries', () => {
    expect(bucketTimesheetEntries([], 'week')).toEqual([]);
  });
});
