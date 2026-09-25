import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../modules/users/users.module';
import { AuditLogModule } from '../modules/audit-log/audit-log.module';
import { Project, ProjectSchema } from '../modules/projects/schemas/project.schema';
import { Team, TeamSchema } from '../modules/teams/schemas/team.schema';
import {
  ProjectRoleDefinition,
  ProjectRoleDefinitionSchema,
} from '../modules/project-roles/schemas/project-role-definition.schema';
import { PermissionScheme, PermissionSchemeSchema } from './schemas/permission-scheme.schema';
import { PermissionSchemesRepository } from './permission-schemes.repository';
import { PermissionSchemesService } from './permission-schemes.service';
import { PermissionSchemesController } from './permission-schemes.controller';

@Module({
  imports: [
    UsersModule,
    AuditLogModule,
    MongooseModule.forFeature([
      { name: PermissionScheme.name, schema: PermissionSchemeSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Team.name, schema: TeamSchema },
      { name: ProjectRoleDefinition.name, schema: ProjectRoleDefinitionSchema },
    ]),
  ],
  controllers: [PermissionSchemesController],
  providers: [PermissionSchemesRepository, PermissionSchemesService],
  exports: [PermissionSchemesService],
})
export class PermissionSchemesModule {}
