import { Module } from '@nestjs/common';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsModule } from '../projects/projects.module';
import { ImportExportService } from './import-export.service';
import { ImportExportController } from './import-export.controller';

/**
 * Standalone, like PlanningModule/WorkLogsModule: it needs both TasksModule and ProjectsModule,
 * and neither of those has any reason to import it back, so it has no natural "parent" module and
 * is registered directly in app.module.ts.
 */
@Module({
  imports: [TasksModule, ProjectsModule],
  controllers: [ImportExportController],
  providers: [ImportExportService],
})
export class ImportExportModule {}
