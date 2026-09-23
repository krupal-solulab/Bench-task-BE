import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { FilterQuery, Types } from 'mongoose';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { extractId } from '../../common/utils/mongo.util';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import {
  TicketStatus,
  TicketStatusCategory,
  categoryOfTicketStatus,
} from '../../common/enums/ticket-status.enum';
import { UsersRepository } from '../users/users.repository';
import { OrganizationsService } from '../organizations/organizations.service';
import { CustomersService } from '../customers/customers.service';
import { TicketsRepository } from './tickets.repository';
import { Ticket, TicketDocument } from './schemas/ticket.schema';
import { TicketActivityAction } from './schemas/ticket-activity.schema';
import { TicketCommentAuthorType } from './schemas/ticket-comment.schema';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { UpdateTicketAssigneeDto } from './dto/update-ticket-assignee.dto';
import { AddTicketCommentDto } from './dto/add-ticket-comment.dto';

/**
 * The event shape passed to `fireTicketTriggers` - a no-op stub in this batch (Batch 0a), filled
 * in by Batch 1's rule engine with real evaluation + enqueue logic. Defining every call site now
 * (rather than retrofitting each mutating method later) is the one contract Batch 1 cannot do
 * without - see the Phase 3 plan.
 */
export interface TicketTriggerEvent {
  type: 'TicketCreated' | 'TicketStatusChanged' | 'TicketReassigned' | 'TicketCommentAdded';
  toStatus?: TicketStatus;
  fromStatus?: TicketStatus;
}

@Injectable()
export class TicketsService {
  constructor(
    private readonly ticketsRepository: TicketsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly organizationsService: OrganizationsService,
    private readonly customersService: CustomersService,
  ) {}

  async create(dto: CreateTicketDto, actingUser: AuthenticatedUser): Promise<TicketDocument> {
    const organizationId = requireOrgId(actingUser);
    const customer = await this.resolveCustomer(organizationId, dto, actingUser);

    if (dto.assignee) {
      await this.assertAssigneeInOrg(dto.assignee, organizationId);
    }

    const prefix = await this.organizationsService.getOrAssignTicketKeyPrefix(organizationId);
    const seq = await this.organizationsService.nextTicketNumber(organizationId);

    const ticket = await this.ticketsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      customer: new Types.ObjectId(customer.id),
      assignee: dto.assignee ? new Types.ObjectId(dto.assignee) : null,
      ticketKey: `${prefix}-${seq}`,
      subject: dto.subject,
      description: dto.description ?? '',
      priority: dto.priority,
      tags: dto.tags ?? [],
    });

    await this.ticketsRepository.logActivity(
      ticket.id,
      actingUser.id,
      TicketActivityAction.CREATED,
    );
    await this.fireTicketTriggers(ticket, { type: 'TicketCreated' });
    return ticket;
  }

  async paginate(query: ListTicketsDto, actingUser: AuthenticatedUser) {
    const organizationId = requireOrgId(actingUser);
    const filter: FilterQuery<TicketDocument> = {
      organizationId: new Types.ObjectId(organizationId),
    };
    if (query.status?.length) filter.status = { $in: query.status };
    if (query.priority?.length) filter.priority = { $in: query.priority };
    if (query.assignee) filter.assignee = new Types.ObjectId(query.assignee);
    if (query.customer) filter.customer = new Types.ObjectId(query.customer);
    if (query.search) {
      const pattern = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { subject: { $regex: pattern, $options: 'i' } },
        { ticketKey: { $regex: pattern, $options: 'i' } },
      ];
    }

    const { data, total } = await this.ticketsRepository.paginate(filter, query.page, query.limit);
    return { data, meta: buildPaginationMeta(total, query.page, query.limit) };
  }

  async getActiveOrThrow(id: string, actingUser: AuthenticatedUser): Promise<TicketDocument> {
    const ticket = await this.ticketsRepository.findById(id);
    if (!ticket || extractId(ticket.organizationId) !== requireOrgId(actingUser)) {
      throw new NotFoundException('Ticket not found');
    }
    return ticket;
  }

  async updateStatus(
    id: string,
    dto: UpdateTicketStatusDto,
    actingUser: AuthenticatedUser,
  ): Promise<TicketDocument> {
    const ticket = await this.getActiveOrThrow(id, actingUser);
    const fromStatus = ticket.status;
    if (fromStatus === dto.status) return ticket;

    const fromCategory = ticket.statusCategory;
    const toCategory = categoryOfTicketStatus(dto.status);
    const now = new Date();

    const update: Partial<Ticket> = { status: dto.status, statusCategory: toCategory };

    // Leaving Paused: fold the elapsed paused time into the running total.
    if (
      fromCategory === TicketStatusCategory.PAUSED &&
      toCategory !== TicketStatusCategory.PAUSED
    ) {
      const pausedSince = ticket.pausedSince ?? now;
      update.pausedAccumMs = ticket.pausedAccumMs + (now.getTime() - pausedSince.getTime());
      update.pausedSince = null;
    }
    // Entering Paused: start the clock.
    if (
      fromCategory !== TicketStatusCategory.PAUSED &&
      toCategory === TicketStatusCategory.PAUSED
    ) {
      update.pausedSince = now;
    }
    // Entering Terminal (Solved/Closed): stamp solvedAt.
    if (toCategory === TicketStatusCategory.TERMINAL) {
      update.solvedAt = now;
    }

    const updated = await this.ticketsRepository.updateById(id, update);
    await this.ticketsRepository.logActivity(
      id,
      actingUser.id,
      TicketActivityAction.STATUS_CHANGED,
      fromStatus,
      dto.status,
    );
    await this.fireTicketTriggers(updated!, {
      type: 'TicketStatusChanged',
      fromStatus,
      toStatus: dto.status,
    });
    return updated!;
  }

  async assign(
    id: string,
    dto: UpdateTicketAssigneeDto,
    actingUser: AuthenticatedUser,
  ): Promise<TicketDocument> {
    const ticket = await this.getActiveOrThrow(id, actingUser);
    if (dto.assignee) {
      await this.assertAssigneeInOrg(dto.assignee, requireOrgId(actingUser));
    }

    const updated = await this.ticketsRepository.updateById(id, {
      assignee: dto.assignee ? new Types.ObjectId(dto.assignee) : null,
    });
    await this.ticketsRepository.logActivity(
      id,
      actingUser.id,
      TicketActivityAction.REASSIGNED,
      ticket.assignee ? extractId(ticket.assignee) : null,
      dto.assignee ?? null,
    );
    await this.fireTicketTriggers(updated!, { type: 'TicketReassigned' });
    return updated!;
  }

  async addComment(id: string, dto: AddTicketCommentDto, actingUser: AuthenticatedUser) {
    const ticket = await this.getActiveOrThrow(id, actingUser);
    const isPublic = dto.isPublic ?? true;

    // Checked BEFORE creating the new comment - this is the query that decides whether the
    // comment we're about to create is the first public staff reply.
    const isFirstPublicReply =
      isPublic &&
      !ticket.firstRespondedAt &&
      !(await this.ticketsRepository.hasPublicStaffComment(id));

    const comment = await this.ticketsRepository.createComment({
      ticket: new Types.ObjectId(id),
      authorType: TicketCommentAuthorType.STAFF,
      authorUser: new Types.ObjectId(actingUser.id),
      body: dto.body,
      isPublic,
    });

    if (isFirstPublicReply) {
      await this.ticketsRepository.updateById(id, { firstRespondedAt: new Date() });
    }

    await this.ticketsRepository.logActivity(id, actingUser.id, TicketActivityAction.COMMENT_ADDED);
    await this.fireTicketTriggers(ticket, { type: 'TicketCommentAdded' });
    return comment;
  }

  listComments(id: string, actingUser: AuthenticatedUser) {
    return this.getActiveOrThrow(id, actingUser).then(() =>
      this.ticketsRepository.listComments(id),
    );
  }

  listActivity(id: string, actingUser: AuthenticatedUser) {
    return this.getActiveOrThrow(id, actingUser).then(() =>
      this.ticketsRepository.listActivity(id),
    );
  }

  /**
   * No-op in Batch 0a - Batch 1 fills this in with real ticket-automation-rule evaluation and
   * enqueueing onto the (separate, ticket-only) BullMQ queue. Defined now so every mutating method
   * above already has its call site in place.
   */
  private async fireTicketTriggers(
    _ticket: TicketDocument,
    _event: TicketTriggerEvent,
  ): Promise<void> {
    return;
  }

  private async resolveCustomer(
    organizationId: string,
    dto: CreateTicketDto,
    actingUser: AuthenticatedUser,
  ) {
    if (dto.customerId) {
      return this.customersService.getActiveOrThrow(dto.customerId, actingUser);
    }
    if (dto.customerEmail && dto.customerName) {
      return this.customersService.findOrCreateByEmail(
        organizationId,
        dto.customerEmail,
        dto.customerName,
      );
    }
    throw new BadRequestException(
      'Provide either customerId, or both customerEmail and customerName',
    );
  }

  private async assertAssigneeInOrg(userId: string, organizationId: string): Promise<void> {
    const user = await this.usersRepository.findById(userId);
    if (!user || extractId(user.organizationId) !== organizationId) {
      throw new BadRequestException('Assignee must belong to the same organization');
    }
  }
}
