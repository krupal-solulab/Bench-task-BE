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
import { api, createProject } from './setup/fixtures';

describe('project roles (Module 6 - Teams, Project Roles & Security Schemes)', () => {
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

  async function seedFixtures() {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: 'pr-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'pr-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'pr-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, manager, developer };
  }

  it('starts with no project roles (regression)', async () => {
    const { admin } = await seedFixtures();
    const res = await api(app)
      .get(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('an Admin creates a project role', async () => {
    const { admin } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'QA Lead', description: 'Owns test sign-off' });
    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('QA Lead');
  });

  it('rejects project role creation from a Manager (Admin-only, mirrors Permission Schemes)', async () => {
    const { manager } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Not allowed' });
    expect(res.status).toBe(403);
  });

  it('rejects a duplicate project role name within the same org', async () => {
    const { admin } = await seedFixtures();
    await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Duplicate' });
    const res = await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Duplicate' });
    expect(res.status).toBe(400);
  });

  it('assigns users and teams to a project role on a specific project, resolved via Permission Scheme grants', async () => {
    const { admin, manager, developer } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, {
      name: 'Role Project',
      memberIds: [developer.userDoc.id],
    });

    const role = await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Deployers' });

    const assign = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/role-assignments/${role.body.data.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ userIds: [developer.userDoc.id] });
    expect(assign.status).toBe(200);
    expect(assign.body.data.roleAssignments).toEqual([
      { projectRoleId: role.body.data.id, userIds: [developer.userDoc.id], teamIds: [] },
    ]);

    // A Permission Scheme grant naming the Project Role (not the user or global role directly) -
    // proves the role assignment is actually consulted by the grant-checking path.
    const scheme = await api(app)
      .post(`/${API_PREFIX}/permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Deployers can delete',
        grants: [
          {
            action: 'Delete',
            allowedRoles: [],
            allowedUserIds: [],
            allowedProjectRoleIds: [role.body.data.id],
          },
        ],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ permissionSchemeId: scheme.body.data.id });

    const task = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({ title: 'Deletable', project: project.id, priority: 'P2' });

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/tasks/${task.body.data.id}`)
      .set(...authHeader(developer.accessToken));
    expect(deleted.status).toBe(204);
  });

  it('rejects a role assignment naming a project role from another organization', async () => {
    const { manager } = await seedFixtures();
    const otherOrg = await seedOrganization(app);
    const otherAdmin = await seedUserAndLogin(app, {
      email: 'pr-other-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: otherOrg.id,
    });
    const foreignRole = await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(otherAdmin.accessToken))
      .send({ name: 'Foreign role' });
    const project = await createProject(app, manager.accessToken, { name: 'My Project' });

    const res = await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/role-assignments/${foreignRole.body.data.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ userIds: [] });
    expect(res.status).toBe(400);
  });

  it('rejects deleting a project role currently assigned on a project', async () => {
    const { admin, manager } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, { name: 'In Use Project' });
    const role = await api(app)
      .post(`/${API_PREFIX}/project-roles`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'In use role' });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/role-assignments/${role.body.data.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ userIds: [] });

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/project-roles/${role.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deleted.status).toBe(400);
  });
});
