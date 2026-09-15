import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api } from './setup/fixtures';

describe('dashboard preferences (integration)', () => {
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
      email: 'dash-pref-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    return { org, manager };
  }

  it("defaults to empty (today's behavior) when nothing has been saved yet (regression)", async () => {
    const { manager } = await seedManager();
    const res = await api(app)
      .get(`/${API_PREFIX}/dashboard/preferences`)
      .set(...authHeader(manager.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ hiddenWidgets: [], widgetOrder: [] });
  });

  it('rejects an unknown widget id', async () => {
    const { manager } = await seedManager();
    const res = await api(app)
      .put(`/${API_PREFIX}/dashboard/preferences`)
      .set(...authHeader(manager.accessToken))
      .send({ hiddenWidgets: ['notARealWidget'], widgetOrder: [] });
    expect(res.status).toBe(400);
  });

  it('saves and returns hidden/order preferences, upserting on repeat saves', async () => {
    const { manager } = await seedManager();

    const saved = await api(app)
      .put(`/${API_PREFIX}/dashboard/preferences`)
      .set(...authHeader(manager.accessToken))
      .send({ hiddenWidgets: ['overdueList'], widgetOrder: ['tasksStatus', 'taskTrend'] });
    expect(saved.status).toBe(200);
    expect(saved.body.data).toEqual({
      hiddenWidgets: ['overdueList'],
      widgetOrder: ['tasksStatus', 'taskTrend'],
    });

    const fetched = await api(app)
      .get(`/${API_PREFIX}/dashboard/preferences`)
      .set(...authHeader(manager.accessToken));
    expect(fetched.body.data).toEqual({
      hiddenWidgets: ['overdueList'],
      widgetOrder: ['tasksStatus', 'taskTrend'],
    });

    const resaved = await api(app)
      .put(`/${API_PREFIX}/dashboard/preferences`)
      .set(...authHeader(manager.accessToken))
      .send({ hiddenWidgets: [], widgetOrder: ['taskTrend'] });
    expect(resaved.body.data).toEqual({ hiddenWidgets: [], widgetOrder: ['taskTrend'] });
  });

  it("one user's preference never affects another user's", async () => {
    const { org, manager } = await seedManager();
    const otherManager = await seedUserAndLogin(app, {
      email: 'other-dash-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });

    await api(app)
      .put(`/${API_PREFIX}/dashboard/preferences`)
      .set(...authHeader(manager.accessToken))
      .send({ hiddenWidgets: ['overdueList'], widgetOrder: [] });

    const otherFetched = await api(app)
      .get(`/${API_PREFIX}/dashboard/preferences`)
      .set(...authHeader(otherManager.accessToken));
    expect(otherFetched.body.data).toEqual({ hiddenWidgets: [], widgetOrder: [] });
  });
});
