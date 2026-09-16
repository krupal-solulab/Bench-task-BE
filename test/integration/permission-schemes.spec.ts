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
import { api, createProject, addMembers, createTask } from './setup/fixtures';

describe('permission schemes (integration)', () => {
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

  async function seedOrgWithAdminAndDev(adminEmail = 'ps-admin@example.com') {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: adminEmail,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: `dev-${adminEmail}`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, developer };
  }

  it('starts with no permission schemes (regression)', async () => {
    const { admin } = await seedOrgWithAdminAndDev();
    const res = await api(app)
      .get(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('a project with no scheme assigned behaves exactly as before this feature (regression)', async () => {
    const { admin, developer } = await seedOrgWithAdminAndDev();
    const project = await createProject(app, admin.accessToken, { name: 'Unscoped Project' });
    await addMembers(app, admin.accessToken, project.id, [developer.userDoc.id]);

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Should be denied', project: project.id, priority: 'P2' });
    expect(res.status).toBe(403);
  });

  it('a scheme grant lets a Developer create issues in a project it is assigned to, but not elsewhere', async () => {
    const { admin, developer } = await seedOrgWithAdminAndDev();
    const project = await createProject(app, admin.accessToken, { name: 'Scheme Project' });
    const otherProject = await createProject(app, admin.accessToken, { name: 'Other Project' });
    await addMembers(app, admin.accessToken, project.id, [developer.userDoc.id]);
    await addMembers(app, admin.accessToken, otherProject.id, [developer.userDoc.id]);

    const scheme = await api(app)
      .post(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Open',
        grants: [{ action: 'CreateIssue', allowedRoles: ['Developer'], allowedUserIds: [] }],
      });
    expect(scheme.status).toBe(201);

    const assign = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ permissionSchemeId: scheme.body.data.id });
    expect(assign.status).toBe(200);
    expect(assign.body.data.permissionSchemeId).toBe(scheme.body.data.id);

    const allowed = await createTask(app, developer.accessToken, {
      title: 'Now allowed',
      project: project.id,
      priority: 'P2',
    });
    expect(allowed.title).toBe('Now allowed');

    const stillDenied = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Still denied', project: otherProject.id, priority: 'P2' });
    expect(stillDenied.status).toBe(403);
  });

  it('a scheme can grant Assign to a named individual, a capability with no legacy per-member flag', async () => {
    const { admin, developer } = await seedOrgWithAdminAndDev();
    const project = await createProject(app, admin.accessToken, { name: 'Assign Project' });
    await addMembers(app, admin.accessToken, project.id, [developer.userDoc.id]);
    const task = await createTask(app, admin.accessToken, {
      title: 'Reassign me',
      project: project.id,
      priority: 'P2',
    });

    const deniedBefore = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/assignee`)
      .set(...authHeader(developer.accessToken))
      .send({ assignee: developer.userDoc.id });
    expect(deniedBefore.status).toBe(403);

    const scheme = await api(app)
      .post(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Individual grant',
        grants: [{ action: 'Assign', allowedRoles: [], allowedUserIds: [developer.userDoc.id] }],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ permissionSchemeId: scheme.body.data.id });

    const allowedAfter = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/assignee`)
      .set(...authHeader(developer.accessToken))
      .send({ assignee: developer.userDoc.id });
    expect(allowedAfter.status).toBe(200);
  });

  it('Admin and owning Manager are never blocked by any scheme (regression)', async () => {
    const { org, admin } = await seedOrgWithAdminAndDev();
    const manager = await seedUserAndLogin(app, {
      email: 'ps-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, { name: 'Manager Project' });

    const scheme = await api(app)
      .post(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Nobody allowed', grants: [] });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ permissionSchemeId: scheme.body.data.id });

    const managerCreates = await createTask(app, manager.accessToken, {
      title: 'Manager can always',
      project: project.id,
      priority: 'P2',
    });
    expect(managerCreates.title).toBe('Manager can always');
  });

  it('rejects deleting a scheme currently assigned to a project', async () => {
    const { admin } = await seedOrgWithAdminAndDev();
    const project = await createProject(app, admin.accessToken, { name: 'In Use Project' });
    const scheme = await api(app)
      .post(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'In use', grants: [] });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ permissionSchemeId: scheme.body.data.id });

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/permission-schemes/${scheme.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deleted.status).toBe(400);

    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ permissionSchemeId: null });
    const deletedAfterUnassign = await api(app)
      .delete(`/${API_PREFIX}/permission-schemes/${scheme.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deletedAfterUnassign.status).toBe(204);
  });

  it("never lets an Admin from a different org see or edit another org's scheme", async () => {
    const { admin: ownerAdmin } = await seedOrgWithAdminAndDev('ps-owner-org@example.com');
    const { admin: strangerAdmin } = await seedOrgWithAdminAndDev('ps-stranger-org@example.com');

    const scheme = await api(app)
      .post(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(ownerAdmin.accessToken))
      .send({ name: 'Private to org A', grants: [] });

    const strangerList = await api(app)
      .get(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(strangerAdmin.accessToken));
    expect(strangerList.body.data).toEqual([]);

    const strangerUpdate = await api(app)
      .patch(`/${API_PREFIX}/permission-schemes/${scheme.body.data.id}`)
      .set(...authHeader(strangerAdmin.accessToken))
      .send({ name: 'Hijacked' });
    expect(strangerUpdate.status).toBe(404);
  });

  it('rejects a scheme grant naming a user id outside the organization', async () => {
    const { admin } = await seedOrgWithAdminAndDev();
    const res = await api(app)
      .post(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Bad grant',
        grants: [
          { action: 'Delete', allowedRoles: [], allowedUserIds: ['507f1f77bcf86cd799439099'] },
        ],
      });
    expect(res.status).toBe(400);
  });
});
