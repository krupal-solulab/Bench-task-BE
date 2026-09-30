import { Injectable } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectPinoLogger, PinoLogger } from 'nestjs-pino';
import { ProjectsRepository } from '../projects/projects.repository';
import { ImportExportService } from './import-export.service';

/** Module 5 gap-closure: daily scheduled project backups - mirrors TasksDueDateReminderService/
 * SlaBreachTriggerService's own cron pattern exactly, at a daily (not hourly) cadence since a
 * project's configuration/issue snapshot doesn't need to be captured more often than that. One
 * project's failure (e.g. a transient DB error) doesn't stop the sweep for the rest. */
@Injectable()
export class ProjectBackupsTriggerService {
  constructor(
    private readonly projectsRepository: ProjectsRepository,
    private readonly importExportService: ImportExportService,
    @InjectPinoLogger(ProjectBackupsTriggerService.name) private readonly logger: PinoLogger,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async handleDailyBackups(): Promise<void> {
    const projects = await this.projectsRepository.findAllActive();
    this.logger.debug({ count: projects.length }, 'running daily scheduled project backups');

    for (const project of projects) {
      try {
        await this.importExportService.snapshotProjectForCron(project);
      } catch (err) {
        this.logger.warn({ err, projectId: project.id }, 'scheduled backup failed for a project');
      }
    }
  }
}
