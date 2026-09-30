import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsModule } from '../projects/projects.module';
import { ImportExportService } from './import-export.service';
import { ImportExportController } from './import-export.controller';
import { ProjectBackupSnapshotsRepository } from './project-backup-snapshots.repository';
import { ProjectBackupsTriggerService } from './project-backups-trigger.service';
import {
  ProjectBackupSnapshot,
  ProjectBackupSnapshotSchema,
} from './schemas/project-backup-snapshot.schema';

/**
 * Standalone, like PlanningModule/WorkLogsModule: it needs both TasksModule and ProjectsModule,
 * and neither of those has any reason to import it back, so it has no natural "parent" module and
 * is registered directly in app.module.ts.
 */
@Module({
  imports: [
    TasksModule,
    ProjectsModule,
    MongooseModule.forFeature([
      { name: ProjectBackupSnapshot.name, schema: ProjectBackupSnapshotSchema },
    ]),
  ],
  controllers: [ImportExportController],
  providers: [ImportExportService, ProjectBackupSnapshotsRepository, ProjectBackupsTriggerService],
})
export class ImportExportModule {}
