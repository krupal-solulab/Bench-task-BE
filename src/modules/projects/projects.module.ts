import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { PermissionSchemesModule } from '../../permission-schemes/permission-schemes.module';
import { SecuritySchemesModule } from '../../security-schemes/security-schemes.module';
import { FieldPermissionSchemesModule } from '../../field-permission-schemes/field-permission-schemes.module';
import { TeamsModule } from '../teams/teams.module';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { CustomRolesModule } from '../custom-roles/custom-roles.module';
import { ProjectRolesModule } from '../project-roles/project-roles.module';
import { Task, TaskSchema } from '../tasks/schemas/task.schema';
import { TaskActivity, TaskActivitySchema } from '../tasks/schemas/task-activity.schema';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { Sprint, SprintSchema } from '../sprints/schemas/sprint.schema';
import { Project, ProjectSchema } from './schemas/project.schema';
import { ProjectActivity, ProjectActivitySchema } from './schemas/project-activity.schema';
import {
  ProjectCategory,
  ProjectCategorySchema,
} from '../project-categories/schemas/project-category.schema';
import { ProjectsRepository } from './projects.repository';
import { ProjectsService } from './projects.service';
import { ProjectsController } from './projects.controller';

@Module({
  imports: [
    UsersModule,
    PermissionSchemesModule,
    SecuritySchemesModule,
    FieldPermissionSchemesModule,
    TeamsModule,
    ProjectRolesModule,
    CustomRolesModule,
    AuditLogModule,
    MongooseModule.forFeature([
      { name: Project.name, schema: ProjectSchema },
      { name: ProjectActivity.name, schema: ProjectActivitySchema },
      { name: Task.name, schema: TaskSchema },
      { name: TaskActivity.name, schema: TaskActivitySchema },
      { name: Comment.name, schema: CommentSchema },
      { name: Sprint.name, schema: SprintSchema },
      { name: ProjectCategory.name, schema: ProjectCategorySchema },
    ]),
  ],
  controllers: [ProjectsController],
  providers: [ProjectsRepository, ProjectsService],
  exports: [ProjectsService, ProjectsRepository, MongooseModule],
})
export class ProjectsModule {}
