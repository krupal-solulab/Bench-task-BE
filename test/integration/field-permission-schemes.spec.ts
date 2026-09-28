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

describe('field permission schemes (Module 12 - integration)', () => {
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

  async function seedFixtures(suffix: string) {
    const org = await seedOrganization(app, { name: `Field Perm Org ${suffix}` });
    const admin = await seedUserAndLogin(app, {
      email: `fp-admin-${suffix}@example.com`,
      password: 'Password123',
      role: Role.ADMIN,
      organizationId: org.id,
    });
    const manager = await seedUserAndLogin(app, {
      email: `fp-manager-${suffix}@example.com`,
      password: 'Password123',
      role: Role.MANAGER,
      organizationId: org.id,
    });
    const developer = await seedUserAndLogin(app, {
      email: `fp-dev-${suffix}@example.com`,
      password: 'Password123',
      role: Role.DEVELOPER,
      organizationId: org.id,
    });
    return { org, admin, manager, developer };
  }

  it('starts with no field permission schemes (regression)', async () => {
    const { admin } = await seedFixtures('empty');
    const res = await api(app)
      .get(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([]);
  });

  it('rejects scheme creation from a Manager (Admin-only)', async () => {
    const { manager } = await seedFixtures('roles');
    const res = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Not allowed', rules: [] });
    expect(res.status).toBe(403);
  });

  it('lets any org role (not just Admin) read the scheme list - TaskForm needs it to compute per-field access for every role', async () => {
    const { admin, manager, developer } = await seedFixtures('read-access');
    await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Readable by all', rules: [] });

    const managerList = await api(app)
      .get(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(manager.accessToken));
    expect(managerList.status).toBe(200);
    expect(managerList.body.data).toHaveLength(1);

    const devList = await api(app)
      .get(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(developer.accessToken));
    expect(devList.status).toBe(200);
    expect(devList.body.data).toHaveLength(1);
  });

  it('rejects updating or deleting a scheme from a Manager (Admin-only)', async () => {
    const { admin, manager } = await seedFixtures('write-gate');
    const scheme = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'Gate check', rules: [] });

    const update = await api(app)
      .patch(`/${API_PREFIX}/field-permission-schemes/${scheme.body.data.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ name: 'Hijacked' });
    expect(update.status).toBe(403);

    const remove = await api(app)
      .delete(`/${API_PREFIX}/field-permission-schemes/${scheme.body.data.id}`)
      .set(...authHeader(manager.accessToken));
    expect(remove.status).toBe(403);
  });

  it('a field with no rule stays fully open for everyone (regression)', async () => {
    const { admin, manager, developer } = await seedFixtures('open');
    const project = await createProject(app, manager.accessToken, {
      name: 'Open Project',
      memberIds: [developer.userDoc.id],
    });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/members/${developer.userDoc.id}/permissions`)
      .set(...authHeader(manager.accessToken))
      .send({ canEditAnyTask: true });
    const scheme = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Restrictions',
        rules: [{ fieldId: 'priority', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] }],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/field-permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ fieldPermissionSchemeId: scheme.body.data.id });

    const task = await createTask(app, manager.accessToken, {
      title: 'Untouched field task',
      project: project.id,
      priority: 'P2',
      dueDate: '2030-01-01T00:00:00.000Z',
    });

    const devEdit = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken))
      .send({ dueDate: '2030-02-02T00:00:00.000Z' });
    expect(devEdit.status).toBe(200);
    expect(devEdit.body.data.dueDate).toBe('2030-02-02T00:00:00.000Z');
  });

  it('hiddenFromRoles: a Developer cannot see the field value on the single-task read', async () => {
    const { admin, manager, developer } = await seedFixtures('hidden-view');
    const project = await createProject(app, manager.accessToken, {
      name: 'Hidden Field Project',
      memberIds: [developer.userDoc.id],
    });
    const scheme = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Confidentiality',
        rules: [{ fieldId: 'priority', hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] }],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/field-permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ fieldPermissionSchemeId: scheme.body.data.id });

    const task = await createTask(app, manager.accessToken, {
      title: 'Secret priority task',
      project: project.id,
      priority: 'P1',
    });

    const devView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(devView.status).toBe(200);
    expect(devView.body.data.priority).toBeNull();

    const managerView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken));
    expect(managerView.body.data.priority).toBe('P1');
  });

  it('readOnlyForRoles: a Developer can view but not edit the field; editing an unrelated field still works', async () => {
    const { admin, manager, developer } = await seedFixtures('readonly');
    const project = await createProject(app, manager.accessToken, {
      name: 'Read Only Field Project',
      memberIds: [developer.userDoc.id],
    });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/members/${developer.userDoc.id}/permissions`)
      .set(...authHeader(manager.accessToken))
      .send({ canEditAnyTask: true });
    const scheme = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Locked priority',
        rules: [{ fieldId: 'priority', hiddenFromRoles: [], readOnlyForRoles: [Role.DEVELOPER] }],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/field-permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ fieldPermissionSchemeId: scheme.body.data.id });

    const task = await createTask(app, manager.accessToken, {
      title: 'Locked priority task',
      project: project.id,
      priority: 'P2',
    });

    const devView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(devView.body.data.priority).toBe('P2');

    const devEditPriority = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken))
      .send({ priority: 'P1' });
    expect(devEditPriority.status).toBe(403);

    const devEditTitle = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken))
      .send({ title: 'Renamed by dev' });
    expect(devEditTitle.status).toBe(200);
    expect(devEditTitle.body.data.title).toBe('Renamed by dev');

    const managerEditPriority = await api(app)
      .patch(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken))
      .send({ priority: 'P1' });
    expect(managerEditPriority.status).toBe(200);
  });

  it('restricts a custom field id the same way as a built-in field', async () => {
    const { admin, manager, developer } = await seedFixtures('custom-field');
    const project = await createProject(app, manager.accessToken, {
      name: 'Custom Field Restriction Project',
      memberIds: [developer.userDoc.id],
    });
    const customFields = await api(app)
      .put(`/${API_PREFIX}/projects/${project.id}/custom-fields`)
      .set(...authHeader(admin.accessToken))
      .send({
        fields: [{ name: 'Customer Contact', type: 'Text', required: false }],
      });
    const fieldId = customFields.body.data.customFields[0].id;

    const scheme = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Hide customer contact',
        rules: [{ fieldId, hiddenFromRoles: [Role.DEVELOPER], readOnlyForRoles: [] }],
      });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/field-permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ fieldPermissionSchemeId: scheme.body.data.id });

    const task = await createTask(app, manager.accessToken, {
      title: 'Custom field task',
      project: project.id,
      priority: 'P2',
      customFieldValues: { [fieldId]: 'jane@customer.example' },
    });

    const devView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(developer.accessToken));
    expect(devView.body.data.customFieldValues[fieldId]).toBeUndefined();

    const managerView = await api(app)
      .get(`/${API_PREFIX}/tasks/${task.id}`)
      .set(...authHeader(manager.accessToken));
    expect(managerView.body.data.customFieldValues[fieldId]).toBe('jane@customer.example');
  });

  it('rejects unassigning by deleting a scheme currently assigned to a project', async () => {
    const { admin, manager } = await seedFixtures('in-use');
    const project = await createProject(app, manager.accessToken, { name: 'In Use Project' });
    const scheme = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({ name: 'In use', rules: [] });
    await api(app)
      .patch(`/${API_PREFIX}/projects/${project.id}/field-permission-scheme`)
      .set(...authHeader(admin.accessToken))
      .send({ fieldPermissionSchemeId: scheme.body.data.id });

    const deleted = await api(app)
      .delete(`/${API_PREFIX}/field-permission-schemes/${scheme.body.data.id}`)
      .set(...authHeader(admin.accessToken));
    expect(deleted.status).toBe(400);
  });

  it('rejects a scheme with duplicate fieldIds', async () => {
    const { admin } = await seedFixtures('dupes');
    const res = await api(app)
      .post(`/${API_PREFIX}/field-permission-schemes`)
      .set(...authHeader(admin.accessToken))
      .send({
        name: 'Dupes',
        rules: [
          { fieldId: 'priority', hiddenFromRoles: [], readOnlyForRoles: [] },
          { fieldId: 'priority', hiddenFromRoles: [], readOnlyForRoles: [] },
        ],
      });
    expect(res.status).toBe(400);
  });
});
