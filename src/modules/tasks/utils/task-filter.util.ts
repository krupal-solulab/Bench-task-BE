import { FilterQuery, Types } from 'mongoose';
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

  if (query.dueDateFrom || query.dueDateTo) {
    filter.dueDate = {
      ...(query.dueDateFrom ? { $gte: new Date(query.dueDateFrom) } : {}),
      ...(query.dueDateTo ? { $lte: new Date(query.dueDateTo) } : {}),
    };
  }

  if (query.overdue) {
    filter.dueDate = { ...(filter.dueDate as object), $lt: new Date() };
    filter.status = { $ne: 'Done' };
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
