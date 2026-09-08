import { INestApplication } from '@nestjs/common';
import { Role } from 'src/common/enums/role.enum';
import { TaskPriority } from 'src/common/enums/task-priority.enum';
import {
  API_PREFIX,
  createTestApp,
  closeTestApp,
  clearInMemoryMongo,
  seedOrganization,
  seedUserAndLogin,
  authHeader,
} from './setup/test-app';
import { api, createProject, createTask } from './setup/fixtures';

/**
 * Confirms the API itself gates access by role (not just UI hiding), for a representative set
 * of endpoints across every module. Each case is read directly from the controller's @Roles()
 * decorator (or, where there's no decorator, from the service's own manual checks).
 */
describe('RBAC matrix (integration)', () => {
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

  async function seedRoleUsers() {
    const org = await seedOrganization(app);
    const admin = await seedUserAndLogin(app, {
      email: 'rbac-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'rbac-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'rbac-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, manager, developer };
  }

  it('POST /projects: Admin and Manager 201, Developer 403', async () => {
    const { admin, manager, developer } = await seedRoleUsers();
    const body = { name: 'RBAC Project' };

    const asAdmin = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(admin.accessToken))
      .send(body);
    expect(asAdmin.status).toBe(201);

    const asManager = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(manager.accessToken))
      .send(body);
    expect(asManager.status).toBe(201);

    const asDeveloper = await api(app)
      .post(`/${API_PREFIX}/projects`)
      .set(...authHeader(developer.accessToken))
      .send(body);
    expect(asDeveloper.status).toBe(403);
  });

  it('POST /tasks: Admin and Manager (owner) 201, Developer 403', async () => {
    const { admin, developer } = await seedRoleUsers();
    const project = await createProject(app, admin.accessToken, { name: 'Task RBAC Project' });

    const asAdmin = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(admin.accessToken))
      .send({ title: 'Admin task', project: project.id, priority: TaskPriority.P2 });
    expect(asAdmin.status).toBe(201);

    const asDeveloper = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Dev task', project: project.id, priority: TaskPriority.P2 });
    expect(asDeveloper.status).toBe(403);
  });

  it('PATCH /tasks/:id/status: assigned Developer 200, unassigned Developer 403', async () => {
    const { org, admin, developer } = await seedRoleUsers();
    const otherDeveloper = await seedUserAndLogin(app, {
      email: 'rbac-developer-2@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, admin.accessToken, {
      name: 'Status RBAC Project',
      memberIds: [developer.userDoc.id, otherDeveloper.userDoc.id],
    });
    const task = await createTask(app, admin.accessToken, {
      title: 'Assigned task',
      project: project.id,
      priority: TaskPriority.P2,
      assignee: developer.userDoc.id,
    });

    const asOwner = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(developer.accessToken))
      .send({ status: 'In Progress' });
    expect(asOwner.status).toBe(200);

    const asOther = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}/status`)
      .set(...authHeader(otherDeveloper.accessToken))
      .send({ status: 'Review' });
    expect(asOther.status).toBe(403);
  });

  it('GET /users: Admin 200, Manager/Developer 403', async () => {
    const { admin, manager, developer } = await seedRoleUsers();

    const asAdmin = await api(app)
      .get(`/${API_PREFIX}/users`)
      .set(...authHeader(admin.accessToken));
    expect(asAdmin.status).toBe(200);

    const asManager = await api(app)
      .get(`/${API_PREFIX}/users`)
      .set(...authHeader(manager.accessToken));
    expect(asManager.status).toBe(403);

    const asDeveloper = await api(app)
      .get(`/${API_PREFIX}/users`)
      .set(...authHeader(developer.accessToken));
    expect(asDeveloper.status).toBe(403);
  });

  it('GET /dashboard/developer-workload: Admin/Manager 200, Developer 403', async () => {
    const { admin, manager, developer } = await seedRoleUsers();

    const asAdmin = await api(app)
      .get(`/${API_PREFIX}/dashboard/developer-workload`)
      .set(...authHeader(admin.accessToken));
    expect(asAdmin.status).toBe(200);

    const asManager = await api(app)
      .get(`/${API_PREFIX}/dashboard/developer-workload`)
      .set(...authHeader(manager.accessToken));
    expect(asManager.status).toBe(200);

    const asDeveloper = await api(app)
      .get(`/${API_PREFIX}/dashboard/developer-workload`)
      .set(...authHeader(developer.accessToken));
    expect(asDeveloper.status).toBe(403);
  });

  it('GET /dashboard/summary: any authenticated role gets 200 (no @Roles restriction)', async () => {
    const { admin, manager, developer } = await seedRoleUsers();
    for (const { accessToken } of [admin, manager, developer]) {
      const res = await api(app)
        .get(`/${API_PREFIX}/dashboard/summary`)
        .set(...authHeader(accessToken));
      expect(res.status).toBe(200);
    }
  });

  it('unauthenticated requests get 401 on a protected route', async () => {
    const res = await api(app).get(`/${API_PREFIX}/projects`);
    expect(res.status).toBe(401);
  });

  it('DELETE /projects/:id: Developer 403 even as a project member', async () => {
    const { admin, developer } = await seedRoleUsers();
    const project = await createProject(app, admin.accessToken, {
      name: 'Delete RBAC Project',
      memberIds: [developer.userDoc.id],
    });
    const res = await api(app)
      .delete(`/${API_PREFIX}/projects/${project.id}`)
      .set(...authHeader(developer.accessToken));
    expect(res.status).toBe(403);
  });
});
