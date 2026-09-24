import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsModule } from '../projects/projects.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { WorkLog, WorkLogSchema } from './schemas/work-log.schema';
import { WorkLogsRepository } from './worklogs.repository';
import { WorkLogsService } from './worklogs.service';
import { WorkLogsController } from './worklogs.controller';

// Imports TasksModule directly (for TasksRepository.findRawById) the same way CommentsModule
// does - TasksModule doesn't depend on WorkLogsModule, so this is a safe one-directional edge.
// Registers the User schema directly (rather than importing UsersModule) for the report's
// tiny read-only name lookup - the same "duplicate a tiny read-only query" trade-off
// RoadmapService documents for itself in Module 1.
@Module({
  imports: [
    TasksModule,
    ProjectsModule,
    MongooseModule.forFeature([
      { name: WorkLog.name, schema: WorkLogSchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [WorkLogsController],
  providers: [WorkLogsRepository, WorkLogsService],
  exports: [WorkLogsService],
})
export class WorkLogsModule {}
