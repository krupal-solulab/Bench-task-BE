import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Sprint, SprintSchema } from '../sprints/schemas/sprint.schema';
import { AuditLogEntry, AuditLogEntrySchema } from '../audit-log/schemas/audit-log-entry.schema';
import { AdminStatsService } from './admin-stats.service';
import { AdminConsoleController } from './admin-console.controller';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Task.name, schema: TaskSchema },
      { name: Sprint.name, schema: SprintSchema },
      { name: AuditLogEntry.name, schema: AuditLogEntrySchema },
    ]),
  ],
  controllers: [AdminConsoleController],
  providers: [AdminStatsService],
})
export class AdminConsoleModule {}
