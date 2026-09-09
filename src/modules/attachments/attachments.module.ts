import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { TasksModule } from '../tasks/tasks.module';
import { ProjectsModule } from '../projects/projects.module';
import { Attachment, AttachmentSchema } from './schemas/attachment.schema';
import { AttachmentsRepository } from './attachments.repository';
import { AttachmentsService } from './attachments.service';
import { AttachmentsController } from './attachments.controller';

@Module({
  imports: [
    TasksModule,
    ProjectsModule,
    MongooseModule.forFeature([{ name: Attachment.name, schema: AttachmentSchema }]),
  ],
  controllers: [AttachmentsController],
  providers: [AttachmentsRepository, AttachmentsService],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
