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
import { api, createProject } from './setup/fixtures';

const P = `/${API_PREFIX}`;
const NONE = {
  canCreateTask: false,
  canEditAnyTask: false,
  canDeleteTask: false,
  canChangeAnyTaskStatus: false,
  canManageSprints: false,
  canManageProject: false,
};
type Rec = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

describe('role permissions: built-in roles, "Manage project", per-project overrides, org isolation', () => {
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

  /** One organization: its Admin, a QA and a plain Developer, and two projects with both in. */
  async function seedOrg(tag: string) {
    const org = await seedOrganization(app, { name: `Org ${tag}` });
    const admin = await seedUserAndLogin(app, {
      email: `admin-${tag}@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: `dev-${tag}@example.com`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const roles: Rec[] = (
      await api(app)
        .get(`${P}/custom-roles`)
        .set(...authHeader(admin.accessToken))
    ).body.data;
    const role = (name: string) => roles.find((r) => r.name === name)!;
    const qaCreate = await api(app)
      .post(`${P}/users`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: `QA ${tag}`,
        email: `qa-${tag}@example.com`,
        password: 'Password123',
        role: 'Developer',
        customRoleId: role('QA').id,
      });
    const qaUser = qaCreate.body.data;
    const p1 = await createProject(app, admin.accessToken, {
      name: `${tag} Project 1`,
      memberIds: [qaUser.id, developer.userDoc.id],
    });
    const p2 = await createProject(app, admin.accessToken, {
      name: `${tag} Project 2`,
      memberIds: [qaUser.id, developer.userDoc.id],
    });
    return { org, admin, developer, qaUser, role, roles, p1, p2 };
  }

  const qaLogin = (tag: string) => loginAs(app, `qa-${tag}@example.com`, 'Password123');
  const renameProject = (token: string, id: string, name: string) =>
    api(app)
      .patch(`${P}/projects/${id}`)
      .set(...authHeader(token))
      .send({ name });
  const setRolePerms = (token: string, roleId: string, permissions: Rec) =>
    api(app)
      .patch(`${P}/custom-roles/${roleId}`)
      .set(...authHeader(token))
      .send({ permissions });

  it('lists the built-in Manager and Developer roles first; their permissions are editable, nothing else', async () => {
    const { admin, roles, role } = await seedOrg('a');

    expect(roles.slice(0, 2).map((r) => [r.name, r.builtInRole])).toEqual([
      ['Manager', 'Manager'],
      ['Developer', 'Developer'],
    ]);
    expect(role('Developer')).toMatchObject({ permissions: NONE, memberCount: 1 });

    const rename = await api(app)
      .patch(`${P}/custom-roles/${role('Developer').id}`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Engineer' });
    expect(rename.status).toBe(400);
    const del = await api(app)
      .delete(`${P}/custom-roles/${role('Manager').id}`)
      .set(...authHeader(admin.accessToken));
    expect(del.status).toBe(403);
  });

  it('editing the built-in Developer role changes what every plain Developer may do', async () => {
    const { admin, developer, role, p1 } = await seedOrg('a');
    const create = () =>
      api(app)
        .post(`${P}/tasks`)
        .set(...authHeader(developer.accessToken))
        .send({ title: 'Dev task', project: p1.id, priority: TaskPriority.P2 });

    expect((await create()).status).toBe(403);
    await setRolePerms(admin.accessToken, role('Developer').id, { ...NONE, canCreateTask: true });
    expect((await create()).status).toBe(201);

    const me = await api(app)
      .get(`${P}/auth/me`)
      .set(...authHeader(developer.accessToken));
    expect(me.body.data).toMatchObject({
      roleId: role('Developer').id,
      rolePermissions: { canCreateTask: true },
    });
  });

  it("Admin A gives QA 'Manage project' - Admin B's QA (another organization) is unaffected", async () => {
    const A = await seedOrg('a');
    const B = await seedOrg('b');
    await setRolePerms(A.admin.accessToken, A.role('QA').id, {
      ...A.role('QA').permissions,
      canManageProject: true,
    });
    const qaA = await qaLogin('a');
    const qaB = await qaLogin('b');

    expect((await renameProject(qaA.accessToken, A.p1.id, 'Renamed by QA A')).status).toBe(200);
    expect((await renameProject(qaB.accessToken, B.p1.id, 'Nope')).status).toBe(403);

    // Each organization only ever sees and edits its own roles.
    const bRoles = await api(app)
      .get(`${P}/custom-roles`)
      .set(...authHeader(B.admin.accessToken));
    const bQa = bRoles.body.data.find((r: Rec) => r.name === 'QA');
    expect(bQa.id).not.toBe(A.role('QA').id);
    expect(bQa.permissions.canManageProject).toBe(false);
    const crossEdit = await setRolePerms(A.admin.accessToken, bQa.id, {
      ...NONE,
      canManageProject: true,
    });
    expect(crossEdit.status).toBe(404);
    const crossOverride = await api(app)
      .put(`${P}/projects/${B.p1.id}/role-permissions/${bQa.id}`)
      .set(...authHeader(A.admin.accessToken))
      .send({ ...NONE, canManageProject: true });
    expect(crossOverride.status).toBe(403);
  });

  it('a per-project override: QA manages Project 1 but not Project 2 (same organization)', async () => {
    const { admin, role, p1, p2 } = await seedOrg('a');
    const override = await api(app)
      .put(`${P}/projects/${p1.id}/role-permissions/${role('QA').id}`)
      .set(...authHeader(admin.accessToken))
      .send({ ...role('QA').permissions, canManageProject: true });
    expect(override.status).toBe(200);
    const row = override.body.data.find((r: Rec) => r.name === 'QA');
    expect(row).toMatchObject({
      override: { canManageProject: true },
      effective: { canManageProject: true },
    });

    const qa = await qaLogin('a');
    expect((await renameProject(qa.accessToken, p1.id, 'QA manages P1')).status).toBe(200);
    expect((await renameProject(qa.accessToken, p2.id, 'Not P2')).status).toBe(403);

    // An override can also take permissions away in one project only.
    const restrict = await api(app)
      .put(`${P}/projects/${p2.id}/role-permissions/${role('QA').id}`)
      .set(...authHeader(admin.accessToken))
      .send(NONE);
    expect(restrict.status).toBe(200);
    const createInP2 = await api(app)
      .post(`${P}/tasks`)
      .set(...authHeader(qa.accessToken))
      .send({ title: 'Task in P2', project: p2.id, priority: TaskPriority.P2 });
    expect(createInP2.status).toBe(403);
    const createInP1 = await api(app)
      .post(`${P}/tasks`)
      .set(...authHeader(qa.accessToken))
      .send({ title: 'Task in P1', project: p1.id, priority: TaskPriority.P2 });
    expect(createInP1.status).toBe(201);

    // Reset -> back to the organization defaults for that project.
    const reset = await api(app)
      .delete(`${P}/projects/${p1.id}/role-permissions/${role('QA').id}`)
      .set(...authHeader(admin.accessToken));
    expect(reset.body.data.find((r: Rec) => r.name === 'QA').override).toBeNull();
    expect((await renameProject(qa.accessToken, p1.id, 'Again')).status).toBe(403);
  });

  it("'Manage project' covers details, members, invites, sprints and settings - never delete, schemes or role permissions", async () => {
    const { admin, developer, role, p1, org } = await seedOrg('a');
    await setRolePerms(admin.accessToken, role('QA').id, { ...NONE, canManageProject: true });
    const qa = await qaLogin('a');
    const t = qa.accessToken;

    const other = await seedUserAndLogin(app, {
      email: 'another-dev@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const allowed = [
      await api(app)
        .patch(`${P}/projects/${p1.id}`)
        .set(...authHeader(t))
        .send({ description: 'by QA' }),
      await api(app)
        .post(`${P}/projects/${p1.id}/members`)
        .set(...authHeader(t))
        .send({ userIds: [other.userDoc.id] }),
      await api(app)
        .get(`${P}/projects/${p1.id}/member-candidates`)
        .set(...authHeader(t)),
      await api(app)
        .post(`${P}/projects/${p1.id}/invites`)
        .set(...authHeader(t))
        .send({ email: 'new-person@example.com', role: 'Developer' }),
      await api(app)
        .post(`${P}/projects/${p1.id}/sprints`)
        .set(...authHeader(t))
        .send({ name: 'Sprint QA', startDate: '2026-11-01', endDate: '2026-11-14' }),
      await api(app)
        .patch(`${P}/projects/${p1.id}/members/${developer.userDoc.id}/permissions`)
        .set(...authHeader(t))
        .send({ canCreateTask: true }),
      await api(app)
        .put(`${P}/projects/${p1.id}/components`)
        .set(...authHeader(t))
        .send({ names: ['API'] }),
    ];
    expect(allowed.map((r) => r.status)).toEqual([200, 201, 200, 201, 201, 200, 200]);

    const denied = [
      await api(app)
        .delete(`${P}/projects/${p1.id}`)
        .set(...authHeader(t)),
      await api(app)
        .patch(`${P}/projects/${p1.id}/permission-scheme`)
        .set(...authHeader(t))
        .send({ permissionSchemeId: null }),
      await api(app)
        .put(`${P}/projects/${p1.id}/role-permissions/${role('QA').id}`)
        .set(...authHeader(t))
        .send(NONE),
      await api(app)
        .post(`${P}/projects`)
        .set(...authHeader(t))
        .send({ name: 'QA project' }),
    ];
    expect(denied.map((r) => r.status)).toEqual([403, 403, 403, 403]);

    // A role-manager in Project 1 is nothing special in a project it is not a member of.
    const outside = await createProject(app, admin.accessToken, { name: 'Outside' });
    expect((await renameProject(t, outside.id, 'Not allowed here')).status).toBe(403);
  });
});
