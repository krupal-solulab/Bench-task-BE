import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { CustomersModule } from '../customers/customers.module';
import { Ticket, TicketSchema } from './schemas/ticket.schema';
import { TicketActivity, TicketActivitySchema } from './schemas/ticket-activity.schema';
import { TicketComment, TicketCommentSchema } from './schemas/ticket-comment.schema';
import { TicketsRepository } from './tickets.repository';
import { TicketsService } from './tickets.service';
import { TicketsController } from './tickets.controller';

@Module({
  imports: [
    UsersModule,
    OrganizationsModule,
    CustomersModule,
    MongooseModule.forFeature([
      { name: Ticket.name, schema: TicketSchema },
      { name: TicketActivity.name, schema: TicketActivitySchema },
      { name: TicketComment.name, schema: TicketCommentSchema },
    ]),
  ],
  controllers: [TicketsController],
  providers: [TicketsRepository, TicketsService],
  exports: [TicketsService, TicketsRepository, MongooseModule],
})
export class TicketsModule {}
