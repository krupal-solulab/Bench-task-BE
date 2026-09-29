export interface TimesheetBucketEntry {
  id: string;
  taskId: string;
  issueKey: string | null;
  taskTitle: string;
  projectId: string;
  projectName: string;
  hours: number;
  workDate: string;
  billable: boolean;
  description: string;
}

export interface TimesheetBucket {
  bucketStart: string;
  totalHours: number;
  billableHours: number;
  entries: TimesheetBucketEntry[];
}

function bucketStartFor(workDate: Date, groupBy: 'week' | 'month'): string {
  if (groupBy === 'month') {
    return new Date(Date.UTC(workDate.getUTCFullYear(), workDate.getUTCMonth(), 1))
      .toISOString()
      .slice(0, 10);
  }
  // Monday-start week, computed in UTC so a work date's calendar day never shifts across buckets
  // depending on the server's local timezone.
  const mondayOffset = (workDate.getUTCDay() + 6) % 7;
  const monday = new Date(workDate);
  monday.setUTCDate(monday.getUTCDate() - mondayOffset);
  return monday.toISOString().slice(0, 10);
}

/**
 * Groups a flat list of work-log entries into week/month buckets, newest bucket first - the one
 * piece of real logic behind the personal cross-project timesheet, kept pure and unit-tested
 * directly rather than folded into a Mongo aggregation pipeline.
 */
export function bucketTimesheetEntries(
  entries: TimesheetBucketEntry[],
  groupBy: 'week' | 'month',
): TimesheetBucket[] {
  const byBucket = new Map<string, TimesheetBucketEntry[]>();
  for (const entry of entries) {
    const key = bucketStartFor(new Date(entry.workDate), groupBy);
    const existing = byBucket.get(key);
    if (existing) existing.push(entry);
    else byBucket.set(key, [entry]);
  }

  return [...byBucket.entries()]
    .sort(([a], [b]) => (a < b ? 1 : -1))
    .map(([bucketStart, bucketEntries]) => ({
      bucketStart,
      totalHours: bucketEntries.reduce((sum, e) => sum + e.hours, 0),
      billableHours: bucketEntries.reduce((sum, e) => sum + (e.billable ? e.hours : 0), 0),
      entries: bucketEntries,
    }));
}
