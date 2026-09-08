import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { OrganizationStatus } from 'src/common/enums/organization-status.enum';
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

/**
 * Covers the platform/org split enforced by OrganizationScopeGuard: a PlatformAdmin can reach
 * only @PlatformOnly() (or @Public()/@SharedRoute()) routes, and every ordinary org role is
 * permanently locked out of the Platform Admin API. Also smoke-tests the Platform Admin API's
 * CRUD surface end to end.
 */
describe('platform admin boundary and API (integration)', () => {
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

  describe('a PlatformAdmin cannot reach any ordinary org route', () => {
    it('403 on GET /projects, /tasks, /users, /dashboard/summary', async () => {
      const platformAdmin = await seedPlatformAdmin('boundary-platform-admin@example.com');

      const routes = [
        `/${API_PREFIX}/projects`,
        `/${API_PREFIX}/tasks`,
        `/${API_PREFIX}/users`,
        `/${API_PREFIX}/dashboard/summary`,
      ];
      for (const route of routes) {
        const res = await api(app)
          .get(route)
          .set(...authHeader(platformAdmin.accessToken));
        expect(res.status).toBe(403);
      }
    });

    it('200 on GET /platform/organizations and GET /platform/stats', async () => {
      const platformAdmin = await seedPlatformAdmin('boundary-platform-admin-2@example.com');

      const orgsRes = await api(app)
        .get(`/${API_PREFIX}/platform/organizations`)
        .set(...authHeader(platformAdmin.accessToken));
      expect(orgsRes.status).toBe(200);

      const statsRes = await api(app)
        .get(`/${API_PREFIX}/platform/stats`)
        .set(...authHeader(platformAdmin.accessToken));
      expect(statsRes.status).toBe(200);
      expect(statsRes.body.data).toMatchObject({
        organizationCount: expect.any(Number),
        totalUserCount: expect.any(Number),
      });
    });
  });

  describe('an ordinary org role can never reach the Platform Admin API', () => {
    it('403 for Admin/Manager/Developer on every /platform/organizations* and /platform/stats route', async () => {
      const org = await seedOrganization(app);
      const admin = await seedUserAndLogin(app, {
        email: 'boundary-admin@example.com',
        password: 'Password123',
        role: Role.ADMIN,
        organizationId: org.id,
      });
      const manager = await seedUserAndLogin(app, {
        email: 'boundary-manager@example.com',
        password: 'Password123',
        role: Role.MANAGER,
        organizationId: org.id,
      });
      const developer = await seedUserAndLogin(app, {
        email: 'boundary-developer@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
        organizationId: org.id,
      });

      for (const { accessToken } of [admin, manager, developer]) {
        const listRes = await api(app)
          .get(`/${API_PREFIX}/platform/organizations`)
          .set(...authHeader(accessToken));
        expect(listRes.status).toBe(403);

        const detailRes = await api(app)
          .get(`/${API_PREFIX}/platform/organizations/${org.id}`)
          .set(...authHeader(accessToken));
        expect(detailRes.status).toBe(403);

        const createRes = await api(app)
          .post(`/${API_PREFIX}/platform/organizations`)
          .set(...authHeader(accessToken))
          .send({
            organizationName: 'Should Not Be Created',
            adminName: 'Nope',
            adminEmail: 'should-not-exist@example.com',
            adminPassword: 'Password123',
          });
        expect(createRes.status).toBe(403);

        const statsRes = await api(app)
          .get(`/${API_PREFIX}/platform/stats`)
          .set(...authHeader(accessToken));
        expect(statsRes.status).toBe(403);
      }
    });
  });

  describe('Platform Admin API CRUD smoke test', () => {
    it('create -> list -> detail -> suspend -> reactivate -> add a second admin', async () => {
      const platformAdmin = await seedPlatformAdmin('crud-platform-admin@example.com');

      const createRes = await api(app)
        .post(`/${API_PREFIX}/platform/organizations`)
        .set(...authHeader(platformAdmin.accessToken))
        .send({
          organizationName: 'Acme Inc',
          adminName: 'Acme Admin',
          adminEmail: 'acme-admin@example.com',
          adminPassword: 'Password123',
        });
      expect(createRes.status).toBe(201);
      const orgId: string = createRes.body.data.organization.id;
      expect(createRes.body.data.admin.email).toBe('acme-admin@example.com');

      const listRes = await api(app)
        .get(`/${API_PREFIX}/platform/organizations`)
        .set(...authHeader(platformAdmin.accessToken));
      expect(listRes.status).toBe(200);
      const listedOrg = listRes.body.data.find((o: { id: string }) => o.id === orgId);
      expect(listedOrg).toMatchObject({ name: 'Acme Inc', userCount: 1 });

      const detailRes = await api(app)
        .get(`/${API_PREFIX}/platform/organizations/${orgId}`)
        .set(...authHeader(platformAdmin.accessToken));
      expect(detailRes.status).toBe(200);
      expect(detailRes.body.data.admins).toHaveLength(1);
      expect(detailRes.body.data.admins[0]).toMatchObject({ email: 'acme-admin@example.com' });

      const renameRes = await api(app)
        .patch(`/${API_PREFIX}/platform/organizations/${orgId}`)
        .set(...authHeader(platformAdmin.accessToken))
        .send({ name: 'Acme International' });
      expect(renameRes.status).toBe(200);
      expect(renameRes.body.data.name).toBe('Acme International');

      const suspendRes = await api(app)
        .patch(`/${API_PREFIX}/platform/organizations/${orgId}/status`)
        .set(...authHeader(platformAdmin.accessToken))
        .send({ status: OrganizationStatus.SUSPENDED });
      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.data.status).toBe(OrganizationStatus.SUSPENDED);

      // Adding an admin to a suspended org is rejected (organizations.service.ts
      // `getActiveOrThrow`); reactivate first so the "add a second admin" step below is exercising
      // the add-admin behavior itself, not this separate suspended-org guard.
      const blockedAddAdmin = await api(app)
        .post(`/${API_PREFIX}/platform/organizations/${orgId}/admins`)
        .set(...authHeader(platformAdmin.accessToken))
        .send({
          name: 'Blocked Admin',
          email: 'blocked-admin@example.com',
          password: 'Password123',
        });
      expect(blockedAddAdmin.status).toBe(400);

      const reactivateRes = await api(app)
        .patch(`/${API_PREFIX}/platform/organizations/${orgId}/status`)
        .set(...authHeader(platformAdmin.accessToken))
        .send({ status: OrganizationStatus.ACTIVE });
      expect(reactivateRes.status).toBe(200);
      expect(reactivateRes.body.data.status).toBe(OrganizationStatus.ACTIVE);

      const addAdminRes = await api(app)
        .post(`/${API_PREFIX}/platform/organizations/${orgId}/admins`)
        .set(...authHeader(platformAdmin.accessToken))
        .send({ name: 'Second Admin', email: 'second-admin@example.com', password: 'Password123' });
      expect(addAdminRes.status).toBe(201);

      const listAfterRes = await api(app)
        .get(`/${API_PREFIX}/platform/organizations`)
        .set(...authHeader(platformAdmin.accessToken));
      const listedAfter = listAfterRes.body.data.find((o: { id: string }) => o.id === orgId);
      expect(listedAfter.userCount).toBe(2);

      const detailAfterRes = await api(app)
        .get(`/${API_PREFIX}/platform/organizations/${orgId}`)
        .set(...authHeader(platformAdmin.accessToken));
      expect(detailAfterRes.body.data.admins).toHaveLength(2);
    });
  });
});
