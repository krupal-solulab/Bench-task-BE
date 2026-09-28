import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { Project, ProjectSchema } from '../projects/schemas/project.schema';
import { IssueTemplate, IssueTemplateSchema } from './schemas/issue-template.schema';
import { IssueTemplatesRepository } from './issue-templates.repository';
import { IssueTemplatesService } from './issue-templates.service';
import { IssueTemplatesController } from './issue-templates.controller';

@Module({
  imports: [
    AuditLogModule,
    MongooseModule.forFeature([
      { name: IssueTemplate.name, schema: IssueTemplateSchema },
      { name: Project.name, schema: ProjectSchema },
    ]),
  ],
  controllers: [IssueTemplatesController],
  providers: [IssueTemplatesRepository, IssueTemplatesService],
  exports: [IssueTemplatesService],
})
export class IssueTemplatesModule {}
