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

/** Fire-and-forget persistence (see ApiLogInterceptor) means a write can still be in flight
 * immediately after the response comes back - give it a beat before asserting on it. */
async function flushApiLogWrites(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 100));
}

describe('api logs (integration)', () => {
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

  async function seedPlatformAdmin(email: string) {
    return seedUserAndLogin(app, {
      email,
      password: 'Password123',
      role: Role.PLATFORM_ADMIN,
      organizationId: null,
    });
  }

  it('rejects an ordinary org role from viewing the API log (403)', async () => {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: 'log-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/platform/logs`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(403);
  });

  it('records method, path, status, and organization for a completed request', async () => {
    const platformAdmin = await seedPlatformAdmin('log-platform-admin-1@example.com');
    const org = await seedOrganization(app, { name: 'Logged Org' });
    const admin = await seedUserAndLogin(app, {
      email: 'logged-org-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });

    await api(app)
      .get(`/${API_PREFIX}/projects`)
      .set(...authHeader(admin.accessToken));
    await flushApiLogWrites();

    const res = await api(app)
      .get(`/${API_PREFIX}/platform/logs`)
      .set(...authHeader(platformAdmin.accessToken));
    expect(res.status).toBe(200);

    const entry = res.body.data.find(
      (e: { path: string; method: string }) =>
        e.path === `/${API_PREFIX}/projects` && e.method === 'GET',
    );
    expect(entry).toBeDefined();
    expect(entry.statusCode).toBe(200);
    expect(entry.organization).toMatchObject({ name: 'Logged Org' });
  });

  it('records a failed request with its real status code and no organization for a public route', async () => {
    const platformAdmin = await seedPlatformAdmin('log-platform-admin-2@example.com');

    await api(app)
      .post(`/${API_PREFIX}/auth/login`)
      .send({ email: 'nobody@x.com', password: 'wrong' });
    await flushApiLogWrites();

    const res = await api(app)
      .get(`/${API_PREFIX}/platform/logs`)
      .set(...authHeader(platformAdmin.accessToken));

    const entry = res.body.data.find(
      (e: { path: string; method: string }) => e.path === `/${API_PREFIX}/auth/login`,
    );
    expect(entry).toBeDefined();
    expect(entry.statusCode).toBe(401);
    expect(entry.organization).toBeNull();
  });

  it('does not log health check requests', async () => {
    const platformAdmin = await seedPlatformAdmin('log-platform-admin-3@example.com');

    await api(app).get(`/${API_PREFIX}/health`);
    await flushApiLogWrites();

    const res = await api(app)
      .get(`/${API_PREFIX}/platform/logs`)
      .set(...authHeader(platformAdmin.accessToken));

    const entry = res.body.data.find((e: { path: string }) => e.path.endsWith('/health'));
    expect(entry).toBeUndefined();
  });

  it('filters by organizationId, method, and status class', async () => {
    const platformAdmin = await seedPlatformAdmin('log-platform-admin-4@example.com');
    const orgA = await seedOrganization(app, { name: 'Org A' });
    const orgB = await seedOrganization(app, { name: 'Org B' });
    const adminA = await seedUserAndLogin(app, {
      email: 'org-a-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: orgA.id,
    });
    const adminB = await seedUserAndLogin(app, {
      email: 'org-b-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: orgB.id,
    });

    await api(app)
      .get(`/${API_PREFIX}/projects`)
      .set(...authHeader(adminA.accessToken));
    await api(app)
      .get(`/${API_PREFIX}/projects`)
      .set(...authHeader(adminB.accessToken));
    await api(app)
      .get(`/${API_PREFIX}/projects/000000000000000000000000`)
      .set(...authHeader(adminA.accessToken));
    await flushApiLogWrites();

    const byOrg = await api(app)
      .get(`/${API_PREFIX}/platform/logs`)
      .query({ organizationId: orgA.id })
      .set(...authHeader(platformAdmin.accessToken));
    expect(byOrg.status).toBe(200);
    expect(
      byOrg.body.data.every(
        (e: { organization: { id: string } | null }) => e.organization?.id === orgA.id,
      ),
    ).toBe(true);
    expect(byOrg.body.data.length).toBeGreaterThanOrEqual(2);

    const byStatusClass = await api(app)
      .get(`/${API_PREFIX}/platform/logs`)
      .query({ organizationId: orgA.id, statusClass: '4xx' })
      .set(...authHeader(platformAdmin.accessToken));
    expect(byStatusClass.body.data.length).toBeGreaterThanOrEqual(1);
    expect(
      byStatusClass.body.data.every(
        (e: { statusCode: number }) => e.statusCode >= 400 && e.statusCode < 500,
      ),
    ).toBe(true);

    const byMethod = await api(app)
      .get(`/${API_PREFIX}/platform/logs`)
      .query({ method: 'GET', organizationId: orgB.id })
      .set(...authHeader(platformAdmin.accessToken));
    expect(byMethod.body.data.every((e: { method: string }) => e.method === 'GET')).toBe(true);
  });

  it('filters by a path substring', async () => {
    const platformAdmin = await seedPlatformAdmin('log-platform-admin-5@example.com');
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: 'path-filter-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });

    await api(app)
      .get(`/${API_PREFIX}/dashboard/summary`)
      .set(...authHeader(admin.accessToken));
    await flushApiLogWrites();

    const res = await api(app)
      .get(`/${API_PREFIX}/platform/logs`)
      .query({ path: 'dashboard' })
      .set(...authHeader(platformAdmin.accessToken));

    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    expect(
      res.body.data.every((e: { path: string }) => e.path.toLowerCase().includes('dashboard')),
    ).toBe(true);
  });
});
