import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { AuditAction } from 'src/modules/audit-log/schemas/audit-log-entry.schema';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUser,
  seedUserAndLogin,
  authHeader,
  loginAs,
} from './setup/test-app';
import { api } from './setup/fixtures';

/** Module 8 gap-closure: bulk user actions (`POST users/bulk/role`, `POST users/bulk/status`). */
describe('users bulk actions (integration)', () => {
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

  async function seedOrg(prefix = 'bulk') {
    const org = await seedOrganization(app, { name: `${prefix} org`, slug: `${prefix}-org` });
    const admin = await seedUserAndLogin(app, {
      email: `${prefix}-admin@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const devs = await Promise.all(
      [1, 2].map((n) =>
        seedUser(app, {
          email: `${prefix}-dev${n}@example.com`,
          password: 'Password123',
          role: Role.DEVELOPER,
          organizationId: org.id,
        }),
      ),
    );
    return { org, admin, devs };
  }

  function bulk(path: 'role' | 'status', token: string, body: Record<string, unknown>) {
    return api(app)
      .post(`/${API_PREFIX}/users/bulk/${path}`)
      .set(...authHeader(token))
      .send(body);
  }

  it('changes many roles at once and audit-logs each change individually', async () => {
    const { admin, devs } = await seedOrg();
    const ids = devs.map((d) => d.id);

    const res = await bulk('role', admin.accessToken, { userIds: ids, role: Role.MANAGER });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ succeeded: ids, failed: [] });

    const list = await api(app)
      .get(`/${API_PREFIX}/users`)
      .query({ role: Role.MANAGER })
      .set(...authHeader(admin.accessToken));
    expect(list.body.data.map((u: { id: string }) => u.id).sort()).toEqual([...ids].sort());

    const audit = await api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .query({ action: AuditAction.USER_ROLE_CHANGED })
      .set(...authHeader(admin.accessToken));
    expect(audit.body.data).toHaveLength(2);
    expect(audit.body.data[0].metadata).toMatchObject({ from: 'Developer', to: 'Manager' });
  });

  it("reports the acting Admin and another org's user as per-id failures without aborting the rest", async () => {
    const { admin, devs } = await seedOrg('mix');
    const other = await seedOrg('mixother');

    const res = await bulk('status', admin.accessToken, {
      userIds: [devs[0]!.id, admin.user.id, other.devs[0]!.id],
      isActive: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.succeeded).toEqual([devs[0]!.id]);
    expect(res.body.data.failed).toEqual([
      { userId: admin.user.id, message: 'Admins cannot deactivate themselves' },
      { userId: other.devs[0]!.id, message: 'User not found' },
    ]);

    // The other org's user really is untouched, and the deactivated dev can no longer log in.
    const otherList = await api(app)
      .get(`/${API_PREFIX}/users`)
      .query({ isActive: 'true' })
      .set(...authHeader(other.admin.accessToken));
    expect(otherList.body.data.map((u: { id: string }) => u.id)).toContain(other.devs[0]!.id);
    await expect(loginAs(app, 'mix-dev1@example.com', 'Password123')).rejects.toThrow();
  });

  it('skips audit entries for no-op changes but still reports them as succeeded', async () => {
    const { admin, devs } = await seedOrg('noop');
    const res = await bulk('status', admin.accessToken, {
      userIds: [devs[0]!.id, devs[0]!.id],
      isActive: true,
    });
    expect(res.body.data).toEqual({ succeeded: [devs[0]!.id], failed: [] });

    const audit = await api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .query({ action: AuditAction.USER_STATUS_CHANGED })
      .set(...authHeader(admin.accessToken));
    expect(audit.body.data).toHaveLength(0);
  });

  it('is Admin-only and validates its payload', async () => {
    const { org, admin, devs } = await seedOrg('val');
    const manager = await seedUserAndLogin(app, {
      email: 'val-mgr@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    expect(
      (await bulk('role', manager.accessToken, { userIds: [devs[0]!.id], role: Role.ADMIN }))
        .status,
    ).toBe(403);
    expect((await bulk('role', admin.accessToken, { userIds: [], role: Role.ADMIN })).status).toBe(
      400,
    );
    expect(
      (await bulk('role', admin.accessToken, { userIds: [devs[0]!.id], role: 'PlatformAdmin' }))
        .status,
    ).toBe(400);
  });
});
