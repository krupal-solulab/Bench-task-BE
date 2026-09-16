import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../modules/users/users.module';
import { Project, ProjectSchema } from '../modules/projects/schemas/project.schema';
import { PermissionScheme, PermissionSchemeSchema } from './schemas/permission-scheme.schema';
import { PermissionSchemesRepository } from './permission-schemes.repository';
import { PermissionSchemesService } from './permission-schemes.service';
import { PermissionSchemesController } from './permission-schemes.controller';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: PermissionScheme.name, schema: PermissionSchemeSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [PermissionSchemesController],
  providers: [PermissionSchemesRepository, PermissionSchemesService],
  exports: [PermissionSchemesService],
})
export class PermissionSchemesModule {}
