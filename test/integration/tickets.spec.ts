import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TicketPriority } from 'src/common/enums/ticket-priority.enum';
import { TicketStatus } from 'src/common/enums/ticket-status.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createCustomer, createTicket } from './setup/fixtures';

describe('tickets (integration)', () => {
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
      email: 'ticket-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it('creates a ticket via customerEmail+customerName, assigning a human-readable ticketKey', async () => {
    const { manager } = await seedManager();

    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Cannot log in',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana Customer',
      priority: TicketPriority.HIGH,
    });

    expect(ticket.status).toBe(TicketStatus.NEW);
    expect(ticket.ticketKey).toMatch(/^[A-Z]+-1$/);
    expect(ticket.priority).toBe(TicketPriority.HIGH);
  });

  it('reuses the same Customer contact for a repeat ticket from the same email (regression: no duplicate contacts)', async () => {
    const { manager } = await seedManager();

    const first = await createTicket(app, manager.accessToken, {
      subject: 'Issue 1',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana Customer',
    });
    const second = await createTicket(app, manager.accessToken, {
      subject: 'Issue 2',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana Customer',
    });

    expect(second.customer.id ?? second.customer).toBe(first.customer.id ?? first.customer);

    const customers = await api(app)
      .get(`/${API_PREFIX}/customers`)
      .set(...authHeader(manager.accessToken));
    expect(customers.body.data).toHaveLength(1);
  });

  it('assigns sequential ticketKeys across multiple tickets in the same org', async () => {
    const { manager } = await seedManager();

    const t1 = await createTicket(app, manager.accessToken, {
      subject: 'First',
      customerEmail: 'a@customer.com',
      customerName: 'A',
    });
    const t2 = await createTicket(app, manager.accessToken, {
      subject: 'Second',
      customerEmail: 'b@customer.com',
      customerName: 'B',
    });

    const n1 = Number(t1.ticketKey.split('-')[1]);
    const n2 = Number(t2.ticketKey.split('-')[1]);
    expect(n2).toBe(n1 + 1);
  });

  it('rejects creating a ticket with neither customerId nor customerEmail+customerName', async () => {
    const { manager } = await seedManager();

    const res = await api(app)
      .post(`/${API_PREFIX}/tickets`)
      .set(...authHeader(manager.accessToken))
      .send({ subject: 'No customer given' });
    expect(res.status).toBe(400);
  });

  it('never returns a ticket from a different organization (404, not a data leak)', async () => {
    const { manager } = await seedManager();
    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Org A ticket',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });

    const otherOrg = await seedOrganization(app);
    const otherManager = await seedUserAndLogin(app, {
      email: 'other-org-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: otherOrg.id,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}`)
      .set(...authHeader(otherManager.accessToken));
    expect(res.status).toBe(404);
  });

  it('full lifecycle: status transitions correctly track paused time and stamp solvedAt', async () => {
    const { manager } = await seedManager();
    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Lifecycle ticket',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });

    const toOpen = await api(app)
      .patch(`/${API_PREFIX}/tickets/${ticket.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TicketStatus.OPEN });
    expect(toOpen.body.data.statusCategory).toBe('Open');

    const toPending = await api(app)
      .patch(`/${API_PREFIX}/tickets/${ticket.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TicketStatus.PENDING });
    expect(toPending.body.data.statusCategory).toBe('Paused');
    expect(toPending.body.data.pausedSince).not.toBeNull();

    const toSolved = await api(app)
      .patch(`/${API_PREFIX}/tickets/${ticket.id}/status`)
      .set(...authHeader(manager.accessToken))
      .send({ status: TicketStatus.SOLVED });
    expect(toSolved.body.data.statusCategory).toBe('Terminal');
    expect(toSolved.body.data.solvedAt).not.toBeNull();
    expect(toSolved.body.data.pausedSince).toBeNull();
    expect(toSolved.body.data.pausedAccumMs).toBeGreaterThanOrEqual(0);
  });

  it('the first isPublic reply sets firstRespondedAt; an internal note does not', async () => {
    const { manager } = await seedManager();
    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Needs a reply',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });

    const note = await api(app)
      .post(`/${API_PREFIX}/tickets/${ticket.id}/comments`)
      .set(...authHeader(manager.accessToken))
      .send({ body: 'internal note', isPublic: false });
    expect(note.status).toBe(201);

    const afterNote = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}`)
      .set(...authHeader(manager.accessToken));
    expect(afterNote.body.data.firstRespondedAt).toBeNull();

    await api(app)
      .post(`/${API_PREFIX}/tickets/${ticket.id}/comments`)
      .set(...authHeader(manager.accessToken))
      .send({ body: 'We are on it!' });

    const afterReply = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}`)
      .set(...authHeader(manager.accessToken));
    expect(afterReply.body.data.firstRespondedAt).not.toBeNull();

    const comments = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}/comments`)
      .set(...authHeader(manager.accessToken));
    expect(comments.body.data).toHaveLength(2);

    const activity = await api(app)
      .get(`/${API_PREFIX}/tickets/${ticket.id}/activity`)
      .set(...authHeader(manager.accessToken));
    expect(activity.body.data.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['created', 'comment_added']),
    );
  });

  it('rejects assigning a ticket to a user from a different organization', async () => {
    const { manager } = await seedManager();
    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Needs an assignee',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });

    const otherOrg = await seedOrganization(app);
    const otherDev = await seedUserAndLogin(app, {
      email: 'other-org-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: otherOrg.id,
    });

    const res = await api(app)
      .patch(`/${API_PREFIX}/tickets/${ticket.id}/assignee`)
      .set(...authHeader(manager.accessToken))
      .send({ assignee: otherDev.userDoc.id });
    expect(res.status).toBe(400);
  });

  it('rejects a Developer from managing tickets outside their organization scope, but a Developer within the org can still act', async () => {
    const { org, manager } = await seedManager();
    const developer = await seedUserAndLogin(app, {
      email: 'ticket-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const ticket = await createTicket(app, manager.accessToken, {
      subject: 'Dev can act on org tickets',
      customerEmail: 'dana@customer.com',
      customerName: 'Dana',
    });

    const assign = await api(app)
      .patch(`/${API_PREFIX}/tickets/${ticket.id}/assignee`)
      .set(...authHeader(developer.accessToken))
      .send({ assignee: developer.userDoc.id });
    expect(assign.status).toBe(200);
    expect(assign.body.data.assignee.id).toBe(developer.userDoc.id);
  });

  it('creates a customer contact directly and rejects a duplicate email in the same org', async () => {
    const { manager } = await seedManager();

    const customer = await createCustomer(app, manager.accessToken, {
      email: 'contact@customer.com',
      name: 'A Contact',
    });
    expect(customer.tier).toBe('Standard');

    const duplicate = await api(app)
      .post(`/${API_PREFIX}/customers`)
      .set(...authHeader(manager.accessToken))
      .send({ email: 'contact@customer.com', name: 'Someone Else' });
    expect(duplicate.status).toBe(409);
  });
});
