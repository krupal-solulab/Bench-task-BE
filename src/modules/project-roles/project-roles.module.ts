import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import {
  ProjectRoleDefinition,
  ProjectRoleDefinitionSchema,
} from './schemas/project-role-definition.schema';
import { ProjectRolesRepository } from './project-roles.repository';
import { ProjectRolesService } from './project-roles.service';
import { ProjectRolesController } from './project-roles.controller';

/** Standalone, like PermissionSchemesModule: registers its own handle on the `Project` collection
 * (for the "is this role still assigned anywhere" delete-guard) rather than importing
 * ProjectsModule, since ProjectsModule itself needs to import this module (to validate a Role
 * Assignment's projectRoleId) - importing ProjectsModule back here would be a genuine cycle. */
@Module({
  imports: [
    AuditLogModule,
    MongooseModule.forFeature([
      { name: ProjectRoleDefinition.name, schema: ProjectRoleDefinitionSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [ProjectRolesController],
  providers: [ProjectRolesRepository, ProjectRolesService],
  exports: [ProjectRolesService],
})
export class ProjectRolesModule {}
