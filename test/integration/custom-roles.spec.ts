import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import {
  API_PREFIX,
  authHeader,
  clearInMemoryMongo,
  closeTestApp,
  createTestApp,
  loginAs,
  seedOrganization,
  seedUserAndLogin,
} from './setup/test-app';
import { api, createProject, createTask } from './setup/fixtures';

const P = `/${API_PREFIX}`;
const PERMS_NONE = {
  canCreateTask: false,
  canEditAnyTask: false,
  canDeleteTask: false,
  canChangeAnyTaskStatus: false,
  canManageSprints: false,
  canManageProject: false,
};

describe('custom roles - QA, DevOps, Designer, ... (integration)', () => {
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

  async function setup() {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: 'cr-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'cr-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const roles = await api(app)
      .get(`${P}/custom-roles`)
      .set(...authHeader(admin.accessToken));
    const byName = Object.fromEntries(
      (roles.body.data as Array<{ name: string; id: string }>).map((r) => [r.name, r]),
    );
    return { org, admin, developer, roles: roles.body.data, byName };
  }

  async function createUserWithRole(adminToken: string, email: string, customRoleId: string) {
    const res = await api(app)
      .post(`${P}/users`)
      .set(...authHeader(adminToken))
      .send({
        name: 'Role Holder',
        email,
        password: 'Password123',
        role: 'Developer',
        customRoleId,
      });
    expect(res.status).toBe(201);
    return { user: res.body.data, session: await loginAs(app, email, 'Password123') };
  }

  it('every organization starts with QA, DevOps, Designer and Business Analyst - seeded once', async () => {
    const { admin, roles, byName } = await setup();

    // Plus the built-in Manager/Developer rows (listed first, permissions-only, never deleted).
    expect(roles.slice(0, 2).map((r: { name: string }) => r.name)).toEqual([
      'Manager',
      'Developer',
    ]);
    const customRoles = roles.filter((r: { builtInRole: string | null }) => !r.builtInRole);
    expect(customRoles.map((r: { name: string }) => r.name).sort()).toEqual([
      'Business Analyst',
      'Designer',
      'DevOps',
      'QA',
    ]);
    expect(byName.QA).toMatchObject({
      accessLevel: 'Developer',
      memberCount: 0,
      permissions: { ...PERMS_NONE, canCreateTask: true, canChangeAnyTaskStatus: true },
    });

    // Deleting every role keeps them deleted - the defaults are not re-seeded.
    for (const r of customRoles) {
      const del = await api(app)
        .delete(`${P}/custom-roles/${r.id}`)
        .set(...authHeader(admin.accessToken));
      expect(del.status).toBe(204);
    }
    const after = await api(app)
      .get(`${P}/custom-roles`)
      .set(...authHeader(admin.accessToken));
    expect(after.body.data.map((r: { name: string }) => r.name)).toEqual(['Manager', 'Developer']);
  });

  it('a QA user keeps Developer access, and /auth/me carries the role and its permissions', async () => {
    const { admin, byName } = await setup();
    const { user, session } = await createUserWithRole(
      admin.accessToken,
      'qa-person@example.com',
      byName.QA.id,
    );

    expect(user).toMatchObject({ role: 'Developer', customRoleId: byName.QA.id });
    expect(session.user).toMatchObject({
      role: 'Developer',
      customRole: {
        name: 'QA',
        accessLevel: 'Developer',
        permissions: { canChangeAnyTaskStatus: true },
      },
    });
    const me = await api(app)
      .get(`${P}/auth/me`)
      .set(...authHeader(session.accessToken));
    expect(me.body.data.customRole.name).toBe('QA');

    // Developer-level access is unchanged: no admin endpoints.
    const users = await api(app)
      .get(`${P}/users`)
      .set(...authHeader(session.accessToken));
    expect(users.status).toBe(403);
  });

  it("a role's permissions are enforced in every project the holder is a member of - and nowhere else", async () => {
    const { admin, developer, byName } = await setup();
    const { user: qaUser, session: qa } = await createUserWithRole(
      admin.accessToken,
      'qa-enforce@example.com',
      byName.QA.id,
    );
    const project = await createProject(app, admin.accessToken, {
      name: 'QA Project',
      memberIds: [qaUser.id, developer.userDoc.id],
    });
    const outside = await createProject(app, admin.accessToken, { name: 'Not A Member' });
    const task = await createTask(app, admin.accessToken, {
      title: 'Someone else’s task',
      project: project.id,
      priority: TaskPriority.P2,
    });

    // A plain Developer can neither move someone else's task nor create tasks...
    const devMove = await api(app)
      .patch(`${P}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'In Progress' });
    expect(devMove.status).toBe(403);
    const devCreate = await api(app)
      .post(`${P}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Dev task', project: project.id, priority: TaskPriority.P2 });
    expect(devCreate.status).toBe(403);

    // ...but QA can do both (canChangeAnyTaskStatus + canCreateTask), with no per-project grant.
    const qaMove = await api(app)
      .patch(`${P}/tasks/${task.id}/status`)
      .set(...authHeader(qa.accessToken))
      .send({ status: 'In Progress' });
    expect(qaMove.status).toBe(200);
    const qaCreate = await api(app)
      .post(`${P}/tasks`)
      .set(...authHeader(qa.accessToken))
      .send({ title: 'Bug found by QA', project: project.id, priority: TaskPriority.P1 });
    expect(qaCreate.status).toBe(201);

    // QA's role grants nothing it doesn't list (delete) ...
    const qaDelete = await api(app)
      .delete(`${P}/tasks/${task.id}`)
      .set(...authHeader(qa.accessToken));
    expect(qaDelete.status).toBe(403);
    // ... and nothing in a project QA is not a member of.
    const qaOutside = await api(app)
      .post(`${P}/tasks`)
      .set(...authHeader(qa.accessToken))
      .send({ title: 'Nope', project: outside.id, priority: TaskPriority.P2 });
    expect(qaOutside.status).toBe(403);

    // Editing the role takes effect immediately for its holders.
    const edit = await api(app)
      .patch(`${P}/custom-roles/${byName.QA.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ permissions: { ...PERMS_NONE, canDeleteTask: true } });
    expect(edit.status).toBe(200);
    const nowCreate = await api(app)
      .post(`${P}/tasks`)
      .set(...authHeader(qa.accessToken))
      .send({ title: 'No longer allowed', project: project.id, priority: TaskPriority.P2 });
    expect(nowCreate.status).toBe(403);
    const nowDelete = await api(app)
      .delete(`${P}/tasks/${task.id}`)
      .set(...authHeader(qa.accessToken));
    expect([200, 204]).toContain(nowDelete.status);
  });

  it('admins create, rename, re-level and delete roles - with validation and audit', async () => {
    const { admin, developer, byName } = await setup();

    const create = await api(app)
      .post(`${P}/custom-roles`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Scrum Master',
        color: 'emerald',
        accessLevel: 'Developer',
        permissions: { ...PERMS_NONE, canManageSprints: true },
      });
    expect(create.status).toBe(201);

    const dup = await api(app)
      .post(`${P}/custom-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'scrum master', accessLevel: 'Developer', permissions: PERMS_NONE });
    expect(dup.status).toBe(409);
    const builtIn = await api(app)
      .post(`${P}/custom-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Manager', accessLevel: 'Developer', permissions: PERMS_NONE });
    expect(builtIn.status).toBe(409);

    // Everyone can read roles (for badges), only Admins can change them.
    expect(
      (
        await api(app)
          .get(`${P}/custom-roles`)
          .set(...authHeader(developer.accessToken))
      ).status,
    ).toBe(200);
    expect(
      (
        await api(app)
          .post(`${P}/custom-roles`)
          .set(...authHeader(developer.accessToken))
          .send({ name: 'Sneaky', accessLevel: 'Developer', permissions: PERMS_NONE })
      ).status,
    ).toBe(403);

    // A role in use can't be deleted; raising its access level moves its holders along.
    const { user } = await createUserWithRole(
      admin.accessToken,
      'devops@example.com',
      byName.DevOps.id,
    );
    const blocked = await api(app)
      .delete(`${P}/custom-roles/${byName.DevOps.id}`)
      .set(...authHeader(admin.accessToken));
    expect(blocked.status).toBe(409);
    expect(blocked.body.message).toMatch(/1 user has this role/);

    const relevel = await api(app)
      .patch(`${P}/custom-roles/${byName.DevOps.id}`)
      .set(...authHeader(admin.accessToken))
      .send({ accessLevel: 'Manager', name: 'Platform Engineer' });
    expect(relevel.body.data).toMatchObject({ accessLevel: 'Manager', memberCount: 1 });
    const holder = await api(app)
      .get(`${P}/users/${user.id}`)
      .set(...authHeader(admin.accessToken));
    expect(holder.body.data.role).toBe('Manager');

    // Filtering the user list by role, and the audit trail.
    const filtered = await api(app)
      .get(`${P}/users?customRoleId=${byName.DevOps.id}`)
      .set(...authHeader(admin.accessToken));
    expect(filtered.body.data.map((u: { email: string }) => u.email)).toEqual([
      'devops@example.com',
    ]);
    const audit = await api(app)
      .get(`${P}/audit-log?limit=50`)
      .set(...authHeader(admin.accessToken));
    const actions = audit.body.data.map((e: { action: string }) => e.action);
    expect(actions).toEqual(expect.arrayContaining(['CustomRoleCreated', 'CustomRoleUpdated']));
  });

  it("changing a user's role between built-in and custom roles, logged by name", async () => {
    const { admin, developer, byName } = await setup();

    const toQa = await api(app)
      .patch(`${P}/users/${developer.userDoc.id}/role`)
      .set(...authHeader(admin.accessToken))
      .send({ role: 'Developer', customRoleId: byName.QA.id });
    expect(toQa.status).toBe(200);
    expect(toQa.body.data).toMatchObject({ role: 'Developer', customRoleId: byName.QA.id });

    const toManager = await api(app)
      .patch(`${P}/users/${developer.userDoc.id}/role`)
      .set(...authHeader(admin.accessToken))
      .send({ role: 'Manager', customRoleId: null });
    expect(toManager.body.data).toMatchObject({ role: 'Manager', customRoleId: null });

    const adminWithCustom = await api(app)
      .patch(`${P}/users/${developer.userDoc.id}/role`)
      .set(...authHeader(admin.accessToken))
      .send({ role: 'Admin', customRoleId: byName.QA.id });
    expect(adminWithCustom.status).toBe(400);

    const audit = await api(app)
      .get(`${P}/audit-log?action=UserRoleChanged&limit=10`)
      .set(...authHeader(admin.accessToken));
    const changes = audit.body.data.map(
      (e: { metadata: { from: string; to: string } }) => e.metadata,
    );
    expect(changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ from: 'Developer', to: 'QA' }),
        expect.objectContaining({ from: 'QA', to: 'Manager' }),
      ]),
    );
  });

  it('project invites can grant a custom role', async () => {
    const { admin, byName } = await setup();
    const project = await createProject(app, admin.accessToken, { name: 'Invite Role Project' });

    const invite = await api(app)
      .post(`${P}/projects/${project.id}/invites`)
      .set(...authHeader(admin.accessToken))
      .send({ email: 'designer@example.com', role: 'Developer', customRoleId: byName.Designer.id });
    expect(invite.status).toBe(201);
    expect(invite.body.data.invite.customRoleId).toBe(byName.Designer.id);
    const token = invite.body.data.inviteUrl.split('/invite/')[1];

    const preview = await api(app).get(`${P}/auth/invites/${token}`);
    expect(preview.body.data.role).toBe('Designer');

    const accepted = await api(app)
      .post(`${P}/auth/invites/${token}/accept`)
      .send({ temporaryPassword: invite.body.data.temporaryPassword });
    expect(accepted.body.data.user).toMatchObject({
      role: 'Developer',
      customRoleId: byName.Designer.id,
      customRole: { name: 'Designer' },
    });
  });
});
