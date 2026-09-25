import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { AuditAction } from 'src/modules/audit-log/schemas/audit-log-entry.schema';
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
 * Module 8's new self-service org settings surface (`GET/PATCH organizations/me`), purely
 * additive: an org's own Admin can now manage name/timezone/logoUrl for their OWN org, which was
 * previously PlatformAdmin-only. Confirms the existing `platform/organizations/:id` rename route
 * (any org, by id) is completely unaffected by this addition.
 */
describe('organization settings (integration)', () => {
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

  async function seedOrgWithAdmin(name = 'Settings Org') {
    const org = await seedOrganization(app, { name });
    const admin = await seedUserAndLogin(app, {
      email: `settings-admin-${Math.random().toString(36).slice(2, 8)}@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    return { org, admin };
  }

  it('defaults to UTC timezone and a null logoUrl for a freshly seeded org', async () => {
    const { org, admin } = await seedOrgWithAdmin();
    const res = await api(app)
      .get(`/${API_PREFIX}/organizations/me`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: org.id,
      name: org.name,
      timezone: 'UTC',
      logoUrl: null,
    });
  });

  it("lets an org's own Admin update name, timezone, and logoUrl", async () => {
    const { admin } = await seedOrgWithAdmin();
    const res = await api(app)
      .patch(`/${API_PREFIX}/organizations/me`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Renamed By Self',
        timezone: 'America/New_York',
        logoUrl: 'https://example.com/logo.png',
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      name: 'Renamed By Self',
      timezone: 'America/New_York',
      logoUrl: 'https://example.com/logo.png',
    });

    const refetch = await api(app)
      .get(`/${API_PREFIX}/organizations/me`)
      .set(...authHeader(admin.accessToken));
    expect(refetch.body.data.name).toBe('Renamed By Self');
  });

  it('rejects a Manager and a Developer from reading or updating org settings (403)', async () => {
    const { org } = await seedOrgWithAdmin();
    const manager = await seedUserAndLogin(app, {
      email: 'settings-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'settings-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });

    for (const user of [manager, developer]) {
      const getRes = await api(app)
        .get(`/${API_PREFIX}/organizations/me`)
        .set(...authHeader(user.accessToken));
      expect(getRes.status).toBe(403);

      const patchRes = await api(app)
        .patch(`/${API_PREFIX}/organizations/me`)
        .set(...authHeader(user.accessToken))
        .send({ name: 'Should Not Apply' });
      expect(patchRes.status).toBe(403);
    }
  });

  it("never lets an Admin update another org's settings - always scoped to the caller's own org", async () => {
    const { admin: ownerAdmin } = await seedOrgWithAdmin('Owner Org');
    const { org: strangerOrg, admin: strangerAdmin } = await seedOrgWithAdmin('Stranger Org');

    await api(app)
      .patch(`/${API_PREFIX}/organizations/me`)
      .set(...authHeader(strangerAdmin.accessToken))
      .send({ name: 'Stranger Renamed Self' });

    const ownerView = await api(app)
      .get(`/${API_PREFIX}/organizations/me`)
      .set(...authHeader(ownerAdmin.accessToken));
    expect(ownerView.body.data.name).toBe('Owner Org');

    const strangerView = await api(app)
      .get(`/${API_PREFIX}/organizations/me`)
      .set(...authHeader(strangerAdmin.accessToken));
    expect(strangerView.body.data.id).toBe(strangerOrg.id);
    expect(strangerView.body.data.name).toBe('Stranger Renamed Self');
  });

  it('records an OrganizationSettingsUpdated audit entry naming the new value', async () => {
    const { admin } = await seedOrgWithAdmin();
    await api(app)
      .patch(`/${API_PREFIX}/organizations/me`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Audited Rename' });

    const log = await api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .set(...authHeader(admin.accessToken));
    expect(log.body.data).toHaveLength(1);
    expect(log.body.data[0]).toMatchObject({
      action: AuditAction.ORGANIZATION_SETTINGS_UPDATED,
      targetType: 'Organization',
      targetLabel: 'Audited Rename',
      metadata: { name: 'Audited Rename' },
    });
  });

  it('the existing PlatformAdmin-only rename route is completely unaffected by this addition', async () => {
    const { org, admin } = await seedOrgWithAdmin('Platform Managed Org');
    const platformAdmin = await seedUserAndLogin(app, {
      email: 'settings-platform-admin@example.com',
      password: 'Password123',
      role: Role.PLATFORM_ADMIN,
      organizationId: null,
    });

    // The org's own Admin still cannot reach the platform-only route.
    const deniedForOrgAdmin = await api(app)
      .patch(`/${API_PREFIX}/platform/organizations/${org.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Should Be Denied' });
    expect(deniedForOrgAdmin.status).toBe(403);

    // The PlatformAdmin route still works exactly as before (any org, by id, name-only).
    const platformRename = await api(app)
      .patch(`/${API_PREFIX}/platform/organizations/${org.id}`)
      .set(...authHeader(platformAdmin.accessToken))
      .send({ name: 'Renamed By Platform' });
    expect(platformRename.status).toBe(200);
    expect(platformRename.body.data.name).toBe('Renamed By Platform');

    // And the new self-service surface reflects that change (same underlying document).
    const selfView = await api(app)
      .get(`/${API_PREFIX}/organizations/me`)
      .set(...authHeader(admin.accessToken));
    expect(selfView.body.data.name).toBe('Renamed By Platform');
  });
});
