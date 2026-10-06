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
        .populate('externalReferences.addedBy', POPULATE_FIELDS)
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

  /** Same populate shape as `paginateWithFilter`, but unpaginated (hard-capped) - the JQL search
   * export's row source, mirroring `findAllForProject`'s own "unpaginated but bounded" shape. */
  async findAllWithFilter(
    filter: FilterQuery<TaskDocument>,
    sort: Record<string, 1 | -1>,
    limit = 5000,
  ): Promise<TaskDocument[]> {
    return this.model
      .find(filter)
      .populate('assignee', POPULATE_FIELDS)
      .populate('project', 'name')
      .sort(sort)
      .limit(limit)
      .exec();
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

  /** Module 7 gap-closure - `$push` appends, letting Mongoose assign the subdocument its own
   * `_id` (see ExternalReference's own doc comment for why this one, unlike most embedded arrays
   * in this codebase, is keyed by a real `_id` rather than a natural-identity field). */
  async addExternalReference(
    id: string,
    entry: { label: string; url: string; addedBy: Types.ObjectId; addedAt: Date },
  ): Promise<TaskDocument | null> {
    await this.model.updateOne({ _id: id }, { $push: { externalReferences: entry } }).exec();
    return this.findByIdActive(id);
  }

  async removeExternalReference(id: string, referenceId: string): Promise<TaskDocument | null> {
    await this.model
      .updateOne(
        { _id: id },
        { $pull: { externalReferences: { _id: new Types.ObjectId(referenceId) } } },
      )
      .exec();
    return this.findByIdActive(id);
  }

  async softDelete(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: new Date() }).exec();
  }

  /** Module 5 gap-closure: the undo half of softDelete - reachable only via a bulk operation's
   * undo, not a standalone "restore" endpoint (a deliberate scope line - see BulkOperationLog's own
   * doc comment). */
  async restoreById(id: string): Promise<void> {
    await this.model.updateOne({ _id: id }, { deletedAt: null }).exec();
  }

  /** Includes soft-deleted tasks - the undo-a-bulk-delete path needs the deleted task's project. */
  findIncludingDeleted(id: string): Promise<TaskDocument | null> {
    return this.model.findById(id).select('project').exec();
  }

  /** Whether a task has any non-deleted children (sub-tasks, or Standard-level issues linked to an
   * Epic) - Module 5's move-project blocks moving a task with children, since a child's parent must
   * stay in the same project as the child (assertValidHierarchy). */
  async hasChildren(taskId: string): Promise<boolean> {
    return (
      (await this.model.exists({ parent: new Types.ObjectId(taskId), deletedAt: null })) !== null
    );
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
    field: string | null = null,
  ): Promise<void> {
    await this.activityModel.create({
      task: new Types.ObjectId(taskId),
      actor: new Types.ObjectId(actorId),
      action,
      from,
      to,
      viaAutomationRule,
      field,
    });
  }

  /**
   * Module 12 gap-closure: atomically records one approver's vote on the pending request - only if
   * a request is still pending and this user hasn't already voted - so two approvers clicking at
   * once can never lose a vote or double-count one. Null when nothing was recorded.
   */
  async addApprovalVote(id: string, userId: string): Promise<TaskDocument | null> {
    const user = new Types.ObjectId(userId);
    return this.model
      .findOneAndUpdate(
        {
          _id: id,
          deletedAt: null,
          pendingApproval: { $ne: null },
          'pendingApproval.approvals.user': { $ne: user },
        },
        { $push: { 'pendingApproval.approvals': { user, at: new Date() } } },
        { new: true },
      )
      .exec();
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

  /** Module 10's issue summary: the full (capped) activity history for one task, ascending, so
   * the summary composer can find the most recent status change without a second sort. Capped
   * rather than truly unbounded - same defensive bound as `findAllForProject`'s CSV export. */
  async findActivityForSummary(
    taskId: string,
    limit = 500,
  ): Promise<Array<{ action: TaskActivityAction; createdAt: Date }>> {
    return this.activityModel
      .find({ task: new Types.ObjectId(taskId) }, { action: 1, createdAt: 1 })
      .sort({ createdAt: 1 })
      .limit(limit)
      .lean();
  }

  /** Module 11 gap-closure: a page of activity, newest first, actor name populated. */
  findActivityBatch(filter: FilterQuery<TaskActivityDocument>, limit: number) {
    return this.activityModel
      .find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .populate('actor', 'name')
      .lean();
  }

  /** Module 11 gap-closure: ids of tasks matching a (visibility-scoped) filter. */
  async findIds(filter: FilterQuery<TaskDocument>, limit: number): Promise<Types.ObjectId[]> {
    const rows = await this.model.find(filter).select('_id').limit(limit).lean();
    return rows.map((r) => r._id as Types.ObjectId);
  }

  /** Module 11 gap-closure: id/key/title of tasks matching a (visibility-scoped) filter. */
  findSummaries(filter: FilterQuery<TaskDocument>) {
    return this.model.find(filter).select('title issueKey').lean();
  }

  /** Module 10 gap-closure: the candidate pool duplicate detection scores (newest first). */
  findSimilarityCandidates(filter: FilterQuery<TaskDocument>, limit: number) {
    return this.model
      .find(filter)
      .select('title description issueKey status statusCategory')
      .sort({ updatedAt: -1 })
      .limit(limit)
      .lean();
  }

  /** Module 10 gap-closure: the fields risk flagging reads, for open tasks. */
  findForRisk(filter: FilterQuery<TaskDocument>, limit: number) {
    return this.model
      .find(filter)
      .select('title issueKey status statusCategory priority assignee dueDate createdAt')
      .populate('assignee', 'name email')
      .limit(limit)
      .lean();
  }

  /** Module 10 gap-closure: each task's most recent STATUS_CHANGED time. */
  async lastStatusChangeByTask(taskIds: Types.ObjectId[]): Promise<Map<string, Date>> {
    if (taskIds.length === 0) return new Map();
    const rows = await this.activityModel
      .aggregate<{ _id: Types.ObjectId; at: Date }>([
        { $match: { task: { $in: taskIds }, action: TaskActivityAction.STATUS_CHANGED } },
        { $group: { _id: '$task', at: { $max: '$createdAt' } } },
      ])
      .exec();
    return new Map(rows.map((r) => [r._id.toString(), r.at]));
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

  /** Every non-deleted task in a sprint, projected down to just what Module 3's sprint-level
   * time-spent-vs-estimate report needs. */
  findBySprintRaw(sprintId: string): Promise<TaskDocument[]> {
    return this.model
      .find({ sprint: new Types.ObjectId(sprintId), deletedAt: null })
      .select('issueKey title storyPoints originalEstimateHours')
      .exec();
  }

  /** Every non-deleted, story-pointed task in a project - the population Module 3's story-point-
   * to-time correlation report scatters against actual logged hours. */
  findWithStoryPointsForProject(projectId: string): Promise<TaskDocument[]> {
    return this.model
      .find({
        project: new Types.ObjectId(projectId),
        deletedAt: null,
        storyPoints: { $ne: null },
      })
      .select('issueKey title storyPoints')
      .exec();
  }

  /** Sum of every non-deleted task's original estimate in a project - the project-wide half of
   * Module 3's estimate-vs-actual rollup (the "actual" half comes from WorkLog, not Task). */
  async sumEstimateHoursForProject(projectId: string): Promise<number> {
    const rows = await this.model.aggregate<{ _id: null; total: number }>([
      {
        $match: {
          project: new Types.ObjectId(projectId),
          deletedAt: null,
          originalEstimateHours: { $ne: null },
        },
      },
      { $group: { _id: null, total: { $sum: '$originalEstimateHours' } } },
    ]);
    return rows[0]?.total ?? 0;
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
