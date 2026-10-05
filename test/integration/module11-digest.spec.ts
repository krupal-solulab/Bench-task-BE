import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { EMAIL_SERVICE } from 'src/notifications/email.constants';
import { IEmailService } from 'src/notifications/email.interface';
import { LoggingEmailService } from 'src/notifications/logging-email.service';
import { NotificationDigestService } from 'src/notifications/notification-digest.service';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createTask } from './setup/fixtures';
import { getModelToken } from '@nestjs/mongoose';
import { NotificationPreference } from 'src/notifications/schemas/notification-preference.schema';

const DAY = 24 * 60 * 60 * 1000;

/** Module 11 gap-closure: notification digest (in-app + email via the swappable sender). */
describe('Module 11 - notification digest (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    ({ app } = await createTestApp());
  });

  afterAll(async () => {
    await closeTestApp(app);
  });

  afterEach(async () => {
    await clearInMemoryMongo();
    jest.restoreAllMocks();
  });

  async function seed() {
    const org = await seedOrganization(app, { name: 'dg org', slug: 'dg-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'dg-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const dev = await seedUserAndLogin(app, {
      email: 'dg-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, admin.accessToken, {
      name: 'Digest project',
      memberIds: [dev.userDoc.id],
    });
    for (const title of ['First assignment', 'Second assignment']) {
      await createTask(app, admin.accessToken, {
        title,
        project: project.id,
        priority: TaskPriority.P2,
        assignee: dev.userDoc.id,
      });
    }
    return { admin, dev };
  }

  it('uses the logging-only sender when no SMTP_HOST is configured (no real email)', () => {
    expect(app.get<IEmailService>(EMAIL_SERVICE)).toBeInstanceOf(LoggingEmailService);
  });

  it('is off by default, and can be set to daily/weekly', async () => {
    const { dev } = await seed();
    const prefs = await api(app)
      .get(`/${API_PREFIX}/notifications/preferences`)
      .set(...authHeader(dev.accessToken));
    expect(prefs.body.data).toEqual({ mutedTypes: [], digest: 'off' });

    const put = await api(app)
      .put(`/${API_PREFIX}/notifications/preferences`)
      .set(...authHeader(dev.accessToken))
      .send({ mutedTypes: [], digest: 'weekly' });
    expect(put.body.data).toEqual({ mutedTypes: [], digest: 'weekly' });

    const bad = await api(app)
      .put(`/${API_PREFIX}/notifications/preferences`)
      .set(...authHeader(dev.accessToken))
      .send({ mutedTypes: [], digest: 'hourly' });
    expect(bad.status).toBe(400);
  });

  it('returns an in-app digest of unread notifications for the period', async () => {
    const { dev } = await seed();
    const res = await api(app)
      .get(`/${API_PREFIX}/notifications/digest`)
      .query({ period: 'daily' })
      .set(...authHeader(dev.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      period: 'daily',
      unreadCount: 2,
      byType: [{ type: 'TaskAssigned', count: 2 }],
      subject: 'Your daily digest: 2 unread notifications',
    });
  });

  async function enableDailyDigest(token: string) {
    await api(app)
      .put(`/${API_PREFIX}/notifications/preferences`)
      .set(...authHeader(token))
      .send({ mutedTypes: [], digest: 'daily' });
  }

  /** Make every saved digest look like it last went out just over a day ago. */
  async function backdateDigests() {
    const model = app.get(getModelToken(NotificationPreference.name));
    await model.updateMany({}, { lastDigestAt: new Date(Date.now() - DAY - 60_000) });
  }

  it('never sends a digest before a full period has passed since it was turned on', async () => {
    const { dev } = await seed();
    const send = jest.spyOn(app.get<IEmailService>(EMAIL_SERVICE), 'send');
    await enableDailyDigest(dev.accessToken);
    send.mockClear();
    expect(await app.get(NotificationDigestService).sendDueDigests(new Date())).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it('emails a due digest exactly once, and skips users with nothing unread', async () => {
    const { admin, dev } = await seed();
    const send = jest.spyOn(app.get<IEmailService>(EMAIL_SERVICE), 'send');
    const digests = app.get(NotificationDigestService);
    await enableDailyDigest(dev.accessToken); // 2 unread assignments
    await enableDailyDigest(admin.accessToken); // nothing unread
    await backdateDigests();
    send.mockClear();

    const now = new Date();
    expect(await digests.sendDueDigests(now)).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'dg-dev@example.com',
        subject: 'Your daily digest: 2 unread notifications',
        template: 'digest',
      }),
    );

    // Both users' clocks were reset - running again immediately sends nothing more.
    expect(await digests.sendDueDigests(now)).toBe(0);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
