import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { NotificationsModule } from '../../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CustomersModule } from '../customers/customers.module';
import { Ticket, TicketSchema } from './schemas/ticket.schema';
import { TicketActivity, TicketActivitySchema } from './schemas/ticket-activity.schema';
import { TicketComment, TicketCommentSchema } from './schemas/ticket-comment.schema';
import {
  TicketAutomationExecutionLog,
  TicketAutomationExecutionLogSchema,
} from './schemas/ticket-automation-execution-log.schema';
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';
import { TicketSettingsController } from './ticket-settings.controller';
import { TicketAutomationLogController } from './ticket-automation-log.controller';
import { TicketAutomationJobProcessor } from './ticket-automation-job.processor';
import { TicketScheduledAutomationSweepService } from './ticket-scheduled-automation-sweep.service';
import { TicketSlaCheckService } from './ticket-sla-check.service';

@Module({
  imports: [
    UsersModule,
    OrganizationsModule,
    CustomersModule,
    NotificationsModule,
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: TicketActivity.name, schema: TicketActivitySchema },
      { name: TicketComment.name, schema: TicketCommentSchema },
      { name: TicketAutomationExecutionLog.name, schema: TicketAutomationExecutionLogSchema },
    ]),
  ],
  controllers: [TicketsController, TicketSettingsController, TicketAutomationLogController],
  providers: [
    TicketsRepository,
    TicketsService,
    TicketAutomationJobProcessor,
    TicketScheduledAutomationSweepService,
    TicketSlaCheckService,
  ],
  exports: [TicketsService, TicketsRepository, MongooseModule],
})
export class TicketsModule {}
