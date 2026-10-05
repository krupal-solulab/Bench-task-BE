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

/** Module 11 gap-closure: personal time zone + comments in global search. */
describe('Module 11 - time zone setting & comment search (integration)', () => {
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
    const org = await seedOrganization(app, { name: 'm11 org', slug: 'm11-org' });
    const admin = await seedUserAndLogin(app, {
      email: 'm11-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const dev = await seedUserAndLogin(app, {
      email: 'm11-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, dev };
  }

  function patchMe(token: string, body: Record<string, unknown>) {
    return api(app)
      .patch(`/${API_PREFIX}/auth/me`)
      .set(...authHeader(token))
      .send(body);
  }

  it('saves, returns and clears a valid time zone; rejects an invalid one', async () => {
    const { dev } = await seed();
    const saved = await patchMe(dev.accessToken, { timezone: 'Asia/Kolkata' });
    expect(saved.status).toBe(200);
    expect(saved.body.data.timezone).toBe('Asia/Kolkata');

    const me = await api(app)
      .get(`/${API_PREFIX}/auth/me`)
      .set(...authHeader(dev.accessToken));
    expect(me.body.data.timezone).toBe('Asia/Kolkata');

    expect((await patchMe(dev.accessToken, { timezone: 'Mars/Olympus' })).status).toBe(400);

    const cleared = await patchMe(dev.accessToken, { timezone: null });
    expect(cleared.body.data.timezone).toBeNull();

    // A name-only edit leaves the time zone alone, and new users default to null.
    await patchMe(dev.accessToken, { timezone: 'Europe/London' });
    const renamed = await patchMe(dev.accessToken, { name: 'Dana Renamed' });
    expect(renamed.body.data).toMatchObject({ name: 'Dana Renamed', timezone: 'Europe/London' });
  });

  it('does not let an Admin set a time zone through the admin user-edit route', async () => {
    const { admin, dev } = await seed();
    const res = await api(app)
      .patch(`/${API_PREFIX}/users/${dev.userDoc.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ timezone: 'Asia/Tokyo' });
    expect(res.status).toBe(400); // unknown property on that DTO - unchanged behavior
  });

  it('finds comments by text, but only on issues the caller can see', async () => {
    const { admin, dev } = await seed();
    const visible = await createProject(app, admin.accessToken, {
      name: 'Visible project',
      memberIds: [dev.userDoc.id],
    });
    const hidden = await createProject(app, admin.accessToken, { name: 'Hidden project' });
    const visibleTask = await createTask(app, admin.accessToken, {
      title: 'Broker sync',
      project: visible.id,
      priority: TaskPriority.P2,
    });
    const hiddenTask = await createTask(app, admin.accessToken, {
      title: 'Secret work',
      project: hidden.id,
      priority: TaskPriority.P2,
    });
    for (const [taskId, body] of [
      [visibleTask.id, 'We hit the Kafka outage again during the nightly sync'],
      [hiddenTask.id, 'kafka outage notes for the hidden project'],
    ]) {
      const res = await api(app)
        .post(`/${API_PREFIX}/tasks/${taskId}/comments`)
        .set(...authHeader(admin.accessToken))
        .send({ body });
      expect(res.status).toBe(201);
    }

    const devSearch = await api(app)
      .get(`/${API_PREFIX}/search`)
      .query({ q: 'kafka outage' })
      .set(...authHeader(dev.accessToken));
    expect(devSearch.status).toBe(200);
    expect(devSearch.body.data.comments).toHaveLength(1);
    expect(devSearch.body.data.comments[0]).toMatchObject({
      snippet: 'We hit the Kafka outage again during the nightly sync',
      task: { id: visibleTask.id, title: 'Broker sync' },
      author: { name: expect.any(String) },
    });

    const adminSearch = await api(app)
      .get(`/${API_PREFIX}/search`)
      .query({ q: 'kafka outage' })
      .set(...authHeader(admin.accessToken));
    expect(adminSearch.body.data.comments).toHaveLength(2);
  });
});
