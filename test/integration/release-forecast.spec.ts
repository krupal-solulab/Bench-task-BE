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

/** Module 9 gap-closure: release ETA projection + the dashboard gadget ids. */
describe('release forecast (integration)', () => {
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
    const org = await seedOrganization(app, { name: 'fc org', slug: 'fc-org' });
    const manager = await seedUserAndLogin(app, {
      email: 'fc-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Forecast Project' });
    return { org, manager, project };
  }

  async function release(token: string, projectId: string, body: Record<string, unknown>) {
    const res = await api(app)
      .post(`/${API_PREFIX}/projects/${projectId}/releases`)
      .set(...authHeader(token))
      .send(body);
    expect(res.status).toBe(201);
    return res.body.data;
  }

  async function complete(token: string, taskId: string) {
    for (const status of ['In Progress', 'Review', 'Done']) {
      await api(app)
        .patch(`/${API_PREFIX}/tasks/${taskId}/status`)
        .set(...authHeader(token))
        .send({ status });
    }
  }

  it('forecasts every unreleased release, with an ETA and an on-track verdict', async () => {
    const { manager, project } = await seed();
    const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const v1 = await release(manager.accessToken, project.id, {
      name: 'v1.0',
      releaseDate: farFuture,
    });
    const v2 = await release(manager.accessToken, project.id, { name: 'v2.0' });

    const tasks = [];
    for (const title of ['Task A', 'Task B', 'Task C']) {
      tasks.push(
        await createTask(app, manager.accessToken, {
          title,
          project: project.id,
          priority: TaskPriority.P2,
          fixVersions: [v1.id],
        }),
      );
    }
    await complete(manager.accessToken, tasks[0].id);

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/releases/forecast`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    const [first, second] = res.body.data;

    expect(first).toMatchObject({
      releaseId: v1.id,
      name: 'v1.0',
      totalIssues: 3,
      doneIssues: 1,
      progress: 33,
      eta: { remainingIssues: 2, basis: 'release', onTrack: true, daysLate: 0 },
    });
    expect(new Date(first.eta.projectedDate).getTime()).toBeGreaterThan(Date.now());

    // An empty release has nothing to project, and no target date means no verdict.
    expect(second).toMatchObject({
      releaseId: v2.id,
      totalIssues: 0,
      eta: { projectedDate: null, onTrack: null },
    });
  });

  it('leaves released releases out of the forecast', async () => {
    const { manager, project } = await seed();
    const shipped = await release(manager.accessToken, project.id, { name: 'shipped' });
    await api(app)
      .post(`/${API_PREFIX}/projects/${project.id}/releases/${shipped.id}/release`)
      .set(...authHeader(manager.accessToken));

    const res = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/releases/forecast`)
      .set(...authHeader(manager.accessToken));
    expect(res.body.data).toEqual([]);
  });

  it("refuses a project the caller can't view (403)", async () => {
    const { org, project } = await seed();
    const outsider = await seedUserAndLogin(app, {
      email: 'fc-outsider@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const res = await api(app)
      .get(`/${API_PREFIX}/projects/${project.id}/releases/forecast`)
      .set(...authHeader(outsider.accessToken));
    expect(res.status).toBe(403);
  });

  it('accepts the three new report gadgets in dashboard preferences', async () => {
    const { manager } = await seed();
    const res = await api(app)
      .put(`/${API_PREFIX}/dashboard/preferences`)
      .set(...authHeader(manager.accessToken))
      .send({
        hiddenWidgets: ['controlChart'],
        widgetOrder: ['cumulativeFlow', 'releaseForecast', 'controlChart'],
      });
    expect(res.status).toBe(200);
  });
});
