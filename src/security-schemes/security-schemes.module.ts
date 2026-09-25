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
import { SecurityScheme, SecuritySchemeSchema } from './schemas/security-scheme.schema';
import { SecuritySchemesRepository } from './security-schemes.repository';
import { SecuritySchemesService } from './security-schemes.service';
import { SecuritySchemesController } from './security-schemes.controller';

@Module({
  imports: [
    UsersModule,
    AuditLogModule,
    MongooseModule.forFeature([
      { name: SecurityScheme.name, schema: SecuritySchemeSchema },
      { name: Project.name, schema: ProjectSchema },
      { name: Team.name, schema: TeamSchema },
      { name: ProjectRoleDefinition.name, schema: ProjectRoleDefinitionSchema },
    ]),
  ],
  controllers: [SecuritySchemesController],
  providers: [SecuritySchemesRepository, SecuritySchemesService],
  exports: [SecuritySchemesService],
})
export class SecuritySchemesModule {}
