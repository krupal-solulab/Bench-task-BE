import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuditLogEntry, AuditLogEntrySchema } from './schemas/audit-log-entry.schema';
import { AuditLogRepository } from './audit-log.repository';
import { AuditLogService } from './audit-log.service';
import { AuditLogController } from './audit-log.controller';

/** Standalone, like PermissionSchemesModule/TeamsModule: a leaf module with no dependencies on any
 * other feature module, imported BY the 5 controllers that write to it (Users, Permission Schemes,
 * Security Schemes, Teams, Project Roles, Organization Settings) rather than the reverse - no
 * cycle risk in either direction. Registered directly in app.module.ts (no natural parent). */
@Module({
  imports: [MongooseModule.forFeature([{ name: AuditLogEntry.name, schema: AuditLogEntrySchema }])],
  controllers: [AuditLogController],
  providers: [AuditLogRepository, AuditLogService],
  exports: [AuditLogService],
})
export class AuditLogModule {}
