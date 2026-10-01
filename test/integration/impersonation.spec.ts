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
import { api, createProject, createTask } from './setup/fixtures';

const READ_ONLY_MESSAGE =
  'You are viewing as another user (read-only) - exit "view as" to make changes';

/** Module 8 gap-closure: read-only Admin impersonation ("view as"). */
describe('impersonation (integration)', () => {
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

  async function seedOrg(prefix = 'imp') {
    const org = await seedOrganization(app, { name: `${prefix} org`, slug: `${prefix}-org` });
    const admin = await seedUserAndLogin(app, {
      email: `${prefix}-admin@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const dev = await seedUserAndLogin(app, {
      email: `${prefix}-dev@example.com`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, dev };
  }

  function impersonate(token: string, userId: string) {
    return api(app)
      .post(`/${API_PREFIX}/auth/impersonate/${userId}`)
      .set(...authHeader(token));
  }

  it('issues an access-only token that sees exactly what the target sees, audit-logged', async () => {
    const { admin, dev } = await seedOrg();
    const project = await createProject(app, admin.accessToken, {
      name: 'Dev project',
      memberIds: [dev.userDoc.id],
    });
    await createProject(app, admin.accessToken, { name: 'Admin-only project' });

    const res = await impersonate(admin.accessToken, dev.userDoc.id);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ expiresInSeconds: 900, user: { id: dev.userDoc.id } });
    expect(res.body.data.refreshToken).toBeUndefined();
    const token = res.body.data.accessToken as string;

    const me = await api(app)
      .get(`/${API_PREFIX}/auth/me`)
      .set(...authHeader(token));
    expect(me.body.data.email).toBe('imp-dev@example.com');

    // Role-scoped data: the Developer sees only the project they're a member of.
    const projects = await api(app)
      .get(`/${API_PREFIX}/projects`)
      .set(...authHeader(token));
    expect(projects.body.data.map((p: { id: string }) => p.id)).toEqual([project.id]);

    const audit = await api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .query({ action: AuditAction.IMPERSONATION_STARTED })
      .set(...authHeader(admin.accessToken));
    expect(audit.body.data[0]).toMatchObject({
      targetId: dev.userDoc.id,
      actor: { email: 'imp-admin@example.com' },
    });
  });

  it('refuses every write while viewing as - including logout and password change', async () => {
    const { admin, dev } = await seedOrg('ro');
    const project = await createProject(app, admin.accessToken, {
      name: 'RO project',
      memberIds: [dev.userDoc.id],
    });
    const task = await createTask(app, admin.accessToken, {
      title: 'Existing',
      project: project.id,
      priority: 'P2',
    });
    const token = (await impersonate(admin.accessToken, dev.userDoc.id)).body.data.accessToken;
    const auth = authHeader(token);

    const attempts = await Promise.all([
      api(app)
        .post(`/${API_PREFIX}/tasks`)
        .set(...auth)
        .send({
          title: 'As someone else',
          project: project.id,
          priority: 'P2',
        }),
      api(app)
        .patch(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...auth)
        .send({ title: 'Edited' }),
      api(app)
        .post(`/${API_PREFIX}/tasks/${task.id}/comments`)
        .set(...auth)
        .send({ body: 'Hi' }),
      api(app)
        .delete(`/${API_PREFIX}/tasks/${task.id}`)
        .set(...auth),
      api(app)
        .post(`/${API_PREFIX}/auth/logout`)
        .set(...auth)
        .send({}),
      api(app)
        .post(`/${API_PREFIX}/auth/logout-all`)
        .set(...auth),
      api(app)
        .patch(`/${API_PREFIX}/auth/me`)
        .set(...auth)
        .send({ name: 'Renamed' }),
      api(app)
        .patch(`/${API_PREFIX}/auth/me/password`)
        .set(...auth)
        .send({ currentPassword: 'Password123', newPassword: 'Password456' }),
    ]);
    for (const res of attempts) {
      expect({ status: res.status, message: res.body.message }).toEqual({
        status: 403,
        message: READ_ONLY_MESSAGE,
      });
    }

    // The real user's own session is untouched: their refresh token still works.
    const refreshed = await api(app)
      .post(`/${API_PREFIX}/auth/refresh`)
      .send({ refreshToken: dev.refreshToken });
    expect(refreshed.status).toBe(200);
  });

  it('allows ending the session (audit-logged under the real Admin)', async () => {
    const { admin, dev } = await seedOrg('end');
    const token = (await impersonate(admin.accessToken, dev.userDoc.id)).body.data.accessToken;
    const ended = await api(app)
      .post(`/${API_PREFIX}/auth/impersonation/end`)
      .set(...authHeader(token));
    expect(ended.status).toBe(204);

    const audit = await api(app)
      .get(`/${API_PREFIX}/audit-log`)
      .query({ action: AuditAction.IMPERSONATION_ENDED })
      .set(...authHeader(admin.accessToken));
    expect(audit.body.data[0]).toMatchObject({
      targetId: dev.userDoc.id,
      actor: { email: 'end-admin@example.com' },
    });
  });

  it('rejects self, another Admin, a deactivated user, another org, and non-Admin callers', async () => {
    const { org, admin, dev } = await seedOrg('rules');
    const otherAdmin = await seedUser(app, {
      email: 'rules-admin2@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const inactive = await seedUser(app, {
      email: 'rules-inactive@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
      isActive: false,
    });
    const foreign = await seedOrg('rulesother');

    expect((await impersonate(admin.accessToken, admin.userDoc.id)).status).toBe(400);
    expect((await impersonate(admin.accessToken, otherAdmin.id)).status).toBe(403);
    expect((await impersonate(admin.accessToken, inactive.id)).status).toBe(400);
    expect((await impersonate(admin.accessToken, foreign.dev.userDoc.id)).status).toBe(404);
    expect((await impersonate(dev.accessToken, admin.userDoc.id)).status).toBe(403);

    // No nesting: a "view as" token can't start another one.
    const token = (await impersonate(admin.accessToken, dev.userDoc.id)).body.data.accessToken;
    expect((await impersonate(token, dev.userDoc.id)).status).toBe(403);
  });

  it('kills the session immediately once the Admin is demoted', async () => {
    const { org, admin, dev } = await seedOrg('kill');
    const token = (await impersonate(admin.accessToken, dev.userDoc.id)).body.data.accessToken;
    const secondAdmin = await seedUserAndLogin(app, {
      email: 'kill-admin2@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    await api(app)
      .patch(`/${API_PREFIX}/users/${admin.userDoc.id}/role`)
      .set(...authHeader(secondAdmin.accessToken))
      .send({ role: Role.MANAGER });

    const res = await api(app)
      .get(`/${API_PREFIX}/auth/me`)
      .set(...authHeader(token));
    expect(res.status).toBe(401);

    // The demoted Admin's normal login is unaffected.
    await expect(loginAs(app, 'kill-admin@example.com', 'Password123')).resolves.toBeDefined();
  });
});
