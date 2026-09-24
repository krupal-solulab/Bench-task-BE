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
import { ProjectsService } from '../projects/projects.service';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { ReleasesRepository } from './releases.repository';
import { ReleaseDocument } from './schemas/release.schema';
import { isLegalReleaseTransition, legalReleaseTransitions } from './release-status.rules';
import { buildReleaseNotesMarkdown } from './release-notes.util';
import { CreateReleaseDto } from './dto/create-release.dto';
import { UpdateReleaseDto } from './dto/update-release.dto';
import { ListReleasesDto } from './dto/list-releases.dto';

export interface ReleaseProgress {
  releaseId: string;
  totalIssues: number;
  doneIssues: number;
  progress: number;
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
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  async create(
    projectId: string,
    dto: CreateReleaseDto,
    actingUser: AuthenticatedUser,
  ): Promise<ReleaseDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanManage(project, actingUser);

    if (await this.releasesRepository.nameExistsInProject(projectId, dto.name)) {
      throw new ConflictException(`A release named "${dto.name}" already exists in this project`);
    }

    return this.releasesRepository.create({
      name: dto.name,
      description: dto.description ?? '',
      project: new Types.ObjectId(projectId),
      releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null,
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
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
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

    const updated = await this.releasesRepository.updateById(releaseId, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
      ...(dto.releaseDate !== undefined
        ? { releaseDate: dto.releaseDate ? new Date(dto.releaseDate) : null }
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
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
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

  async remove(projectId: string, releaseId: string, actingUser: AuthenticatedUser): Promise<void> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
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
    const [totalIssues, doneIssues] = await Promise.all([
      this.taskModel.countDocuments(filter),
      this.taskModel.countDocuments({ ...filter, statusCategory: StatusCategory.DONE }),
    ]);

    return {
      releaseId,
      totalIssues,
      doneIssues,
      progress: totalIssues > 0 ? Math.round((doneIssues / totalIssues) * 100) : 0,
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

  private async getActiveOrThrow(releaseId: string, projectId: string): Promise<ReleaseDocument> {
    const release = await this.releasesRepository.findByIdActiveInProject(releaseId, projectId);
    if (!release) throw new NotFoundException('Release not found');
    return release;
  }
}
