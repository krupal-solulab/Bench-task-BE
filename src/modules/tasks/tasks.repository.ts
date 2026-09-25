import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { StatusCategory } from '../../common/enums/status-category.enum';
import { Task, TaskDocument } from './schemas/task.schema';
import {
  TaskActivity,
  TaskActivityAction,
  TaskActivityDocument,
} from './schemas/task-activity.schema';
import { ListTasksDto } from './dto/list-tasks.dto';
import { buildTaskListFilter, buildTaskListSort } from './utils/task-filter.util';
import { renumberedRanks } from './utils/rank.util';

export interface RankScope {
  project: Types.ObjectId;
  sprint: Types.ObjectId | null;
}

const POPULATE_FIELDS = 'name email role isActive';
const RELEASE_POPULATE_FIELDS = 'name status';

@Injectable()
export class TasksRepository {
  constructor(
    @InjectModel(Task.name) private readonly model: Model<TaskDocument>,
    @InjectModel(TaskActivity.name) private readonly activityModel: Model<TaskActivityDocument>,
  ) {}

  create(data: Partial<Task>): Promise<TaskDocument> {
    return this.model.create(data);
  }

  findByIdActive(id: string): Promise<TaskDocument | null> {
    return (
      this.model
        .findOne({ _id: id, deletedAt: null })
        .populate('assignee', POPULATE_FIELDS)
        .populate('createdBy', POPULATE_FIELDS)
        .populate('project', 'name')
        .populate('sprint', 'name')
        .populate('parent', 'title issueKey')
        .populate('fixVersions', RELEASE_POPULATE_FIELDS)
        .populate('affectsVersions', RELEASE_POPULATE_FIELDS)
        // Module 7 - only populated on the single-task detail fetch, not the list/search populate
        // chains below, since watchers/voters are a detail-page-only concern.
        .populate('watcherIds', POPULATE_FIELDS)
        .populate('voterIds', POPULATE_FIELDS)
        .exec()
    );
  }

  findRawById(id: string): Promise<TaskDocument | null> {
    return this.model.findOne({ _id: id, deletedAt: null }).exec();
  }

  async paginate(
    query: ListTasksDto,
    scope: FilterQuery<TaskDocument> = {},
  ): Promise<{ data: TaskDocument[]; total: number }> {
    const filter = buildTaskListFilter(query, scope);
    const sortOrder = query.sortOrder === 'asc' ? 1 : -1;
    const sort = buildTaskListSort(query.sortBy, sortOrder);
    return this.paginateWithFilter(filter, sort, query.page, query.limit);
  }

  /**
   * Same populate/pagination shape as `paginate()`, but for an already-built Mongo filter -
   * used by the JQL-lite `/tasks/search` endpoint, whose filter comes from compiling a parsed
   * query rather than a fixed-shape DTO (see `search/jql.util.ts`).
   */
  async paginateWithFilter(
    filter: FilterQuery<TaskDocument>,
    sort: Record<string, 1 | -1>,
    page: number,
    limit: number,
  ): Promise<{ data: TaskDocument[]; total: number }> {
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.model
        .find(filter)
        .populate('assignee', POPULATE_FIELDS)
        .populate('createdBy', POPULATE_FIELDS)
        .populate('project', 'name')
        .populate('sprint', 'name')
        .populate('parent', 'title issueKey')
        .populate('fixVersions', RELEASE_POPULATE_FIELDS)
        .populate('affectsVersions', RELEASE_POPULATE_FIELDS)
        .sort(sort)
        .skip(skip)
        .limit(limit)
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { data, total };
  }

  async updateById(id: string, update: Partial<Task>): Promise<TaskDocument | null> {
    await this.model.updateOne({ _id: id }, update).exec();
    return this.findByIdActive(id);
  }

  /** `$addToSet`/`$pull` are idempotent by construction - calling add twice, or removing someone
   * not currently in the list, is always a safe no-op, never an error. */
  async addWatcher(id: string, userId: string): Promise<TaskDocument | null> {
    await this.model
      .updateOne({ _id: id }, { $addToSet: { watcherIds: new Types.ObjectId(userId) } })
      .exec();
    return this.findByIdActive(id);
  }

  async removeWatcher(id: string, userId: string): Promise<TaskDocument | null> {
    await this.model
      .updateOne({ _id: id }, { $pull: { watcherIds: new Types.ObjectId(userId) } })
      .exec();
    return this.findByIdActive(id);
  }

  async addVoter(id: string, userId: string): Promise<TaskDocument | null> {
    await this.model
      .updateOne({ _id: id }, { $addToSet: { voterIds: new Types.ObjectId(userId) } })
      .exec();
    return this.findByIdActive(id);
  }

  async removeVoter(id: string, userId: string): Promise<TaskDocument | null> {
    await this.model
      .updateOne({ _id: id }, { $pull: { voterIds: new Types.ObjectId(userId) } })
      .exec();
    return this.findByIdActive(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }

  /** Assigned, not-yet-Done, not-yet-notified tasks whose due date falls within the given window. */
  findDueSoonUnnotified(now: Date, threshold: Date): Promise<TaskDocument[]> {
    return this.model
      .find({
        deletedAt: null,
        dueDateNotifiedAt: null,
        assignee: { $ne: null },
        statusCategory: { $ne: StatusCategory.DONE },
        dueDate: { $gte: now, $lte: threshold },
      })
      .exec();
  }

  async markDueDateNotified(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { dueDateNotifiedAt: new Date() }).exec();
  }

  /** BRD 8's UnassignedForDuration automation trigger - every currently-unassigned, open task,
   * for the hourly checker to compute each one's own elapsed-unassigned duration against its
   * project's rules. */
  findUnassignedCandidates(): Promise<TaskDocument[]> {
    return this.model
      .find({
        deletedAt: null,
        assigneeClearedAt: { $ne: null },
        statusCategory: { $ne: StatusCategory.DONE },
      })
      .exec();
  }

  async addFiredTimeBasedRuleIds(id: string, ruleIds: string[]): Promise<void> {
    await this.model
      .updateOne({ _id: id }, { $addToSet: { firedTimeBasedRuleIds: { $each: ruleIds } } })
      .exec();
  }

  /** BRD 8's SlaBreach notification scheme event - every open task not yet notified, for the
   * hourly checker to resolve each one's own project's SLA policy and decide if it's breached. */
  findOpenTasksUnnotifiedForSla(): Promise<TaskDocument[]> {
    return this.model
      .find({
        deletedAt: null,
        slaBreachNotifiedAt: null,
        statusCategory: { $ne: StatusCategory.DONE },
      })
      .exec();
  }

  async markSlaBreachNotified(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { slaBreachNotifiedAt: new Date() }).exec();
  }

  async logActivity(
    taskId: string,
    actorId: string,
    action: TaskActivityAction,
    from: string | null = null,
    to: string | null = null,
    viaAutomationRule: string | null = null,
  ): Promise<void> {
    await this.activityModel.create({
      task: new Types.ObjectId(taskId),
      actor: new Types.ObjectId(actorId),
      action,
      from,
      to,
      viaAutomationRule,
    });
  }

  async paginateActivity(
    taskId: string,
    page: number,
    limit: number,
  ): Promise<{ data: TaskActivityDocument[]; total: number }> {
    const filter = { task: new Types.ObjectId(taskId) };
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.activityModel
        .find(filter)
        .populate('actor', POPULATE_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.activityModel.countDocuments(filter).exec(),
    ]);
    return { data, total };
  }

  /** Highest rank currently in a backlog/sprint scope, or null if the scope is empty. */
  async findMaxRank(scope: RankScope): Promise<number | null> {
    const top = await this.model
      .findOne({ project: scope.project, sprint: scope.sprint, deletedAt: null })
      .sort({ rank: -1 })
      .select('rank')
      .exec();
    return top ? top.rank : null;
  }

  /**
   * A neighbor task's current rank, but only if it actually sits in the given scope - a
   * before/afterTaskId from a different project or sprint is rejected by returning null rather
   * than silently reordering against an unrelated list.
   */
  async findRankInScope(taskId: string, scope: RankScope): Promise<number | null> {
    const task = await this.model
      .findOne({ _id: taskId, project: scope.project, sprint: scope.sprint, deletedAt: null })
      .select('rank')
      .exec();
    return task ? task.rank : null;
  }

  /** Direct (not transitive) linked-issue counts for an Epic's progress bar. */
  async countLinkedIssues(epicId: string): Promise<{ total: number; done: number }> {
    const filter = { parent: new Types.ObjectId(epicId), deletedAt: null };
    const [total, done] = await Promise.all([
      this.model.countDocuments(filter).exec(),
      this.model.countDocuments({ ...filter, statusCategory: StatusCategory.DONE }).exec(),
    ]);
    return { total, done };
  }

  /** Module 9's Epic Burndown: the same {storyPoints, completedAt} shape sprint burndown's
   * `computeBurndown` already consumes, scoped to an Epic's direct linked issues instead of a
   * sprint's tasks. */
  async findLinkedIssueSnapshots(
    epicId: string,
  ): Promise<Array<{ storyPoints: number | null; completedAt: Date | null }>> {
    return this.model
      .find(
        { parent: new Types.ObjectId(epicId), deletedAt: null },
        { storyPoints: 1, completedAt: 1 },
      )
      .lean();
  }

  /** Every non-deleted task in a project, for Module 5's CSV export/project backup - unpaginated
   * (unlike `paginate()`, which is capped at 100 per page), but still hard-capped to keep a single
   * export request bounded. */
  async findAllForProject(projectId: string, limit = 5000): Promise<TaskDocument[]> {
    return this.model
      .find({ project: new Types.ObjectId(projectId), deletedAt: null })
      .populate('assignee', POPULATE_FIELDS)
      .sort({ rank: 1, createdAt: 1 })
      .limit(limit)
      .exec();
  }

  /** Distinct, currently-in-use values for a JQL autocomplete field, scoped to the org - e.g. the
   * real status names or issue types staff have actually used, rather than a fixed enum (both are
   * project-workflow-customizable, so there's no single fixed list to offer instead). */
  async distinctValues(
    field: 'issueType' | 'status' | 'labels' | 'components',
    organizationId: string,
  ): Promise<string[]> {
    const values = await this.model.distinct(field, {
      organizationId: new Types.ObjectId(organizationId),
      deletedAt: null,
    });
    return (values as unknown[]).filter((v): v is string => typeof v === 'string').sort();
  }

  /** Re-spaces every task in a scope evenly by RANK_STEP, in their current rank order. */
  async renumberScope(scope: RankScope): Promise<void> {
    const tasks = await this.model
      .find({ project: scope.project, sprint: scope.sprint, deletedAt: null })
      .sort({ rank: 1, createdAt: 1 })
      .select('_id')
      .exec();
    if (tasks.length === 0) return;

    const ranks = renumberedRanks(tasks.length);
    await this.model.bulkWrite(
      tasks.map((task, index) => ({
        updateOne: { filter: { _id: task._id }, update: { rank: ranks[index] } },
      })),
    );
  }
}
