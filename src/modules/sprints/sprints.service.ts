import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { SprintStatus } from '../../common/enums/sprint-status.enum';
import { StatusCategory } from '../../common/enums/status-category.enum';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { ProjectsService } from '../projects/projects.service';
import { Task, TaskDocument } from '../tasks/schemas/task.schema';
import { SprintsRepository } from './sprints.repository';
import { SprintDocument } from './schemas/sprint.schema';
import { SprintActivityAction } from './schemas/sprint-activity.schema';
import { isLegalSprintTransition, legalSprintTransitions } from './sprint-status.rules';
import { CreateSprintDto } from './dto/create-sprint.dto';
import { UpdateSprintDto } from './dto/update-sprint.dto';
import { ListSprintsDto } from './dto/list-sprints.dto';

@Injectable()
export class SprintsService {
  constructor(
    private readonly sprintsRepository: SprintsRepository,
    private readonly projectsService: ProjectsService,
    @InjectModel(Task.name) private readonly taskModel: Model<TaskDocument>,
  ) {}

  async create(
    projectId: string,
    dto: CreateSprintDto,
    actingUser: AuthenticatedUser,
  ): Promise<SprintDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanManageOrGranted(project, actingUser, 'canManageSprints');

    const startDate = new Date(dto.startDate);
    const endDate = new Date(dto.endDate);
    this.assertValidDateRange(startDate, endDate);

    const sprint = await this.sprintsRepository.create({
      name: dto.name,
      goal: dto.goal ?? '',
      project: new Types.ObjectId(project.id),
      startDate,
      endDate,
      createdBy: new Types.ObjectId(actingUser.id),
      organizationId: project.organizationId,
    });

    await this.sprintsRepository.logActivity(
      sprint.id,
      actingUser.id,
      SprintActivityAction.CREATED,
    );
    return this.sprintsRepository.findByIdActive(sprint.id) as Promise<SprintDocument>;
  }

  async paginate(projectId: string, query: ListSprintsDto, actingUser: AuthenticatedUser) {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    const { data, total } = await this.sprintsRepository.paginate(projectId, query);
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async findActive(
    projectId: string,
    actingUser: AuthenticatedUser,
  ): Promise<SprintDocument | null> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    return this.sprintsRepository.findActiveSprintForProject(projectId);
  }

  async findOneScoped(
    projectId: string,
    sprintId: string,
    actingUser: AuthenticatedUser,
  ): Promise<SprintDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    return this.getActiveOrThrow(sprintId, projectId);
  }

  async update(
    projectId: string,
    sprintId: string,
    dto: UpdateSprintDto,
    actingUser: AuthenticatedUser,
  ): Promise<SprintDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanManageOrGranted(project, actingUser, 'canManageSprints');
    const sprint = await this.getActiveOrThrow(sprintId, projectId);

    if (sprint.status === SprintStatus.COMPLETED) {
      throw new ConflictException('A completed sprint cannot be edited');
    }

    const nextStartDate = dto.startDate ? new Date(dto.startDate) : sprint.startDate;
    const nextEndDate = dto.endDate ? new Date(dto.endDate) : sprint.endDate;
    this.assertValidDateRange(nextStartDate, nextEndDate);

    const updated = await this.sprintsRepository.updateById(sprintId, {
      ...(dto.name ? { name: dto.name } : {}),
      ...(dto.goal !== undefined ? { goal: dto.goal } : {}),
      ...(dto.startDate ? { startDate: nextStartDate } : {}),
      ...(dto.endDate ? { endDate: nextEndDate } : {}),
    });
    await this.sprintsRepository.logActivity(sprintId, actingUser.id, SprintActivityAction.UPDATED);
    return updated!;
  }

  async start(
    projectId: string,
    sprintId: string,
    actingUser: AuthenticatedUser,
  ): Promise<SprintDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanManageOrGranted(project, actingUser, 'canManageSprints');
    const sprint = await this.getActiveOrThrow(sprintId, projectId);

    this.assertLegalTransition(sprint.status, SprintStatus.ACTIVE);

    const existingActive = await this.sprintsRepository.findActiveSprintForProject(projectId);
    if (existingActive) {
      throw new ConflictException(
        `Sprint "${existingActive.name}" is already active for this project - complete it first`,
      );
    }

    const updated = await this.sprintsRepository.updateById(sprintId, {
      status: SprintStatus.ACTIVE,
      startedAt: new Date(),
    });
    await this.sprintsRepository.logActivity(
      sprintId,
      actingUser.id,
      SprintActivityAction.STARTED,
      sprint.status,
      SprintStatus.ACTIVE,
    );
    return updated!;
  }

  async complete(
    projectId: string,
    sprintId: string,
    actingUser: AuthenticatedUser,
  ): Promise<SprintDocument> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanManageOrGranted(project, actingUser, 'canManageSprints');
    const sprint = await this.getActiveOrThrow(sprintId, projectId);

    this.assertLegalTransition(sprint.status, SprintStatus.COMPLETED);

    // Only non-Done-category tasks return to the backlog - Done tasks keep their sprint reference
    // permanently, so a completed sprint's history still shows what it actually finished. Category-
    // based (not the literal "Done") so this works under a custom workflow's differently-named
    // Done status too.
    const { modifiedCount } = await this.taskModel.updateMany(
      { sprint: sprint._id, deletedAt: null, statusCategory: { $ne: StatusCategory.DONE } },
      { sprint: null },
    );

    const updated = await this.sprintsRepository.updateById(sprintId, {
      status: SprintStatus.COMPLETED,
      completedAt: new Date(),
    });
    await this.sprintsRepository.logActivity(
      sprintId,
      actingUser.id,
      SprintActivityAction.COMPLETED,
      sprint.status,
      `${modifiedCount} task(s) moved to backlog`,
    );
    return updated!;
  }

  async remove(projectId: string, sprintId: string, actingUser: AuthenticatedUser): Promise<void> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanManageOrGranted(project, actingUser, 'canManageSprints');
    const sprint = await this.getActiveOrThrow(sprintId, projectId);

    if (sprint.status !== SprintStatus.PLANNED) {
      throw new ConflictException('Only a Planned sprint can be deleted');
    }

    await this.sprintsRepository.softDelete(sprintId);
    await this.sprintsRepository.logActivity(sprintId, actingUser.id, SprintActivityAction.DELETED);
  }

  async listActivity(
    projectId: string,
    sprintId: string,
    page: number,
    limit: number,
    actingUser: AuthenticatedUser,
  ) {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);
    await this.getActiveOrThrow(sprintId, projectId);
    const { data, total } = await this.sprintsRepository.paginateActivity(sprintId, page, limit);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  /** Used by TasksService.updateSprint to validate a sprint before attaching a task to it. */
  async getActiveOrThrow(sprintId: string, projectId: string): Promise<SprintDocument> {
    const sprint = await this.sprintsRepository.findByIdActiveInProject(sprintId, projectId);
    if (!sprint) throw new NotFoundException('Sprint not found');
    return sprint;
  }

  private assertLegalTransition(from: SprintStatus, to: SprintStatus): void {
    if (from === to) return;
    if (!isLegalSprintTransition(from, to)) {
      throw new ConflictException(
        `Cannot transition from ${from} to ${to}. Allowed: ${legalSprintTransitions(from).join(', ') || 'none'}`,
      );
    }
  }

  private assertValidDateRange(startDate: Date, endDate: Date): void {
    if (endDate < startDate) {
      throw new BadRequestException('endDate must be on or after startDate');
    }
  }
}
