import { buildDigest } from 'src/notifications/digest.util';
import { renderEmailText } from 'src/notifications/smtp-email.service';
import { NotificationType } from 'src/notifications/schemas/notification.schema';

describe('buildDigest (Module 11 gap-closure)', () => {
  const at = new Date('2026-10-05T10:00:00.000Z');
  const n = (type: NotificationType, title: string) => ({
    type,
    title,
    message: `${title} details`,
    taskId: 't-1',
    createdAt: at,
  });

  it('counts by type (largest first), keeps the newest few, and writes subject + text', () => {
    const digest = buildDigest(
      [
        n(NotificationType.COMMENT_ADDED, 'Comment 1'),
        n(NotificationType.COMMENT_ADDED, 'Comment 2'),
        n(NotificationType.TASK_ASSIGNED, 'Assigned'),
      ],
      'daily',
      'https://app.example.com/',
    );
    expect(digest.unreadCount).toBe(3);
    expect(digest.byType).toEqual([
      { type: 'CommentAdded', label: 'New comments', count: 2 },
      { type: 'TaskAssigned', label: 'Assigned to you', count: 1 },
    ]);
    expect(digest.subject).toBe('Your daily digest: 3 unread notifications');
    expect(digest.text).toContain('- New comments: 2');
    expect(digest.text).toContain('* Comment 1 - Comment 1 details');
    expect(digest.text).toContain('https://app.example.com/notifications');
  });

  it('caps highlights at 8 and says how many more there are', () => {
    const many = Array.from({ length: 11 }, (_, i) => n(NotificationType.MENTIONED, `M${i}`));
    const digest = buildDigest(many, 'weekly', 'http://x');
    expect(digest.highlights).toHaveLength(8);
    expect(digest.text).toContain('...and 3 more.');
    expect(digest.text).toContain('last week');
  });

  it('handles an empty period', () => {
    expect(buildDigest([], 'daily', 'http://x').subject).toBe('Your daily digest: nothing new');
  });
});

describe('renderEmailText (Module 11 gap-closure)', () => {
  it('uses pre-rendered text when given, otherwise lists the scalar fields', () => {
    expect(
      renderEmailText({ to: 'a@b.c', subject: 'S', template: 'digest', data: { text: 'Hello' } }),
    ).toBe('Hello');
    const text = renderEmailText({
      to: 'a@b.c',
      subject: "You've been assigned: Fix login",
      template: 'task-assigned',
      data: { taskTitle: 'Fix login', assigneeName: 'Dana', nested: { skip: true } },
    });
    expect(text).toContain('task Title: Fix login');
    expect(text).toContain('assignee Name: Dana');
    expect(text).not.toContain('skip');
  });
});
