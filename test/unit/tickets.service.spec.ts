import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import { TicketsRepository } from 'src/modules/tickets/tickets.repository';
import { UsersRepository } from 'src/modules/users/users.repository';
import { OrganizationsService } from 'src/modules/organizations/organizations.service';
import { CustomersService } from 'src/modules/customers/customers.service';
import { NotificationsService } from 'src/notifications/notifications.service';
import { ITicketAutomationQueue } from 'src/modules/ticket-automation-queue/ticket-automation-queue.interface';
import { TicketActivityAction } from 'src/modules/tickets/schemas/ticket-activity.schema';
import { TicketStatus, TicketStatusCategory } from 'src/common/enums/ticket-status.enum';
import { Role } from 'src/common/enums/role.enum';
import { AuthenticatedUser } from 'src/common/interfaces/jwt-payload.interface';

function makeOrganization(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: '507f1f77bcf86cd799439999',
    timezone: 'UTC',
    ticketAutomationRules: [],
    ticketScheduledAutomations: [],
    ticketMacros: [],
    ticketSlaPolicy: [],
    businessHoursCalendar: null,
    ...overrides,
  } as never;
}

const ORG_A = '507f1f77bcf86cd799439010';
const ORG_B = '507f1f77bcf86cd799439099';
const USER_ID = '507f1f77bcf86cd799439011';
const ASSIGNEE_ID = '507f1f77bcf86cd799439012';
const CUSTOMER_ID = '507f1f77bcf86cd799439013';
const TICKET_ID = '507f1f77bcf86cd799439014';

function makeUser(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    id: USER_ID,
    email: 'agent@a.com',
    role: Role.MANAGER,
    organizationId: ORG_A,
    ...overrides,
  };
}

function makeTicket(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: TICKET_ID,
    organizationId: { toString: () => ORG_A },
    customer: { toString: () => CUSTOMER_ID },
    assignee: null,
    status: TicketStatus.NEW,
    statusCategory: TicketStatusCategory.OPEN,
    pausedAccumMs: 0,
    pausedSince: null,
    firstRespondedAt: null,
    solvedAt: null,
    ...overrides,
  } as never;
}

function makeCustomer(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: CUSTOMER_ID,
    email: 'dana@customer.com',
    name: 'Dana Customer',
    ...overrides,
  } as never;
}

describe('TicketsService', () => {
  let ticketsRepository: jest.Mocked<
    Pick<
      TicketsRepository,
      | 'create'
      | 'findById'
      | 'updateById'
      | 'paginate'
      | 'logActivity'
      | 'createComment'
      | 'listComments'
      | 'listActivity'
      | 'hasPublicStaffComment'
    >
  >;
  let usersRepository: jest.Mocked<Pick<UsersRepository, 'findById'>>;
  let organizationsService: jest.Mocked<
    Pick<
      OrganizationsService,
      'getOrAssignTicketKeyPrefix' | 'nextTicketNumber' | 'getOrganizationDocument'
    >
  >;
  let customersService: jest.Mocked<
    Pick<CustomersService, 'getActiveOrThrow' | 'findOrCreateByEmail'>
  >;
  let notificationsService: jest.Mocked<Pick<NotificationsService, 'notifyTicketAutomationRole'>>;
  let ticketAutomationQueue: jest.Mocked<ITicketAutomationQueue>;
  let ticketAutomationLogModel: { create: jest.Mock };
  let service: TicketsService;

  beforeEach(() => {
    ticketsRepository = {
      create: jest.fn(),
      findById: jest.fn(),
      updateById: jest.fn(),
      paginate: jest.fn(),
      logActivity: jest.fn().mockResolvedValue(undefined),
      createComment: jest.fn(),
      listComments: jest.fn(),
      listActivity: jest.fn(),
      hasPublicStaffComment: jest.fn().mockResolvedValue(false),
    };
    usersRepository = { findById: jest.fn() };
    organizationsService = {
      getOrAssignTicketKeyPrefix: jest.fn().mockResolvedValue('SUP'),
      nextTicketNumber: jest.fn().mockResolvedValue(101),
      // Empty ticketAutomationRules keeps fireTicketTriggers a no-op for every test below that
      // isn't specifically exercising Batch 1's automation engine, exactly matching this
      // service's pre-Batch-1 stubbed behavior.
      getOrganizationDocument: jest.fn().mockResolvedValue(makeOrganization()),
    };
    customersService = {
      getActiveOrThrow: jest.fn().mockResolvedValue(makeCustomer()),
      findOrCreateByEmail: jest.fn().mockResolvedValue(makeCustomer()),
    };
    notificationsService = { notifyTicketAutomationRole: jest.fn().mockResolvedValue(undefined) };
    ticketAutomationQueue = { enqueue: jest.fn().mockResolvedValue(undefined) };
    ticketAutomationLogModel = { create: jest.fn().mockResolvedValue(undefined) };
    service = new TicketsService(
      ticketsRepository as unknown as TicketsRepository,
      usersRepository as unknown as UsersRepository,
      organizationsService as unknown as OrganizationsService,
      customersService as unknown as CustomersService,
      notificationsService as unknown as NotificationsService,
      ticketAutomationQueue,
      ticketAutomationLogModel as never,
    );
  });

  describe('create', () => {
    it('builds a ticketKey from the org prefix + atomic sequence', async () => {
      ticketsRepository.create.mockResolvedValue(makeTicket());

      await service.create({ subject: 'Help', customerId: CUSTOMER_ID } as never, makeUser());

      expect(ticketsRepository.create).toHaveBeenCalledWith(
        expect.objectContaining({ ticketKey: 'SUP-101' }),
      );
      expect(ticketsRepository.logActivity).toHaveBeenCalledWith(
        TICKET_ID,
        USER_ID,
        TicketActivityAction.CREATED,
      );
    });

    it('finds-or-creates a customer by email when no customerId is given', async () => {
      ticketsRepository.create.mockResolvedValue(makeTicket());

      await service.create(
        { subject: 'Help', customerEmail: 'dana@customer.com', customerName: 'Dana' } as never,
        makeUser(),
      );

      expect(customersService.findOrCreateByEmail).toHaveBeenCalledWith(
        ORG_A,
        'dana@customer.com',
        'Dana',
      );
      expect(customersService.getActiveOrThrow).not.toHaveBeenCalled();
    });

    it('rejects when neither customerId nor customerEmail+customerName is given', async () => {
      await expect(service.create({ subject: 'Help' } as never, makeUser())).rejects.toThrow(
        BadRequestException,
      );
      expect(ticketsRepository.create).not.toHaveBeenCalled();
    });

    it('rejects an assignee from a different organization', async () => {
      usersRepository.findById.mockResolvedValue({
        organizationId: { toString: () => ORG_B },
      } as never);

      await expect(
        service.create(
          { subject: 'Help', customerId: CUSTOMER_ID, assignee: ASSIGNEE_ID } as never,
          makeUser(),
        ),
      ).rejects.toThrow(BadRequestException);
      expect(ticketsRepository.create).not.toHaveBeenCalled();
    });
  });

  describe('getActiveOrThrow', () => {
    it('rejects a ticket belonging to a different organization', async () => {
      ticketsRepository.findById.mockResolvedValue(
        makeTicket({ organizationId: { toString: () => ORG_B } }),
      );

      await expect(service.getActiveOrThrow(TICKET_ID, makeUser())).rejects.toThrow(
        NotFoundException,
      );
    });

    it('rejects a non-existent ticket', async () => {
      ticketsRepository.findById.mockResolvedValue(null);
      await expect(service.getActiveOrThrow(TICKET_ID, makeUser())).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('updateStatus', () => {
    it('starts the paused clock when entering Pending', async () => {
      ticketsRepository.findById.mockResolvedValue(makeTicket({ status: TicketStatus.OPEN }));
      ticketsRepository.updateById.mockResolvedValue(makeTicket({ status: TicketStatus.PENDING }));

      await service.updateStatus(TICKET_ID, { status: TicketStatus.PENDING } as never, makeUser());

      expect(ticketsRepository.updateById).toHaveBeenCalledWith(
        TICKET_ID,
        expect.objectContaining({
          status: TicketStatus.PENDING,
          statusCategory: TicketStatusCategory.PAUSED,
          pausedSince: expect.any(Date),
        }),
      );
    });

    it('folds elapsed paused time into pausedAccumMs when leaving Pending', async () => {
      const pausedSince = new Date(Date.now() - 60_000); // 60s ago
      ticketsRepository.findById.mockResolvedValue(
        makeTicket({
          status: TicketStatus.PENDING,
          statusCategory: TicketStatusCategory.PAUSED,
          pausedSince,
          pausedAccumMs: 1000,
        }),
      );
      ticketsRepository.updateById.mockResolvedValue(makeTicket({ status: TicketStatus.OPEN }));

      await service.updateStatus(TICKET_ID, { status: TicketStatus.OPEN } as never, makeUser());

      const call = ticketsRepository.updateById.mock.calls[0]![1] as { pausedAccumMs: number };
      expect(call.pausedAccumMs).toBeGreaterThanOrEqual(1000 + 59_000);
      expect(ticketsRepository.updateById).toHaveBeenCalledWith(
        TICKET_ID,
        expect.objectContaining({ pausedSince: null }),
      );
    });

    it('stamps solvedAt when entering a Terminal status', async () => {
      ticketsRepository.findById.mockResolvedValue(makeTicket({ status: TicketStatus.OPEN }));
      ticketsRepository.updateById.mockResolvedValue(makeTicket({ status: TicketStatus.SOLVED }));

      await service.updateStatus(TICKET_ID, { status: TicketStatus.SOLVED } as never, makeUser());

      expect(ticketsRepository.updateById).toHaveBeenCalledWith(
        TICKET_ID,
        expect.objectContaining({
          statusCategory: TicketStatusCategory.TERMINAL,
          solvedAt: expect.any(Date),
        }),
      );
    });

    it('is a no-op when the status is unchanged', async () => {
      ticketsRepository.findById.mockResolvedValue(makeTicket({ status: TicketStatus.OPEN }));

      await service.updateStatus(TICKET_ID, { status: TicketStatus.OPEN } as never, makeUser());

      expect(ticketsRepository.updateById).not.toHaveBeenCalled();
      expect(ticketsRepository.logActivity).not.toHaveBeenCalled();
    });
  });

  describe('assign', () => {
    it('rejects assigning to a user outside the org', async () => {
      ticketsRepository.findById.mockResolvedValue(makeTicket());
      usersRepository.findById.mockResolvedValue({
        organizationId: { toString: () => ORG_B },
      } as never);

      await expect(
        service.assign(TICKET_ID, { assignee: ASSIGNEE_ID } as never, makeUser()),
      ).rejects.toThrow(BadRequestException);
    });

    it('allows unassigning (null)', async () => {
      ticketsRepository.findById.mockResolvedValue(
        makeTicket({ assignee: { toString: () => ASSIGNEE_ID } }),
      );
      ticketsRepository.updateById.mockResolvedValue(makeTicket({ assignee: null }));

      await service.assign(TICKET_ID, { assignee: null } as never, makeUser());

      expect(ticketsRepository.updateById).toHaveBeenCalledWith(TICKET_ID, { assignee: null });
    });
  });

  describe('addComment', () => {
    it('sets firstRespondedAt on the first isPublic staff reply', async () => {
      ticketsRepository.findById.mockResolvedValue(makeTicket({ firstRespondedAt: null }));
      ticketsRepository.hasPublicStaffComment.mockResolvedValue(false);
      ticketsRepository.createComment.mockResolvedValue({ id: 'c-1' } as never);

      await service.addComment(TICKET_ID, { body: 'We are looking into it' } as never, makeUser());

      expect(ticketsRepository.updateById).toHaveBeenCalledWith(
        TICKET_ID,
        expect.objectContaining({ firstRespondedAt: expect.any(Date) }),
      );
    });

    it('does not touch firstRespondedAt for an internal note', async () => {
      ticketsRepository.findById.mockResolvedValue(makeTicket({ firstRespondedAt: null }));
      ticketsRepository.createComment.mockResolvedValue({ id: 'c-1' } as never);

      await service.addComment(
        TICKET_ID,
        { body: 'internal note', isPublic: false } as never,
        makeUser(),
      );

      expect(ticketsRepository.updateById).not.toHaveBeenCalled();
    });

    it('does not overwrite firstRespondedAt on a second public reply', async () => {
      ticketsRepository.findById.mockResolvedValue(
        makeTicket({ firstRespondedAt: new Date('2026-01-01') }),
      );
      ticketsRepository.createComment.mockResolvedValue({ id: 'c-2' } as never);

      await service.addComment(TICKET_ID, { body: 'follow up' } as never, makeUser());

      expect(ticketsRepository.updateById).not.toHaveBeenCalled();
    });
  });
});
