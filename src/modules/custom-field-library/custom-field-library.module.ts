import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogModule } from '../audit-log/audit-log.module';
import { ProjectsModule } from '../projects/projects.module';
import {
  CustomFieldLibraryEntry,
  CustomFieldLibraryEntrySchema,
} from './schemas/custom-field-library-entry.schema';
import { CustomFieldLibraryService } from './custom-field-library.service';
import { CustomFieldLibraryController } from './custom-field-library.controller';

@Module({
  imports: [
    AuditLogModule,
    ProjectsModule,
    MongooseModule.forFeature([
      { name: CustomFieldLibraryEntry.name, schema: CustomFieldLibraryEntrySchema },
    ]),
  ],
  controllers: [CustomFieldLibraryController],
  providers: [CustomFieldLibraryService],
})
export class CustomFieldLibraryModule {}
