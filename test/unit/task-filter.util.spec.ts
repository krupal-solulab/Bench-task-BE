import { Types } from 'mongoose';
import { buildTaskListFilter, buildTaskListSort } from 'src/modules/tasks/utils/task-filter.util';
import { StatusCategory } from 'src/common/enums/status-category.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';

describe('buildTaskListFilter', () => {
  it('returns just the base scope when no query fields are set (regression)', () => {
    const filter = buildTaskListFilter({}, { organizationId: 'org-1' });
    expect(filter).toEqual({ deletedAt: null, organizationId: 'org-1' });
  });

  it('filters by a single custom field value', () => {
    const filter = buildTaskListFilter({
      customFieldFilters: [{ fieldId: 'f-1', value: 'High' }],
    });
    expect(filter['customFieldValues.f-1']).toBe('High');
  });

  it('ANDs multiple custom field filters together', () => {
    const filter = buildTaskListFilter({
      customFieldFilters: [
        { fieldId: 'f-1', value: 'High' },
        { fieldId: 'f-2', value: 'Backend' },
      ],
    });
    expect(filter['customFieldValues.f-1']).toBe('High');
    expect(filter['customFieldValues.f-2']).toBe('Backend');
  });

  it('does not touch the filter when customFieldFilters is empty or omitted', () => {
    const withEmpty = buildTaskListFilter({ customFieldFilters: [] });
    const withUndefined = buildTaskListFilter({});
    expect(withEmpty).toEqual(withUndefined);
  });

  it('free-text search matches title, description, and issueKey', () => {
    const filter = buildTaskListFilter({ search: 'PRJ-42' });
    expect(filter.$or).toEqual([
      { title: { $regex: 'PRJ-42', $options: 'i' } },
      { description: { $regex: 'PRJ-42', $options: 'i' } },
      { issueKey: { $regex: 'PRJ-42', $options: 'i' } },
    ]);
  });

  it('escapes regex metacharacters in the search term', () => {
    const filter = buildTaskListFilter({ search: 'a.b*c' });
    expect(filter.$or![0]).toEqual({ title: { $regex: 'a\\.b\\*c', $options: 'i' } });
  });

  it('still applies every existing filter unchanged alongside the new ones (regression)', () => {
    const projectId = new Types.ObjectId().toString();
    const filter = buildTaskListFilter({
      project: projectId,
      status: ['Todo', 'In Progress'],
      priority: [TaskPriority.P1],
      labels: ['bug'],
      components: ['API'],
      overdue: true,
    });
    expect(filter.project).toEqual(new Types.ObjectId(projectId));
    expect(filter.status).toEqual({ $in: ['Todo', 'In Progress'] });
    expect(filter.priority).toEqual({ $in: ['P1'] });
    expect(filter.labels).toEqual({ $in: ['bug'] });
    expect(filter.components).toEqual({ $in: ['API'] });
    expect(filter.statusCategory).toEqual({ $ne: StatusCategory.DONE });
  });
});

describe('buildTaskListSort', () => {
  it('is unaffected by this phase (regression)', () => {
    expect(buildTaskListSort('createdAt', -1)).toEqual({ createdAt: -1 });
    expect(buildTaskListSort('priority', 1)).toEqual({ priority: 1, createdAt: 1 });
  });
});
