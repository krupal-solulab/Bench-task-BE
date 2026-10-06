import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { ReleaseStatus } from '../../common/enums/release-status.enum';
import { StatusCategory } from '../../common/enums/status-category.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { extractId } from '../../common/utils/mongo.util';
import { ProjectsService } from '../projects/projects.service';
import { UsersService } from '../users/users.service';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { ReleasesRepository } from './releases.repository';
import { ReleaseDocument } from './schemas/release.schema';
import { isLegalReleaseTransition, legalReleaseTransitions } from './release-status.rules';
import { buildReleaseNotesMarkdown } from './release-notes.util';
import { ETA_THROUGHPUT_WINDOW_DAYS, ReleaseEta, projectReleaseEta } from './release-eta.util';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { ListReleasesDto } from './dto/list-releases.dto';

export interface ReleaseProgress {
  releaseId: string;
  totalIssues: number;
  doneIssues: number;
  progress: number;
  unreleasedIssues: Array<{
    id: string;
    issueKey: string | null;
    title: string;
    status: string;
    statusCategory: string;
  }>;
  /** Module 9 gap-closure: projected completion (additive - absent fields never changed). */
  eta: ReleaseEta;
}

/** Module 9 gap-closure: one row of a project's release forecast. */
export interface ReleaseForecastRow {
  releaseId: string;
  name: string;
  releaseDate: Date | null;
  totalIssues: number;
  doneIssues: number;
  progress: number;
  eta: ReleaseEta;
}

export interface ReleaseCompareIssue {
  id: string;
  issueKey: string | null;
  title: string;
  statusCategory: string;
}

export interface ReleaseCompareResult {
  onlyInA: ReleaseCompareIssue[];
  onlyInB: ReleaseCompareIssue[];
  inBoth: ReleaseCompareIssue[];
}

export interface ReleaseNotes {
  releaseId: string;
  releaseName: string;
  issueCount: number;
  markdown: string;
  generatedAt: Date;
}

@Injectable()
export class ReleasesService {
  constructor(
    private readonly releasesRepository: ReleasesRepository,
    private readonly projectsService: ProjectsService,
    private readonly usersService: UsersService,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  /** The owner is purely informational (doesn't gate any action) so it only needs to be a real,
   * active user in the same org - not a project member, the way an assignee must be. */
  private async assertOwnerEligible(ownerId: string, organizationId: string): Promise<void> {
    await this.usersService.findByIdInOrgOrThrow(ownerId, organizationId);
  }

  async create(
    projectId: string,
    dto: CreateReleaseDto,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseDocument> {
    const project = await this.projectsService.getWritableProjectOrThrow(projectId);
    this.projectsService.assertUserCanManage(project, actingUser);

    if (await this.releasesRepository.nameExistsInProject(projectId, dto.name)) {
      throw new ConflictException(`A release named "${dto.name}" already exists in this project`);
    }
    if (dto.ownerId) {
      await this.assertOwnerEligible(dto.ownerId, extractId(project.organizationId));
    }

    return this.releasesRepository.create({
      name: dto.name,
      description: dto.description ?? '',
      project: new Types.ObjectId(projectId),
      releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null,
      ownerId: dto.ownerId ? new Types.ObjectId(dto.ownerId) : null,
      createdBy: new Types.ObjectId(actingUser.id),
      organizationId: project.organizationId,
    });
  }

  async paginate(projectId: string, query: ListReleasesDto, actingUser: AuthenticatedUser) {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const { data, total } = await this.releasesRepository.paginate(projectId, query);
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async findOneScoped(
    projectId: string,
    releaseId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    return this.getActiveOrThrow(releaseId, projectId);
  }

  async update(
    projectId: string,
    releaseId: string,
    dto: UpdateReleaseDto,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseDocument> {
    const project = await this.projectsService.getWritableProjectOrThrow(projectId);
    this.projectsService.assertUserCanManage(project, actingUser);
    const release = await this.getActiveOrThrow(releaseId, projectId);

    if (release.status === ReleaseStatus.ARCHIVED) {
      throw new ConflictException('An archived release cannot be edited');
    }
    if (dto.name && dto.name !== release.name) {
      if (await this.releasesRepository.nameExistsInProject(projectId, dto.name, releaseId)) {
        throw new ConflictException(`A release named "${dto.name}" already exists in this project`);
      }
    }
    if (dto.ownerId) {
      await this.assertOwnerEligible(dto.ownerId, extractId(project.organizationId));
    }

    const updated = await this.releasesRepository.updateById(releaseId, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.releaseDate !== undefined
        ? { releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null }
        : {}),
      ...(dto.ownerId !== undefined
        ? { ownerId: dto.ownerId ? new Types.ObjectId(dto.ownerId) : null }
        : {}),
    });
    return updated!;
  }

  async transition(
    projectId: string,
    releaseId: string,
    to: ReleaseStatus,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseDocument> {
    const project = await this.projectsService.getWritableProjectOrThrow(projectId);
    this.projectsService.assertUserCanManage(project, actingUser);
    const release = await this.getActiveOrThrow(releaseId, projectId);

    if (release.status === to) return release;
    if (!isLegalReleaseTransition(release.status, to)) {
      throw new ConflictException(
        `Cannot transition from ${release.status} to ${to}. Allowed: ` +
          `${legalReleaseTransitions(release.status).join(', ') || 'none'}`,
      );
    }

    const updated = await this.releasesRepository.updateById(releaseId, {
      status: to,
      // Set once, on first release; reverting to Unreleased does NOT clear it, so "was this ever
      // released, and when" stays answerable even after an unrelease/re-release cycle.
      ...(to === ReleaseStatus.RELEASED && !release.releasedAt ? { releasedAt: new Date() } : {}),
    });
    return updated!;
  }

  /** The BRD's "restore from archive" action - restores to whichever of Released/Unreleased the
   * release effectively was before archiving, decided from releasedAt (set once on first release
   * and never cleared - see the schema's own comment) rather than a single fixed target. */
  async unarchive(
    projectId: string,
    releaseId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseDocument> {
    const release = await this.getActiveOrThrow(releaseId, projectId);
    const target = release.releasedAt ? ReleaseStatus.RELEASED : ReleaseStatus.UNRELEASED;
    return this.transition(projectId, releaseId, target, actingUser);
  }

  async remove(projectId: string, releaseId: string, actingUser: AuthenticatedUser): Promise<void> {
    const project = await this.projectsService.getWritableProjectOrThrow(projectId);
    this.projectsService.assertUserCanManage(project, actingUser);
    const release = await this.getActiveOrThrow(releaseId, projectId);

    await this.releasesRepository.softDelete(releaseId);
    // Detach the deleted release from every task that referenced it, so a populated
    // fixVersions/affectsVersions array never carries a dangling id.
    await this.taskModel.updateMany(
      {
        project: release.project,
        $or: [{ fixVersions: release._id }, { affectsVersions: release._id }],
      },
      { $pull: { fixVersions: release._id, affectsVersions: release._id } },
    );
  }

  async progress(
    projectId: string,
    releaseId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseProgress> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const release = await this.getActiveOrThrow(releaseId, projectId);

    const filter = { fixVersions: release._id, deletedAt: null };
    const [totalIssues, doneIssues, unreleasedTasks] = await Promise.all([
      this.taskModel.countDocuments(filter),
      this.taskModel.countDocuments({ ...filter, statusCategory: StatusCategory.DONE }),
      this.taskModel
        .find({ ...filter, statusCategory: { $ne: StatusCategory.DONE } })
        .select('issueKey title status statusCategory')
        .exec(),
    ]);

    const now = new Date();
    const since = new Date(now.getTime() - ETA_THROUGHPUT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [releaseDoneInWindow, projectDoneInWindow] = await Promise.all([
      this.taskModel.countDocuments({ ...filter, completedAt: { $gte: since } }),
      this.countProjectDoneSince(project._id, since),
    ]);

    return {
      releaseId,
      totalIssues,
      doneIssues,
      progress: totalIssues > 0 ? Math.round((doneIssues / totalIssues) * 100) : 0,
      eta: projectReleaseEta({
        totalIssues,
        doneIssues,
        releaseDoneInWindow,
        projectDoneInWindow,
        releaseDate: release.releaseDate,
        now,
      }),
      unreleasedIssues: unreleasedTasks.map((t) => ({
        id: t.id,
        issueKey: t.issueKey,
        title: t.title,
        status: t.status,
        statusCategory: t.statusCategory,
      })),
    };
  }

  /**
   * Module 9 gap-closure: an ETA forecast for every unreleased release in the project - one
   * aggregation for all releases' counts rather than N progress() calls, so the dashboard gadget
   * stays a single request.
   */
  async forecast(projectId: string, actingUser: AuthenticatedUser): Promise<ReleaseForecastRow[]> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    // Soonest target date first; releases with no target date last (Mongo would sort nulls first).
    const releases = (await this.releasesRepository.findUnreleasedInProject(projectId)).sort(
      (a, b) =>
        (a.releaseDate?.getTime() ?? Number.POSITIVE_INFINITY) -
        (b.releaseDate?.getTime() ?? Number.POSITIVE_INFINITY),
    );
    if (releases.length === 0) return [];

    const now = new Date();
    const since = new Date(now.getTime() - ETA_THROUGHPUT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
    const [rows, projectDoneInWindow] = await Promise.all([
      this.taskModel.aggregate<{
        _id: Types.ObjectId;
        total: number;
        done: number;
        recent: number;
      }>([
        { $match: { fixVersions: { $in: releases.map((r) => r._id) }, deletedAt: null } },
        { $unwind: '$fixVersions' },
        { $match: { fixVersions: { $in: releases.map((r) => r._id) } } },
        {
          $group: {
            _id: '$fixVersions',
            total: { $sum: 1 },
            done: {
              $sum: { $cond: [{ $eq: ['$statusCategory', StatusCategory.DONE] }, 1, 0] },
            },
            recent: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$statusCategory', StatusCategory.DONE] },
                      { $gte: ['$completedAt', since] },
                    ],
                  },
                  1,
                  0,
                ],
              },
            },
          },
        },
      ]),
      this.countProjectDoneSince(project._id, since),
    ]);
    const countsById = new Map(rows.map((r) => [r._id.toString(), r]));

    return releases.map((release) => {
      const counts = countsById.get(release.id) ?? { total: 0, done: 0, recent: 0 };
      return {
        releaseId: release.id,
        name: release.name,
        releaseDate: release.releaseDate,
        totalIssues: counts.total,
        doneIssues: counts.done,
        progress: counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0,
        eta: projectReleaseEta({
          totalIssues: counts.total,
          doneIssues: counts.done,
          releaseDoneInWindow: counts.recent,
          projectDoneInWindow,
          releaseDate: release.releaseDate,
          now,
        }),
      };
    });
  }

  private countProjectDoneSince(projectObjectId: Types.ObjectId, since: Date): Promise<number> {
    return this.taskModel.countDocuments({
      project: projectObjectId,
      deletedAt: null,
      statusCategory: StatusCategory.DONE,
      completedAt: { $gte: since },
    });
  }

  /**
   * Module 2's version comparison - a scope diff between two releases' issue sets (which issues
   * are only tagged with A, only with B, or both), not a historical diff. "Moved out of a release"
   * (an issue that WAS tagged, then had the fixVersion removed) isn't tracked here: fixVersions
   * changes were never audit-logged (see TasksService.update), so there's no history to read - a
   * documented scope limitation, not an oversight.
   */
  async compare(
    projectId: string,
    releaseIdA: string,
    releaseIdB: string,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseCompareResult> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const [releaseA, releaseB] = await Promise.all([
      this.getActiveOrThrow(releaseIdA, projectId),
      this.getActiveOrThrow(releaseIdB, projectId),
    ]);

    const [tasksA, tasksB] = await Promise.all([
      this.taskModel
        .find({ fixVersions: releaseA._id, deletedAt: null })
        .select('issueKey title statusCategory')
        .exec(),
      this.taskModel
        .find({ fixVersions: releaseB._id, deletedAt: null })
        .select('issueKey title statusCategory')
        .exec(),
    ]);

    const toCompareIssue = (t: (typeof tasksA)[number]): ReleaseCompareIssue => ({
      id: t.id,
      issueKey: t.issueKey,
      title: t.title,
      statusCategory: t.statusCategory,
    });
    const idsA = new Set(tasksA.map((t) => t.id));
    const idsB = new Set(tasksB.map((t) => t.id));

    return {
      onlyInA: tasksA.filter((t) => !idsB.has(t.id)).map(toCompareIssue),
      onlyInB: tasksB.filter((t) => !idsA.has(t.id)).map(toCompareIssue),
      inBoth: tasksA.filter((t) => idsB.has(t.id)).map(toCompareIssue),
    };
  }

  /** See release-notes.util.ts's own doc comment: a deterministic composer from real completed-
   * issue data, not a real LLM call - no LLM provider exists anywhere in this codebase. */
  async releaseNotes(
    projectId: string,
    releaseId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseNotes> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const release = await this.getActiveOrThrow(releaseId, projectId);

    const doneTasks = await this.taskModel
      .find({ fixVersions: release._id, deletedAt: null, statusCategory: StatusCategory.DONE })
      .select('issueKey title issueType')
      .exec();

    const markdown = buildReleaseNotesMarkdown(
      release.name,
      doneTasks.map((t) => ({ issueKey: t.issueKey, title: t.title, issueType: t.issueType })),
    );

    return {
      releaseId,
      releaseName: release.name,
      issueCount: doneTasks.length,
      markdown,
      generatedAt: new Date(),
    };
  }

  /** Used by TasksService to validate a task's fixVersions/affectsVersions before saving - throws
   * with every unknown/cross-project id named, rather than failing on just the first one found. */
  async validateIdsForProject(projectId: string, ids: string[]): Promise<void> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return;

    const found = await this.releasesRepository.findManyActiveInProject(uniqueIds, projectId);
    const foundIds = new Set(found.map((r) => r.id));
    const unknown = uniqueIds.filter((id) => !foundIds.has(id));
    if (unknown.length > 0) {
      throw new BadRequestException(
        `Unknown release id(s) for this project: ${unknown.join(', ')}`,
      );
    }
  }

  /** Module 12 gap-closure: id -> name for the field-level audit trail (unknown ids omitted). */
  async namesForIds(projectId: string, ids: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return new Map();
    const found = await this.releasesRepository.findManyActiveInProject(uniqueIds, projectId);
    return new Map(found.map((r) => [r.id, r.name]));
  }

  private async getActiveOrThrow(releaseId: string, projectId: string): Promise<ReleaseDocument> {
    const release = await this.releasesRepository.findByIdActiveInProject(releaseId, projectId);
    if (!release) throw new NotFoundException('Release not found');
    return release;
  }
}
