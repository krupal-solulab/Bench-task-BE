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
import { api, createProject, createTask } from './setup/fixtures';

describe('security schemes (Module 6 - Teams, Project Roles & Security Schemes)', () => {
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
      email: 'ss-admin@example.com',
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: 'ss-manager@example.com',
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: 'ss-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    const otherDeveloper = await seedUserAndLogin(app, {
      email: 'ss-other-developer@example.com',
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, manager, developer, otherDeveloper };
  }

  it('starts with no security schemes (regression)', async () => {
    const { admin } = await seedFixtures();
    const res = await api(app)
      .get(`/${API_PREFIX}/security-schemes`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects security scheme creation from a Manager (Admin-only)', async () => {
    const { manager } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/security-schemes`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Not allowed', levels: [] });
    expect(res.status).toBe(403);
  });

  it('a task with no securityLevel is unaffected by a scheme (regression)', async () => {
    const { admin, manager, developer } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, {
      name: 'Unrestricted Project',
      memberIds: [developer.userDoc.id],
    });
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

    const task = await createTask(app, manager.accessToken, {
      title: 'Plain task',
      project: project.id,
      priority: 'P2',
    });

    const devView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(devView.status).toBe(200);
  });

  it('blocks a project member from viewing a task set to a level they are not granted', async () => {
    const { admin, manager, developer } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, {
      name: 'Restricted Project',
      memberIds: [developer.userDoc.id],
    });
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

    const task = await createTask(app, manager.accessToken, {
      title: 'Secret task',
      project: project.id,
      priority: 'P2',
      securityLevel: 'Confidential',
    });

    const devView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(devView.status).toBe(403);

    const managerView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken));
    expect(managerView.status).toBe(200);
  });

  it('excludes a restricted task from list/search results for a user without view access', async () => {
    const { admin, manager, developer } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, {
      name: 'List Filter Project',
      memberIds: [developer.userDoc.id],
    });
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

    await createTask(app, manager.accessToken, {
      title: 'Visible task',
      project: project.id,
      priority: 'P2',
    });
    await createTask(app, manager.accessToken, {
      title: 'Secret task',
      project: project.id,
      priority: 'P2',
      securityLevel: 'Confidential',
    });

    const devList = await api(app)
      .get(`/${API_PREFIX}/tasks?project=${project.id}`)
      .set(...authHeader(developer.accessToken));
    expect(devList.body.meta.total).toBe(1);
    expect(devList.body.data[0].title).toBe('Visible task');

    const managerList = await api(app)
      .get(`/${API_PREFIX}/tasks?project=${project.id}`)
      .set(...authHeader(manager.accessToken));
    expect(managerList.body.meta.total).toBe(2);
  });

  it('a user granted the level by individual user id can view it', async () => {
    const { admin, manager, developer, otherDeveloper } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, {
      name: 'Individual Grant Project',
      memberIds: [developer.userDoc.id, otherDeveloper.userDoc.id],
    });
    const scheme = await api(app)
      .post(`/${API_PREFIX}/security-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Confidentiality',
        levels: [
          { name: 'Confidential', allowedRoles: [], allowedUserIds: [developer.userDoc.id] },
        ],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/security-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ securitySchemeId: scheme.body.data.id });

    const task = await createTask(app, manager.accessToken, {
      title: 'Secret task',
      project: project.id,
      priority: 'P2',
      securityLevel: 'Confidential',
    });

    const grantedView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(grantedView.status).toBe(200);

    const ungranted = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(otherDeveloper.accessToken));
    expect(ungranted.status).toBe(403);
  });

  it('rejects setting a task to a security level not defined in the project scheme', async () => {
    const { admin, manager } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, { name: 'Level Check Project' });
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

    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({ title: 'Bad level', project: project.id, priority: 'P2', securityLevel: 'Nope' });
    expect(res.status).toBe(400);
  });

  it('rejects setting a securityLevel on a project with no scheme assigned', async () => {
    const { manager } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, { name: 'No Scheme Project' });
    const res = await api(app)
      .post(`/${API_PREFIX}/tasks`)
      .set(...authHeader(manager.accessToken))
      .send({ title: 'Bad level', project: project.id, priority: 'P2', securityLevel: 'Anything' });
    expect(res.status).toBe(400);
  });

  it('rejects deleting a scheme currently assigned to a project', async () => {
    const { admin, manager } = await seedFixtures();
    const project = await createProject(app, manager.accessToken, { name: 'In Use Project' });
    const scheme = await api(app)
      .post(`/${API_PREFIX}/security-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'In use', levels: [] });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/security-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ securitySchemeId: scheme.body.data.id });

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/security-schemes/${scheme.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deleted.status).toBe(400);
  });

  it('rejects a scheme with duplicate level names', async () => {
    const { admin } = await seedFixtures();
    const res = await api(app)
      .post(`/${API_PREFIX}/security-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Dupes',
        levels: [
          { name: 'Confidential', allowedRoles: [], allowedUserIds: [] },
          { name: 'Confidential', allowedRoles: [], allowedUserIds: [] },
        ],
      });
    expect(res.status).toBe(400);
  });
});
