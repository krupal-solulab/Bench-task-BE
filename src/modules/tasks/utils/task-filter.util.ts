import { FilterQuery, Types } from 'mongoose';
import { StatusCategory } from '../../../common/enums/status-category.enum';
import { TaskDocument } from '../schemas/task.schema';
import { ListTasksDto } from '../dto/list-tasks.dto';

/** Escapes regex metacharacters so free-text search terms are matched literally. */
function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Shared by TasksRepository and ProjectsService (for the pre-scoped /projects/:id/tasks route). */
export function buildTaskListFilter(
  query: Partial<ListTasksDto>,
  extra: FilterQuery<TaskDocument> = {},
): FilterQuery<TaskDocument> {
  const filter: FilterQuery<TaskDocument> = { deletedAt: null, ...extra };

  if (query.project) filter.project = new Types.ObjectId(query.project);
  if (query.assignee) filter.assignee = new Types.ObjectId(query.assignee);
  if (query.status?.length) filter.status = { $in: query.status };
  if (query.priority?.length) filter.priority = { $in: query.priority };
  if (query.createdBy) filter.createdBy = new Types.ObjectId(query.createdBy);

  if (query.unassignedSprint) filter.sprint = null;
  else if (query.sprintId) filter.sprint = new Types.ObjectId(query.sprintId);

  if (query.issueType?.length) filter.issueType = { $in: query.issueType };
  if (query.parent) filter.parent = new Types.ObjectId(query.parent);
  if (query.labels?.length) filter.labels = { $in: query.labels };
  if (query.components?.length) filter.components = { $in: query.components };

  if (query.dueDateFrom || query.dueDateTo) {
    filter.dueDate = {
      ...(query.dueDateFrom ? { $gte: new Date(query.dueDateFrom) } : {}),
      ...(query.dueDateTo ? { $lte: new Date(query.dueDateTo) } : {}),
    };
  }

  if (query.overdue) {
    filter.dueDate = { ...(filter.dueDate as object), $lt: new Date() };
    // Category-based, not the literal "Done" - a custom workflow's Done-category status can be
    // named anything (e.g. "Shipped"), so this must keep matching correctly for those projects too.
    filter.statusCategory = { $ne: StatusCategory.DONE };
  }

  if (query.search) {
    const pattern = escapeRegex(query.search);
    filter.$or = [
      { title: { $regex: pattern, $options: 'i' } },
      { description: { $regex: pattern, $options: 'i' } },
    ];
  }

  return filter;
}

/**
 * Shared by TasksRepository and ProjectsService's task-list sort. Adds a stable `createdAt: 1`
 * tie-break for every sort field except `createdAt` itself (which would otherwise collide with -
 * and silently override, since object literals can't hold the same key twice - the primary sort's
 * own direction). This keeps legacy tasks that all share `rank: 0` in a deterministic order in the
 * Backlog view instead of Mongo's undefined tie-break order.
 */
export function buildTaskListSort(sortBy: string, sortOrder: 1 | -1): Record<string, 1 | -1> {
  if (sortBy === 'createdAt') return { createdAt: sortOrder };
  return { [sortBy]: sortOrder, createdAt: 1 };
}
