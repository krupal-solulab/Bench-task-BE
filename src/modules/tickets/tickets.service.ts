import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { requireOrgId } from '../../common/utils/auth-user.util';
import { extractId } from '../../common/utils/mongo.util';
import { buildPaginationMeta } from '../../common/utils/pagination.util';
import { AuthenticatedUser } from '../../common/interfaces/jwt-payload.interface';
import { Role } from '../../common/enums/role.enum';
import { CustomerTier } from '../../common/enums/customer-tier.enum';
import { TicketPriority } from '../../common/enums/ticket-priority.enum';
import {
  TicketStatus,
  TicketStatusCategory,
  categoryOfTicketStatus,
} from '../../common/enums/ticket-status.enum';
import { NotificationsService } from '../../notifications/notifications.service';
import { UsersRepository } from '../users/users.repository';
import { OrganizationsService } from '../organizations/organizations.service';
import { CustomersService } from '../customers/customers.service';
import { TicketsRepository } from './tickets.repository';
import { Ticket, TicketDocument } from './schemas/ticket.schema';
import { TicketActivityAction } from './schemas/ticket-activity.schema';
import { TicketCommentAuthorType } from './schemas/ticket-comment.schema';
import {
  TicketAutomationAction,
  TicketAutomationActionType,
  TicketAutomationFiredAction,
  TicketAutomationRule,
  TicketAutomationTriggerType,
  evaluateTicketAutomationRules,
  renderTicketTemplate,
} from './schemas/ticket-automation-rule.schema';
import {
  TicketScheduledAutomation,
  evaluateScheduledAutomations,
} from './schemas/ticket-scheduled-automation.schema';
import { TicketMacro, TicketMacroVisibility } from './schemas/ticket-macro.schema';
import {
  TicketAutomationExecutionLog,
  TicketAutomationExecutionLogDocument,
  TicketAutomationExecutionOutcome,
} from './schemas/ticket-automation-execution-log.schema';
import { calculateElapsedBusinessMs } from './schemas/business-hours-calendar.schema';
import {
  TicketSlaPolicyEntry,
  isTicketSlaApproachingBreach,
  isTicketSlaBreached,
  resolveTicketSlaEntry,
} from './schemas/ticket-sla-policy.schema';
import { TICKET_AUTOMATION_QUEUE } from '../ticket-automation-queue/ticket-automation-queue.constants';
import {
  ITicketAutomationQueue,
  TicketAutomationJobData,
} from '../ticket-automation-queue/ticket-automation-queue.interface';
import { CreateTicketDto } from './dto/create-ticket.dto';
import { ListTicketsDto } from './dto/list-tickets.dto';
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto';
import { UpdateTicketAssigneeDto } from './dto/update-ticket-assignee.dto';
import { UpdateTicketPriorityDto } from './dto/update-ticket-priority.dto';
import { AddTicketCommentDto } from './dto/add-ticket-comment.dto';
import { PutTicketAutomationRulesDto } from './dto/put-ticket-automation-rules.dto';
import { PutTicketScheduledAutomationsDto } from './dto/put-ticket-scheduled-automations.dto';
import { PutTicketMacrosDto } from './dto/put-ticket-macros.dto';
import { PutTicketSlaPolicyDto } from './dto/put-ticket-sla-policy.dto';
import { PutBusinessHoursCalendarDto } from './dto/put-business-hours-calendar.dto';

/** How far ahead of a hard SLA breach the escalation-chain notification fires. */
const SLA_ESCALATION_LEAD_HOURS = 2;

/**
 * The event shape passed to `fireTicketTriggers` - filled in for real by Batch 1 (Triggers/
 * Automations/Macros). Every mutating method below already calls this at its own point of
 * persistence, a contract fixed in Batch 0a specifically so Batch 1 never has to retrofit a call
 * site.
 */
export interface TicketTriggerEvent {
  type: 'TicketCreated' | 'TicketStatusChanged' | 'TicketReassigned' | 'TicketCommentAdded';
  toStatus?: TicketStatus;
  fromStatus?: TicketStatus;
}

@Injectable()
export class TicketsService {
  private readonly logger = new Logger(TicketsService.name);

  constructor(
    private readonly ticketsRepository: TicketsRepository,
    private readonly usersRepository: UsersRepository,
    private readonly organizationsService: OrganizationsService,
    private readonly customersService: CustomersService,
    private readonly notificationsService: NotificationsService,
    @Inject(TICKET_AUTOMATION_QUEUE) private readonly ticketAutomationQueue: ITicketAutomationQueue,
    @InjectModel(TicketAutomationExecutionLog.name)
    private readonly ticketAutomationLogModel: Model<TicketAutomationExecutionLogDocument>,
  ) {}

  async create(dto: CreateTicketDto, actingUser: AuthenticatedUser): Promise<TicketDocument> {
    const organizationId = requireOrgId(actingUser);
    const customer = await this.resolveCustomer(organizationId, dto, actingUser);

    if (dto.assignee) {
      await this.assertAssigneeInOrg(dto.assignee, organizationId);
    }

    const prefix = await this.organizationsService.getOrAssignTicketKeyPrefix(organizationId);
    const seq = await this.organizationsService.nextTicketNumber(organizationId);
    const now = new Date();

    const ticket = await this.ticketsRepository.create({
      organizationId: new Types.ObjectId(organizationId),
      customer: new Types.ObjectId(customer.id),
      createdBy: new Types.ObjectId(actingUser.id),
      assignee: dto.assignee ? new Types.ObjectId(dto.assignee) : null,
      ticketKey: `${prefix}-${seq}`,
      subject: dto.subject,
      description: dto.description ?? '',
      priority: dto.priority,
      tags: dto.tags ?? [],
      statusEnteredAt: now,
    });

    await this.ticketsRepository.logActivity(
      ticket.id,
      actingUser.id,
      TicketActivityAction.CREATED,
    );
    await this.fireTicketTriggers(ticket, { type: 'TicketCreated' }, actingUser);
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

    const update: Partial<Ticket> = {
      status: dto.status,
      statusCategory: toCategory,
      statusEnteredAt: now,
      firedScheduledAutomationIds: [],
    };

    // Leaving Paused: fold the elapsed paused time (wall-clock + business-hours) into the running
    // totals the SLA breach calculation reads.
    if (
      fromCategory === TicketStatusCategory.PAUSED &&
      toCategory !== TicketStatusCategory.PAUSED
    ) {
      const pausedSince = ticket.pausedSince ?? now;
      update.pausedAccumMs = ticket.pausedAccumMs + (now.getTime() - pausedSince.getTime());
      update.pausedSince = null;

      const organization = await this.organizationsService.getOrganizationDocument(
        extractId(ticket.organizationId),
      );
      update.pausedAccumBusinessMs =
        ticket.pausedAccumBusinessMs +
        calculateElapsedBusinessMs(
          organization.businessHoursCalendar,
          organization.timezone,
          pausedSince,
          now,
        );
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
    await this.fireTicketTriggers(
      updated!,
      { type: 'TicketStatusChanged', fromStatus, toStatus: dto.status },
      actingUser,
    );
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
    await this.fireTicketTriggers(updated!, { type: 'TicketReassigned' }, actingUser);
    return updated!;
  }

  async updatePriority(
    id: string,
    dto: UpdateTicketPriorityDto,
    actingUser: AuthenticatedUser,
  ): Promise<TicketDocument> {
    const ticket = await this.getActiveOrThrow(id, actingUser);
    if (ticket.priority === dto.priority) return ticket;

    const updated = await this.ticketsRepository.updateById(id, { priority: dto.priority });
    await this.ticketsRepository.logActivity(
      id,
      actingUser.id,
      TicketActivityAction.PRIORITY_CHANGED,
      ticket.priority,
      dto.priority,
    );
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
    await this.fireTicketTriggers(ticket, { type: 'TicketCommentAdded' }, actingUser);
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

  // ---------------------------------------------------------------------------------------------
  // Triggers/Automations/Macros (Batch 1)
  // ---------------------------------------------------------------------------------------------

  /**
   * Evaluates this ticket's org's automation rules against a fired trigger and enqueues every
   * matched action onto the (separate, ticket-only) BullMQ queue - mirrors
   * TasksService.runAutomations' enqueue-not-execute-inline shape exactly, for the same one-bad-
   * action-never-blocks-the-others isolation. A no-op for any org with no rules configured
   * (every org, until one deliberately opts in).
   */
  private async fireTicketTriggers(
    ticket: TicketDocument,
    event: TicketTriggerEvent,
    actingUser: AuthenticatedUser,
  ): Promise<void> {
    const organizationId = extractId(ticket.organizationId);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    if (!organization.ticketAutomationRules.length) return;

    let customerTier: CustomerTier;
    try {
      const customer = await this.customersService.getActiveOrThrow(
        extractId(ticket.customer),
        actingUser,
      );
      customerTier = customer.tier;
    } catch (err) {
      this.logger.warn(
        `Ticket automation evaluation skipped on ticket ${ticket.id} - customer lookup failed: ${(err as Error).message}`,
      );
      return;
    }

    let fired: TicketAutomationFiredAction[];
    try {
      fired = evaluateTicketAutomationRules(
        organization.ticketAutomationRules,
        {
          type: event.type as TicketAutomationTriggerType,
          toStatus: event.toStatus,
          fromStatus: event.fromStatus,
        },
        {
          priority: ticket.priority,
          channel: ticket.channel,
          customerTier,
          tags: ticket.tags,
        },
      );
    } catch (err) {
      this.logger.warn(
        `Ticket automation rule evaluation failed on ticket ${ticket.id}: ${(err as Error).message}`,
      );
      return;
    }

    for (const { ruleId, ruleName, action } of fired) {
      await this.ticketAutomationQueue.enqueue({
        ruleId,
        ruleName,
        triggerType: event.type,
        organizationId,
        ticketId: ticket.id,
        actionType: action.type,
        actionValue: action.value,
        actingUser: {
          id: actingUser.id,
          email: actingUser.email,
          role: actingUser.role,
          organizationId: actingUser.organizationId,
        },
      });
    }
  }

  /**
   * Executes exactly one fired ticket-automation action (one queue job's worth of work) and
   * writes a TicketAutomationExecutionLog entry recording the outcome either way. Called by
   * TicketAutomationJobProcessor's real Worker and by FakeTicketAutomationQueue in tests. Public
   * because it's invoked from outside this service (the queue processor).
   */
  async executeTicketAutomationJob(data: TicketAutomationJobData): Promise<void> {
    const actingUser: AuthenticatedUser = {
      id: data.actingUser.id,
      email: data.actingUser.email,
      role: data.actingUser.role,
      organizationId: data.actingUser.organizationId,
    };

    let outcome = TicketAutomationExecutionOutcome.SUCCESS;
    let errorMessage: string | null = null;
    try {
      const ticket = await this.ticketsRepository.findById(data.ticketId);
      if (!ticket) throw new NotFoundException('Ticket not found');
      await this.applyTicketAutomationAction(
        ticket,
        { type: data.actionType as TicketAutomationActionType, value: data.actionValue },
        actingUser,
        data.ruleName,
      );
    } catch (err) {
      outcome = TicketAutomationExecutionOutcome.FAILURE;
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
      this.logger.warn(
        `Ticket automation rule "${data.ruleName}" (${data.actionType}) failed on ticket ${data.ticketId}: ${errorMessage}`,
      );
    }

    await this.ticketAutomationLogModel.create({
      organizationId: new Types.ObjectId(data.organizationId),
      ticket: new Types.ObjectId(data.ticketId),
      ruleId: data.ruleId,
      ruleName: data.ruleName,
      triggerType: data.triggerType,
      actionSummaries: [`${data.actionType}: ${data.actionValue}`],
      outcome,
      errorMessage,
    });
  }

  /** BRD 3.3's ticket automation audit trail - "which rule fired, when, on which ticket,"
   * queryable org-wide. */
  async listTicketAutomationLog(page: number, limit: number, actingUser: AuthenticatedUser) {
    const organizationId = requireOrgId(actingUser);
    const filter = { organizationId: new Types.ObjectId(organizationId) };
    const [data, total] = await Promise.all([
      this.ticketAutomationLogModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate('ticket', 'subject ticketKey')
        .exec(),
      this.ticketAutomationLogModel.countDocuments(filter),
    ]);
    return { data, meta: buildPaginationMeta(total, page, limit) };
  }

  /** BRD 3.3's "Macros" - applies a stored action bundle to one ticket on demand, reusing the
   * same action executor Triggers use. Executed synchronously (not via the queue) since this is
   * a deliberate, immediate human action, not an asynchronous reaction to one. */
  async applyMacro(
    ticketId: string,
    macroId: string,
    actingUser: AuthenticatedUser,
  ): Promise<TicketDocument> {
    const ticket = await this.getActiveOrThrow(ticketId, actingUser);
    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    const macro = organization.ticketMacros.find((m) => m.id === macroId);
    if (!macro) throw new NotFoundException('Macro not found');
    if (macro.visibility === TicketMacroVisibility.PERSONAL && macro.createdBy !== actingUser.id) {
      throw new ForbiddenException('This macro is personal to another user');
    }

    let outcome = TicketAutomationExecutionOutcome.SUCCESS;
    let errorMessage: string | null = null;
    try {
      for (const action of macro.actions) {
        await this.applyTicketAutomationAction(ticket, action, actingUser, macro.name);
      }
    } catch (err) {
      outcome = TicketAutomationExecutionOutcome.FAILURE;
      errorMessage = err instanceof Error ? err.message : 'Unknown error';
    }

    await this.ticketAutomationLogModel.create({
      organizationId: new Types.ObjectId(organizationId),
      ticket: new Types.ObjectId(ticketId),
      ruleId: macro.id,
      ruleName: macro.name,
      triggerType: 'Macro',
      actionSummaries: macro.actions.map((a) => `${a.type}: ${a.value}`),
      outcome,
      errorMessage,
    });

    if (errorMessage) {
      throw new BadRequestException(`Macro application failed: ${errorMessage}`);
    }
    return this.getActiveOrThrow(ticketId, actingUser);
  }

  /**
   * Hourly-checked scheduled Automation sweep (BRD 3.3's "Pending 3 days -> auto-close") - called
   * by TicketScheduledAutomationSweepService's `@Cron`, not by any request path. Iterates every
   * active org's configured scheduled automations against its currently-open tickets, firing
   * (enqueuing) any newly-matched one and recording it in `firedScheduledAutomationIds` so the
   * same automation doesn't refire every subsequent hourly run for the same status episode.
   */
  async checkScheduledAutomations(): Promise<void> {
    const now = new Date();
    const organizations = await this.organizationsService.listActiveOrganizations();

    for (const organization of organizations) {
      if (!organization.ticketScheduledAutomations.length) continue;
      const tickets = await this.ticketsRepository.findOpenTicketsByOrganization(organization.id);

      for (const ticket of tickets) {
        if (!ticket.statusEnteredAt) continue;
        const statusHours = (now.getTime() - ticket.statusEnteredAt.getTime()) / (60 * 60 * 1000);
        const systemActingUser = this.systemActingUserFor(ticket);

        let customerTier: CustomerTier;
        try {
          const customer = await this.customersService.getActiveOrThrow(
            extractId(ticket.customer),
            systemActingUser,
          );
          customerTier = customer.tier;
        } catch {
          continue;
        }

        let fired: TicketAutomationFiredAction[];
        try {
          fired = evaluateScheduledAutomations(organization.ticketScheduledAutomations, {
            status: ticket.status,
            statusHours,
            firedScheduledAutomationIds: ticket.firedScheduledAutomationIds,
            priority: ticket.priority,
            channel: ticket.channel,
            customerTier,
            tags: ticket.tags,
          });
        } catch (err) {
          this.logger.warn(
            `Scheduled ticket automation evaluation failed on ticket ${ticket.id}: ${(err as Error).message}`,
          );
          continue;
        }
        if (!fired.length) continue;

        for (const { ruleId, ruleName, action } of fired) {
          await this.ticketAutomationQueue.enqueue({
            ruleId,
            ruleName,
            triggerType: 'ScheduledAutomation',
            organizationId: organization.id,
            ticketId: ticket.id,
            actionType: action.type,
            actionValue: action.value,
            actingUser: systemActingUser,
          });
        }
        await this.ticketsRepository.addFiredScheduledAutomationIds(
          ticket.id,
          fired.map((f) => f.ruleId),
        );
      }
    }
  }

  /**
   * Hourly-checked SLA breach + pre-breach escalation (BRD 3.4's Advanced SLA) - called by
   * TicketSlaCheckService's `@Cron`. Resolution-focused (createdAt -> solvedAt/now), business-
   * hours-aware and paused-time-excluded (see calculateElapsedBusinessMs). Each of the two events
   * fires at most once per ticket (Ticket.slaEscalatedAt / Ticket.slaBreachNotifiedAt).
   */
  async checkSlaBreachesAndEscalations(): Promise<void> {
    const now = new Date();
    const candidates = await this.ticketsRepository.findOpenTicketsForSlaCheck();

    for (const ticket of candidates) {
      const organizationId = extractId(ticket.organizationId);
      const organization = await this.organizationsService.getOrganizationDocument(organizationId);
      const systemActingUser = this.systemActingUserFor(ticket);

      let customerTier: CustomerTier;
      try {
        const customer = await this.customersService.getActiveOrThrow(
          extractId(ticket.customer),
          systemActingUser,
        );
        customerTier = customer.tier;
      } catch {
        continue;
      }

      const entry = resolveTicketSlaEntry(organization.ticketSlaPolicy, {
        priority: ticket.priority,
        customerTier,
        channel: ticket.channel,
      });
      if (!entry) continue;

      const endAnchor = ticket.solvedAt ?? now;
      const totalElapsedMs = calculateElapsedBusinessMs(
        organization.businessHoursCalendar,
        organization.timezone,
        ticket.createdAt,
        endAnchor,
      );
      const pausedInProgressMs =
        ticket.statusCategory === TicketStatusCategory.PAUSED && ticket.pausedSince
          ? calculateElapsedBusinessMs(
              organization.businessHoursCalendar,
              organization.timezone,
              ticket.pausedSince,
              now,
            )
          : 0;
      const elapsedBusinessMs = Math.max(
        0,
        totalElapsedMs - ticket.pausedAccumBusinessMs - pausedInProgressMs,
      );

      if (
        !ticket.slaEscalatedAt &&
        isTicketSlaApproachingBreach(
          'resolution',
          entry,
          elapsedBusinessMs,
          SLA_ESCALATION_LEAD_HOURS,
        )
      ) {
        await this.escalateTicketSla(ticket, entry);
        await this.ticketsRepository.markSlaEscalated(ticket.id);
      }

      if (
        !ticket.slaBreachNotifiedAt &&
        isTicketSlaBreached('resolution', entry, elapsedBusinessMs)
      ) {
        await this.notifyTicketSlaBreach(ticket);
        await this.ticketsRepository.markSlaBreachNotified(ticket.id);
      }
    }
  }

  private async escalateTicketSla(
    ticket: TicketDocument,
    entry: TicketSlaPolicyEntry,
  ): Promise<void> {
    const escalateToId = entry.escalationChain[0];
    if (!escalateToId) return;
    await this.notificationsService.notifyTicketAutomationRole({
      recipientId: escalateToId,
      ticketId: ticket.id,
      ticketSubject: ticket.subject,
      ruleName: 'SLA escalation',
    });
  }

  private async notifyTicketSlaBreach(ticket: TicketDocument): Promise<void> {
    const recipientId = ticket.assignee ? extractId(ticket.assignee) : null;
    if (!recipientId) return;
    await this.notificationsService.notifyTicketAutomationRole({
      recipientId,
      ticketId: ticket.id,
      ticketSubject: ticket.subject,
      ruleName: 'SLA breach',
    });
  }

  /**
   * Applies one automation/macro action by calling this service's own existing mutation methods
   * reentrantly where safe - mirrors TasksService.applyAutomationAction's exact reasoning. Two
   * deliberate exceptions, both to prevent an automation-fired action from re-triggering itself:
   * AddComment writes directly via the repository (bypassing the public addComment(), which fires
   * TicketCommentAdded triggers - unlike Task, tickets DO have a CommentAdded trigger type, so
   * going through addComment() here could recurse), and SetPriority updates directly (there is no
   * PriorityChanged trigger, but no public "update priority and fire triggers" wrapper reason to
   * add one either).
   */
  private async applyTicketAutomationAction(
    ticket: TicketDocument,
    action: TicketAutomationAction,
    actingUser: AuthenticatedUser,
    ruleName: string,
  ): Promise<void> {
    switch (action.type) {
      case TicketAutomationActionType.SET_STATUS:
        await this.updateStatus(ticket.id, { status: action.value as TicketStatus }, actingUser);
        return;
      case TicketAutomationActionType.SET_PRIORITY:
        await this.ticketsRepository.updateById(ticket.id, {
          priority: action.value as TicketPriority,
        });
        return;
      case TicketAutomationActionType.SET_ASSIGNEE:
        await this.assign(ticket.id, { assignee: action.value || null }, actingUser);
        return;
      case TicketAutomationActionType.ADD_TAGS: {
        const additions = action.value
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        const tags = [...new Set([...ticket.tags, ...additions])];
        await this.ticketsRepository.updateById(ticket.id, { tags });
        return;
      }
      case TicketAutomationActionType.ADD_COMMENT: {
        const rendered = renderTicketTemplate(action.value, {
          subject: ticket.subject,
          ticketKey: ticket.ticketKey,
          status: ticket.status,
        });
        // Internal note by default - an automated trigger should never blast a customer-facing
        // reply without deliberate configuration.
        await this.ticketsRepository.createComment({
          ticket: new Types.ObjectId(ticket.id),
          authorType: TicketCommentAuthorType.STAFF,
          authorUser: new Types.ObjectId(actingUser.id),
          body: rendered,
          isPublic: false,
        });
        await this.ticketsRepository.logActivity(
          ticket.id,
          actingUser.id,
          TicketActivityAction.COMMENT_ADDED,
        );
        return;
      }
      case TicketAutomationActionType.NOTIFY_ROLE: {
        const organizationId = extractId(ticket.organizationId);
        const targets = await this.usersRepository.findByRole(organizationId, action.value as Role);
        for (const target of targets) {
          await this.notificationsService.notifyTicketAutomationRole({
            recipientId: target.id,
            ticketId: ticket.id,
            ticketSubject: ticket.subject,
            ruleName,
          });
        }
        return;
      }
      case TicketAutomationActionType.WEBHOOK:
        // Logging stub - mirrors the Task automation engine's own WEBHOOK action exactly (see
        // that method's own comment on why a real call isn't made here).
        this.logger.log(
          `Ticket automation rule "${ruleName}" would POST to ${action.value} for ticket ${ticket.id} (webhook delivery not implemented - logging only)`,
        );
        return;
    }
  }

  private systemActingUserFor(ticket: TicketDocument) {
    return {
      id: extractId(ticket.createdBy),
      email: 'automation@internal',
      role: Role.MANAGER,
      organizationId: extractId(ticket.organizationId),
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Settings (per-org config, Admin/Manager only - enforced at the controller via @Roles)
  // ---------------------------------------------------------------------------------------------

  async getAutomationRules(actingUser: AuthenticatedUser): Promise<TicketAutomationRule[]> {
    const organization = await this.organizationsService.getOrganizationDocument(
      requireOrgId(actingUser),
    );
    return organization.ticketAutomationRules;
  }

  async updateAutomationRules(
    dto: PutTicketAutomationRulesDto,
    actingUser: AuthenticatedUser,
  ): Promise<TicketAutomationRule[]> {
    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    const existingById = new Map(organization.ticketAutomationRules.map((r) => [r.id, r]));

    const rules: TicketAutomationRule[] = dto.rules.map((r) => {
      if (r.id && !existingById.has(r.id)) {
        throw new BadRequestException(`Automation rule "${r.id}" does not exist for this org`);
      }
      return {
        id: r.id ?? new Types.ObjectId().toString(),
        name: r.name.trim(),
        enabled: r.enabled,
        trigger: {
          type: r.trigger.type,
          toStatus: r.trigger.toStatus ?? null,
          fromStatus: r.trigger.fromStatus ?? null,
        },
        conditions: r.conditions.map((c) => ({ field: c.field, value: c.value.trim() })),
        actions: r.actions.map((a) => ({ type: a.type, value: a.value.trim() })),
      };
    });
    this.assertUniqueNames(rules, 'Automation rule');

    const updated = await this.organizationsService.updateTicketAutomationConfig(organizationId, {
      ticketAutomationRules: rules,
    });
    return updated.ticketAutomationRules;
  }

  async getScheduledAutomations(
    actingUser: AuthenticatedUser,
  ): Promise<TicketScheduledAutomation[]> {
    const organization = await this.organizationsService.getOrganizationDocument(
      requireOrgId(actingUser),
    );
    return organization.ticketScheduledAutomations;
  }

  async updateScheduledAutomations(
    dto: PutTicketScheduledAutomationsDto,
    actingUser: AuthenticatedUser,
  ): Promise<TicketScheduledAutomation[]> {
    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    const existingById = new Map(organization.ticketScheduledAutomations.map((a) => [a.id, a]));

    const automations: TicketScheduledAutomation[] = dto.automations.map((a) => {
      if (a.id && !existingById.has(a.id)) {
        throw new BadRequestException(`Scheduled automation "${a.id}" does not exist for this org`);
      }
      return {
        id: a.id ?? new Types.ObjectId().toString(),
        name: a.name.trim(),
        enabled: a.enabled,
        matchStatus: a.matchStatus,
        afterHours: a.afterHours,
        conditions: a.conditions.map((c) => ({ field: c.field, value: c.value.trim() })),
        actions: a.actions.map((act) => ({ type: act.type, value: act.value.trim() })),
      };
    });
    this.assertUniqueNames(automations, 'Scheduled automation');

    const updated = await this.organizationsService.updateTicketAutomationConfig(organizationId, {
      ticketScheduledAutomations: automations,
    });
    return updated.ticketScheduledAutomations;
  }

  async getMacros(actingUser: AuthenticatedUser): Promise<TicketMacro[]> {
    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    return organization.ticketMacros.filter(
      (m) => m.visibility === TicketMacroVisibility.TEAM || m.createdBy === actingUser.id,
    );
  }

  async updateMacros(
    dto: PutTicketMacrosDto,
    actingUser: AuthenticatedUser,
  ): Promise<TicketMacro[]> {
    const organizationId = requireOrgId(actingUser);
    const organization = await this.organizationsService.getOrganizationDocument(organizationId);
    const existingById = new Map(organization.ticketMacros.map((m) => [m.id, m]));

    const macros: TicketMacro[] = dto.macros.map((m) => {
      const existing = m.id ? existingById.get(m.id) : undefined;
      if (m.id && !existing) {
        throw new BadRequestException(`Macro "${m.id}" does not exist for this org`);
      }
      return {
        id: existing?.id ?? new Types.ObjectId().toString(),
        name: m.name.trim(),
        actions: m.actions.map((a) => ({ type: a.type, value: a.value.trim() })),
        visibility: m.visibility,
        // Ownership is preserved for an edit, never taken from the request body - see
        // PutTicketMacrosDto's own comment on why `createdBy` isn't a client-writable field.
        createdBy: existing?.createdBy ?? actingUser.id,
      };
    });
    this.assertUniqueNames(macros, 'Macro');

    const updated = await this.organizationsService.updateTicketAutomationConfig(organizationId, {
      ticketMacros: macros,
    });
    return updated.ticketMacros;
  }

  async getSlaPolicy(actingUser: AuthenticatedUser): Promise<TicketSlaPolicyEntry[]> {
    const organization = await this.organizationsService.getOrganizationDocument(
      requireOrgId(actingUser),
    );
    return organization.ticketSlaPolicy;
  }

  async updateSlaPolicy(
    dto: PutTicketSlaPolicyDto,
    actingUser: AuthenticatedUser,
  ): Promise<TicketSlaPolicyEntry[]> {
    const organizationId = requireOrgId(actingUser);
    const policy: TicketSlaPolicyEntry[] = dto.policy.map((p) => ({
      priority: p.priority,
      customerTier: p.customerTier ?? null,
      channel: p.channel ?? null,
      firstResponseHours: p.firstResponseHours,
      resolutionHours: p.resolutionHours,
      escalationChain: p.escalationChain,
    }));

    const updated = await this.organizationsService.updateTicketAutomationConfig(organizationId, {
      ticketSlaPolicy: policy,
    });
    return updated.ticketSlaPolicy;
  }

  async getBusinessHoursCalendar(actingUser: AuthenticatedUser) {
    const organization = await this.organizationsService.getOrganizationDocument(
      requireOrgId(actingUser),
    );
    return organization.businessHoursCalendar;
  }

  async updateBusinessHoursCalendar(
    dto: PutBusinessHoursCalendarDto,
    actingUser: AuthenticatedUser,
  ) {
    const organizationId = requireOrgId(actingUser);
    const updated = await this.organizationsService.updateTicketAutomationConfig(organizationId, {
      businessHoursCalendar: {
        workingDays: dto.workingDays,
        workingHours: dto.workingHours,
        holidays: dto.holidays,
      },
    });
    return updated.businessHoursCalendar;
  }

  private assertUniqueNames(items: Array<{ name: string }>, label: string): void {
    const names = items.map((i) => i.name);
    if (new Set(names).size !== names.length) {
      throw new BadRequestException(`${label} names must be unique`);
    }
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
