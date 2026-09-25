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
 * Module 8's Admin Audit Log: a semantic "who changed what" trail for the admin-console-surface
 * actions (user lifecycle, org settings, and the 4 reusable scheme/team/role config types).
 * Deliberately separate from `platform/logs` (a raw HTTP request/response log) and from the
 * per-task/per-project activity feeds (day-to-day work item changes), which this does not touch.
 */
describe('audit log (integration)', () => {
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

  async function seedOrgWithAdmin(adminEmail = 'audit-admin@example.com') {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: adminEmail,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    return { org, admin };
  }

  function listAuditLog(token: string, query: Record<string, string> = {}) {
    return api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .query(query)
      .set(...authHeader(token));
  }

  it('rejects a non-Admin from viewing the audit log (403)', async () => {
    const { org } = await seedOrgWithAdmin();
    const developer = await seedUserAndLogin(app, {
      email: 'audit-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const res = await listAuditLog(developer.accessToken);
    expect(res.status).toBe(403);
  });

  it('starts with no audit log entries (regression)', async () => {
    const { admin } = await seedOrgWithAdmin();
    const res = await listAuditLog(admin.accessToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
    expect(res.body.meta).toMatchObject({ total: 0, page: 1, limit: 20 });
  });

  it('records UserCreated, UserRoleChanged, and UserStatusChanged for the user lifecycle', async () => {
    const { admin } = await seedOrgWithAdmin();

    const created = await api(app)
      .post(`/${API_PREFIX}/users`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Tracked User',
        email: 'tracked-user@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
      });
    expect(created.status).toBe(201);
    const userId = created.body.data.id;

    await api(app)
      .patch(`/${API_PREFIX}/users/${userId}/role`)
      .set(...authHeader(admin.accessToken))
      .send({ role: Role.MANAGER });

    await api(app)
      .patch(`/${API_PREFIX}/users/${userId}/status`)
      .set(...authHeader(admin.accessToken))
      .send({ isActive: false });

    const res = await listAuditLog(admin.accessToken, { sortOrder: 'asc' });
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(3);

    const [createdEntry, roleEntry, statusEntry] = res.body.data;
    expect(createdEntry).toMatchObject({
      action: AuditAction.USER_CREATED,
      targetType: 'User',
      targetId: userId,
      targetLabel: 'Tracked User',
      metadata: { role: Role.DEVELOPER },
    });
    expect(createdEntry.actor).toMatchObject({ email: admin.userDoc.email });

    expect(roleEntry).toMatchObject({
      action: AuditAction.USER_ROLE_CHANGED,
      targetId: userId,
      metadata: { from: Role.DEVELOPER, to: Role.MANAGER },
    });

    expect(statusEntry).toMatchObject({
      action: AuditAction.USER_STATUS_CHANGED,
      targetId: userId,
      metadata: { isActive: false },
    });
  });

  it('records UserUpdated on a name/email change', async () => {
    const { admin } = await seedOrgWithAdmin();
    const created = await api(app)
      .post(`/${API_PREFIX}/users`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Before Name',
        email: 'update-target@example.com',
        password: 'Password123',
        role: Role.DEVELOPER,
      });

    await api(app)
      .patch(`/${API_PREFIX}/users/${created.body.data.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'After Name' });

    const res = await listAuditLog(admin.accessToken, { action: AuditAction.USER_UPDATED });
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({
      action: AuditAction.USER_UPDATED,
      targetId: created.body.data.id,
      targetLabel: 'After Name',
    });
  });

  it('records create/update/delete for a permission scheme', async () => {
    const { admin } = await seedOrgWithAdmin();
    const created = await api(app)
      .post(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Scheme A', grants: [] });
    const schemeId = created.body.data.id;

    await api(app)
      .patch(`/${API_PREFIX}/permission-schemes/${schemeId}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Scheme A Renamed' });

    await api(app)
      .delete(`/${API_PREFIX}/permission-schemes/${schemeId}`)
      .set(...authHeader(admin.accessToken));

    const res = await listAuditLog(admin.accessToken, { sortOrder: 'asc' });
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual([
      AuditAction.PERMISSION_SCHEME_CREATED,
      AuditAction.PERMISSION_SCHEME_UPDATED,
      AuditAction.PERMISSION_SCHEME_DELETED,
    ]);
    expect(res.body.data[1].targetLabel).toBe('Scheme A Renamed');
    // The delete lookup happens BEFORE the document is removed, so the name snapshot survives.
    expect(res.body.data[2].targetLabel).toBe('Scheme A Renamed');
  });

  it('records create/update/delete for a security scheme', async () => {
    const { admin } = await seedOrgWithAdmin();
    const level = { name: 'Confidential', allowedRoles: [Role.ADMIN], allowedUserIds: [] };
    const created = await api(app)
      .post(`/${API_PREFIX}/security-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Levels A', levels: [level] });
    const schemeId = created.body.data.id;

    await api(app)
      .patch(`/${API_PREFIX}/security-schemes/${schemeId}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Levels A Renamed' });

    await api(app)
      .delete(`/${API_PREFIX}/security-schemes/${schemeId}`)
      .set(...authHeader(admin.accessToken));

    const res = await listAuditLog(admin.accessToken, { sortOrder: 'asc' });
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual([
      AuditAction.SECURITY_SCHEME_CREATED,
      AuditAction.SECURITY_SCHEME_UPDATED,
      AuditAction.SECURITY_SCHEME_DELETED,
    ]);
    expect(res.body.data[2].targetLabel).toBe('Levels A Renamed');
  });

  it('records create/update/delete for a team', async () => {
    const { admin } = await seedOrgWithAdmin();
    const created = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Team A' });
    const teamId = created.body.data.id;

    await api(app)
      .patch(`/${API_PREFIX}/teams/${teamId}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Team A Renamed' });

    await api(app)
      .delete(`/${API_PREFIX}/teams/${teamId}`)
      .set(...authHeader(admin.accessToken));

    const res = await listAuditLog(admin.accessToken, { sortOrder: 'asc' });
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual([
      AuditAction.TEAM_CREATED,
      AuditAction.TEAM_UPDATED,
      AuditAction.TEAM_DELETED,
    ]);
    expect(res.body.data[2].targetLabel).toBe('Team A Renamed');
  });

  it('records create/update/delete for a project role', async () => {
    const { admin } = await seedOrgWithAdmin();
    const created = await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Role A' });
    const roleId = created.body.data.id;

    await api(app)
      .patch(`/${API_PREFIX}/project-roles/${roleId}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Role A Renamed' });

    await api(app)
      .delete(`/${API_PREFIX}/project-roles/${roleId}`)
      .set(...authHeader(admin.accessToken));

    const res = await listAuditLog(admin.accessToken, { sortOrder: 'asc' });
    expect(res.body.data.map((e: { action: string }) => e.action)).toEqual([
      AuditAction.PROJECT_ROLE_CREATED,
      AuditAction.PROJECT_ROLE_UPDATED,
      AuditAction.PROJECT_ROLE_DELETED,
    ]);
    expect(res.body.data[2].targetLabel).toBe('Role A Renamed');
  });

  it('filters by action and by actorId', async () => {
    const { admin } = await seedOrgWithAdmin();
    const otherAdmin = await seedUserAndLogin(app, {
      email: 'audit-admin-2@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: admin.userDoc.organizationId!.toString(),
    });

    await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Filter Team' });
    await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(otherAdmin.accessToken))
      .send({ name: 'Filter Role' });

    const byAction = await listAuditLog(admin.accessToken, { action: AuditAction.TEAM_CREATED });
    expect(byAction.body.data).toHaveLength(1);
    expect(byAction.body.data[0].action).toBe(AuditAction.TEAM_CREATED);

    const byActor = await listAuditLog(admin.accessToken, { actorId: otherAdmin.userDoc.id });
    expect(byActor.body.data).toHaveLength(1);
    expect(byActor.body.data[0].action).toBe(AuditAction.PROJECT_ROLE_CREATED);
  });

  it('a dateFrom in the future excludes all existing entries', async () => {
    const { admin } = await seedOrgWithAdmin();
    await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Dated Team' });

    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const res = await listAuditLog(admin.accessToken, { dateFrom: future });
    expect(res.body.data).toEqual([]);
  });

  it("never lets an Admin from a different org see another org's audit log", async () => {
    const { admin: ownerAdmin } = await seedOrgWithAdmin('audit-owner@example.com');
    const { admin: strangerAdmin } = await seedOrgWithAdmin('audit-stranger@example.com');

    await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(ownerAdmin.accessToken))
      .send({ name: 'Owner Org Team' });

    const strangerLog = await listAuditLog(strangerAdmin.accessToken);
    expect(strangerLog.body.data).toEqual([]);
  });

  it('an entry with no metadata still returns metadata as {} rather than omitting the field (regression: Mongoose minimize)', async () => {
    // Live-browser smoke testing caught this: Mongoose's default `minimize: true` strips an
    // empty-object field entirely on save, so `AuditLogService.record()`'s `metadata ?? {}`
    // default was silently dropped before ever reaching the database - the field was missing
    // from the API response, not merely empty, and the frontend crashed on `Object.entries`
    // of `undefined`. `TeamCreated` is a real example: TeamsController never passes metadata.
    const { admin } = await seedOrgWithAdmin();
    await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'No Metadata Team' });

    const res = await listAuditLog(admin.accessToken);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].metadata).toEqual({});
  });

  it('a failed mutation (validation error) never produces an audit entry', async () => {
    const { admin } = await seedOrgWithAdmin();
    const rejected = await api(app)
      .post(`/${API_PREFIX}/teams`)
      .set(...authHeader(admin.accessToken))
      .send({ name: '' });
    expect(rejected.status).toBe(400);

    const res = await listAuditLog(admin.accessToken);
    expect(res.body.data).toEqual([]);
  });
});
