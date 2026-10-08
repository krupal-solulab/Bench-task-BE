import { randomUUID } from 'crypto';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import configuration, { AppConfig } from './config/configuration';
import { envValidationSchema } from './config/env.validation';
import { DatabaseModule } from './database/database.module';
import { RedisModule } from './redis/redis.module';
import { StorageModule } from './storage/storage.module';
import { AutomationQueueModule } from './modules/automation-queue/automation-queue.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { OrganizationScopeGuard } from './common/guards/organization-scope.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { PasswordChangeRequiredGuard } from './common/guards/password-change-required.guard';
import { ImpersonationReadOnlyGuard } from './common/guards/impersonation-read-only.guard';
import { HealthModule } from './modules/health/health.module';
import { UsersModule } from './modules/users/users.module';
import { OrganizationsModule } from './modules/organizations/organizations.module';
import { AuthModule } from './modules/auth/auth.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TasksModule } from './modules/tasks/tasks.module';
import { PlanningModule } from './modules/planning/planning.module';
import { WorkLogsModule } from './modules/worklogs/worklogs.module';
import { ImportExportModule } from './modules/import-export/import-export.module';
import { CommentsModule } from './modules/comments/comments.module';
import { AttachmentsModule } from './modules/attachments/attachments.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SavedFiltersModule } from './modules/saved-filters/saved-filters.module';
import { ApiLogsModule } from './modules/api-logs/api-logs.module';
import { IntegrationHealthModule } from './modules/integration-health/integration-health.module';
import { CannedResponsesModule } from './modules/canned-responses/canned-responses.module';
import { EventsModule } from './events/events.module';
import { PermissionSchemesModule } from './permission-schemes/permission-schemes.module';
import { WorkflowTemplatesModule } from './workflow-templates/workflow-templates.module';
import { TeamsModule } from './modules/teams/teams.module';
import { ProjectRolesModule } from './modules/project-roles/project-roles.module';
import { SecuritySchemesModule } from './security-schemes/security-schemes.module';
import { FieldPermissionSchemesModule } from './field-permission-schemes/field-permission-schemes.module';
import { AuditLogModule } from './modules/audit-log/audit-log.module';
import { SearchModule } from './modules/search/search.module';
import { IssueTemplatesModule } from './modules/issue-templates/issue-templates.module';
import { ProjectCategoriesModule } from './modules/project-categories/project-categories.module';
import { AdminConsoleModule } from './modules/admin-console/admin-console.module';
import { CustomFieldLibraryModule } from './modules/custom-field-library/custom-field-library.module';
import { CustomRolesModule } from './modules/custom-roles/custom-roles.module';
import { ProjectInvitesModule } from './modules/project-invites/project-invites.module';
import { ApiTokensModule } from './modules/api-tokens/api-tokens.module';
import { ApiTokenRestrictionGuard } from './common/guards/api-token-restriction.guard';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: { abortEarly: false },
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        pinoHttp: {
          level: configService.get('logLevel', { infer: true }),
          genReqId: (req: { headers: Record<string, string | string[] | undefined> }) =>
            req.headers['x-request-id'] ?? randomUUID(),
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'req.body.password',
              'req.body.passwordHash',
              'req.body.currentPassword',
              'req.body.newPassword',
              'req.body.temporaryPassword',
              'req.body.accessToken',
              'req.body.refreshToken',
              '*.password',
              '*.passwordHash',
              '*.accessToken',
              '*.refreshToken',
              '*.temporaryPassword',
            ],
            censor: '[REDACTED]',
          },
          transport:
            configService.get('nodeEnv', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService<AppConfig, true>) => ({
        throttlers: [
          {
            ttl: configService.get('throttle.ttl', { infer: true }) * 1000,
            limit: configService.get('throttle.limit', { infer: true }),
          },
        ],
      }),
    }),
    ScheduleModule.forRoot(),
    DatabaseModule,
    RedisModule,
    StorageModule,
    AutomationQueueModule,
    EventsModule,
    HealthModule,
    UsersModule,
    OrganizationsModule,
    AuthModule,
    ProjectsModule,
    TasksModule,
    PlanningModule,
    WorkLogsModule,
    CommentsModule,
    AttachmentsModule,
    DashboardModule,
    SavedFiltersModule,
    PermissionSchemesModule,
    WorkflowTemplatesModule,
    ApiLogsModule,
    IntegrationHealthModule,
    CannedResponsesModule,
    ImportExportModule,
    TeamsModule,
    ProjectRolesModule,
    SecuritySchemesModule,
    FieldPermissionSchemesModule,
    AuditLogModule,
    SearchModule,
    IssueTemplatesModule,
    ProjectCategoriesModule,
    AdminConsoleModule,
    CustomFieldLibraryModule,
    ApiTokensModule,
    ProjectInvitesModule,
    CustomRolesModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: OrganizationScopeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Must run after JwtAuthGuard (needs req.user) - Module 8 read-only impersonation.
    { provide: APP_GUARD, useClass: ImpersonationReadOnlyGuard },
    // Module 11 gap-closure: refuses @DisallowApiToken routes for personal API tokens.
    { provide: APP_GUARD, useClass: ApiTokenRestrictionGuard },
    // Invite accounts must set their own password before anything else (needs req.user).
    { provide: APP_GUARD, useClass: PasswordChangeRequiredGuard },
  ],
})
export class AppModule {}
