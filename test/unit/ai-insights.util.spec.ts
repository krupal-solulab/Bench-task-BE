import { StatusCategory } from 'src/common/enums/status-category.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { SIMILARITY_THRESHOLD, similarityScore, tokenize } from 'src/modules/tasks/similarity.util';
import { assessTaskRisk, TaskRiskInput } from 'src/modules/tasks/task-risk.util';

describe('similarityScore (Module 10 gap-closure)', () => {
  it('tokenizes with stop words removed and light stemming', () => {
    expect(tokenize('The login page is crashing on Safari')).toEqual([
      'login',
      'page',
      'crash',
      'safari',
    ]);
  });

  it('scores differently-worded duplicates above the threshold', () => {
    const score = similarityScore('Safari crash when logging in', {
      title: 'Login page crashes on Safari',
    });
    expect(score).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it('scores unrelated issues below the threshold', () => {
    const score = similarityScore('Export invoices to CSV', {
      title: 'Login page crashes on Safari',
    });
    expect(score).toBeLessThan(SIMILARITY_THRESHOLD);
  });

  it('ranks an exact title above a partial match, and tolerates a typo', () => {
    const exact = similarityScore('Dark mode toggle', { title: 'Dark mode toggle' });
    const partial = similarityScore('Dark mode toggle', { title: 'Toggle for notifications' });
    expect(exact).toBe(1);
    expect(exact).toBeGreaterThan(partial);
    expect(
      similarityScore('Paymnet gateway timeout', { title: 'Payment gateway timeout' }),
    ).toBeGreaterThanOrEqual(SIMILARITY_THRESHOLD);
  });

  it('counts description words, at reduced weight', () => {
    const withDescription = similarityScore('webhook retries', {
      title: 'Stripe integration',
      description: 'Webhook retries are not handled',
    });
    expect(withDescription).toBeGreaterThan(0);
    expect(similarityScore('', { title: 'anything' })).toBe(0);
  });
});

describe('assessTaskRisk (Module 10 gap-closure)', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  const day = 24 * 60 * 60 * 1000;
  const base: TaskRiskInput = {
    priority: TaskPriority.P2,
    assignee: 'u-1',
    dueDate: null,
    statusCategory: StatusCategory.TODO,
    lastStatusChangeAt: now,
    openBlockers: [],
  };

  it('is not at risk with nothing wrong, and never once done', () => {
    expect(assessTaskRisk(base, now)).toEqual({ score: 0, level: 'low', reasons: [] });
    expect(
      assessTaskRisk(
        {
          ...base,
          statusCategory: StatusCategory.DONE,
          dueDate: new Date(now.getTime() - 9 * day),
        },
        now,
      ).score,
    ).toBe(0);
  });

  it('flags overdue, due-soon-not-started, stalled, blocked and unassigned P1, each with a reason', () => {
    expect(
      assessTaskRisk({ ...base, dueDate: new Date(now.getTime() - 2 * day) }, now),
    ).toMatchObject({
      score: 3,
      level: 'medium',
      reasons: ['Overdue by 2 days'],
    });
    expect(
      assessTaskRisk({ ...base, dueDate: new Date(now.getTime() + 2 * day) }, now).reasons,
    ).toEqual(['Due in 2 days and not started']);
    expect(
      assessTaskRisk(
        {
          ...base,
          statusCategory: StatusCategory.IN_PROGRESS,
          lastStatusChangeAt: new Date(now.getTime() - 10 * day),
        },
        now,
      ).reasons,
    ).toEqual(['No status change for 10 days']);
    expect(
      assessTaskRisk({ ...base, openBlockers: ['API-1', 'API-2', 'API-3', 'API-4'] }, now).reasons,
    ).toEqual(['Blocked by API-1, API-2, API-3 +1 more']);
    expect(
      assessTaskRisk({ ...base, priority: TaskPriority.P1, assignee: null }, now).reasons,
    ).toEqual(['High priority with nobody assigned']);
  });

  it('counts whole days overdue, minimum 1 (regression: 2 days + a few ms read as "3 days")', () => {
    const justOver = new Date(now.getTime() - 2 * day - 5);
    expect(assessTaskRisk({ ...base, dueDate: justOver }, now).reasons).toEqual([
      'Overdue by 2 days',
    ]);
    const anHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
    expect(assessTaskRisk({ ...base, dueDate: anHourAgo }, now).reasons).toEqual([
      'Overdue by 1 day',
    ]);
  });

  it('adds up to high risk when several rules apply', () => {
    const risk = assessTaskRisk(
      {
        ...base,
        priority: TaskPriority.P1,
        assignee: null,
        dueDate: new Date(now.getTime() - day),
        openBlockers: ['API-9'],
      },
      now,
    );
    expect(risk).toMatchObject({ score: 7, level: 'high' });
    expect(risk.reasons).toHaveLength(3);
  });

  it('does not call in-progress work "not started", nor a recent status change stalled', () => {
    const risk = assessTaskRisk(
      {
        ...base,
        statusCategory: StatusCategory.IN_PROGRESS,
        dueDate: new Date(now.getTime() + day),
        lastStatusChangeAt: new Date(now.getTime() - 2 * day),
      },
      now,
    );
    expect(risk.score).toBe(0);
  });
});
