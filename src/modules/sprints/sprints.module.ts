import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { TaskActivity, TaskActivitySchema } from '../tasks/schemas/task-activity.schema';
import { Sprint, SprintSchema } from './schemas/sprint.schema';
import { SprintActivity, SprintActivitySchema } from './schemas/sprint-activity.schema';
import { SprintsRepository } from './sprints.repository';
import { SprintsService } from './sprints.service';
import { SprintsController } from './sprints.controller';

@Module({
  imports: [
    ProjectsModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Sprint.name, schema: SprintSchema },
      { name: SprintActivity.name, schema: SprintActivitySchema },
      { name: Task.name, schema: TaskSchema },
      { name: TaskActivity.name, schema: TaskActivitySchema },
    ]),
  ],
  controllers: [SprintsController],
  providers: [SprintsRepository, SprintsService],
  exports: [SprintsService, SprintsRepository, MongooseModule],
})
export class SprintsModule {}
