import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { PermissionSchemesModule } from '../../permission-schemes/permission-schemes.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { Sprint, SprintSchema } from '../sprints/schemas/sprint.schema';
import { Project, ProjectSchema } from './schemas/project.schema';
import { ProjectActivity, ProjectActivitySchema } from './schemas/project-activity.schema';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';

@Module({
  imports: [
    UsersModule,
    PermissionSchemesModule,
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: ProjectActivity.name, schema: ProjectActivitySchema },
      { name: Task.name, schema: TaskSchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Sprint.name, schema: SprintSchema },
    ]),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsRepository, ProjectsService],
  exports: [ProjectsService, ProjectsRepository, MongooseModule],
})
export class ProjectsModule {}
