import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { TaskPriority } from '../../common/enums/task-priority.enum';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';
import { TasksRepository } from '../tasks/tasks.repository';
import { CreateTaskDto } from '../tasks/dto/create-task.dto';
import { buildCsv, parseCsv } from './csv.util';
import { ImportTasksDto } from './dto/import-tasks.dto';

const EXPORT_COLUMNS = [
  'issueKey',
  'title',
  'description',
  'issueType',
  'status',
  'priority',
  'assignee',
  'storyPoints',
  'labels',
  'components',
  'dueDate',
  'createdAt',
] as const;

const MAX_IMPORT_ROWS = 500;

export interface CsvExportResult {
  filename: string;
  csv: string;
}

export interface ImportRowSuccess {
  row: number;
  issueKey: string | null;
  taskId: string;
}

export interface ImportRowFailure {
  row: number;
  message: string;
}

export interface ImportTasksResult {
  succeeded: ImportRowSuccess[];
  failed: ImportRowFailure[];
}

export interface ProjectBackup {
  exportedAt: string;
  project: {
    name: string;
    key: string | null;
    description: string;
    boardType: string;
    components: string[];
    customFields: unknown[];
    customFieldOverridesByType: unknown[];
    automationRules: unknown[];
    issueTypes: unknown[];
    workflow: unknown;
    workflowsByType: unknown[];
    slaPolicy: unknown[];
    notificationScheme: unknown[];
  };
  tasks: unknown[];
}

export interface ProjectBackupResult {
  filename: string;
  backup: ProjectBackup;
}

/**
 * Module 5's CSV import/export and project backup - a separate module (not folded into
 * TasksModule/ProjectsModule) for the same reason PlanningModule is its own module: it needs
 * both TasksService and ProjectsService, and importing either into the other would be circular.
 * CSV/backup content travels as a JSON string field (`{csv}`/`{backup}`), not a raw
 * text/csv or file-download HTTP response - this codebase has no existing precedent for bypassing
 * the global JSON success envelope for a real file body (only `@RawResponse()`'s use on health
 * checks, which stays JSON), so the frontend builds the actual downloadable Blob client-side
 * instead of the server managing content-type/disposition headers.
 */
@Injectable()
export class ImportExportService {
  constructor(
    private readonly tasksService: TasksService,
    private readonly tasksRepository: TasksRepository,
    private readonly projectsService: ProjectsService,
  ) {}

  async exportTasksCsv(projectId: string, actingUser: AuthenticatedUser): Promise<CsvExportResult> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanView(project, actingUser);

    const tasks = await this.tasksRepository.findAllForProject(projectId);
    const rows: string[][] = [
      [...EXPORT_COLUMNS],
      ...tasks.map((t) => {
        const assignee = t.assignee as unknown as { name?: string } | null;
        return [
          t.issueKey ?? '',
          t.title,
          t.description,
          t.issueType,
          t.status,
          t.priority,
          assignee?.name ?? '',
          t.storyPoints != null ? String(t.storyPoints) : '',
          t.labels.join(';'),
          t.components.join(';'),
          t.dueDate ? t.dueDate.toISOString().slice(0, 10) : '',
          t.createdAt.toISOString(),
        ];
      }),
    ];

    const datePart = new Date().toISOString().slice(0, 10);
    return {
      filename: `${project.key ?? project.name}-tasks-${datePart}.csv`,
      csv: buildCsv(rows),
    };
  }

  /**
   * Creates one task per data row via the real `TasksService.create()` (so hierarchy/custom-field/
   * component validation and permission checks stay in exactly one place), collecting a per-row
   * result rather than failing the whole import on the first bad row - the same partial-success
   * shape every bulk-* task endpoint already uses.
   */
  async importTasksCsv(
    projectId: string,
    dto: ImportTasksDto,
    actingUser: AuthenticatedUser,
  ): Promise<ImportTasksResult> {
    await this.projectsService.getActiveProjectOrThrow(projectId);

    const rows = parseCsv(dto.csv);
    if (rows.length === 0) {
      throw new BadRequestException('CSV has no rows');
    }
    const [headerRow, ...dataRows] = rows;
    const headers = headerRow!.map((h) => h.trim().toLowerCase());
    if (!headers.includes('title')) {
      throw new BadRequestException('CSV is missing a required "title" column');
    }
    if (dataRows.length > MAX_IMPORT_ROWS) {
      throw new BadRequestException(`Cannot import more than ${MAX_IMPORT_ROWS} rows at once`);
    }

    const get = (cells: string[], name: string): string | undefined => {
      const idx = headers.indexOf(name);
      const value = idx === -1 ? undefined : cells[idx];
      return value?.trim() || undefined;
    };

    const succeeded: ImportRowSuccess[] = [];
    const failed: ImportRowFailure[] = [];

    for (const [i, cells] of dataRows.entries()) {
      // +2: 1-indexed for a human, plus the header row itself.
      const rowNumber = i + 2;
      try {
        const title = get(cells, 'title');
        if (!title) throw new BadRequestException('Missing title');

        const priorityRaw = get(cells, 'priority')?.toUpperCase();
        const priority = (Object.values(TaskPriority) as string[]).includes(priorityRaw ?? '')
          ? (priorityRaw as TaskPriority)
          : TaskPriority.P2;

        const storyPointsRaw = get(cells, 'storypoints');
        const storyPoints = storyPointsRaw ? Number(storyPointsRaw) : undefined;

        const createDto: CreateTaskDto = {
          title,
          description: get(cells, 'description'),
          project: projectId,
          priority,
          dueDate: get(cells, 'duedate'),
          issueType: get(cells, 'issuetype'),
          storyPoints:
            storyPoints !== undefined && !Number.isNaN(storyPoints) ? storyPoints : undefined,
          labels: get(cells, 'labels')
            ?.split(';')
            .map((s) => s.trim())
            .filter(Boolean),
          components: get(cells, 'components')
            ?.split(';')
            .map((s) => s.trim())
            .filter(Boolean),
        };

        const created = await this.tasksService.create(createDto, actingUser);
        succeeded.push({ row: rowNumber, issueKey: created.issueKey, taskId: created.id });
      } catch (err) {
        failed.push({
          row: rowNumber,
          message: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    return { succeeded, failed };
  }

  /**
   * A configuration + issue snapshot for a project (BRD: "project backups") - deliberately scoped
   * to what's portable/restorable-in-principle: project settings and task content, not sprints,
   * releases, comments, attachments, or work logs. Export only; there's no restore-from-backup
   * endpoint - reconstructing a project from this JSON (id remapping, conflict handling) is a
   * meaningfully bigger and riskier feature, deferred rather than half-built here.
   */
  async backupProject(
    projectId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ProjectBackupResult> {
    const project = await this.projectsService.getActiveProjectOrThrow(projectId);
    this.projectsService.assertUserCanManage(project, actingUser);

    const tasks = await this.tasksRepository.findAllForProject(projectId);
    const backup: ProjectBackup = {
      exportedAt: new Date().toISOString(),
      project: {
        name: project.name,
        key: project.key,
        description: project.description,
        boardType: project.boardType,
        components: project.components,
        customFields: project.customFields,
        customFieldOverridesByType: project.customFieldOverridesByType,
        automationRules: project.automationRules,
        issueTypes: project.issueTypes,
        workflow: project.workflow,
        workflowsByType: project.workflowsByType,
        slaPolicy: project.slaPolicy,
        notificationScheme: project.notificationScheme,
      },
      tasks: tasks.map((t) => ({
        issueKey: t.issueKey,
        title: t.title,
        description: t.description,
        issueType: t.issueType,
        status: t.status,
        statusCategory: t.statusCategory,
        priority: t.priority,
        storyPoints: t.storyPoints,
        labels: t.labels,
        components: t.components,
        dueDate: t.dueDate,
        customFieldValues: t.customFieldValues,
        createdAt: t.createdAt,
      })),
    };

    const datePart = new Date().toISOString().slice(0, 10);
    return { filename: `${project.key ?? project.name}-backup-${datePart}.json`, backup };
  }
}
