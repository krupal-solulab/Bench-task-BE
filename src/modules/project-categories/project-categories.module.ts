import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { ProjectCategory, ProjectCategorySchema } from './schemas/project-category.schema';
import { ProjectCategoriesService } from './project-categories.service';
import { ProjectCategoriesController } from './project-categories.controller';

@Module({
  imports: [
    AuditLogModule,
    MongooseModule.forFeature([
      { name: ProjectCategory.name, schema: ProjectCategorySchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [ProjectCategoriesController],
  providers: [ProjectCategoriesService],
  exports: [ProjectCategoriesService],
})
export class ProjectCategoriesModule {}
