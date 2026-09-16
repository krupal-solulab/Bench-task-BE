import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { WorkflowTemplate, WorkflowTemplateSchema } from './schemas/workflow-template.schema';
import { WorkflowTemplatesRepository } from './workflow-templates.repository';
import { WorkflowTemplatesService } from './workflow-templates.service';
import { WorkflowTemplatesController } from './workflow-templates.controller';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: WorkflowTemplate.name, schema: WorkflowTemplateSchema }]),
  ],
  controllers: [WorkflowTemplatesController],
  providers: [WorkflowTemplatesRepository, WorkflowTemplatesService],
  exports: [WorkflowTemplatesService],
})
export class WorkflowTemplatesModule {}
