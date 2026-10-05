import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
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

const HOUR = 60 * 60 * 1000;

/** Module 11 gap-closure: per-issue notification snooze + the activity feed. */
describe('Module 11 - snooze & activity feed (integration)', () => {
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

  async function seed() {
    const org = await seedOrganization(app, { name: 'm11b org', slug: 'm11b-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'm11b-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const dev = await seedUserAndLogin(app, {
      email: 'm11b-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, admin.accessToken, {
      name: 'Feed project',
      memberIds: [dev.userDoc.id],
    });
    return { org, admin, dev, project };
  }

  const get = (token: string, path: string, query: Record<string, string> = {}) =>
    api(app)
      .get(`/${API_PREFIX}/${path}`)
      .query(query)
      .set(...authHeader(token));

  it("snoozing an issue hides its notifications and unread count until it's cancelled", async () => {
    const { admin, dev, project } = await seed();
    const noisy = await createTask(app, admin.accessToken, {
      title: 'Noisy issue',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: dev.userDoc.id,
    });
    await createTask(app, admin.accessToken, {
      title: 'Quiet issue',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: dev.userDoc.id,
    });
    const before = await get(dev.accessToken, 'notifications');
    expect(before.body.data).toHaveLength(2);
    const unreadBefore = (await get(dev.accessToken, 'notifications/unread-count')).body.data;

    const snooze = await api(app)
      .put(`/${API_PREFIX}/notifications/snoozes/${noisy.id}`)
      .set(...authHeader(dev.accessToken))
      .send({ until: new Date(Date.now() + 2 * HOUR).toISOString() });
    expect(snooze.status).toBe(200);
    expect(snooze.body.data.taskId).toBe(noisy.id);

    const during = await get(dev.accessToken, 'notifications');
    expect(during.body.data.map((n: { title: string; message: string }) => n.message)).toEqual([
      'You were assigned "Quiet issue"',
    ]);
    const unreadDuring = (await get(dev.accessToken, 'notifications/unread-count')).body.data;
    expect(unreadDuring.count).toBe(unreadBefore.count - 1);
    expect((await get(dev.accessToken, 'notifications/snoozes')).body.data).toHaveLength(1);

    // Snoozing is personal: the Admin's own notifications are untouched.
    const del = await api(app)
      .delete(`/${API_PREFIX}/notifications/snoozes/${noisy.id}`)
      .set(...authHeader(dev.accessToken));
    expect(del.status).toBe(204);
    expect((await get(dev.accessToken, 'notifications')).body.data).toHaveLength(2);
  });

  it('rejects a snooze in the past or longer than 90 days', async () => {
    const { admin, dev, project } = await seed();
    const task = await createTask(app, admin.accessToken, {
      title: 'Snooze rules',
      project: project.id,
      priority: TaskPriority.P2,
    });
    const put = (until: Date) =>
      api(app)
        .put(`/${API_PREFIX}/notifications/snoozes/${task.id}`)
        .set(...authHeader(dev.accessToken))
        .send({ until: until.toISOString() });
    expect((await put(new Date(Date.now() - HOUR))).status).toBe(400);
    expect((await put(new Date(Date.now() + 91 * 24 * HOUR))).status).toBe(400);
  });

  it('shows activity on visible issues only, newest first, with an "involved" filter and paging', async () => {
    const { admin, dev, project } = await seed();
    const hidden = await createProject(app, admin.accessToken, { name: 'Hidden project' });
    const mine = await createTask(app, admin.accessToken, {
      title: 'Assigned to dev',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: dev.userDoc.id,
    });
    await createTask(app, admin.accessToken, {
      title: 'Not involved',
      project: project.id,
      priority: TaskPriority.P2,
    });
    await createTask(app, admin.accessToken, {
      title: 'Secret',
      project: hidden.id,
      priority: TaskPriority.P2,
    });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${mine.id}/status`)
      .set(...authHeader(admin.accessToken))
      .send({ status: 'In Progress' });

    const feed = await get(dev.accessToken, 'tasks/activity-feed');
    expect(feed.status).toBe(200);
    const titles = feed.body.data.entries.map((e: { task: { title: string } }) => e.task.title);
    expect(titles).not.toContain('Secret');
    expect(titles).toContain('Not involved');
    expect(feed.body.data.entries[0]).toMatchObject({
      action: 'status_changed',
      to: 'In Progress',
      actor: { name: expect.any(String) },
      task: { title: 'Assigned to dev' },
    });

    const involved = await get(dev.accessToken, 'tasks/activity-feed', { scope: 'involved' });
    expect(
      new Set(involved.body.data.entries.map((e: { task: { title: string } }) => e.task.title)),
    ).toEqual(new Set(['Assigned to dev']));

    const page1 = await get(dev.accessToken, 'tasks/activity-feed', { limit: '1' });
    expect(page1.body.data.entries).toHaveLength(1);
    expect(page1.body.data.nextBefore).toBeTruthy();
    const page2 = await get(dev.accessToken, 'tasks/activity-feed', {
      limit: '1',
      before: page1.body.data.entries[0].createdAt,
    });
    expect(page2.body.data.entries[0].id).not.toBe(page1.body.data.entries[0].id);

    // The admin sees the hidden project's activity too.
    const adminFeed = await get(admin.accessToken, 'tasks/activity-feed');
    expect(
      adminFeed.body.data.entries.map((e: { task: { title: string } }) => e.task.title),
    ).toContain('Secret');
  });
});
