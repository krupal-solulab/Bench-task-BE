import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../modules/audit-log/audit-log.module';
import { Project, ProjectSchema } from '../modules/projects/schemas/project.schema';
import {
  FieldPermissionScheme,
  FieldPermissionSchemeSchema,
} from './schemas/field-permission-scheme.schema';
import { FieldPermissionSchemesRepository } from './field-permission-schemes.repository';
import { FieldPermissionSchemesService } from './field-permission-schemes.service';
import { FieldPermissionSchemesController } from './field-permission-schemes.controller';

@Module({
  imports: [
    AuditLogModule,
    MongooseModule.forFeature([
      { name: FieldPermissionScheme.name, schema: FieldPermissionSchemeSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [FieldPermissionSchemesController],
  providers: [FieldPermissionSchemesRepository, FieldPermissionSchemesService],
  exports: [FieldPermissionSchemesService],
})
export class FieldPermissionSchemesModule {}
