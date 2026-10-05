import { NotificationType } from './schemas/notification.schema';

export type DigestFrequency = 'off' | 'daily' | 'weekly';
export const DIGEST_FREQUENCIES: DigestFrequency[] = ['off', 'daily', 'weekly'];
export const DIGEST_PERIOD_MS: Record<Exclude<DigestFrequency, 'off'>, number> = {
  daily: 24 * 60 * 60 * 1000,
  weekly: 7 * 24 * 60 * 60 * 1000,
};

const TYPE_LABELS: Record<string, string> = {
  [NotificationType.TASK_ASSIGNED]: 'Assigned to you',
  [NotificationType.STATUS_CHANGED]: 'Status changes',
  [NotificationType.COMMENT_ADDED]: 'New comments',
  [NotificationType.DUE_SOON]: 'Due soon',
  [NotificationType.MENTIONED]: 'Mentions',
  [NotificationType.WATCHED_TASK_UPDATED]: 'Watched issue activity',
};

export interface DigestInput {
  type: string;
  title: string;
  message: string;
  taskId: string | null;
  createdAt: Date;
}

export interface Digest {
  period: Exclude<DigestFrequency, 'off'>;
  unreadCount: number;
  byType: Array<{ type: string; label: string; count: number }>;
  /** The newest few items, for a quick read. */
  highlights: Array<{ title: string; message: string; taskId: string | null; createdAt: Date }>;
  subject: string;
  text: string;
}

const MAX_HIGHLIGHTS = 8;

/**
 * Module 11 gap-closure: a digest of the unread notifications from one period - counts by type
 * plus the newest few. The same summary backs the in-app digest card and the digest email.
 * `notifications` must be newest-first.
 */
export function buildDigest(
  notifications: DigestInput[],
  period: Exclude<DigestFrequency, 'off'>,
  appUrl: string,
): Digest {
  const counts = new Map<string, number>();
  for (const n of notifications) counts.set(n.type, (counts.get(n.type) ?? 0) + 1);
  const byType = [...counts.entries()]
    .map(([type, count]) => ({ type, label: TYPE_LABELS[type] ?? type, count }))
    .sort((a, b) => b.count - a.count);
  const highlights = notifications.slice(0, MAX_HIGHLIGHTS).map((n) => ({
    title: n.title,
    message: n.message,
    taskId: n.taskId,
    createdAt: n.createdAt,
  }));

  const periodWord = period === 'daily' ? 'day' : 'week';
  const subject =
    notifications.length === 0
      ? `Your ${period} digest: nothing new`
      : `Your ${period} digest: ${notifications.length} unread notification${notifications.length === 1 ? '' : 's'}`;
  const text = [
    `Here's what happened in the last ${periodWord}.`,
    '',
    ...byType.map((t) => `- ${t.label}: ${t.count}`),
    '',
    ...highlights.map((h) => `* ${h.title} - ${h.message}`),
    notifications.length > highlights.length
      ? `...and ${notifications.length - highlights.length} more.`
      : '',
    '',
    `Open your notifications: ${appUrl.replace(/\/$/, '')}/notifications`,
  ]
    .filter((line, i, all) => !(line === '' && all[i - 1] === ''))
    .join('\n');

  return { period, unreadCount: notifications.length, byType, highlights, subject, text };
}
