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
import { api, createProject, createTask, addMembers } from './setup/fixtures';

/**
 * Module 11's Global Search (`GET /search`). Since SearchService is a thin composer over
 * TasksService.search()/ProjectsService.paginate()/UsersService.paginate() rather than new query
 * logic, these tests focus on proving that composition doesn't leak: org scoping, role-based
 * project visibility, and Module 6 security-level task exclusion must all still be enforced
 * exactly as they are on the underlying list/search endpoints.
 */
describe('global search (integration)', () => {
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

  async function seedAdmin(organizationId: string, email = 'search-admin@example.com') {
    return seedUserAndLogin(app, {
      email,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId,
    });
  }

  it('rejects a query shorter than 2 characters (400)', async () => {
    const org = await seedOrganization(app);
    const admin = await seedAdmin(org.id);
    const res = await api(app)
      .get(`/${API_PREFIX}/search`)
      .query({ q: 'a' })
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(400);
  });

  it('returns matching tasks, projects, and users in one call', async () => {
    const org = await seedOrganization(app);
    const admin = await seedAdmin(org.id);
    const zephyrUser = await seedUserAndLogin(app, {
      name: 'Zephyr Person',
      email: 'zephyr-person@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, admin.accessToken, { name: 'Zephyr Project' });
    const task = await createTask(app, admin.accessToken, {
      title: 'Zephyr Task',
      project: project.id,
      priority: 'P2',
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/search`)
      .query({ q: 'Zephyr' })
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.tasks.map((t: { id: string }) => t.id)).toContain(task.id);
    expect(res.body.data.projects.map((p: { id: string }) => p.id)).toContain(project.id);
    expect(res.body.data.users.map((u: { id: string }) => u.id)).toContain(zephyrUser.userDoc.id);
  });

  it("never surfaces another organization's matching tasks, projects, or users", async () => {
    const orgA = await seedOrganization(app);
    const adminA = await seedAdmin(orgA.id, 'search-admin-a@example.com');
    await seedUserAndLogin(app, {
      name: 'Zephyr Person A',
      email: 'zephyr-person-a@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: orgA.id,
    });
    const projectA = await createProject(app, adminA.accessToken, { name: 'Zephyr Project A' });
    await createTask(app, adminA.accessToken, {
      title: 'Zephyr Task A',
      project: projectA.id,
      priority: 'P2',
    });

    const orgB = await seedOrganization(app);
    const adminB = await seedAdmin(orgB.id, 'search-admin-b@example.com');

    const res = await api(app)
      .get(`/${API_PREFIX}/search`)
      .query({ q: 'Zephyr' })
      .set(...authHeader(adminB.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.tasks).toEqual([]);
    expect(res.body.data.projects).toEqual([]);
    expect(res.body.data.users).toEqual([]);
  });

  it("a Developer's search never surfaces a matching project they are not a member of", async () => {
    const org = await seedOrganization(app);
    const manager = await seedUserAndLogin(app, {
      email: 'search-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'search-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const visibleProject = await createProject(app, manager.accessToken, {
      name: 'Zephyr Visible Project',
    });
    await addMembers(app, manager.accessToken, visibleProject.id, [developer.userDoc.id]);
    const hiddenProject = await createProject(app, manager.accessToken, {
      name: 'Zephyr Hidden Project',
    });

    const res = await api(app)
      .get(`/${API_PREFIX}/search`)
      .query({ q: 'Zephyr' })
      .set(...authHeader(developer.accessToken));
    expect(res.status).toBe(200);
    const projectIds = res.body.data.projects.map((p: { id: string }) => p.id);
    expect(projectIds).toContain(visibleProject.id);
    expect(projectIds).not.toContain(hiddenProject.id);
  });

  it('respects Module 6 security-level task exclusion in search results', async () => {
    const org = await seedOrganization(app);
    const admin = await seedAdmin(org.id, 'search-security-admin@example.com');
    const manager = await seedUserAndLogin(app, {
      email: 'search-security-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'search-security-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const project = await createProject(app, manager.accessToken, {
      name: 'Zephyr Security Project',
    });
    await addMembers(app, manager.accessToken, project.id, [developer.userDoc.id]);
    const scheme = await api(app)
      .post(`/${API_PREFIX}/security-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Confidentiality',
        levels: [{ name: 'Confidential', allowedRoles: ['Manager'], allowedUserIds: [] }],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/security-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ securitySchemeId: scheme.body.data.id });

    const visibleTask = await createTask(app, manager.accessToken, {
      title: 'Zephyr Visible Task',
      project: project.id,
      priority: 'P2',
    });
    const secretTask = await createTask(app, manager.accessToken, {
      title: 'Zephyr Secret Task',
      project: project.id,
      priority: 'P2',
      securityLevel: 'Confidential',
    });

    const devSearch = await api(app)
      .get(`/${API_PREFIX}/search`)
      .query({ q: 'Zephyr' })
      .set(...authHeader(developer.accessToken));
    expect(devSearch.status).toBe(200);
    const devTaskIds = devSearch.body.data.tasks.map((t: { id: string }) => t.id);
    expect(devTaskIds).toContain(visibleTask.id);
    expect(devTaskIds).not.toContain(secretTask.id);

    const managerSearch = await api(app)
      .get(`/${API_PREFIX}/search`)
      .query({ q: 'Zephyr' })
      .set(...authHeader(manager.accessToken));
    const managerTaskIds = managerSearch.body.data.tasks.map((t: { id: string }) => t.id);
    expect(managerTaskIds).toContain(visibleTask.id);
    expect(managerTaskIds).toContain(secretTask.id);
  });
});
