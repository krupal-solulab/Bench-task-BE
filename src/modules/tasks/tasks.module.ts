import { Module } from '@nestjs/common';
import { Organization, OrganizationSchema } from '../organizations/schemas/organization.schema';
import { MongooseModule } from '@nestjs/mongoose';
import { ProjectsModule } from '../projects/projects.module';
import { SecuritySchemesModule } from '../../security-schemes/security-schemes.module';
import { FieldPermissionSchemesModule } from '../../field-permission-schemes/field-permission-schemes.module';
import { SprintsModule } from '../sprints/sprints.module';
import { ReleasesModule } from '../releases/releases.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { EventsModule } from '../../events/events.module';
import { Comment, CommentSchema } from '../comments/schemas/comment.schema';
import { IssueLink, IssueLinkSchema } from '../planning/schemas/issue-link.schema';
import { Task, TaskSchema } from './schemas/task.schema';
import { TaskActivity, TaskActivitySchema } from './schemas/task-activity.schema';
import {
  AutomationExecutionLog,
  AutomationExecutionLogSchema,
} from './schemas/automation-execution-log.schema';
import { BulkOperationLog, BulkOperationLogSchema } from './schemas/bulk-operation-log.schema';
import { TasksRepository } from './tasks.repository';
import { BulkOperationLogsRepository } from './bulk-operation-logs.repository';
import { TasksService } from './tasks.service';
import { TasksController } from './tasks.controller';
import { ProjectTasksController } from './project-tasks.controller';
import { AutomationLogController } from './automation-log.controller';
import { TasksDueDateReminderService } from './tasks-due-date-reminder.service';
import { UnassignedAutomationTriggerService } from './unassigned-automation-trigger.service';
import { SlaBreachTriggerService } from './sla-breach-trigger.service';
import { AutomationJobProcessor } from './automation-job.processor';

@Module({
  imports: [
    ProjectsModule,
    SecuritySchemesModule,
    FieldPermissionSchemesModule,
    SprintsModule,
    ReleasesModule,
    NotificationsModule,
    EventsModule,
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: TaskActivity.name, schema: TaskActivitySchema },
      { name: AutomationExecutionLog.name, schema: AutomationExecutionLogSchema },
      // Registered here too (already registered by CommentsModule) so TasksService can post an
      // automation "Add Comment" action's comment directly, without importing CommentsModule -
      // CommentsModule already imports TasksModule, so that would be a genuine two-way cycle.
      { name: Comment.name, schema: CommentSchema },
      // Same reasoning, for Module 10's issue summary (comment/linked-issue counts): PlanningModule
      // (issue-links) already imports TasksModule, so importing it back here would also cycle.
      { name: IssueLink.name, schema: IssueLinkSchema },
      { name: BulkOperationLog.name, schema: BulkOperationLogSchema },
      // Module 10 gap-closure: risk flagging reads the org's (possibly custom) link types to
      // know which links block - the model, not OrganizationsService, to avoid a module cycle.
      { name: Organization.name, schema: OrganizationSchema },
    ]),
  ],
  controllers: [TasksController, AutomationLogController, ProjectTasksController],
  providers: [
    TasksRepository,
    BulkOperationLogsRepository,
    TasksService,
    TasksDueDateReminderService,
    UnassignedAutomationTriggerService,
    SlaBreachTriggerService,
    // The automation queue's consumer (needs TasksService) - see its own file comment for why it
    // lives here rather than in the (global, dependency-free) AutomationQueueModule.
    AutomationJobProcessor,
  ],
  exports: [TasksService, TasksRepository, MongooseModule],
})
export class TasksModule {}
