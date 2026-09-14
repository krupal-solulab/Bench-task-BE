import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Sprint, SprintSchema } from './schemas/sprint.schema';
import { SprintActivity, SprintActivitySchema } from './schemas/sprint-activity.schema';
import { SprintsRepository } from './sprints.repository';
import { SprintsService } from './sprints.service';
import { SprintsController } from './sprints.controller';

@Module({
  imports: [
    ProjectsModule,
    MongooseModule.forFeature([
      { name: Sprint.name, schema: SprintSchema },
      { name: SprintActivity.name, schema: SprintActivitySchema },
      { name: Task.name, schema: TaskSchema },
    ]),
  ],
  controllers: [SprintsController],
  providers: [SprintsRepository, SprintsService],
  exports: [SprintsService, SprintsRepository, MongooseModule],
})
export class SprintsModule {}
