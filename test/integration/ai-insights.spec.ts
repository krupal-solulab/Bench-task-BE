import { INestApplication } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import { TaskActivity, TaskActivityDocument } from 'src/modules/tasks/schemas/task-activity.schema';
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

const DAY = 24 * 60 * 60 * 1000;

/** Module 10 gap-closure: deterministic duplicate detection and risk flagging. */
describe('AI insights - similar issues & risk (integration)', () => {
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
    const org = await seedOrganization(app, { name: 'ai org', slug: 'ai-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'ai-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const project = await createProject(app, admin.accessToken, { name: 'Insights Project' });
    const task = (body: Record<string, unknown>) =>
      createTask(app, admin.accessToken, {
        project: project.id,
        priority: TaskPriority.P2,
        ...body,
      });
    return { org, admin, project, task };
  }

  function get(token: string, path: string, query: Record<string, string>) {
    return api(app)
      .get(`/${API_PREFIX}/${path}`)
      .query(query)
      .set(...authHeader(token));
  }

  it('finds differently-worded duplicates, best match first, and leaves out unrelated issues', async () => {
    const { admin, project, task } = await seed();
    const login = await task({ title: 'Login page crashes on Safari' });
    await task({ title: 'Safari login crash after update' });
    await task({ title: 'Export invoices to CSV' });

    const res = await get(admin.accessToken, 'tasks/similar', {
      project: project.id,
      text: 'Safari crashing on the login page',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.map((m: { title: string }) => m.title)).toEqual([
      'Login page crashes on Safari',
      'Safari login crash after update',
    ]);
    expect(res.body.data[0].score).toBeGreaterThan(res.body.data[1].score);

    const excluding = await get(admin.accessToken, 'tasks/similar', {
      project: project.id,
      text: 'Login page crashes on Safari',
      excludeId: login.id,
    });
    expect(excluding.body.data.map((m: { id: string }) => m.id)).not.toContain(login.id);
  });

  it('flags at-risk issues with reasons, highest risk first, and skips healthy and done ones', async () => {
    const { admin, project, task } = await seed();
    const overdueUnassignedP1 = await task({
      title: 'Overdue P1',
      priority: TaskPriority.P1,
      dueDate: new Date(Date.now() - 2 * DAY).toISOString(),
    });
    const blocker = await task({ title: 'Blocking API work' });
    const blocked = await task({ title: 'Needs the API' });
    await task({ title: 'Healthy task', dueDate: new Date(Date.now() + 30 * DAY).toISOString() });
    await api(app)
      .post(`/${API_PREFIX}/tasks/${blocker.id}/links`)
      .set(...authHeader(admin.accessToken))
      .send({ targetTaskId: blocked.id, linkTypeId: 'blocks' });

    const res = await get(admin.accessToken, 'tasks/at-risk', { project: project.id });
    expect(res.status).toBe(200);
    const byTitle = Object.fromEntries(
      res.body.data.map((r: { title: string; risk: unknown }) => [r.title, r.risk]),
    );
    expect(Object.keys(byTitle)).toEqual(['Overdue P1', 'Needs the API']);
    expect(byTitle['Overdue P1']).toMatchObject({
      level: 'high',
      reasons: ['Overdue by 2 days', 'High priority with nobody assigned'],
    });
    expect(byTitle['Needs the API'].reasons).toEqual([`Blocked by ${blocker.issueKey}`]);

    // Finishing the blocker clears the blocked issue's risk.
    for (const status of ['In Progress', 'Review', 'Done']) {
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${blocker.id}/status`)
        .set(...authHeader(admin.accessToken))
        .send({ status });
    }
    const single = await get(admin.accessToken, `tasks/${blocked.id}/risk`, {});
    expect(single.body.data).toEqual({ score: 0, level: 'low', reasons: [] });
    const overdue = await get(admin.accessToken, `tasks/${overdueUnassignedP1.id}/risk`, {});
    expect(overdue.body.data.score).toBe(5);
  });

  it('flags work stalled In Progress for a week', async () => {
    const { admin, project, task } = await seed();
    const stalled = await task({ title: 'Stalled work' });
    await api(app)
      .patch(`/${API_PREFIX}/tasks/${stalled.id}/status`)
      .set(...authHeader(admin.accessToken))
      .send({ status: 'In Progress' });
    // Age the status change by 10 days.
    const activityModel = app.get<Model<TaskActivityDocument>>(getModelToken(TaskActivity.name));
    await activityModel.collection.updateMany(
      { task: new Types.ObjectId(stalled.id) },
      { $set: { createdAt: new Date(Date.now() - 10 * DAY) } },
    );

    const res = await get(admin.accessToken, 'tasks/at-risk', { project: project.id });
    expect(res.body.data[0]).toMatchObject({
      title: 'Stalled work',
      risk: { reasons: ['No status change for 10 days'] },
    });
  });

  it("refuses a project the caller can't view, and validates input", async () => {
    const { org, admin, project } = await seed();
    const outsider = await seedUserAndLogin(app, {
      email: 'ai-outsider@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    expect((await get(outsider.accessToken, 'tasks/at-risk', { project: project.id })).status).toBe(
      403,
    );
    expect(
      (await get(outsider.accessToken, 'tasks/similar', { project: project.id, text: 'x y' }))
        .status,
    ).toBe(403);
    expect((await get(admin.accessToken, 'tasks/similar', { project: project.id })).status).toBe(
      400,
    );
    expect((await get(admin.accessToken, 'tasks/at-risk', { project: 'nope' })).status).toBe(400);
  });
});
