import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import { TicketPriority } from 'src/common/enums/ticket-priority.enum';
import { TicketStatus } from 'src/common/enums/ticket-status.enum';
import {
  TicketAutomationActionType,
  TicketAutomationTriggerType,
} from 'src/modules/tickets/schemas/ticket-automation-rule.schema';
import { TicketMacroVisibility } from 'src/modules/tickets/schemas/ticket-macro.schema';
import { Ticket, TicketDocument } from 'src/modules/tickets/schemas/ticket.schema';
import { TicketsService } from 'src/modules/tickets/tickets.service';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createTicket } from './setup/fixtures';

describe('ticket automation engine (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  afterEach(async () => {
    await clearInMemoryMongo();
  });

  async function seedManager() {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'tae-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  function ticketModel() {
    return app.get<Model<TicketDocument>>(getModelToken(Ticket.name));
  }

  it('an org with no ticket automation rules behaves identically to today (regression)', async () => {
    const { manager } = await seedManager();
    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Plain ticket',
      customerEmail: 'plain@customer.com',
      customerName: 'Plain Customer',
    });
    expect(ticket.priority).toBe(TicketPriority.NORMAL);
    expect(ticket.tags).toEqual([]);
  });

  it('a TicketCreated trigger fires SetPriority + AddTags through the real ticket queue, and both actions are logged', async () => {
    const { manager } = await seedManager();

    const put = await api(app)
      .put(`/${API_PREFIX}/tickets/settings/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Escalate on creation',
            enabled: true,
            trigger: { type: TicketAutomationTriggerType.TICKET_CREATED },
            conditions: [],
            actions: [
              { type: TicketAutomationActionType.SET_PRIORITY, value: TicketPriority.URGENT },
              { type: TicketAutomationActionType.ADD_TAGS, value: 'vip' },
            ],
          },
        ],
      });
    expect(put.status).toBe(200);

    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'New issue',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });

    const fetched = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}`)
      .set(...authHeader(manager.accessToken));
    expect(fetched.body.data.priority).toBe(TicketPriority.URGENT);
    expect(fetched.body.data.tags).toEqual(['vip']);

    const log = await api(app)
      .get(`/${API_PREFIX}/tickets/settings/automation-log`)
      .set(...authHeader(manager.accessToken));
    expect(log.status).toBe(200);
    expect(log.body.data).toHaveLength(2);
    expect(log.body.data.every((e: { outcome: string }) => e.outcome === 'success')).toBe(true);
  });

  it('a StatusChanged trigger fires an internal-note AddComment action (never a public reply)', async () => {
    const { manager } = await seedManager();
    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Needs a note',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });

    await api(app)
      .put(`/${API_PREFIX}/tickets/settings/automation-rules`)
      .set(...authHeader(manager.accessToken))
      .send({
        rules: [
          {
            name: 'Note on solve',
            enabled: true,
            trigger: {
              type: TicketAutomationTriggerType.STATUS_CHANGED,
              toStatus: TicketStatus.SOLVED,
            },
            conditions: [],
            actions: [
              {
                type: TicketAutomationActionType.ADD_COMMENT,
                value: '{{ticketKey}} resolved automatically',
              },
            ],
          },
        ],
      });

    await api(app)
      .patch(`/${API_PREFIX}/tickets/${ticket.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TicketStatus.SOLVED });

    const comments = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}/comments`)
      .set(...authHeader(manager.accessToken));
    expect(comments.body.data).toHaveLength(1);
    expect(comments.body.data[0].isPublic).toBe(false);
    expect(comments.body.data[0].body).toBe(`${ticket.ticketKey} resolved automatically`);
  });

  it('applies a team macro on demand, and rejects applying a personal macro belonging to someone else', async () => {
    const { org, manager } = await seedManager();
    const otherManager = await seedUserAndLogin(app, {
      email: 'other-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });

    const put = await api(app)
      .put(`/${API_PREFIX}/tickets/settings/macros`)
      .set(...authHeader(manager.accessToken))
      .send({
        macros: [
          {
            name: 'Close as resolved',
            actions: [{ type: TicketAutomationActionType.SET_STATUS, value: TicketStatus.SOLVED }],
            visibility: TicketMacroVisibility.TEAM,
          },
          {
            name: "Manager's private shortcut",
            actions: [{ type: TicketAutomationActionType.ADD_TAGS, value: 'reviewed-by-manager' }],
            visibility: TicketMacroVisibility.PERSONAL,
          },
        ],
      });
    expect(put.status).toBe(200);
    const teamMacro = put.body.data.find((m: { name: string }) => m.name === 'Close as resolved');
    const personalMacro = put.body.data.find(
      (m: { name: string }) => m.name === "Manager's private shortcut",
    );

    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Macro target',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });

    const applied = await api(app)
      .post(`/${API_PREFIX}/tickets/${ticket.id}/apply-macro/${teamMacro.id}`)
      .set(...authHeader(otherManager.accessToken))
      .send();
    expect(applied.status).toBe(201);
    expect(applied.body.data.status).toBe(TicketStatus.SOLVED);

    const forbidden = await api(app)
      .post(`/${API_PREFIX}/tickets/${ticket.id}/apply-macro/${personalMacro.id}`)
      .set(...authHeader(otherManager.accessToken))
      .send();
    expect(forbidden.status).toBe(403);

    const ownedByCreator = await api(app)
      .post(`/${API_PREFIX}/tickets/${ticket.id}/apply-macro/${personalMacro.id}`)
      .set(...authHeader(manager.accessToken))
      .send();
    expect(ownedByCreator.status).toBe(201);
  });

  it('a scheduled Automation fires once a ticket has been in matchStatus past its threshold, and never refires the same episode', async () => {
    const { manager } = await seedManager();

    await api(app)
      .put(`/${API_PREFIX}/tickets/settings/scheduled-automations`)
      .set(...authHeader(manager.accessToken))
      .send({
        automations: [
          {
            name: 'Flag stale pending tickets',
            enabled: true,
            matchStatus: TicketStatus.PENDING,
            afterHours: 72,
            conditions: [],
            actions: [{ type: TicketAutomationActionType.ADD_TAGS, value: 'stale' }],
          },
        ],
      });

    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Idle pending ticket',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });
    await api(app)
      .patch(`/${API_PREFIX}/tickets/${ticket.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TicketStatus.PENDING });

    // Simulates the passage of time (100h in Pending) rather than waiting for the real hourly
    // @Cron - the check only cares about how long ago Ticket.statusEnteredAt was.
    await ticketModel().updateOne(
      { _id: ticket.id },
      { statusEnteredAt: new Date(Date.now() - 100 * 60 * 60 * 1000) },
    );

    const ticketsService = app.get(TicketsService);
    await ticketsService.checkScheduledAutomations();

    const afterFirstCheck = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}`)
      .set(...authHeader(manager.accessToken));
    expect(afterFirstCheck.body.data.tags).toContain('stale');

    // A second hourly run for the same still-Pending episode must not re-fire (no duplicate tag
    // entries, no duplicate automation-log entry).
    await ticketsService.checkScheduledAutomations();
    const afterSecondCheck = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}`)
      .set(...authHeader(manager.accessToken));
    expect(afterSecondCheck.body.data.tags).toEqual(['stale']);

    const log = await api(app)
      .get(`/${API_PREFIX}/tickets/settings/automation-log`)
      .set(...authHeader(manager.accessToken));
    expect(log.body.data).toHaveLength(1);
  });

  it('an SLA breach notifies the assignee once, and a pre-breach escalation notifies the escalation chain once', async () => {
    const { org, manager } = await seedManager();
    const assignee = await seedUserAndLogin(app, {
      email: 'sla-assignee@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const escalationTarget = await seedUserAndLogin(app, {
      email: 'sla-escalation@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });

    await api(app)
      .put(`/${API_PREFIX}/tickets/settings/sla-policy`)
      .set(...authHeader(manager.accessToken))
      .send({
        policy: [
          {
            priority: TicketPriority.NORMAL,
            firstResponseHours: 4,
            resolutionHours: 8,
            escalationChain: [escalationTarget.userDoc.id],
          },
        ],
      });

    // Ticket A: 7h elapsed - inside the [6h, 8h) pre-breach escalation window, not yet breached.
    const escalating = await createTicket(app, manager.accessToken, {
      subject: 'About to breach',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });
    // Mongoose's `timestamps: true` schema option resets `createdAt` back to "now" on both
    // `updateOne` and `.save()`, even when a caller explicitly sets it - going through the native
    // driver's collection directly bypasses Mongoose middleware entirely, so the override sticks.
    await ticketModel().collection.updateOne(
      { _id: new Types.ObjectId(escalating.id) },
      { $set: { createdAt: new Date(Date.now() - 7 * 60 * 60 * 1000) } },
    );

    // Ticket B: 10h elapsed - already past the 8h resolution target.
    const breaching = await createTicket(app, manager.accessToken, {
      subject: 'Already breached',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });
    await api(app)
      .patch(`/${API_PREFIX}/tickets/${breaching.id}/assignee`)
      .set(...authHeader(manager.accessToken))
      .send({ assignee: assignee.userDoc.id });
    await ticketModel().collection.updateOne(
      { _id: new Types.ObjectId(breaching.id) },
      { $set: { createdAt: new Date(Date.now() - 10 * 60 * 60 * 1000) } },
    );

    const ticketsService = app.get(TicketsService);
    await ticketsService.checkSlaBreachesAndEscalations();

    const escalationNotifications = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(escalationTarget.accessToken));
    expect(
      escalationNotifications.body.data.some((n: { message: string }) =>
        n.message.includes('SLA escalation'),
      ),
    ).toBe(true);

    const breachNotifications = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(assignee.accessToken));
    expect(
      breachNotifications.body.data.some((n: { message: string }) =>
        n.message.includes('SLA breach'),
      ),
    ).toBe(true);

    // A second run must not send duplicate notifications for either ticket (slaEscalatedAt /
    // slaBreachNotifiedAt make each event fire at most once).
    await ticketsService.checkSlaBreachesAndEscalations();
    const escalationAfterSecondRun = await api(app)
      .get(`/${API_PREFIX}/notifications`)
      .set(...authHeader(escalationTarget.accessToken));
    expect(
      escalationAfterSecondRun.body.data.filter((n: { message: string }) =>
        n.message.includes('SLA escalation'),
      ),
    ).toHaveLength(1);
  });
});
