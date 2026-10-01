import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUser,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createTask } from './setup/fixtures';

/** Module 8 gap-closure: the org Admin's system dashboard (`GET admin-console/stats`). */
describe('admin console stats (integration)', () => {
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

  async function seedOrg(prefix: string) {
    const org = await seedOrganization(app, { name: `${prefix} org`, slug: `${prefix}-org` });
    const admin = await seedUserAndLogin(app, {
      email: `${prefix}-admin@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    return { org, admin };
  }

  function getStats(token: string) {
    return api(app)
      .get(`/${API_PREFIX}/admin-console/stats`)
      .set(...authHeader(token));
  }

  it('is Admin-only (403 for a Manager and a Developer)', async () => {
    const { org } = await seedOrg('st');
    for (const role of [Role.MANAGER, Role.DEVELOPER]) {
      const user = await seedUserAndLogin(app, {
        email: `st-${role.toLowerCase()}@example.com`,
        password: 'Password123',
        role,
        organizationId: org.id,
      });
      expect((await getStats(user.accessToken)).status).toBe(403);
    }
  });

  it("counts only the caller's own org: users by role/active, projects by status, tasks", async () => {
    const { org, admin } = await seedOrg('mine');
    await seedUser(app, {
      email: 'mine-mgr@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    await seedUser(app, {
      email: 'mine-dev-off@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
      isActive: false,
    });
    const project = await createProject(app, admin.accessToken, { name: 'Stats project' });
    await createTask(app, admin.accessToken, { title: 'One', project: project.id, priority: 'P2' });
    await createTask(app, admin.accessToken, { title: 'Two', project: project.id, priority: 'P2' });

    // A second org's data must never leak into the first org's numbers.
    const other = await seedOrg('other');
    const otherProject = await createProject(app, other.admin.accessToken, { name: 'Theirs' });
    await createTask(app, other.admin.accessToken, {
      title: 'Not mine',
      project: otherProject.id,
      priority: 'P2',
    });

    const res = await getStats(admin.accessToken);
    expect(res.status).toBe(200);
    const stats = res.body.data;

    expect(stats.users).toMatchObject({
      total: 3,
      active: 2,
      inactive: 1,
      byRole: {
        Admin: { total: 1, active: 1 },
        Manager: { total: 1, active: 1 },
        Developer: { total: 1, active: 0 },
      },
    });
    expect(stats.projects).toMatchObject({
      total: 1,
      archived: 0,
      byStatus: { Planning: 1, 'In Progress': 0, Completed: 0 },
      createdLast30Days: 1,
    });
    expect(stats.tasks).toMatchObject({ total: 2, open: 2, completed: 0, createdLast7Days: 2 });
    expect(stats.sprints).toEqual({ active: 0 });
    expect(Array.isArray(stats.activity.recent)).toBe(true);
  });

  it('surfaces recent audit-log entries with their actor', async () => {
    const { admin } = await seedOrg('aud');
    await api(app)
      .post(`/${API_PREFIX}/project-categories`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Audited' });

    const stats = (await getStats(admin.accessToken)).body.data;
    expect(stats.activity.auditEventsLast7Days).toBe(1);
    expect(stats.activity.recent[0]).toMatchObject({
      action: 'ProjectCategoryCreated',
      targetLabel: 'Audited',
      actor: { email: 'aud-admin@example.com' },
    });
  });
});
